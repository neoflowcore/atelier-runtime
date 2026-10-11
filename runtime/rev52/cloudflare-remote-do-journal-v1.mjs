// Adapter that lets the existing DigitalOcean guarded controller use Cloudflare D1.
// The remote Cloudflare cron executes independently of the calling process.
const RUN_ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
export function createCloudflareRemoteDigitalOceanJournalV1({baseUrl,bearerToken,fetchImpl=globalThis.fetch}={}) {
  if(typeof bearerToken!=='string'||bearerToken.length<32)throw new Error('CF_DO_JOURNAL_TOKEN_REQUIRED');
  if(typeof fetchImpl!=='function')throw new Error('CF_DO_JOURNAL_FETCH_REQUIRED');
  let parsed;
  try{parsed=new URL(baseUrl);}catch{throw new Error('CF_DO_JOURNAL_URL_INVALID');}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/'||
     !parsed.hostname||parsed.port)throw new Error('CF_DO_JOURNAL_HTTPS_ORIGIN_REQUIRED');
  const root=parsed.origin;
  async function request(method,path,payload) {
    let response;
    try{response=await fetchImpl(root+path,{method,headers:{Authorization:`Bearer ${bearerToken}`,Accept:'application/json',...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{})});}
    catch{throw new Error('CF_DO_JOURNAL_TRANSPORT_UNKNOWN');}
    if(response.status===404)return {notFound:true};
    let body;try{body=await response.json();}catch{throw new Error('CF_DO_JOURNAL_RESPONSE_INVALID');}
    if(!response.ok||body?.ok!==true){
      const code=typeof body?.code==='string'&&/^[A-Z0-9_]+$/.test(body.code)?body.code:'REMOTE_ERROR';
      throw new Error(`CF_DO_JOURNAL_${code}`);
    }
    return body;
  }
  const path=id=>{if(typeof id!=='string'||!RUN_ID.test(id))throw new Error('CF_DO_JOURNAL_RUN_ID_INVALID');return `/v1/runs/${encodeURIComponent(id)}`;};
  return Object.freeze({
    async health(){return request('GET','/v1/health');},
    async read(id){const r=await request('GET',path(id));return r.notFound?null:r.run;},
    async cas(id,expectedRevision,next){if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new Error('CF_DO_JOURNAL_REVISION_REQUIRED');const r=await request('POST',path(id)+'/cas',{expectedRevision,next});return r.run;}
  });
}
