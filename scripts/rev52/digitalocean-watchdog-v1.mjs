#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDigitalOceanGuardedControllerV1 } from '../../runtime/rev52/digitalocean-guardrails-v1.mjs';
import { createDigitalOceanJsonFileJournalV1 } from '../../runtime/rev52/digitalocean-json-journal-v1.mjs';
import { createDigitalOceanRestProviderV1 } from '../../runtime/rev52/digitalocean-rest-provider-v1.mjs';

// DO NOT use this script as a live production watchdog on the disposable VM.
// Put the journal on externally durable storage and run this independently.
const action=process.argv[2]??'--inspect';
if(!['--inspect','--watch'].includes(action))throw new Error('DO_WATCHDOG_MODE_INVALID');
const dir=resolve(process.env.DO_JOURNAL_DIR??'.atelier/do-journals');
const store=createDigitalOceanJsonFileJournalV1({directory:dir});
let files=[];
try{files=await readdir(dir);}catch(e){if(e?.code!=='ENOENT')throw e;}
const runIds=files.filter(name=>/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.json$/.test(name)).map(name=>name.slice(0,-5)).sort();
if(action==='--inspect'){
  const statuses=[];
  for(const id of runIds){const run=await store.read(id);if(run?.schema==='DO_RUN_GUARDED_V1')statuses.push({runId:run.runId,state:run.state,expiresAtMs:run.lease?.expiresAtMs??null});}
  process.stdout.write(JSON.stringify({mode:'INSPECT_ONLY',count:statuses.length,runs:statuses})+'\n');
}else{
  if(process.env.DO_EXTERNAL_WATCHDOG_CONFIRMED!=='YES' || process.env.DO_ENABLE_LEASE_CLEANUP!=='YES')throw new Error('DO_WATCHDOG_LIVE_AUTHORITY_REQUIRED');
  if(!process.env.DIGITALOCEAN_TOKEN)throw new Error('DO_BEARER_TOKEN_REQUIRED');
  const provider=createDigitalOceanRestProviderV1({bearerToken:process.env.DIGITALOCEAN_TOKEN});
  const controller=createDigitalOceanGuardedControllerV1({store,provider});
  const statuses=[];
  for(const id of runIds){
    try{const r=await controller.tick(id,{nowMs:Date.now()});statuses.push({runId:id,status:r.status,reason:r.reason??null});}
    catch(e){statuses.push({runId:id,status:'ERROR',reason:String(e.message).slice(0,100)});process.exitCode=1;}
  }
  if(statuses.some(s=>['RECONCILIATION_REQUIRED','DELETE_OUTCOME_UNKNOWN','CREATE_OUTCOME_UNKNOWN','RESIDUE_PENDING','ERROR'].includes(s.status)))process.exitCode=1;
  process.stdout.write(JSON.stringify({mode:'LEASE_WATCH',count:statuses.length,runs:statuses})+'\n');
}
