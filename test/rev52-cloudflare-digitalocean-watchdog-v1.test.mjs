import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createCloudflareD1DigitalOceanJournalV1 } from '../runtime/rev52/cloudflare-d1-do-journal-v1.mjs';
import { createCloudflareRemoteDigitalOceanJournalV1 } from '../runtime/rev52/cloudflare-remote-do-journal-v1.mjs';
import { createAtelierDigitalOceanWatchdogWorkerV1 } from '../cloudflare/atelier-do-watchdog/worker.mjs';

const SECRET='a'.repeat(48),T0=Date.parse('2026-10-11T11:00:00Z');
function dbFixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../cloudflare/atelier-do-watchdog/migrations/0001_init.sql',import.meta.url),'utf8'));
  return {
    sqlite,
    d1:{prepare(sql){return{bind(...params){const statement=sqlite.prepare(sql);return{
      first:async()=>statement.get(...params)??null,
      all:async()=>({results:statement.all(...params)}),
      run:async()=>({meta:{changes:statement.run(...params).changes}})
    };},first:async()=>sqlite.prepare(sql).get()??null};}}
  };
}
function lease(now=T0){const body={
  runId:'run-A',resourceName:'atelier-run-A',ownershipTag:'atelier-run-'+'a'.repeat(24),
  exactSourceSha256:'c'.repeat(64),grantId:'grant-A',
  expiresAtMs:now+3600_000,estimatedLeaseMilliUsd:1000,costBufferMilliUsd:100,otherReservedMilliUsd:0,
  monthlyCapMilliUsd:5000,baselineChildKeys:[],baselineSnapshotIds:['91001'],protectedSnapshotIds:['91001']
};const sorted=v=>{if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return `[${v.map(sorted).join(',')}]`;return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${sorted(v[k])}`).join(',')}}`};return {...body,LEASE_SHA256:createHash('sha256').update(sorted(body)).digest('hex')};}
function initial(now=T0){return{schema:'DO_RUN_GUARDED_V1',runId:'run-A',state:'READY',revision:0,lease:lease(now),
  createAttempts:0,deleteAttempts:0,dropletId:null,artifactVerified:false,artifactDigest:null,closeReason:null};}
function withState(record,state,patch={}){return {...record,...patch,state};}
function fixture(){
  let time=T0;const disk=dbFixture();let usage=500, ticks=[],deletes=0, failTick=false, unresolved=false;
  const env={DO_WATCHDOG_DB:disk.d1,DO_JOURNAL_SHARED_SECRET:SECRET,DIGITALOCEAN_TOKEN:'do-fake-credential',DO_SCHEDULER_ENABLED:'YES',DO_ENABLE_LEASE_CLEANUP:'YES'};
  const provider={async readMonthlyUsageMilliUsd(){return{complete:true,value:usage,observedAtMs:time}},async deleteDroplet(){deletes++;}};
  const worker=createAtelierDigitalOceanWatchdogWorkerV1({now:()=>time,providerFactory:()=>provider,
    controllerFactory:({store,provider:p})=>({async tick(id,{nowMs,monthToDateUsageMilliUsd}){
      const run=await store.read(id);
      ticks.push(id);
      if(failTick)throw new Error('INJECTED_PROVIDER_FAILURE');
      if(unresolved)return{status:'RECONCILIATION_REQUIRED'};
      if(nowMs<run.lease.expiresAtMs && monthToDateUsageMilliUsd<run.lease.monthlyCapMilliUsd)return{status:run.state};
      if(run.state==='READY')return{status:'NO_RESOURCE_CREATED'};
      if(['BOUND','RUNNING'].includes(run.state)){
        await store.cas(id,run.revision,withState(run,'DELETE_OUTCOME_UNKNOWN',{deleteAttempts:run.deleteAttempts+1}));
        await p.deleteDroplet(run.dropletId);
        return{status:'DELETE_OUTCOME_UNKNOWN'};
      }
      return{status:run.state};
    }})});
  const call=(path,method='GET',body=null,token=SECRET)=>worker.fetch(new Request(`https://atelier-do-watchdog.example${path}`,{
    method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})
  }),env);
  return {disk,env,worker,provider,call,store:createCloudflareD1DigitalOceanJournalV1({db:disk.d1,now:()=>time}),
    clock(x){time=x;},usage(x){usage=x;},fail(x){failTick=x;},unresolved(x){unresolved=x;},get ticks(){return ticks;},get deletes(){return deletes;}, async heartbeat(){return worker.scheduled({cron:'*/5 * * * *'},env,{})}};
}

