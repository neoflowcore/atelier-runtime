import test from"node:test";import assert from"node:assert/strict";import{buildTraceContextV1,validateTracedExternalMutationV1}from"../runtime/rev51/trace-context-v1.mjs";const t=(o={})=>buildTraceContextV1({TRACE_ID:"t",PHASE_ID:"p",JOB_ID:"j",ATTEMPT_ID:"a",OPERATION_ID:"op",...o});
test("P5 trace context binds phase job attempt and operation",()=>assert.equal(t().TRACE_ID,"t"));
test("P5 external mutation requires trace",()=>assert.equal(validateTracedExternalMutationV1({traceContext:null,effectClass:"PROVIDER_MUTATION"}).ok,false));
test("P5 mutation requires operation identity",()=>assert.equal(validateTracedExternalMutationV1({traceContext:t({OPERATION_ID:null}),effectClass:"SOURCE_MUTATION"}).code,"MUTATION_OPERATION_ID_REQUIRED"));
