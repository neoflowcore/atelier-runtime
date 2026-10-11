import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  usdToMilliV1, evaluateDigitalOceanLeaseAdmissionV1,
  evaluateDigitalOceanResidueV1, createDigitalOceanGuardedControllerV1
} from '../runtime/rev52/digitalocean-guardrails-v1.mjs';
import { createDigitalOceanJsonFileJournalV1 } from '../runtime/rev52/digitalocean-json-journal-v1.mjs';

const now = Date.parse('2026-10-11T06:00:00Z');
const HASH = 'a'.repeat(64);
function input(overrides={}) {
  return {
    runId:'ephem-safe-1', resourceName:'ephem-safe-1', exactSourceSha256:HASH,
    grantId:'approved-test-grant', explicitPaidApproval:true,
    providerCredentialReady:true,cleanupAuthorityReady:true,durableJournalReady:true,
    externalWatchdogRegistered:true,completeInventoryReady:true,childScannerReady:true,
    evidenceDestinationReady:true,priorCleanupVerified:true,noExistingOwnedDroplet:true,
    allowedImageVerified:true,minimumResourceVerified:true,
    allowedSize:'s-2vcpu-4gb',allowedRegion:'sgp1',allowedImage:'ubuntu-24-04-x64',
    nowMs:now,monthlyUsageObservedAtMs:now,ttlSeconds:3600,
    monthlyCapMilliUsd:10000,monthToDateUsageMilliUsd:2910,
    otherReservedMilliUsd:0,hourlyPriceMilliUsd:50,costBufferMilliUsd:1000,
    protectedSnapshotIds:['246454343'], ...overrides
  };
}
const spec = { name:'ephem-safe-1',region:'sgp1',size:'s-2vcpu-4gb',image:'ubuntu-24-04-x64',tags:['atelier'] };
const deep = value => value === null ? null : structuredClone(value);
function setup(overrides={}) {
  let nextId=100,creates=0,deletes=0, failCreate='none', failDelete='none', coverage=true, usage=2910;
  const entries = new Map(),childItems=[],snapshots=[{id:246454343,size_gigabytes:48.67}];
  const store=new Map();
  const journal={
    async read(id){return deep(store.get(id)??null);},
    async cas(id,expected,next){ const current=store.get(id); if((current?.revision??0)!==expected)throw new Error('DO_CAS_MISMATCH');
      const updated=deep({...next,revision:expected+1});store.set(id,updated);return deep(updated);}
  };
  const provider={
    async listDroplets(){return {complete:true,items:deep([...entries.values()])};},
    async getDroplet(id){return deep(entries.get(id)??null);},
    async createDroplet(req){creates++;const d={id:nextId++,name:req.name,tags:deep(req.tags),region:req.region,size:req.size,backups:req.backups};
      if(failCreate==='before')throw new Error('network fail'); entries.set(d.id,d); if(failCreate==='after')throw new Error('response lost');return d;},
    async deleteDroplet(id){deletes++;if(failDelete==='before')throw new Error('network fail');entries.delete(id);if(failDelete==='after')throw new Error('response lost');return {accepted:true};},
    async getSizeQuote(size,region){return {verified:true,hourlyPriceMilliUsd:50,size,region};},
    async readMonthlyUsageMilliUsd(){return {complete:true,value:usage,observedAtMs:now};},
    async scanChildResources(){return {complete:coverage,items:deep(childItems)};},
    async listAccountSnapshots(){return deep(snapshots);}
  };
  const controller=createDigitalOceanGuardedControllerV1({store:journal,provider});
  return {controller,provider,store,entries,childItems,snapshots,
    get creates(){return creates;},get deletes(){return deletes;},
    failCreate(v){failCreate=v;}, failDelete(v){failDelete=v;}, setCoverage(v){coverage=v;}, setUsage(v){usage=v;},
    async init(args={}){return controller.initialize(input({...overrides,...args}));},
    async start(){return controller.start('ephem-safe-1',spec,now+500);}
  };
}

