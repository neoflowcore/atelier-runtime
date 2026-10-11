import { createHash } from 'node:crypto';

const SHA256 = /^[0-9a-f]{64}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,62}$/;
const MAX_LEASE_SECONDS = 21600;
const DEFAULT_MAX_BILLING_AGE_MS = 15 * 60 * 1000;

const fail = (message) => { throw new Error(message); };
const safeInteger = (value, code) => Number.isSafeInteger(value) && value >= 0 ? value : fail(code);
const positiveInteger = (value, code) => Number.isSafeInteger(value) && value > 0 ? value : fail(code);
const requiredString = (value, code) => typeof value === 'string' && value.trim() !== '' ? value : fail(code);
const clone = (value) => JSON.parse(JSON.stringify(value));
function stable(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isSafeInteger(value)) fail('DO_CANONICAL_NON_SAFE_INTEGER'); return String(value); }
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  fail('DO_CANONICAL_UNSUPPORTED_TYPE');
}
function digest(value) { return createHash('sha256').update(stable(value), 'utf8').digest('hex'); }
function hasTag(resource, tag) { return Array.isArray(resource?.tags) && resource.tags.includes(tag); }
function ownedResources(items, tag) { return items.filter(item => hasTag(item, tag)); }
function assertCompleteList(inventory) {
  if (!inventory || inventory.complete !== true || !Array.isArray(inventory.items)) fail('DO_INCOMPLETE_PAGINATED_INVENTORY');
  return inventory.items;
}
function assertIdentity(droplet, lease) {
  return droplet && String(droplet.id) === String(lease.dropletId) && droplet.name === lease.resourceName && hasTag(droplet, lease.ownershipTag);
}

export function usdToMilliV1(amount) {
  if (typeof amount !== 'string' || !/^\d+(?:\.\d{1,3})?$/.test(amount)) fail('DO_USD_FORMAT_REQUIRED');
  const [whole, fraction = ''] = amount.split('.');
  const result = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) fail('DO_USD_UNSAFE_AMOUNT');
  return Number(result);
}

