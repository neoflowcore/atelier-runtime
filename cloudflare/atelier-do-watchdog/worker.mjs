import { createHash } from 'node:crypto';
import { createCloudflareD1DigitalOceanJournalV1 } from '../../runtime/rev52/cloudflare-d1-do-journal-v1.mjs';

const MAX_BODY_BYTES = 65536;
const CRON_FRESH_MS = 16 * 60 * 1000; // intended schedule: every 5 minutes
const RUN_PATH = /^\/v1\/runs\/([A-Za-z0-9][A-Za-z0-9._-]{0,79})(\/cas)?$/;
const publicError = (message, status) => Response.json({ok:false,code:message},{status,headers:{'Cache-Control':'no-store'}});
const info = (body, status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const sha = s => createHash('sha256').update(s,'utf8').digest();
function constantTimeEqual(actual, expected) {
  if(typeof actual!=='string'||typeof expected!=='string')return false;
  const a=sha(actual), b=sha(expected); let diff=actual.length^expected.length;
  for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
  return diff===0;
}
function authenticated(request,env) {
  const candidate=request.headers.get('Authorization')||'';
  const token=env.DO_JOURNAL_SHARED_SECRET;
  return typeof token==='string'&&token.length>=32&&constantTimeEqual(candidate,`Bearer ${token}`);
}
function writable(env) {
  return env.DO_SCHEDULER_ENABLED==='YES' && env.DO_ENABLE_LEASE_CLEANUP==='YES' &&
    typeof env.DIGITALOCEAN_TOKEN==='string' && env.DIGITALOCEAN_TOKEN.length>=8;
}
async function readiness(store,env,ms) {
  const heartbeat=await store.getHeartbeat();
  const lastStatus=await store.getWatchStatus();
  const healthy=Number.isSafeInteger(heartbeat)&&heartbeat<=ms&&ms-heartbeat<=CRON_FRESH_MS;
  return {ready:writable(env)&&healthy&&lastStatus==='OK',lastHeartbeatAtMs:heartbeat,cronFresh:healthy,watchStatus:lastStatus,
    cleanupEnabled:env.DO_ENABLE_LEASE_CLEANUP==='YES',schema:'ATELIER_DO_WATCHDOG_STATUS_V1'};
}
async function getBody(request) {
  const n=Number(request.headers.get('content-length')??'0');
  if(n>MAX_BODY_BYTES) throw new Error('DO_WATCHDOG_BODY_TOO_LARGE');
  const text=await request.text();
  if(text.length>MAX_BODY_BYTES)throw new Error('DO_WATCHDOG_BODY_TOO_LARGE');
  try{return JSON.parse(text);}catch{throw new Error('DO_WATCHDOG_INVALID_JSON');}
}

// Injected clock and provider factory only for hermetic, no-network tests.
export function createAtelierDigitalOceanWatchdogWorkerV1({now=Date.now,providerFactory,controllerFactory}={}) {
  async function loadProvider(env) {
    if (providerFactory) return providerFactory(env);
    const mod=await import('../../runtime/rev52/digitalocean-rest-provider-v1.mjs');
    return mod.createDigitalOceanRestProviderV1({bearerToken:env.DIGITALOCEAN_TOKEN,now});
  }
  async function loadController(store,provider) {
    if (controllerFactory) return controllerFactory({store,provider});
    const mod=await import('../../runtime/rev52/digitalocean-guardrails-v1.mjs');
    return mod.createDigitalOceanGuardedControllerV1({store,provider});
  }
  return Object.freeze({
    async fetch(request,env) {
      if(!authenticated(request,env))return publicError('UNAUTHORIZED',401);
      if(!env.DO_WATCHDOG_DB) return publicError('JOURNAL_UNAVAILABLE',503);
      const store=createCloudflareD1DigitalOceanJournalV1({db:env.DO_WATCHDOG_DB,now});
      const url=new URL(request.url), route=RUN_PATH.exec(url.pathname);
      try {
        if(request.method==='GET'&&url.pathname==='/v1/health'){
          const status=await readiness(store,env,now());
          return info({ok:true,...status});
        }
        if(route&&request.method==='GET'&&!route[2]){
          const item=await store.read(route[1]);
          return item?info({ok:true,run:item}):publicError('RUN_NOT_FOUND',404);
        }
        if(route&&route[2]==='/cas'&&request.method==='POST') {
          const payload=await getBody(request);
          if(!payload||!Number.isSafeInteger(payload.expectedRevision))return publicError('EXPECTED_REVISION_REQUIRED',400);
          // A run may only be admitted while the independent off-VM watchdog has actually heartbeated.
          if(payload.expectedRevision===0) {
            const status=await readiness(store,env,now());
            if(!status.ready)return publicError('EXTERNAL_WATCHDOG_NOT_READY',503);
          }
          let freshUsage;
          if(payload.expectedRevision===0){
            const expiry=payload.next?.lease?.expiresAtMs;
            if(!Number.isSafeInteger(expiry) || expiry<=now() || expiry>now()+21600_000)return publicError('LEASE_TTL_OR_EXPIRY_INVALID',400);
            try{
              const provider=await loadProvider(env);
              const usage=await provider.readMonthlyUsageMilliUsd();
              if(usage?.complete!==true || !Number.isSafeInteger(usage.value) || !Number.isSafeInteger(usage.observedAtMs) || usage.observedAtMs>now() || now()-usage.observedAtMs>15*60*1000)
                return publicError('BILLING_FRESHNESS_REQUIRED',503);
              freshUsage=usage.value;
            }catch{return publicError('BILLING_FRESHNESS_REQUIRED',503);}
          }
          const run=await store.cas(route[1],payload.expectedRevision,payload.next,{monthToDateUsageMilliUsd:freshUsage});
          return info({ok:true,run});
        }
        return publicError('METHOD_OR_PATH_NOT_ALLOWED',404);
      } catch(e) {
        const code=String(e?.message||'');
        if(code==='DO_D1_CAS_CONFLICT')return publicError(code,409);
        if(/^(DO_D1_|DO_WATCHDOG_)/.test(code))return publicError(code,400);
        return publicError('JOURNAL_UNAVAILABLE',503);
      }
    },
    async scheduled(_event,env,_ctx) {
      if(!env.DO_WATCHDOG_DB || !writable(env))return {ok:false,code:'WATCHDOG_DISARMED'};
      const store=createCloudflareD1DigitalOceanJournalV1({db:env.DO_WATCHDOG_DB,now});
      try {
        await store.setWatchStatus('DEGRADED');
        const provider=await loadProvider(env);
        // Detect stale/invalid billing reads before advertising that paid work can be created.
        const usage=await provider.readMonthlyUsageMilliUsd();
        if(usage?.complete!==true||!Number.isSafeInteger(usage.value)||!Number.isSafeInteger(usage.observedAtMs)||
          usage.observedAtMs>now()||now()-usage.observedAtMs>15*60*1000)throw new Error('BILLING_PREFLIGHT_UNAVAILABLE');
        const active=await store.listActive(100); // overflow MUST NOT advertise a healthy scheduler
        const controller=await loadController(store,provider);
        const outcomes=[];
        for(const item of active) {
          try {
            const result=await controller.tick(item.runId,{nowMs:now(),monthToDateUsageMilliUsd:usage.value});
            outcomes.push({runId:item.runId,status:result.status});
          } catch { // Continue scanning others; heartbeat stays stale so future paid creates are blocked.
            outcomes.push({runId:item.runId,status:'ERROR'});
          }
        }
        // Unknown create/delete outcomes or unpaid residue must NOT advertise a healthy new-create gate.
        const unsafe=new Set(['ERROR','RECONCILIATION_REQUIRED','RESIDUE_PENDING','DELETE_OUTCOME_UNKNOWN','OWNED_DROPLET_STILL_PRESENT']);
        if(outcomes.some(x=>unsafe.has(x.status)))return {ok:false,code:'WATCHDOG_UNRESOLVED_RESOURCE',outcomes};
        await store.setHeartbeat(now());
        await store.setWatchStatus('OK');
        return {ok:true,code:'WATCHDOG_CYCLE_COMPLETE',count:active.length,outcomes};
      }catch {return {ok:false,code:'WATCHDOG_PREFLIGHT_OR_STORAGE_FAILURE'};}
    }
  });
}
export default createAtelierDigitalOceanWatchdogWorkerV1();
