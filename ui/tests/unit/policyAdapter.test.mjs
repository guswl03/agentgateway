import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { adaptPolicyPlan, parsePolicyPlan, conditionCel, deleteFieldsCel, targetFingerprint, removePolicyTransforms } from '../../src/policyAdapter.ts';
import { policyResourceChanges } from '../../src/policyPersistence.ts';

test('hybrid policy delta preserves infrastructure and DB route identity', () => {
 const before=structuredClone(initial), after=adaptPolicyPlan(plan(card()),before,profile).config;
 const resources=[{kind:'traffic.route',id:'fhir',value:before.routes[0]}];
 const changes=policyResourceChanges(before,after,resources,{gateways:before.gateways});
 assert.equal(changes.length,1);assert.equal(changes[0].id,'fhir');
 assert.deepEqual(changes[0].value.backends,before.routes[0].backends);
 assert.ok(changes[0].value.policies.transformations);
 assert.throws(()=>policyResourceChanges(before,after,[],{}),/파일/);
 assert.throws(()=>policyResourceChanges(before,after,resources,before),/파일/);
 const altered=structuredClone(after);altered.routes[0].backends=[{host:'wrong:80'}];
 assert.throws(()=>policyResourceChanges(before,altered,resources,{}),/목적지/);
});

test('hybrid LLM and route changes share a batch and reject file-owned policies', () => {
 const before={...structuredClone(initial),llm:{models:[],policies:{cors:{allowOrigins:['*']}}}};
 const after=structuredClone(before);after.llm.policies.transformations={request:{body:'"test"'}};
 after.routes[0].policies={transformations:{request:{body:'"test"'}}};
 const resources=[{kind:'traffic.route',id:'fhir',value:before.routes[0]}];
 const changes=policyResourceChanges(before,after,resources,{llm:{policies:{cors:before.llm.policies.cors}}});
 assert.deepEqual(changes.map(c=>[c.kind,c.id]),[['traffic.route','fhir'],['llm.policy','transformations']]);
 assert.throws(()=>policyResourceChanges(before,after,resources,{llm:{policies:{transformations:{}}}}),/파일/);
 const unsupported=structuredClone(after);unsupported.gateways={};
 assert.throws(()=>policyResourceChanges(before,unsupported,resources,{}),/지원하지/);
});

const initial = { gateways: { default: { port: 19210 } }, routes: [{ name: 'fhir', backends: [{ host: '127.0.0.1:19211' }] }] };
const card = () => ({ law_id: 'TEST_LAW', policy_id: 'OTHER_CARD', policy_text: 'Technical fixture, not a legal policy', applies_when: { constant: true }, scope: { target_ref: 'route:0' }, function_combination: 'all',
 function: [{ function_id: 'AGW-BODY-HEADER-TRANSFORM-REQUEST', action: 'remove_field', object: 'DATA_FIELD', direction: 'request', traffic: 'http', parameters: { paths: ['telecom[].value', 'birthDate'], body_location: 'root_json', resource_type: 'Patient' } }], except: [], legal_sources: [{ revision_no: 'TEST', promulgation_date: '2020-01-01' }] });
