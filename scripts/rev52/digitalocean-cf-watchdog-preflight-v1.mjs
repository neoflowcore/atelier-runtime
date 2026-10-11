#!/usr/bin/env node
// External scheduler readiness gate. Safe: GET only, never creates resources.
import { createCloudflareRemoteDigitalOceanJournalV1 } from '../../runtime/rev52/cloudflare-remote-do-journal-v1.mjs';
const url=process.env.DO_WATCHDOG_URL, bearer=process.env.DO_WATCHDOG_SHARED_SECRET;
if(!url||!bearer){console.log(JSON.stringify({status:'BLOCKED',code:'CF_DO_WATCHDOG_CONNECTION_REQUIRED'}));process.exitCode=2;}
else try {
  const client=createCloudflareRemoteDigitalOceanJournalV1({baseUrl:url,bearerToken:bearer});
  const h=await client.health();
  // Never expose secret, server address or provider account metadata in output.
  console.log(JSON.stringify({status:h.ready===true?'PASS':'BLOCKED',code:h.ready===true?'CF_DO_INDEPENDENT_WATCHDOG_READY':'CF_DO_WATCHDOG_NOT_READY',cronFresh:h.cronFresh===true,cleanupEnabled:h.cleanupEnabled===true}));
  if(h.ready!==true)process.exitCode=2;
} catch(e){console.log(JSON.stringify({status:'BLOCKED',code:/^[A-Z0-9_]+$/.test(e.message)?e.message:'CF_DO_WATCHDOG_PREFLIGHT_FAILED'}));process.exitCode=2;}