test('schema installs D1 tables and CAS record can be read',async()=>{
 const f=fixture();const x=await f.store.cas('run-A',0,initial(),{monthToDateUsageMilliUsd:500});assert.equal(x.revision,1);assert.equal((await f.store.read('run-A')).lease.protectedSnapshotIds[0],'91001');f.disk.sqlite.close();
});
test('unauthenticated journal requests are rejected',async()=>{const f=fixture();const r=await f.call('/v1/health','GET',null,'wrong');assert.equal(r.status,401);});
test('read-only health fails closed before first real cron heartbeat',async()=>{const f=fixture();assert.equal((await(await f.call('/v1/health')).json()).ready,false);});
test('cron heartbeat activates readiness when deletion gate and billing checks pass',async()=>{const f=fixture();assert.equal((await f.heartbeat()).ok,true);const h=await(await f.call('/v1/health')).json();assert.equal(h.ready,true);assert.equal(h.cleanupEnabled,true);});
test('disabled deletion gate prevents heartbeat and lease admission',async()=>{const f=fixture();f.env.DO_ENABLE_LEASE_CLEANUP='NO';assert.equal((await f.heartbeat()).ok,false);const r=await f.call('/v1/runs/run-A/cas','POST',{expectedRevision:0,next:initial()});assert.equal(r.status,503);assert.equal(await f.store.read('run-A'),null);});
test('missing DigitalOcean secret prevents admission',async()=>{const f=fixture();delete f.env.DIGITALOCEAN_TOKEN;assert.equal((await f.heartbeat()).ok,false);});
test('first lease admission waits for cron, then uses D1 CAS',async()=>{const f=fixture();await f.heartbeat();const r=await f.call('/v1/runs/run-A/cas','POST',{expectedRevision:0,next:initial()});assert.equal(r.status,200);assert.equal((await r.json()).run.revision,1);});
test('same run ID cannot be created twice via stale CAS',async()=>{const f=fixture();await f.heartbeat();await f.call('/v1/runs/run-A/cas','POST',{expectedRevision:0,next:initial()});const r=await f.call('/v1/runs/run-A/cas','POST',{expectedRevision:0,next:initial()});assert.equal(r.status,409);});
test('unrecognized path is not a privileged provider API proxy',async()=>{const f=fixture();assert.equal((await f.call('/v1/provision','POST',{})).status,404);});
test('D1 updates enforce state ordering',async()=>{const f=fixture();const r=await f.store.cas('run-A',0,initial(),{monthToDateUsageMilliUsd:500});await assert.rejects(f.store.cas('run-A',1,withState(r,'BOUND',{dropletId:77})),/DO_D1_JOURNAL_TRANSITION_DENIED/);});
test('immutable ownership tag cannot be changed between revisions',async()=>{const f=fixture();const r=await f.store.cas('run-A',0,initial(),{monthToDateUsageMilliUsd:500});const bad=withState(r,'CREATE_OUTCOME_UNKNOWN',{lease:{...r.lease,ownershipTag:'atelier-run-'+'b'.repeat(24)}});await assert.rejects(f.store.cas('run-A',1,bad),/DO_D1_LEASE_HASH_MISMATCH/);});
test('protected snapshot set is pinned by lease fingerprint',async()=>{const f=fixture();const r=await f.store.cas('run-A',0,initial(),{monthToDateUsageMilliUsd:500});const bad=withState(r,'CREATE_OUTCOME_UNKNOWN',{lease:{...r.lease,protectedSnapshotIds:[]}});await assert.rejects(f.store.cas('run-A',1,bad),/DO_D1_LEASE_HASH_MISMATCH/);});
test('droplet ID becomes immutable once bound',async()=>{const f=fixture();let r=await f.store.cas('run-A',0,initial(),{monthToDateUsageMilliUsd:500});r=await f.store.cas('run-A',1,withState(r,'CREATE_OUTCOME_UNKNOWN',{createAttempts:1}));r=await f.store.cas('run-A',2,withState(r,'BOUND',{dropletId:73}));await assert.rejects(f.store.cas('run-A',3,withState(r,'RUNNING',{dropletId:74})),/DO_D1_JOURNAL_TRANSITION_DENIED/);});
test('create attempts cannot exceed one',async()=>{const f=fixture();const r=await f.store.cas('run-A',0,initial(),{monthToDateUsageMilliUsd:500});await assert.rejects(f.store.cas('run-A',1,withState(r,'CREATE_OUTCOME_UNKNOWN',{createAttempts:2})),/DO_D1_JOURNAL_PAYLOAD_INVALID/);});
test('delete attempts cannot exceed two',async()=>{const f=fixture();const r=await f.store.cas('run-A',0,initial(),{monthToDateUsageMilliUsd:500});await assert.rejects(f.store.cas('run-A',1,withState(r,'CREATE_OUTCOME_UNKNOWN',{deleteAttempts:3})),/DO_D1_JOURNAL_PAYLOAD_INVALID/);});
test('remote CAS and read flow use authenticated Cloudflare Worker',async()=>{
 const f=fixture();await f.heartbeat();const client=createCloudflareRemoteDigitalOceanJournalV1({baseUrl:'https://atelier-do-watchdog.example/',bearerToken:SECRET,
   fetchImpl:(url,options)=>f.worker.fetch(new Request(url,options),f.env,{})});
 assert.equal((await client.health()).ready,true);const rec=await client.cas('run-A',0,initial());assert.equal(rec.revision,1);
 assert.equal((await client.read('run-A')).state,'READY');assert.equal(await client.read('run-B'),null);
});
test('remote endpoint must be HTTPS origin without embedded credentials',()=>{
 for(const url of ['http://example.test/','https://user:pass@example.test/','https://example.test/secret','https://example.test/?token=x'])
 assert.throws(()=>createCloudflareRemoteDigitalOceanJournalV1({baseUrl:url,bearerToken:SECRET}),/CF_DO_JOURNAL_HTTPS_ORIGIN_REQUIRED/);
});
test('invalid inbound run ID is rejected',async()=>{const f=fixture();await assert.rejects(f.store.cas('../x',0,initial()),/DO_D1_RUN_ID_INVALID/);});
test('D1 active list does not include closed jobs',async()=>{const f=fixture();await f.store.cas('run-A',0,initial(),{monthToDateUsageMilliUsd:500});assert.equal((await f.store.listActive()).length,1);});
test('stale cron heartbeat blocks new lease registration',async()=>{const f=fixture();await f.heartbeat();f.clock(T0+17*60000);assert.equal((await(await f.call('/v1/health')).json()).ready,false);});
test('cron watches registered lease on periodic scheduled events',async()=>{const f=fixture();await f.heartbeat();await f.store.cas('run-A',0,initial(),{monthToDateUsageMilliUsd:500});f.clock(T0+5*60000);const r=await f.heartbeat();assert.equal(r.ok,true);assert.deepEqual(f.ticks,['run-A']);});
test('cost cap signal reaches independent controller tick',async()=>{const f=fixture();await f.heartbeat();let r=await f.store.cas('run-A',0,initial(),{monthToDateUsageMilliUsd:500});r=await f.store.cas('run-A',1,withState(r,'CREATE_OUTCOME_UNKNOWN',{createAttempts:1}));r=await f.store.cas('run-A',2,withState(r,'BOUND',{dropletId:73}));f.usage(6000);await f.heartbeat();assert.equal(f.deletes,1);assert.equal((await f.store.read('run-A')).state,'DELETE_OUTCOME_UNKNOWN');});
test('TTL expiry triggers cleanup tick even without completion evidence',async()=>{const f=fixture();await f.heartbeat();let r=await f.store.cas('run-A',0,initial(),{monthToDateUsageMilliUsd:500});r=await f.store.cas('run-A',1,withState(r,'CREATE_OUTCOME_UNKNOWN',{createAttempts:1}));r=await f.store.cas('run-A',2,withState(r,'BOUND',{dropletId:73}));f.clock(T0+3600_000);await f.heartbeat();assert.equal(f.deletes,1);});
test('scheduler does not falsely certify health when a controller tick fails',async()=>{const f=fixture();await f.heartbeat();await f.store.cas('run-A',0,initial(),{monthToDateUsageMilliUsd:500});f.clock(T0+5*60000);f.fail(true);const r=await f.heartbeat();assert.equal(r.ok,false);assert.equal((await f.store.getHeartbeat()),T0);});
test('unconfigured worker refuses all paid resource registrations',async()=>{const f=fixture();f.env.DO_SCHEDULER_ENABLED='NO';await f.heartbeat();assert.equal((await f.call('/v1/runs/run-A/cas','POST',{expectedRevision:0,next:initial()})).status,503);});
test('journal row survives new worker instance and simulated process restart',async()=>{
 const f=fixture();await f.store.cas('run-A',0,initial(),{monthToDateUsageMilliUsd:500});const store2=createCloudflareD1DigitalOceanJournalV1({db:f.env.DO_WATCHDOG_DB,now:()=>T0+123});assert.equal((await store2.read('run-A')).revision,1);
});
test('D1 journal requires prepared statements, not an in-memory only store',()=>assert.throws(()=>createCloudflareD1DigitalOceanJournalV1({db:null}),/DO_D1_BINDING_REQUIRED/));
test('credential headers do not leak through normal API response',async()=>{const f=fixture();const body=await(await f.call('/v1/health')).text();assert.equal(body.includes(SECRET),false);assert.equal(body.includes(f.env.DIGITALOCEAN_TOKEN),false);});

