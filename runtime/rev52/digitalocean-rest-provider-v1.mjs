import { usdToMilliV1 } from './digitalocean-guardrails-v1.mjs';

// REST adapter for a separately authorized runtime. It does not use the
// ChatGPT connector's tokens, and never logs or serializes the bearer token.
// Production secret must be supplied by an authorized secret broker.
const error = code => {throw new Error(code);};
function ceilHourlyMilli(value) {
  const str=String(value);
  if (!/^\d+(?:\.\d+)?$/.test(str)) error('DO_HOURLY_QUOTE_INVALID');
  const [integer,fraction='']=str.split('.');
  const multiplier=10n**BigInt(fraction.length);
  const milli=(BigInt(integer)*multiplier+BigInt(fraction||'0'))*1000n;
  const rounded=(milli+multiplier-1n)/multiplier;
  if (rounded>BigInt(Number.MAX_SAFE_INTEGER)) error('DO_HOURLY_QUOTE_OVERFLOW');
  return Number(rounded);
}

export function createDigitalOceanRestProviderV1({bearerToken, fetchImpl=globalThis.fetch, now=Date.now,
  endpoint='https://api.digitalocean.com/v2'}={}) {
  if (typeof bearerToken!=='string' || bearerToken.length<8) error('DO_BEARER_TOKEN_REQUIRED');
  if (typeof fetchImpl!=='function' || typeof now!=='function') error('DO_REST_DEPENDENCIES_REQUIRED');
  if (endpoint!=='https://api.digitalocean.com/v2') error('DO_ENDPOINT_NOT_ALLOWLISTED');
  async function request(method, resource, payload) {
    const url=new URL(endpoint+resource);
    const options={method,headers:{Authorization:`Bearer ${bearerToken}`,Accept:'application/json'}};
    if(payload!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(payload);}
    let response;
    try {response=await fetchImpl(url.toString(),options);}
    catch {error('DO_TRANSPORT_OUTCOME_UNKNOWN');}
    if(response.status===404)return {notFound:true};
    if(!response.ok)error(`DO_HTTP_${response.status}`);
    if(response.status===204)return {};
    try{return await response.json();}
    catch{error('DO_API_INVALID_JSON');}
  }
  async function paginated(resource,key) {
    const rows=[];let complete=false;
    for(let page=1;page<=100;page++){
      const separator=resource.includes('?')?'&':'?';
      const body=await request('GET',`${resource}${separator}page=${page}&per_page=200`);
      if(!Array.isArray(body?.[key]))error('DO_PAGINATION_SCHEMA_INVALID');
      rows.push(...body[key]);
      if(!body.links?.pages?.next){
        const total=body.meta?.total;
        if(Number.isSafeInteger(total) && total>rows.length)error('DO_PAGINATION_INCOMPLETE');
        complete=true;break;
      }
    }
    if(!complete)error('DO_PAGINATION_LIMIT_REACHED');
    return rows;
  }
  async function scanChildResources(){
    try{
      const [volumes,ips,lbs]=await Promise.all([
        paginated('/volumes','volumes'),paginated('/reserved_ips','reserved_ips'),paginated('/load_balancers','load_balancers')
      ]);
      const normalize=(values,kind,idName='id')=>values.map(x=>({kind,id:String(x[idName]),tags:Array.isArray(x.tags)?x.tags:[]}));
      return {complete:true,items:[...normalize(volumes,'VOLUME'),...normalize(ips,'RESERVED_IP','ip'),...normalize(lbs,'LOAD_BALANCER')]};
    }catch(e){return {complete:false,items:[],reason:e.message.startsWith('DO_')?e.message:'DO_CHILD_SCAN_FAILURE'};}
  }
  return Object.freeze({
    async listDroplets(){return {complete:true,items:await paginated('/droplets','droplets')};},
    async listAccountSnapshots(){return paginated('/snapshots','snapshots');},
    scanChildResources,
    async getDroplet(id){
      if(!Number.isSafeInteger(id)||id<=0)error('DO_DROPLET_ID_INVALID');
      const body=await request('GET',`/droplets/${id}`);
      return body.notFound?null:body.droplet;
    },
    async createDroplet({name,region,size,image,tags}){
      const body=await request('POST','/droplets',{name,region,size,image,tags,backups:false,monitoring:false});
      if(!Number.isSafeInteger(body?.droplet?.id))error('DO_CREATE_ID_UNVERIFIED');
      return body.droplet;
    },
    async deleteDroplet(id){
      if(!Number.isSafeInteger(id)||id<=0)error('DO_DROPLET_ID_INVALID');
      const body=await request('DELETE',`/droplets/${id}`);
      return {accepted:!body.notFound};
    },
    async getSizeQuote(size,region){
      const sizes=await paginated('/sizes','sizes');
      const candidate=sizes.find(x=>x.slug===size && x.available!==false && Array.isArray(x.regions)&&x.regions.includes(region));
      if(!candidate)return {verified:false};
      return {verified:true,hourlyPriceMilliUsd:ceilHourlyMilli(candidate.price_hourly),size,region};
    },
    async readMonthlyUsageMilliUsd(){
      const balance=await request('GET','/customers/my/balance');
      if(!balance || typeof balance.month_to_date_usage!=='string')error('DO_BILLING_SCHEMA_INVALID');
      return {complete:true,value:usdToMilliV1(balance.month_to_date_usage),observedAtMs:now()};
    }
  });
}