test('currency is exact integer milli-USD; never float rounded down',()=>{
  assert.equal(usdToMilliV1('2.91'),2910);
  assert.equal(usdToMilliV1('0.001'),1);
  assert.throws(()=>usdToMilliV1('0.0005'),/DO_USD_FORMAT_REQUIRED/);
  assert.throws(()=>usdToMilliV1('NaN'),/DO_USD_FORMAT_REQUIRED/);
});
test('admission requires grant, external cleanup watchdog, complete inventory, exact quote and evidence',()=>{
  assert.equal(evaluateDigitalOceanLeaseAdmissionV1(input()).allowed,true);
  for(const field of ['explicitPaidApproval','externalWatchdogRegistered','childScannerReady','cleanupAuthorityReady','durableJournalReady','evidenceDestinationReady','noExistingOwnedDroplet']){
    const d=evaluateDigitalOceanLeaseAdmissionV1(input({[field]:false}));assert.equal(d.allowed,false,field);
  }
});
test('admission blocks cost cap overflow, unsafe time, stale bills and excessive lease',()=>{
  const params=[{monthlyCapMilliUsd:3000},{monthlyUsageObservedAtMs:now-900001},{ttlSeconds:21601},{hourlyPriceMilliUsd:0},{nowMs:Number.MAX_SAFE_INTEGER}];
  for(const p of params)assert.equal(evaluateDigitalOceanLeaseAdmissionV1(input(p)).allowed,false,JSON.stringify(p));
});
test('admission conservative cost estimate rounds positive usage upward',()=>{
  const r=evaluateDigitalOceanLeaseAdmissionV1(input({hourlyPriceMilliUsd:1,ttlSeconds:1}));
  assert.equal(r.allowed,true);assert.equal(r.lease.estimatedLeaseMilliUsd,1);
  assert.ok(/^atelier-run-[a-f0-9]{24}$/.test(r.lease.ownershipTag));
});
test('no paid resources created from a denied envelope',async()=>{
  const t=setup();const r=await t.init({explicitPaidApproval:false});assert.equal(r.status,'DENIED');assert.equal(t.creates,0);
});
test('an exact authorized run externalizes evidence, deletes only owned VM, proves absence, preserves snapshot',async()=>{
  const t=setup();assert.equal((await t.init()).status,'READY');
  assert.equal((await t.start()).status,'BOUND');assert.equal(t.creates,1);
  const running=await t.controller.markRunning('ephem-safe-1'); assert.equal(running.status,'RUNNING');
  const evidence=await t.controller.confirmExternalEvidence('ephem-safe-1',{artifactDigest:HASH,externallyVerified:true});assert.equal(evidence.status,'EVIDENCE_EXTERNALIZED');
  const closed=await t.controller.cleanup('ephem-safe-1',{nowMs:now+1000});
  assert.equal(closed.status,'CLOSED');assert.equal(t.deletes,1);
  assert.equal(closed.receipt.preservedSnapshotCount,1);assert.equal(closed.receipt.accountWideBillableZero,null);
  assert.equal(closed.run.closeReason,'COMPLETED_AND_CLEAN');
  assert.equal(t.snapshots.length,1);assert.equal((await t.controller.tick('ephem-safe-1',{nowMs:now+999999})).status,'CLOSED');
});
test('no duplicate VM after create response gets lost; authoritative reattach adopts exactly one',async()=>{
  const t=setup();await t.init();t.failCreate('after');
  const unknown=await t.start();assert.equal(unknown.status,'CREATE_OUTCOME_UNKNOWN');assert.equal(t.creates,1);
  assert.equal((await t.start()).reason,'DO_NO_BLIND_CREATE_RETRY');
  const adopted=await t.controller.reconcile('ephem-safe-1');assert.equal(adopted.status,'BOUND');assert.equal(t.creates,1);
  const cleaned=await t.controller.tick('ephem-safe-1',{nowMs:now+4000000});assert.equal(cleaned.status,'CLOSED');
  assert.equal(cleaned.run.closeReason,'ABORTED_AND_CLEAN');
});
test('unknown create with zero candidates does not recreate; remains blocked',async()=>{
  const t=setup();await t.init();t.failCreate('before');
  assert.equal((await t.start()).status,'CREATE_OUTCOME_UNKNOWN');
  const observed=await t.controller.reconcile('ephem-safe-1');
  assert.equal(observed.status,'RECONCILIATION_REQUIRED');assert.equal(t.creates,1);
  assert.equal((await t.controller.tick('ephem-safe-1',{nowMs:now+8000000})).status,'RECONCILIATION_REQUIRED');
});
test('the same lease tag on multiple servers quarantines ambiguous create outcome',async()=>{
  const t=setup();await t.init();t.failCreate('after');await t.start();
  const first=[...t.entries.values()][0];t.entries.set(987,{...first,id:987});
  assert.equal((await t.controller.reconcile('ephem-safe-1')).reason,'DO_CREATE_OWNERSHIP_AMBIGUOUS');
  assert.equal(t.deletes,0);
});
test('delete response lost after actual deletion is closed by readback without new delete',async()=>{
  const t=setup();await t.init();await t.start();t.failDelete('after');
  assert.equal((await t.controller.tick('ephem-safe-1',{nowMs:now+4000000})).status,'DELETE_OUTCOME_UNKNOWN');
  assert.equal((await t.controller.reconcile('ephem-safe-1')).status,'CLOSED');assert.equal(t.deletes,1);
});
test('delete ambiguity with a still-existing owned VM allows exactly one readback-backed retry',async()=>{
  const t=setup();await t.init();await t.start();t.failDelete('before');
  assert.equal((await t.controller.tick('ephem-safe-1',{nowMs:now+4000000})).status,'DELETE_OUTCOME_UNKNOWN');
  assert.equal((await t.controller.reconcile('ephem-safe-1')).status,'OWNED_DROPLET_STILL_PRESENT');
  t.failDelete('none');assert.equal((await t.controller.cleanup('ephem-safe-1',{nowMs:now+4000100})).status,'CLOSED');
  assert.equal(t.deletes,2);
});
test('ownership mismatch blocks deleting non-owned droplet even under deadline',async()=>{
  const t=setup();await t.init();await t.start();[...t.entries.values()][0].tags=[];
  assert.equal((await t.controller.tick('ephem-safe-1',{nowMs:now+4000000})).reason,'DO_OWNERSHIP_MISMATCH');
  assert.equal(t.deletes,0);
});
test('watchdog cleans up after TTL without externally verified artifact',async()=>{
  const t=setup();await t.init();await t.start();await t.controller.markRunning('ephem-safe-1');
  assert.equal((await t.controller.tick('ephem-safe-1',{nowMs:now+3000})).status,'RUNNING');
  assert.equal((await t.controller.tick('ephem-safe-1',{nowMs:now+3600001})).status,'CLOSED');
  assert.equal(t.deletes,1);
});
test('budget threshold forces cleanup before TTL, not just warning',async()=>{
  const t=setup();await t.init();await t.start();
  assert.equal((await t.controller.tick('ephem-safe-1',{nowMs:now+5000,monthToDateUsageMilliUsd:10000})).status,'CLOSED');
  assert.equal(t.deletes,1);
});
test('creating a resource with unauthorized size or backup request is denied before mutation',async()=>{
  const t=setup();await t.init();
  assert.equal((await t.controller.start('ephem-safe-1',{...spec,size:'s-8vcpu-16gb'},now+500)).status,'DENIED');
  assert.equal((await t.controller.start('ephem-safe-1',{...spec,backups:true},now+500)).status,'DENIED');
  assert.equal(t.creates,0);
});
test('live cost re-check denies stale or higher current spending before create',async()=>{
  const t=setup();await t.init();t.setUsage(99999);
  assert.equal((await t.start()).reason,'DO_LIVE_BUDGET_EXCEEDED');assert.equal(t.creates,0);
});
test('a newly created untagged snapshot blocks closure instead of being deleted',async()=>{
  const t=setup();await t.init();await t.start();t.snapshots.push({id:654321});
  const result=await t.controller.tick('ephem-safe-1',{nowMs:now+4000000});
  assert.equal(result.status,'RESIDUE_PENDING');assert.equal(result.receipt.unexpectedSnapshotCount,1);
  assert.equal(t.deletes,1);assert.equal(t.snapshots.length,2);
});
test('new untagged child volume and incomplete coverage both fail closed',async()=>{
  const t=setup();await t.init();await t.start();t.childItems.push({kind:'VOLUME',id:'vol-new',tags:[]});
  const pending=await t.controller.tick('ephem-safe-1',{nowMs:now+4000000});
  assert.equal(pending.status,'RESIDUE_PENDING');assert.equal(pending.receipt.unexpectedChildCount,1);
  const s=setup();await s.init();await s.start();s.setCoverage(false);
  const incomplete=await s.controller.tick('ephem-safe-1',{nowMs:now+4000000});
  assert.equal(incomplete.status,'RESIDUE_PENDING');assert.equal(incomplete.receipt.coverageComplete,false);
});
test('local file journal persists across controller recreation and rejects stale concurrent writes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'do-guardrails-'));
  try {
    const storeA=createDigitalOceanJsonFileJournalV1({directory:dir});
    const t=setup();const state=await t.init();
    const copied=await storeA.cas('ephem-safe-1',0,{...state.run,revision:0});
    assert.equal(copied.revision,1);
    const storeB=createDigitalOceanJsonFileJournalV1({directory:dir});
    assert.equal((await storeB.read('ephem-safe-1')).state,'READY');
    await assert.rejects(()=>storeA.cas('ephem-safe-1',0,{...copied}),/DO_JOURNAL_CAS_CONFLICT/);
    assert.equal((await storeB.read('ephem-safe-1')).revision,1);
  } finally {await rm(dir,{recursive:true,force:true});}
});