const plan = policy => ({ version: '1.1-draft', policy_packs: [{ pack_id: 'ARBITRARY_PACK', version: '1', priority: 10, policies: [policy] }] });
const profile = { version: 1, bindings: {} };
test('compatible cards share idempotent headers without dropping cards or conditions', () => {
 for (const action of ['set_header', 'remove_header']) {
  const first=card(); first.applies_when={eq:{fact:'request.method',value:'POST'}};
  first.function=[{function_id:'AGW-BODY-HEADER-TRANSFORM-REQUEST',action,object:'TECHNICAL_HEADER',direction:'request',traffic:'http',parameters:{header:'X-Shared',...(action==='set_header'?{value:'chosen-once'}:{})}}];
  const second=structuredClone(first);second.policy_id='SECOND';second.function[0].parameters.header='x-shared';
  const doc=plan(first);doc.policy_packs[0].policies.push(second);
  const snapshot=structuredClone(doc), result=adaptPolicyPlan(doc,initial,profile);
  assert.deepEqual(result.findings,[]);assert.deepEqual(doc,snapshot);
  const transform=result.config.routes[0].policies.transformations.request;
  assert.equal((transform.replace.match(/\.with\(h,/g)??[]).length,1);
  assert.match(transform.replace,/x-shared/);assert.match(transform.replace,/POST/);
  if(action==='set_header') assert.match(transform.replace,/chosen-once/);
  else assert.match(transform.replace,/filterKeys/);
  assert.ok(result.notes.some(n=>n.includes('TEST_LAW/SECOND')));
 }
});
test('shared headers still block different values, actions, conditions and repeated additions', () => {
 const first=card();first.function=[{function_id:'AGW-BODY-HEADER-TRANSFORM-REQUEST',action:'set_header',object:'TECHNICAL_HEADER',direction:'request',traffic:'http',parameters:{header:'x-shared',value:'one'}}];
 for(const kind of ['value','action','condition','add']) {
  const second=structuredClone(first);second.policy_id='SECOND';
  if(kind==='value')second.function[0].parameters.value='two';
  if(kind==='action')second.function[0].action='remove_header';
  if(kind==='condition')second.applies_when={eq:{fact:'request.method',value:'POST'}};
  const doc=plan(structuredClone(first));doc.policy_packs[0].policies.push(second);
  if(kind==='add')for(const p of doc.policy_packs[0].policies)p.function[0].action='add_header';
  const result=adaptPolicyPlan(doc,initial,profile);
  assert.ok(result.findings.some(f=>f.message.includes('同じ')||f.message.includes('같은 헤더')));assert.deepEqual(result.config,initial);
 }
});
test('removal only clears selected transformations and preserves routing and authorization', () => {
 const base=structuredClone(initial);base.routes[0].policies={transformations:{request:{body:'old'}},authorization:{rules:[{require:'true'}]}};
 base.routes.push({name:'other',policies:{transformations:{response:{body:'keep'}}}});
 const result=removePolicyTransforms(base,['route:0']);
 assert.equal(result.routes[0].policies.transformations,undefined);
 assert.deepEqual(result.routes[0].policies.authorization,base.routes[0].policies.authorization);
 assert.deepEqual(result.routes[0].backends,base.routes[0].backends);
 assert.deepEqual(result.routes[1],base.routes[1]);assert.ok(base.routes[0].policies.transformations);
});
test('generic plan produces config and preserves input', () => {
 const before = JSON.stringify(initial); const result = adaptPolicyPlan(parsePolicyPlan(JSON.stringify(plan(card()))), initial, profile);
 assert.equal(result.findings.length, 0); assert.equal(JSON.stringify(initial), before);
 assert.match(result.config.routes[0].policies.transformations.request.body, /filterKeys/);
 assert.ok(result.config.routes[0].policies.authorization.rules.length);
});
test('same plan can be imported again without duplicating transformations or rules', () => {
 const first = adaptPolicyPlan(plan(card()), initial, profile);
 const second = adaptPolicyPlan(plan(card()), first.config, profile);
 assert.equal(second.findings.length, 0); assert.deepEqual(second.config, first.config);
});
test('unknown source scope is never silently discarded', () => {
 const p = card(); p.scope = { data_scope: 'restricted' };
 assert.ok(adaptPolicyPlan(plan(p), initial, profile).findings.length);
});
test('missing condition is not turned into true', () => { const p = card(); p.applies_when = null; const r = adaptPolicyPlan(plan(p), initial, profile); assert.ok(r.findings.length); assert.deepEqual(r.config, initial); });
test('candidate paths are never implicitly approved', () => { const p = card(); p.function[0].parameters = {}; p.function[0].target = { mappings: [{ element_paths: ['Patient.birthDate'] }] }; assert.ok(adaptPolicyPlan(plan(p), initial, profile).findings.length); });
test('unreviewed exclusion blocks config generation', () => { const p = card(); p.except = null; assert.ok(adaptPolicyPlan(plan(p), initial, profile).findings.length); });
test('conditional exclusion is explicit unsupported', () => { const p = card(); p.except = [{ pack_id: 'LOW', law_id: 'OTHER', policy_id: 'LOW' }]; assert.match(adaptPolicyPlan(plan(p), initial, profile).findings[0].message, /배제/); });
test('existing transformations are never overwritten', () => { const base = structuredClone(initial); base.routes[0].policies = { transformations: { request: { body: '"existing"' } } }; const r = adaptPolicyPlan(plan(card()), base, profile); assert.ok(r.findings.some(f => f.kind === 'conflict')); assert.deepEqual(r.config, base); });
test('request body merges with existing response header and remains idempotent', () => {
 const base=structuredClone(initial); base.routes[0].policies={transformations:{response:{set:{'x-ai-generated':'"true"'}}}};
 const first=adaptPolicyPlan(plan(card()),base,profile); assert.deepEqual(first.findings,[]);
 assert.deepEqual(first.config.routes[0].policies.transformations.response,base.routes[0].policies.transformations.response);
 const second=adaptPolicyPlan(plan(card()),first.config,profile); assert.deepEqual(second.findings,[]); assert.deepEqual(second.config,first.config);
});
test('all existing paths apply with aggregate fingerprint and preserve destinations', () => {
 const base=structuredClone(initial); base.routes.push({name:'second',backends:[{host:'localhost:9001'}]});
 const p=card(), bindings={version:1,bindings:{'TEST_LAW/OTHER_CARD':{target:'all',targetFingerprint:targetFingerprint(base,'all')}}};
 const result=adaptPolicyPlan(plan(p),base,bindings); assert.deepEqual(result.findings,[]);
 for(let i=0;i<2;i++){assert.match(result.config.routes[i].policies.transformations.request.body,/birthDate/);assert.deepEqual(result.config.routes[i].backends,base.routes[i].backends);}
 base.routes[1].backends[0].host='changed:90'; assert.ok(adaptPolicyPlan(plan(p),base,bindings).findings.length);
});
test('unknown functions fail rather than silently disappear', () => { const p = card(); p.function[0].function_id = 'UNKNOWN'; assert.ok(adaptPolicyPlan(plan(p), initial, profile).findings.length); });
test('client approval headers are not implicitly trusted', () => { assert.throws(() => conditionCel({ eq: { fact: 'request.headers.approved', value: 'yes' } })); });
test('field paths reject expression injection', () => { assert.throws(() => deleteFieldsCel(['foo); true'])); });
test('saved route changed destination requires reconfirmation', () => { const base = structuredClone(initial); base.routes[0].backends[0].host = 'another:80'; const saved = { version: 1, bindings: { 'TEST_LAW/OTHER_CARD': { target: 'route:0', targetFingerprint: targetFingerprint(initial, 'route:0') } } }; assert.ok(adaptPolicyPlan(plan(card()), base, saved).findings.length); });
test('wrong plan version and duplicate cards rejected', () => { assert.throws(() => parsePolicyPlan(JSON.stringify({ ...plan(card()), version: 'unknown' }))); const doc = plan(card()); doc.policy_packs[0].policies.push(card()); assert.throws(() => parsePolicyPlan(JSON.stringify(doc))); });
test('conditional header and deletion pass pinned gateway schema', () => {
 const p = card(); p.applies_when = { eq: { fact: 'request.path', value: '/target' } }; p.function.push({ function_id: 'AGW-BODY-HEADER-TRANSFORM-RESPONSE', action: 'set_header', object: 'AI_OUTPUT', direction: 'response', traffic: 'http', parameters: { header: 'x-ai-generated', value: 'true' } });
 const r = adaptPolicyPlan(plan(p), initial, profile); assert.equal(r.findings.length, 0);
 const schema = JSON.parse(readFileSync(new URL('../../../schema/config.json', import.meta.url), 'utf8'));
 function clean(v) { if (!v || typeof v !== 'object') return; if (Array.isArray(v.enum) && !v.enum.length) { delete v.enum; delete v.type; v.not = {}; } Object.values(v).forEach(clean); } clean(schema);
 const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema); assert.ok(validate(r.config), JSON.stringify(validate.errors));
 mkdirSync(new URL('../../test-output/', import.meta.url), { recursive: true }); writeFileSync(new URL('../../test-output/runtime-config.json', import.meta.url), JSON.stringify(r.config, null, 2));
});


