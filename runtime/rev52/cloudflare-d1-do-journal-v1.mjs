import { createHash } from 'node:crypto';
// D1-backed CAS journal: one authoritative, off-Droplet state for guarded runs.
// No provider credentials or paid-resource side effects are stored in D1.
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SHA = /^[0-9a-f]{64}$/;
const TRANSITIONS = Object.freeze({
  READY: ['CREATE_OUTCOME_UNKNOWN'],
  CREATE_OUTCOME_UNKNOWN: ['BOUND'],
  BOUND: ['RUNNING','EVIDENCE_EXTERNALIZED','DELETE_OUTCOME_UNKNOWN','VERIFY_ABSENCE'],
  RUNNING: ['EVIDENCE_EXTERNALIZED','DELETE_OUTCOME_UNKNOWN','VERIFY_ABSENCE'],
  EVIDENCE_EXTERNALIZED: ['DELETE_OUTCOME_UNKNOWN','VERIFY_ABSENCE'],
  DELETE_OUTCOME_UNKNOWN: ['DELETE_OUTCOME_UNKNOWN','VERIFY_ABSENCE','CLOSED'],
  VERIFY_ABSENCE: ['DELETE_OUTCOME_UNKNOWN','VERIFY_ABSENCE','CLOSED'],
  CLOSED: []
});
function canonical(value) {
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){if(!Number.isSafeInteger(value))throw new Error('DO_D1_UNSAFE_NUMBER');return String(value);}
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  throw new Error('DO_D1_CANONICAL_UNSUPPORTED');
}
function sha(body){return createHash('sha256').update(canonical(body),'utf8').digest('hex');}
function requireRun(id) { if(typeof id !== 'string' || !RUN_ID.test(id)) throw new Error('DO_D1_RUN_ID_INVALID'); }
function checkPayload(id, next, prev) {
  if(!next || next.schema!=='DO_RUN_GUARDED_V1' || next.runId!==id || !Object.hasOwn(TRANSITIONS,next.state) ||
      !next.lease || !SHA.test(next.lease.LEASE_SHA256??'') || !SHA.test(next.lease.exactSourceSha256??'') ||
      !/^atelier-run-[a-f0-9]{24}$/.test(next.lease.ownershipTag??'') ||
      !Number.isSafeInteger(next.lease.expiresAtMs) ||
      typeof next.lease.grantId!=='string' || !next.lease.grantId ||
      typeof next.lease.resourceName!=='string' || !next.lease.resourceName ||
      !Number.isSafeInteger(next.lease.monthlyCapMilliUsd) || next.lease.monthlyCapMilliUsd<=0 ||
      !Number.isSafeInteger(next.lease.estimatedLeaseMilliUsd) || next.lease.estimatedLeaseMilliUsd<0 ||
      !Number.isSafeInteger(next.lease.otherReservedMilliUsd) || next.lease.otherReservedMilliUsd<0 ||
      !Number.isSafeInteger(next.lease.costBufferMilliUsd) || next.lease.costBufferMilliUsd<0 ||
      !Number.isSafeInteger(next.createAttempts)||next.createAttempts<0||next.createAttempts>1||
      !Number.isSafeInteger(next.deleteAttempts)||next.deleteAttempts<0||next.deleteAttempts>2 ||
      (next.dropletId!==null && (!Number.isSafeInteger(next.dropletId)||next.dropletId<=0))) {
    throw new Error('DO_D1_JOURNAL_PAYLOAD_INVALID');
  }
  if ((['READY','CREATE_OUTCOME_UNKNOWN'].includes(next.state) && next.dropletId!==null) ||
      (['BOUND','RUNNING','EVIDENCE_EXTERNALIZED','DELETE_OUTCOME_UNKNOWN','VERIFY_ABSENCE','CLOSED'].includes(next.state) && next.dropletId===null))
    throw new Error('DO_D1_DROPLET_BINDING_INVALID');
  const {LEASE_SHA256,...leaseBody}=next.lease;
  if(sha(leaseBody)!==LEASE_SHA256)throw new Error('DO_D1_LEASE_HASH_MISMATCH');
  if(prev) {
    if (!TRANSITIONS[prev.state].includes(next.state) ||
        next.lease.LEASE_SHA256!==prev.lease.LEASE_SHA256 ||
        next.lease.ownershipTag!==prev.lease.ownershipTag ||
        next.lease.resourceName!==prev.lease.resourceName ||
        next.lease.exactSourceSha256!==prev.lease.exactSourceSha256 ||
        next.lease.grantId!==prev.lease.grantId ||
        next.lease.expiresAtMs!==prev.lease.expiresAtMs ||
        (prev.dropletId !== null && next.dropletId!==prev.dropletId) ||
        next.createAttempts < prev.createAttempts ||
        next.deleteAttempts < prev.deleteAttempts) throw new Error('DO_D1_JOURNAL_TRANSITION_DENIED');
  } else if (next.state!=='READY'||next.revision!==0||next.dropletId!==null||next.createAttempts!==0||next.deleteAttempts!==0) {
    throw new Error('DO_D1_INIT_ONLY_READY');
  }
}
export function createCloudflareD1DigitalOceanJournalV1({db, now=Date.now}={}) {
  if (!db || typeof db.prepare!=='function' || typeof now!=='function') throw new Error('DO_D1_BINDING_REQUIRED');
  async function read(id) {
    requireRun(id);
    const row=await db.prepare('SELECT body_json FROM do_runs WHERE run_id = ?').bind(id).first();
    return row ? JSON.parse(row.body_json) : null;
  }
  async function cas(id, expectedRevision, next, {monthToDateUsageMilliUsd}={}) {
    requireRun(id);
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new Error('DO_D1_EXPECTED_REVISION_INVALID');
    const previous=await read(id);
    if ((previous?.revision??0)!==expectedRevision || (!previous&&expectedRevision!==0)) throw new Error('DO_D1_CAS_CONFLICT');
    checkPayload(id,next,previous);
    const saved={...next,revision:expectedRevision+1};
    const timestamp=now();
    if(!Number.isSafeInteger(timestamp))throw new Error('DO_D1_NOW_INVALID');
    let result;
    if(previous) {
      result=await db.prepare('UPDATE do_runs SET body_json = ?, revision = ?, updated_at_ms = ? WHERE run_id = ? AND revision = ?')
        .bind(JSON.stringify(saved),saved.revision,timestamp,id,expectedRevision).run();
    } else {
      if(!Number.isSafeInteger(monthToDateUsageMilliUsd)||monthToDateUsageMilliUsd<0)throw new Error('DO_D1_FRESH_BILL_REQUIRED');
      // One atomic SQLite statement reserves forecast budget across all active leases.
      // A separate read+insert would race if two executions start simultaneously.
      const required=BigInt(monthToDateUsageMilliUsd)+BigInt(next.lease.otherReservedMilliUsd)+BigInt(next.lease.estimatedLeaseMilliUsd)+BigInt(next.lease.costBufferMilliUsd);
      if(required>BigInt(next.lease.monthlyCapMilliUsd))throw new Error('DO_D1_BUDGET_DENIED');
      const allowance=BigInt(next.lease.monthlyCapMilliUsd)-required;
      result=await db.prepare(`INSERT OR IGNORE INTO do_runs (run_id, revision, body_json, updated_at_ms)
        SELECT ?, ?, ?, ? WHERE
        (SELECT COALESCE(SUM(CAST(json_extract(body_json, '$.lease.estimatedLeaseMilliUsd') AS INTEGER) + CAST(json_extract(body_json, '$.lease.costBufferMilliUsd') AS INTEGER)),0)
          FROM do_runs WHERE json_extract(body_json, '$.state') != 'CLOSED') <= ?`)
        .bind(id,saved.revision,JSON.stringify(saved),timestamp,Number(allowance)).run();
    }
    if (result?.meta?.changes!==1) throw new Error('DO_D1_CAS_CONFLICT');
    return saved;
  }
  async function listActive(limit=100) {
    if(!Number.isSafeInteger(limit)||limit<1||limit>100) throw new Error('DO_D1_SCAN_LIMIT_INVALID');
    const result=await db.prepare("SELECT body_json FROM do_runs WHERE json_extract(body_json, '$.state') != 'CLOSED' ORDER BY updated_at_ms ASC LIMIT ?")
      .bind(limit+1).all();
    if(!Array.isArray(result?.results) || result.results.length>limit) throw new Error('DO_D1_ACTIVE_SCAN_OVERFLOW');
    return result.results.map(x=>JSON.parse(x.body_json));
  }
  async function getHeartbeat() {
    const r=await db.prepare("SELECT value FROM do_metadata WHERE key = 'last_cron_ms'").first();
    return r ? Number(r.value) : null;
  }
  async function getWatchStatus() {
    const r=await db.prepare("SELECT value FROM do_metadata WHERE key = 'last_cron_status'").first();
    return r?.value??null;
  }
  async function setWatchStatus(value) {
    if(!['OK','DEGRADED'].includes(value))throw new Error('DO_D1_STATUS_INVALID');
    await db.prepare("INSERT INTO do_metadata (key,value) VALUES ('last_cron_status',?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(value).run();
  }
  async function setHeartbeat(ms) {
    if(!Number.isSafeInteger(ms)||ms<0)throw new Error('DO_D1_NOW_INVALID');
    await db.prepare("INSERT INTO do_metadata (key,value) VALUES ('last_cron_ms',?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(String(ms)).run();
  }
  return Object.freeze({read,cas,listActive,getHeartbeat,setHeartbeat,getWatchStatus,setWatchStatus});
}
