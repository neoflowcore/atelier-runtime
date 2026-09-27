export const EXECUTION_CAPABILITY_ESCALATION_ORDER=Object.freeze(["RUNTIME_INTERNAL_EXECUTOR","CONNECTED_PROVIDER_API","DEVELOPER_WORKSPACE_MCP","APPROVED_REMOTE_RUNNER","TRUSTED_HOST_AGENT","BREAK_GLASS_MANUAL"]);
function uniq(v,c){if(!Array.isArray(v)||v.some(x=>typeof x!=="string"||!x))throw new Error(c);return [...new Set(v)]}
export function selectExecutionPlaneV1({requiredOperations,planes,breakGlassApproval=false}={}){
 const req=uniq(requiredOperations??[],"REQUIRED_OPERATIONS_INVALID");
 if(!Array.isArray(planes))throw new Error("EXECUTION_PLANES_REQUIRED");
 const map=new Map(planes.map(p=>[p.PLANE_ID,p]));
 for(const id of EXECUTION_CAPABILITY_ESCALATION_ORDER){
   const p=map.get(id);if(!p||p.AVAILABLE!==true)continue;
   const covers=req.every(x=>new Set(uniq(p.OPERATIONS??[],"PLANE_OPERATIONS_INVALID")).has(x));if(!covers)continue;
   if(id==="BREAK_GLASS_MANUAL"&&breakGlassApproval!==true)return Object.freeze({ok:false,code:"BREAK_GLASS_APPROVAL_REQUIRED",selected:null});
   return Object.freeze({ok:true,code:id==="BREAK_GLASS_MANUAL"?"BREAK_GLASS_SELECTED":"AUTOMATED_PLANE_SELECTED",selected:id,manual:id==="BREAK_GLASS_MANUAL"});
 }
 return Object.freeze({ok:false,code:"NO_EXECUTION_PLANE_AVAILABLE",selected:null});
}
export function validateManualEscalationV1({requiredOperations,planes,breakGlassApproval=false}={}){
 const automated=(planes??[]).filter(p=>p.PLANE_ID!=="BREAK_GLASS_MANUAL");
 const auto=selectExecutionPlaneV1({requiredOperations,planes:automated,breakGlassApproval:false});
 if(auto.ok)return Object.freeze({ok:false,code:"AUTOMATED_PATH_EXISTS_MANUAL_DENIED",automatedPlane:auto.selected});
 return selectExecutionPlaneV1({requiredOperations,planes,breakGlassApproval});
}