test('generic instruction insertion preserves conditions and supports LLM without policy identity coupling', () => {
 const p=card(); p.applies_when={eq:{fact:'request.path',value:'/v1/chat/completions'}};
 p.function=[{function_id:'AGW-BODY-HEADER-TRANSFORM-REQUEST',action:'rewrite_body',object:'AI_OUTPUT',direction:'request',traffic:'http',parameters:{instruction_text:'Say hello'}}];
 p.scope={target_ref:'llm'};
 const base={llm:{port:4000,models:[]}};
 const result=adaptPolicyPlan(plan(p),base,profile); assert.deepEqual(result.findings,[]);
 const expression=result.config.llm.policies.transformations.request.body;
 assert.match(expression,/messages/); assert.match(expression,/instructions/); assert.match(expression,/Say hello/); assert.ok(expression.includes('request.path == "/v1/chat/completions"'));
 assert.deepEqual(base,{llm:{port:4000,models:[]}});
 p.function[0].parameters.instruction_text=''; assert.ok(adaptPolicyPlan(plan(p),base,profile).findings.length);
 p.function[0].direction='response';p.function[0].function_id='AGW-BODY-HEADER-TRANSFORM-RESPONSE'; assert.ok(adaptPolicyPlan(plan(p),base,profile).findings.length);
});
