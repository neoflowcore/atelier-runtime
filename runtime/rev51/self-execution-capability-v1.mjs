export const SELF_EXECUTION_DECISIONS=Object.freeze(["AUTO_EXECUTABLE","AUTOMATION_PATH_REQUIRED","HARD_BOUNDARY"]);
const ORDER=Object.freeze(["RUNTIME_INTERNAL_EXECUTOR","CONNECTED_PROVIDER_API","DEVELOPER_WORKSPACE_MCP","APPROVED_REMOTE_RUNNER","TRUSTED_HOST_AGENT"]);
function uniq(v,c){if(!Array.isArray(v)||v.some(x=>typeof x!=="string"||!x))throw new Error(c);const s=[...new Set(v)];if(s.length!==v.length)throw new Error(c+"_DUPLICATE");return s}
export function evaluateSelfExecutionCapabilityV1({requiredOperations,executionPlanes}={}){
 const req=uniq(requiredOperations??[],"REQUIRED_OPERATIONS_INVALID");
 if(!Array.isArray(executionPlanes))throw new Error("EXECUTION_PLANES_REQUIRED");
 const byId=new Map(executionPlanes.map(p=>[p.PLANE_ID,p]));
 for(const id of ORDER){
   const p=byId.get(id);if(!p)continue;
   if(!["AUTO_EXECUTABLE","AUTOMATION_PATH_REQUIRED","UNAVAILABLE"].includes(p.STATE))throw new Error("EXECUTION_PLANE_STATE_INVALID");
   if(p.STATE==="UNAVAILABLE")continue;
   const ops=new Set(uniq(p.OPERATIONS??[],"EXECUTION_PLANE_OPERATIONS_INVALID"));
   if(req.every(x=>ops.has(x)))return Object.freeze({decision:p.STATE,planeId:id,missingOperations:[],manualHandoffAllowed:false});
 }
 const available=new Set();for(const p of executionPlanes)for(const x of uniq(p.OPERATIONS??[],"EXECUTION_PLANE_OPERATIONS_INVALID"))if(p.STATE!=="UNAVAILABLE")available.add(x);
 return Object.freeze({decision:"HARD_BOUNDARY",planeId:null,missingOperations:req.filter(x=>!available.has(x)).sort(),manualHandoffAllowed:false});
}
export function validateHumanHandoffV1({selfExecutionDecision,manualPlane,explicitBreakGlassApproval=false,reason}={}){
 if(selfExecutionDecision?.decision!=="HARD_BOUNDARY")return Object.freeze({ok:false,code:"HUMAN_HANDOFF_WITHOUT_SELF_EXECUTION_DENIAL"});
 if(explicitBreakGlassApproval!==true)return Object.freeze({ok:false,code:"BREAK_GLASS_APPROVAL_REQUIRED"});
 if(!["TERMUX","SSH","PROVIDER_UI"].includes(manualPlane))return Object.freeze({ok:false,code:"MANUAL_PLANE_INVALID"});
 if(typeof reason!=="string"||!reason)return Object.freeze({ok:false,code:"BREAK_GLASS_REASON_REQUIRED"});
 return Object.freeze({ok:true,code:"BREAK_GLASS_ALLOWED",manualPlane,reason});
}