function variant(id,tagChar='b',options={}) {
  const source=initial();
  const body={...source.lease,runId:id,ownershipTag:'atelier-run-'+tagChar.repeat(24),...options};
  delete body.LEASE_SHA256;
  const sort=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(sort).join(',')}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${sort(v[k])}`).join(',')}}`;
  return {...source,runId:id,lease:{...body,LEASE_SHA256:createHash('sha256').update(sort(body)).digest('hex')}};
}
test('single-account combined reservations reject exceeding month cap',async()=>{
 const f=fixture();
 for(let i=0;i<4;i++)await f.store.cas(`run-${i}`,0,variant(`run-${i}`,String.fromCharCode(98+i)),{monthToDateUsageMilliUsd:500});
 await assert.rejects(f.store.cas('run-5',0,variant('run-5','f'),{monthToDateUsageMilliUsd:500}),/DO_D1_CAS_CONFLICT/);
 assert.equal((await f.store.listActive()).length,4);
});
test('simultaneous reservations use one atomic D1 insert budget gate',async()=>{
 const f=fixture();const results=await Promise.allSettled([
  f.store.cas('run-left',0,variant('run-left','a',{monthlyCapMilliUsd:2000}),{monthToDateUsageMilliUsd:500}),
  f.store.cas('run-right',0,variant('run-right','b',{monthlyCapMilliUsd:2000}),{monthToDateUsageMilliUsd:500})]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.filter(x=>x.status==='rejected').length,1);
});
test('server rejects forged lease SHA even when payload is otherwise valid',async()=>{
 const f=fixture();const forged=variant('run-forged','f');forged.lease.LEASE_SHA256='0'.repeat(64);
 await assert.rejects(f.store.cas('run-forged',0,forged,{monthToDateUsageMilliUsd:500}),/DO_D1_LEASE_HASH_MISMATCH/);
});
test('remote first journal admission rechecks live billing cost',async()=>{
 const f=fixture();await f.heartbeat();f.usage(4999);
 const r=await f.call('/v1/runs/run-A/cas','POST',{expectedRevision:0,next:initial()});
 assert.equal(r.status,400);assert.equal(await f.store.read('run-A'),null);
});
test('read-only resource snapshot does not permit snapshot deletion',async()=>{
 const f=fixture();await f.store.cas('run-A',0,initial(),{monthToDateUsageMilliUsd:500});
 assert.equal((await f.store.read('run-A')).lease.protectedSnapshotIds.includes('91001'),true);
 assert.equal(typeof f.provider.deleteSnapshot,'undefined');
});

test('unsafe reconciliation blocks new paid admissions immediately, not after heartbeat TTL',async()=>{const f=fixture();await f.heartbeat();await f.store.cas('run-A',0,initial(),{monthToDateUsageMilliUsd:500});f.unresolved(true);const result=await f.heartbeat();assert.equal(result.ok,false);const health=await(await f.call('/v1/health')).json();assert.equal(health.ready,false);assert.equal(health.watchStatus,'DEGRADED');});