// Pure admission. The bill is a provider observation, not a local source of authority.
export function evaluateDigitalOceanLeaseAdmissionV1(input = {}) {
  const reasons = [];
  const add = (condition, code) => { if (!condition) reasons.push(code); };
  add(RUN_ID.test(input.runId ?? ''), 'DO_RUN_ID_INVALID');
  add(NAME.test(input.resourceName ?? ''), 'DO_RESOURCE_NAME_INVALID');
  add(SHA256.test(input.exactSourceSha256 ?? ''), 'DO_SOURCE_IDENTITY_REQUIRED');
  add(typeof input.grantId === 'string' && input.grantId.length > 0 && input.explicitPaidApproval === true, 'DO_EXPLICIT_PAID_GRANT_REQUIRED');
  add(input.providerCredentialReady === true && input.cleanupAuthorityReady === true, 'DO_PROVIDER_CLEANUP_AUTHORITY_REQUIRED');
  add(input.durableJournalReady === true && input.externalWatchdogRegistered === true, 'DO_EXTERNAL_WATCHDOG_REQUIRED');
  add(input.completeInventoryReady === true && input.childScannerReady === true, 'DO_COMPLETE_INVENTORY_REQUIRED');
  add(input.evidenceDestinationReady === true, 'DO_EVIDENCE_DESTINATION_REQUIRED');
  add(input.priorCleanupVerified === true && input.noExistingOwnedDroplet === true, 'DO_PRIOR_RESOURCE_RECONCILIATION_REQUIRED');
  add(input.allowedImageVerified === true && input.minimumResourceVerified === true, 'DO_MINIMUM_IMAGE_RESOURCE_REQUIRED');
  for (const key of ['allowedSize','allowedRegion','allowedImage']) add(typeof input[key] === 'string' && input[key].length > 0, `DO_${key.toUpperCase()}_REQUIRED`);

  const now = input.nowMs;
  const observed = input.monthlyUsageObservedAtMs;
  add(Number.isSafeInteger(now) && now >= 0 && Number.isSafeInteger(observed) && observed <= now && now - observed <= (input.maxBillingAgeMs ?? DEFAULT_MAX_BILLING_AGE_MS), 'DO_BILLING_OBSERVATION_STALE');
  const ttl = input.ttlSeconds;
  add(Number.isSafeInteger(ttl) && ttl > 0 && ttl <= MAX_LEASE_SECONDS, 'DO_TTL_INVALID');
  add(Number.isSafeInteger(now) && Number.isSafeInteger(ttl) && Number.isSafeInteger(now + ttl * 1000), 'DO_EXPIRY_UNSAFE');
  for (const field of ['monthlyCapMilliUsd', 'monthToDateUsageMilliUsd', 'otherReservedMilliUsd', 'hourlyPriceMilliUsd', 'costBufferMilliUsd']) {
    add(Number.isSafeInteger(input[field]) && input[field] >= (field === 'hourlyPriceMilliUsd' || field === 'monthlyCapMilliUsd' ? 1 : 0), `DO_${field.toUpperCase()}_INVALID`);
  }
  let estimatedLeaseMilliUsd = null;
  if (Number.isSafeInteger(ttl) && ttl > 0 && Number.isSafeInteger(input.hourlyPriceMilliUsd) && input.hourlyPriceMilliUsd >= 0) {
    const cost = (BigInt(ttl) * BigInt(input.hourlyPriceMilliUsd) + 3599n) / 3600n;
    if (cost <= BigInt(Number.MAX_SAFE_INTEGER)) estimatedLeaseMilliUsd = Number(cost);
    else reasons.push('DO_ESTIMATED_COST_UNSAFE');
  }
  const allCosts = [input.monthToDateUsageMilliUsd, input.otherReservedMilliUsd, input.costBufferMilliUsd, estimatedLeaseMilliUsd];
  if (allCosts.every(value => Number.isSafeInteger(value) && value >= 0) && Number.isSafeInteger(input.monthlyCapMilliUsd)) {
    const total = allCosts.reduce((sum, value) => sum + BigInt(value), 0n);
    if (total > BigInt(input.monthlyCapMilliUsd)) reasons.push('DO_MONTHLY_BUDGET_EXCEEDED');
  }
  const allowed = reasons.length === 0;
  const identity = RUN_ID.test(input.runId ?? '') ? input.runId : 'invalid';
  const ownershipTag = `atelier-run-${createHash('sha256').update(identity + ':' + (input.exactSourceSha256 ?? '') + ':' + (input.grantId ?? '')).digest('hex').slice(0,24)}`;
  const lease = allowed ? {
    runId: input.runId, resourceName: input.resourceName, ownershipTag,
    allowedSize:input.allowedSize,allowedRegion:input.allowedRegion,allowedImage:input.allowedImage,
    hourlyPriceMilliUsd:input.hourlyPriceMilliUsd,otherReservedMilliUsd:input.otherReservedMilliUsd,
    exactSourceSha256: input.exactSourceSha256, grantId: input.grantId,
    expiresAtMs: now + ttl * 1000, monthlyCapMilliUsd: input.monthlyCapMilliUsd,
    estimatedLeaseMilliUsd, costBufferMilliUsd: input.costBufferMilliUsd,
    protectedSnapshotIds: [...new Set((input.protectedSnapshotIds ?? []).map(String))].sort()
  } : null;
  return Object.freeze({allowed, reasons, lease: lease ? Object.freeze({...lease, LEASE_SHA256: digest(lease)}) : null, newPaidResourceDenied: !allowed});
}

// Explicitly separate this run's residue from other still-billable account resources.
export function evaluateDigitalOceanResidueV1({lease, droplets, children, accountSnapshots = []} = {}) {
  if (!lease || typeof lease.ownershipTag !== 'string') fail('DO_LEASE_REQUIRED');
  const allDroplets = assertCompleteList(droplets);
  if (!children || children.complete !== true || !Array.isArray(children.items) || !Array.isArray(accountSnapshots)) {
    return Object.freeze({jobScopedResidueZero:false,accountWideBillableZero:false,coverageComplete:false,reason:'DO_CHILD_INVENTORY_INCOMPLETE'});
  }
  const owned = [...ownedResources(allDroplets, lease.ownershipTag), ...ownedResources(children.items, lease.ownershipTag)];
  const preserved = accountSnapshots.filter(snapshot => lease.protectedSnapshotIds.includes(String(snapshot.id)));
  const baselineChildIds=new Set((lease.baselineChildKeys??[]).map(String));
  const baselineSnapshotIds=new Set((lease.baselineSnapshotIds??[]).map(String));
  const newChildren=children.items.filter(item=>!baselineChildIds.has(`${item.kind}:${item.id}`));
  const newSnapshots=accountSnapshots.filter(item=>!baselineSnapshotIds.has(String(item.id)));
  const residual=[...owned,...newChildren,...newSnapshots];
  // Other billable resource classes may exist: a Droplet/snapshot-only snapshot
  // of the account can NEVER certify all-provider zero billing.
  const accountWideBillableZero = null;
  const body = {SCHEMA_ID:'DO_RESIDUE_READBACK_V1',SCHEMA_VERSION:'1',runId:lease.runId,
    jobScopedResidueZero:residual.length===0,ownedResourceCount:owned.length,unexpectedChildCount:newChildren.length,unexpectedSnapshotCount:newSnapshots.length,
    preservedSnapshotCount:preserved.length,accountWideBillableZero,coverageComplete:true,
    childBillableArtifactsScanned:true,deleteOrTerminateReadback:owned.length===0,
    powerOffEqualsBillingStop:false};
  return Object.freeze({...body,READBACK_SHA256:digest(body)});
}