import { createDigitalOceanRestProviderV1 } from '../runtime/rev52/digitalocean-rest-provider-v1.mjs';
function fakeDigitalOceanRest({missing=[]}={}) {
  const calls=[];
  const responses={
    '/droplets':{droplets:[],links:{pages:{}}},
    '/snapshots':{snapshots:[{id:246454343,resource_type:'droplet'}],links:{pages:{}}},
    '/volumes':{volumes:[],links:{pages:{}}},
    '/reserved_ips':{reserved_ips:[],links:{pages:{}}},
    '/load_balancers':{load_balancers:[],links:{pages:{}}},
    '/sizes':{sizes:[{slug:'s-2vcpu-4gb',available:true,regions:['sgp1'],price_hourly:0.03641}],links:{pages:{}}},
    '/customers/my/balance':{month_to_date_usage:'2.91'},
    '/droplets/100':{droplet:{id:100,name:'ephem-safe-1',tags:['atelier']}},
  };
  const fetchImpl=async (url,options)=>{
    const path=new URL(url).pathname.replace('/v2','');
    calls.push({path,method:options.method,body:options.body||null,authPresent:options.headers.Authorization==='Bearer test-token-not-real'});
    if(missing.includes(path))return {status:403,ok:false};
    if(options.method==='POST'&&path==='/droplets')return {ok:true,status:202,json:async()=>({droplet:{id:100}})};
    if(options.method==='DELETE')return {ok:true,status:204};
    if(!responses[path])return {ok:false,status:404};
    return {ok:true,status:200,json:async()=>responses[path]};
  };
  return {calls, provider:createDigitalOceanRestProviderV1({bearerToken:'test-token-not-real',fetchImpl,now:()=>now})};
}
test('REST adapter scans real supported billable classes and fetches live balance without mutations',async()=>{
  const t=fakeDigitalOceanRest();
  assert.equal((await t.provider.listDroplets()).complete,true);
  assert.equal((await t.provider.listAccountSnapshots()).length,1);
  assert.equal((await t.provider.scanChildResources()).complete,true);
  assert.equal((await t.provider.readMonthlyUsageMilliUsd()).value,2910);
  assert.equal((await t.provider.getSizeQuote('s-2vcpu-4gb','sgp1')).hourlyPriceMilliUsd,37);
  assert.ok(t.calls.every(x=>x.method==='GET'&&x.authPresent));
});
test('REST adapter fails closed when one billable child inventory permission is missing',async()=>{
  const t=fakeDigitalOceanRest({missing:['/volumes']});
  assert.equal((await t.provider.scanChildResources()).complete,false);
});
test('REST adapter fixed endpoint rejects arbitrary redirect host and prevents backups on creation',async()=>{
  assert.throws(()=>createDigitalOceanRestProviderV1({bearerToken:'test-token-not-real',endpoint:'http://evil.example/v2'}),/DO_ENDPOINT_NOT_ALLOWLISTED/);
  const t=fakeDigitalOceanRest();
  await t.provider.createDroplet({...spec,backups:true});
  const request=t.calls.find(x=>x.method==='POST');
  assert.equal(JSON.parse(request.body).backups,false);
  assert.equal(JSON.parse(request.body).monitoring,false);
});
test('tampered lease digest fails closed before any mutation',async()=>{
  const t=setup();const initial=await t.init();
  const record=t.store.get('ephem-safe-1');record.lease.monthlyCapMilliUsd=99999999;
  await assert.rejects(()=>t.controller.start('ephem-safe-1',spec,now+500),/DO_LEASE_JOURNAL_TAMPERED/);
  assert.equal(t.creates,0);assert.equal(initial.status,'READY');
});
test('cannot close after false artifact claim or missing SHA256',async()=>{
  const t=setup();await t.init();await t.start();await t.controller.markRunning('ephem-safe-1');
  assert.equal((await t.controller.confirmExternalEvidence('ephem-safe-1',{artifactDigest:HASH,externallyVerified:false})).status,'DENIED');
  assert.equal((await t.controller.confirmExternalEvidence('ephem-safe-1',{artifactDigest:'bad',externallyVerified:true})).status,'DENIED');
  assert.equal((await t.controller.cleanup('ephem-safe-1',{nowMs:now+5000})).status,'RUNNING_WITHIN_LEASE');
  assert.equal(t.deletes,0);
});
test('scanner coverage cannot be fabricated when initialize fails to inventory children',async()=>{
  const t=setup();t.setCoverage(false);
  assert.equal((await t.init()).status,'DENIED');assert.equal(t.creates,0);
});
test('read-only REST pagination mismatch prevents false claim of complete inventory',async()=>{
  const fetchImpl=async()=>({ok:true,status:200,json:async()=>({droplets:[],meta:{total:10}})});
  const provider=createDigitalOceanRestProviderV1({bearerToken:'test-token-not-real',fetchImpl});
  await assert.rejects(()=>provider.listDroplets(),/DO_PAGINATION_INCOMPLETE/);
});
test('watchdog missing billing readback initiates safe deletion of an already owned VM',async()=>{
  const t=setup();await t.init();await t.start();
  t.provider.readMonthlyUsageMilliUsd=async()=>{throw new Error('billing disconnected');};
  const closed=await t.controller.tick('ephem-safe-1',{nowMs:now+60000});
  assert.equal(closed.status,'CLOSED');assert.equal(closed.run.closeReason,'ABORTED_AND_CLEAN');assert.equal(t.deletes,1);
});
