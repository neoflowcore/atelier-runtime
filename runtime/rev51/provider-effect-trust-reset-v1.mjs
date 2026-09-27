export const EFFECT_CLASSES=Object.freeze(["PURE_READ","QUERY","SOURCE_MUTATION","PROVIDER_MUTATION","DESTRUCTIVE_MUTATION"]);
export function classifyProviderOperationV1(descriptor){
 if(!descriptor||typeof descriptor!=="object")throw new Error("OPERATION_DESCRIPTOR_REQUIRED");
 if(typeof descriptor.OPERATION!=="string"||!descriptor.OPERATION)throw new Error("OPERATION_ID_REQUIRED");
 if(typeof descriptor.TRANSPORT_METHOD!=="string"||!descriptor.TRANSPORT_METHOD)throw new Error("TRANSPORT_METHOD_REQUIRED");
 if(!EFFECT_CLASSES.includes(descriptor.EFFECT_CLASS))throw new Error("EFFECT_CLASS_INVALID");
 return Object.freeze({operation:descriptor.OPERATION,transportMethod:descriptor.TRANSPORT_METHOD,effectClass:descriptor.EFFECT_CLASS,providerMutation:["PROVIDER_MUTATION","DESTRUCTIVE_MUTATION"].includes(descriptor.EFFECT_CLASS),sourceMutation:descriptor.EFFECT_CLASS==="SOURCE_MUTATION",readOnly:["PURE_READ","QUERY"].includes(descriptor.EFFECT_CLASS),requiredCredentialCapability:descriptor.REQUIRED_CREDENTIAL_CAPABILITY??null});
}
export function authorityAllowsOperationV1({descriptor,allowedEffectClasses}={}){
 const c=classifyProviderOperationV1(descriptor);if(!Array.isArray(allowedEffectClasses))throw new Error("ALLOWED_EFFECT_CLASSES_REQUIRED");
 return Object.freeze({ok:allowedEffectClasses.includes(c.effectClass),effectClass:c.effectClass,transportMethod:c.transportMethod});
}
export function applyOperatorMutationTrustResetV1({evidence,mutation}={}){
 if(!Array.isArray(evidence))throw new Error("EVIDENCE_LIST_REQUIRED");
 if(!mutation||typeof mutation!=="object")throw new Error("OPERATOR_MUTATION_REQUIRED");
 if(mutation.MUTATED!==true)return Object.freeze({trustReset:false,evidence:evidence.map(x=>({...x}))});
 const affected=new Set(mutation.AFFECTED_DOMAINS??[]);const out=evidence.map(x=>affected.has(x.DOMAIN)||affected.has("*")?{...x,STATUS:"STALE",STALE_REASON:"OPERATOR_MUTATION_TRUST_RESET"}:{...x});
 return Object.freeze({trustReset:true,evidence:out});
}