function assertRunIdentity(run, id) {
  if (!run || run.runId !== id || run.schema !== 'DO_RUN_GUARDED_V1') fail('DO_JOURNAL_IDENTITY_INVALID');
  return run;
}
function isUnknownCreate(state) { return state === 'CREATE_OUTCOME_UNKNOWN'; }

// The provider/store are injected. For production, the journal and watchdog must
// live OUTSIDE the disposable Droplet. Never put sole recovery authority on the VM.
export function createDigitalOceanGuardedControllerV1({store, provider} = {}) {
  if (!store || typeof store.read !== 'function' || typeof store.cas !== 'function' || !provider) fail('DO_ADAPTER_DEPENDENCIES_REQUIRED');
  const save = async (run, state, patch = {}) => store.cas(run.runId, run.revision, {...run,...patch,state});
  const read = async id => {
    const run=assertRunIdentity(await store.read(id),id);
    const {LEASE_SHA256,...leaseBody}=run.lease??{};
    if(!LEASE_SHA256 || digest(leaseBody)!==LEASE_SHA256) fail('DO_LEASE_JOURNAL_TAMPERED');
    return run;
  };
  const list = async () => assertCompleteList(await provider.listDroplets());

  async function initialize(input) {
    const decision = evaluateDigitalOceanLeaseAdmissionV1(input);
    if (!decision.allowed) return {status:'DENIED', reasons:decision.reasons};
    const existing = await list();
    if (ownedResources(existing, decision.lease.ownershipTag).length) return {status:'DENIED',reasons:['DO_EXISTING_OWNED_DROPLET']};
    const children=await provider.scanChildResources(decision.lease.ownershipTag);
    const snapshots=await provider.listAccountSnapshots();
    if(children?.complete!==true || !Array.isArray(children.items) || !Array.isArray(snapshots)) return {status:'DENIED',reasons:['DO_BASELINE_CHILD_INVENTORY_INCOMPLETE']};
    const baselineChildKeys=children.items.map(item=>`${item.kind}:${item.id}`).sort();
    const baselineSnapshotIds=snapshots.map(item=>String(item.id)).sort();
    const {LEASE_SHA256:ignored,...originalLease}=decision.lease;
    const leaseBody={...originalLease,baselineChildKeys,baselineSnapshotIds};
    const lease={...leaseBody,LEASE_SHA256:digest(leaseBody)};
    const initial = {schema:'DO_RUN_GUARDED_V1',runId:input.runId,state:'READY',revision:0,
      lease,createAttempts:0,deleteAttempts:0,dropletId:null,
      artifactDigest:null,artifactVerified:false,closeReason:null};
    return {status:'READY',run:await store.cas(input.runId,0,initial)};
  }

  async function start(id, createSpec, nowMs) {
    const run = await read(id);
    if (run.state !== 'READY') return {status:run.state,reason:'DO_NO_BLIND_CREATE_RETRY'};
    if (!Number.isSafeInteger(nowMs) || nowMs >= run.lease.expiresAtMs) return {status:'DENIED',reason:'DO_LEASE_EXPIRED'};
    // The only unambiguous initial create attempt. A timeout is never retried.
    if (ownedResources(await list(),run.lease.ownershipTag).length) return {status:'DENIED',reason:'DO_EXISTING_OWNED_DROPLET'};
    const allowedCreateKeys=new Set(['name','region','size','image','tags']);
    if (!createSpec || Object.keys(createSpec).some(key=>!allowedCreateKeys.has(key)) || createSpec.name !== run.lease.resourceName || !Array.isArray(createSpec.tags) || createSpec.size !== run.lease.allowedSize || createSpec.region !== run.lease.allowedRegion || createSpec.image !== run.lease.allowedImage) return {status:'DENIED',reason:'DO_EXACT_CREATE_SPEC_REQUIRED'};
    if(typeof provider.getSizeQuote !== 'function' || typeof provider.readMonthlyUsageMilliUsd !== 'function') return {status:'DENIED',reason:'DO_LIVE_PRICE_OR_BILLING_CHECK_MISSING'};
    const quote=await provider.getSizeQuote(run.lease.allowedSize,run.lease.allowedRegion);
    const usage=await provider.readMonthlyUsageMilliUsd();
    if(!quote || quote.verified !== true || quote.hourlyPriceMilliUsd !== run.lease.hourlyPriceMilliUsd || !usage || usage.complete !== true || !Number.isSafeInteger(usage.value) || !Number.isSafeInteger(usage.observedAtMs) || usage.observedAtMs > nowMs || nowMs - usage.observedAtMs > DEFAULT_MAX_BILLING_AGE_MS) return {status:'DENIED',reason:'DO_LIVE_PRICE_OR_BILLING_UNVERIFIED'};
    const forecast=BigInt(usage.value)+BigInt(run.lease.otherReservedMilliUsd)+BigInt(run.lease.estimatedLeaseMilliUsd)+BigInt(run.lease.costBufferMilliUsd);
    if(forecast>BigInt(run.lease.monthlyCapMilliUsd)) return {status:'DENIED',reason:'DO_LIVE_BUDGET_EXCEEDED'};
    const pending = await save(run,'CREATE_OUTCOME_UNKNOWN',{createAttempts:1});
    try {
      const created = await provider.createDroplet({...createSpec,tags:[...new Set([...createSpec.tags,run.lease.ownershipTag])],backups:false});
      if (!Number.isSafeInteger(created?.id) || created.id <= 0) return {status:'CREATE_OUTCOME_UNKNOWN',reason:'DO_CREATE_ID_UNVERIFIED'};
      return {status:'BOUND',run:await save(pending,'BOUND',{dropletId:created.id})};
    } catch (error) {
      return {status:'CREATE_OUTCOME_UNKNOWN',reason:'DO_CREATE_RESULT_AMBIGUOUS'};
    }
  }

  async function reconcile(id) {
    const run = await read(id);
    if (isUnknownCreate(run.state)) {
      const tagged = ownedResources(await list(),run.lease.ownershipTag);
      const matching = tagged.filter(x=>x.name===run.lease.resourceName);
      if (tagged.length !== 1 || matching.length !== 1) return {status:'RECONCILIATION_REQUIRED',reason:'DO_CREATE_OWNERSHIP_AMBIGUOUS',matchingCount:tagged.length};
      if (matching.length!==1 || !Number.isSafeInteger(matching[0].id)) {
        return {status:'RECONCILIATION_REQUIRED',reason:matching.length>1?'DO_DUPLICATE_CREATE_CANDIDATES':'DO_CREATE_ABSENCE_NOT_PROOF',matchingCount:matching.length};
      }
      return {status:'BOUND',run:await save(run,'BOUND',{dropletId:matching[0].id})};
    }
    if (run.state==='DELETE_OUTCOME_UNKNOWN' || run.state==='VERIFY_ABSENCE') {
      const droplets = {complete:true,items:await list()};
      const surviving = ownedResources(droplets.items,run.lease.ownershipTag);
      if (surviving.length) {
        // Do not delete/retry anything whose exact identity cannot be proved.
        if (surviving.length!==1 || !assertIdentity(surviving[0],{...run.lease,dropletId:run.dropletId})) return {status:'RECONCILIATION_REQUIRED',reason:'DO_OWNERSHIP_MISMATCH'};
        if (run.deleteAttempts >= 2) return {status:'RECONCILIATION_REQUIRED',reason:'DO_DELETE_RETRY_BUDGET_EXHAUSTED'};
        return {status:'OWNED_DROPLET_STILL_PRESENT',next:'DELETE_AFTER_POSITIVE_READBACK'};
      }
      const children = await provider.scanChildResources(run.lease.ownershipTag);
      const snapshots = await provider.listAccountSnapshots();
      const residue = evaluateDigitalOceanResidueV1({lease:run.lease,droplets,children,accountSnapshots:snapshots});
      if (!residue.coverageComplete || !residue.jobScopedResidueZero) return {status:'RESIDUE_PENDING',receipt:residue};
      const closed = await save(run,'CLOSED',{closeReason:run.artifactVerified?'COMPLETED_AND_CLEAN':'ABORTED_AND_CLEAN',residueReceipt:residue});
      return {status:'CLOSED',run:closed,receipt:residue};
    }
    return {status:run.state,run};
  }

  async function markRunning(id) {
    const run = await read(id);
    if (run.state !== 'BOUND') return {status:run.state};
    const observed=await provider.getDroplet(run.dropletId);
    if(!assertIdentity(observed,{...run.lease,dropletId:run.dropletId})) return {status:'RECONCILIATION_REQUIRED',reason:'DO_BOUND_DROPLET_NOT_VERIFIED'};
    return {status:'RUNNING',run:await save(run,'RUNNING')};
  }

  async function confirmExternalEvidence(id, {artifactDigest,externallyVerified}) {
    const run = await read(id);
    if (!['BOUND','RUNNING'].includes(run.state)) return {status:run.state};
    if (!SHA256.test(artifactDigest ?? '') || externallyVerified !== true) return {status:'DENIED',reason:'DO_EXTERNAL_ARTIFACT_PROOF_REQUIRED'};
    return {status:'EVIDENCE_EXTERNALIZED',run:await save(run,'EVIDENCE_EXTERNALIZED',{artifactDigest,artifactVerified:true})};
  }

  async function cleanup(id, {nowMs,force=false}={}) {
    let run = await read(id);
    if (run.state==='CLOSED') return {status:'CLOSED',run};
    if (isUnknownCreate(run.state)) return reconcile(id);
    if (run.state==='READY') return {status:'NO_RESOURCE_CREATED'};
    if (!Number.isSafeInteger(nowMs)) fail('DO_NOW_MS_REQUIRED');
    if (!force && !run.artifactVerified && nowMs < run.lease.expiresAtMs && run.state!=='DELETE_OUTCOME_UNKNOWN' && run.state!=='VERIFY_ABSENCE') {
      return {status:'RUNNING_WITHIN_LEASE',reason:'DO_ARTIFACT_OR_LEASE_REQUIRED'};
    }
    if (run.dropletId === null) return {status:'RECONCILIATION_REQUIRED',reason:'DO_DROPLET_ID_UNKNOWN'};
    if (run.state==='DELETE_OUTCOME_UNKNOWN' || run.state==='VERIFY_ABSENCE') {
      const rr=await reconcile(id);
      if (rr.status!=='OWNED_DROPLET_STILL_PRESENT') return rr;
      run=await read(id);
    }
    if (run.deleteAttempts>=2) return {status:'RECONCILIATION_REQUIRED',reason:'DO_DELETE_RETRY_BUDGET_EXHAUSTED'};
    const current = await provider.getDroplet(run.dropletId);
    if (current === null) {
      const waiting = await save(run,'VERIFY_ABSENCE');
      return reconcile(waiting.runId);
    }
    if (!assertIdentity(current,{...run.lease,dropletId:run.dropletId})) return {status:'RECONCILIATION_REQUIRED',reason:'DO_OWNERSHIP_MISMATCH'};
    const pending=await save(run,'DELETE_OUTCOME_UNKNOWN',{deleteAttempts:run.deleteAttempts+1});
    try {
      await provider.deleteDroplet(run.dropletId);
      const waiting=await save(pending,'VERIFY_ABSENCE');
      return reconcile(waiting.runId);
    } catch(error) {
      return {status:'DELETE_OUTCOME_UNKNOWN',reason:'DO_DELETE_RESULT_AMBIGUOUS'};
    }
  }

  async function tick(id, {nowMs,monthToDateUsageMilliUsd}={}) {
    const run=await read(id);
    if (run.state==='CLOSED') return {status:'CLOSED'};
    if (!Number.isSafeInteger(nowMs)) fail('DO_NOW_MS_REQUIRED');
    if (isUnknownCreate(run.state)) return reconcile(id);
    const expired=nowMs>=run.lease.expiresAtMs;
    if(!expired && monthToDateUsageMilliUsd===undefined){
      try {
        const usage=await provider.readMonthlyUsageMilliUsd();
        if(usage?.complete!==true || !Number.isSafeInteger(usage.value) || !Number.isSafeInteger(usage.observedAtMs) || usage.observedAtMs>nowMs || nowMs-usage.observedAtMs>DEFAULT_MAX_BILLING_AGE_MS) return cleanup(id,{nowMs,force:true});
        monthToDateUsageMilliUsd=usage.value;
      }catch{return cleanup(id,{nowMs,force:true});}
    }
    const overBudget=monthToDateUsageMilliUsd !== undefined && safeInteger(monthToDateUsageMilliUsd,'DO_USAGE_INVALID')>=run.lease.monthlyCapMilliUsd;
    if (expired||overBudget||run.artifactVerified||['DELETE_OUTCOME_UNKNOWN','VERIFY_ABSENCE'].includes(run.state)) return cleanup(id,{nowMs,force:true});
    return {status:run.state,nextWatchdogDeadlineMs:run.lease.expiresAtMs};
  }
  return Object.freeze({initialize,start,reconcile,markRunning,confirmExternalEvidence,cleanup,tick,read});
}
