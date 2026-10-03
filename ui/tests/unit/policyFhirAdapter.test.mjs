import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adaptPolicyPlan,parsePolicyPlan,parseProfile} from '../../src/policyAdapter.ts';
import {sharedFunctionGroups} from '../../src/policyShared.ts';
const cfg={routes:[{name:'protected',backends:[{host:'localhost:9000'}]}]};
const profile={version:1,bindings:{}};
const fn=(parameters={body_location:'request_fhir',fhir_filter:{version:1,allow_fields:{}}})=>({function_id:'AGW-BODY-HEADER-TRANSFORM-REQUEST',action:'remove_field',direction:'request',traffic:'http',object:'ANY_UNMAPPED_CODE',parameters});
const card=(id,functions=[fn()])=>({law_id:'TECHNICAL',policy_id:id,policy_text:'Technical fixture',scope:{target_ref:'route:0'},applies_when:{eq:{fact:'request.method',value:'POST'}},function_combination:'all',function:functions,except:[],legal_sources:[]});
const plan=(...cards)=>({version:'1.1-draft',policy_packs:[{pack_id:'UNRELATED',version:'1',priority:1,policies:cards}]});
test('FHIR filter generates same pre-upstream fail-closed requirement and conditional body',()=>{
 const result=adaptPolicyPlan(plan(card('A')),cfg,profile);assert.deepEqual(result.findings,[]);
 const policies=result.config.routes[0].policies;
 assert.match(policies.transformations.request.body,/filterFhir/);assert.match(policies.transformations.request.body,/POST/);
 assert.ok(policies.authorization.rules.some(r=>r.require.includes('filterFhir')));
 assert.deepEqual(cfg,{routes:[{name:'protected',backends:[{host:'localhost:9000'}]}]});
});
test('resolved FHIR profiles never request legacy field mapping in shared input groups',()=>{
 const doc=plan(card('A'),card('B'));
 const groups=sharedFunctionGroups(doc,cfg,profile);
 assert.equal(groups.length,1);assert.deepEqual(groups[0].missingFields,[]);
});
test('FHIR protections deduplicate without losing cards and reject mismatched exceptions atomically',()=>{
 const document=plan(card('A'),card('B'));const r=adaptPolicyPlan(document,cfg,profile);
 assert.deepEqual(r.findings,[]);assert.equal((r.config.routes[0].policies.transformations.request.body.match(/filterFhir/g)||[]).length,1);
 assert.ok(r.notes.some(n=>n.includes('TECHNICAL/B')));assert.equal(document.policy_packs[0].policies.length,2);
 document.policy_packs[0].policies[1].function[0].parameters.fhir_filter.allow_fields={Patient:['birthDate']};
 const blocked=adaptPolicyPlan(document,cfg,profile);assert.ok(blocked.findings.some(f=>f.kind==='conflict'));assert.deepEqual(blocked.config,cfg);
});
test('FHIR filter composes after AI notice regardless of card order and preserves explicit deletion',()=>{
 const notice=card('NOTICE',[{...fn(),action:'rewrite_body',parameters:{instruction_text:'AI로 생성된 응답입니다.'}}]);
 const legacy=card('LEGACY',[fn({body_location:'root_json',paths:['birthDate'],resource_type:'Patient'})]);
 for(const cards of [[card('FHIR'),notice],[notice,card('FHIR')],[legacy,card('FHIR')],[notice,legacy,card('FHIR')]]){
 const r=adaptPolicyPlan(plan(...cards),cfg,profile);assert.deepEqual(r.findings,[]);const body=r.config.routes[0].policies.transformations.request.body;
 assert.match(body,/filterFhir/);assert.match(body,/^toJson\(\(/);assert.match(body,/\)\.with\(f,/);
 if(cards.includes(notice)){assert.match(body,/AI로 생성/);assert.ok(body.lastIndexOf('filterFhir')>body.indexOf('AI로 생성'));}
 if(cards.includes(notice)&&cards.includes(legacy))assert.match(body,/\)\.with\(b,/);
 }
});
test('invalid or mixed FHIR parameters and untrusted imported profiles are blocked',()=>{
 for(const p of [{version:2,allow_fields:{}},{version:1,allow_fields:{AuditEvent:['agent[]']}},{version:1,allow_fields:{Patient:['resourceType']}},{version:1,allow_fields:{Patient:['birthDate','birthDate']}}]){
 const result=adaptPolicyPlan(plan(card('A',[fn({body_location:'request_fhir',fhir_filter:p})])),cfg,profile);
 assert.ok(result.findings.length);assert.deepEqual(result.config,cfg);
 assert.throws(()=>parseProfile(JSON.stringify({version:1,bindings:{x:{functions:{0:{body_location:'request_fhir',fhir_filter:p}}}}})));
 }
 const mixed=adaptPolicyPlan(plan(card('A',[fn({body_location:'request_fhir',fhir_filter:{version:1,allow_fields:{}},paths:['name[]']})])),cfg,profile);
 assert.ok(mixed.findings.length);assert.deepEqual(mixed.config,cfg);
});
test('matching existing FHIR policy is idempotent; other body transforms still require review',()=>{
 const doc=plan(card('A'));const first=adaptPolicyPlan(doc,cfg,profile);assert.deepEqual(first.findings,[]);
 const again=adaptPolicyPlan(doc,first.config,profile);assert.deepEqual(again.findings,[]);assert.deepEqual(again.config,first.config);
 const existing=structuredClone(cfg);existing.routes[0].policies={transformations:{request:{body:'"existing"'}}};
 const result=adaptPolicyPlan(doc,existing,profile);assert.ok(result.findings.some(f=>f.kind==='conflict'));assert.deepEqual(result.config,existing);
});

const source=(provision)=>({law_name:'테스트 데이터 보호법',provision,level:'LAW',source_url:'https://fixture.example/law'});
const sourcedCard=(id,functions=[fn()])=>({...card(id,functions),legal_sources:[source(`제${id}조`)]});

test('deduplicated FHIR operation preserves all original card clauses in its decision and fail-closed requirement',()=>{
 const document=plan(sourcedCard('1'),sourcedCard('2'));const before=structuredClone(document);
 const first=adaptPolicyPlan(document,cfg,profile);assert.deepEqual(first.findings,[]);
 const policies=first.config.routes[0].policies;
 assert.equal(policies.transformations.request.bodyDecisions.length,1);
 const decision=policies.transformations.request.bodyDecisions[0];
 assert.equal(decision.action,'remove_field');assert.match(decision.changedWhen,/POST/);assert.match(decision.changedWhen,/p != n/);assert.match(decision.changedWhen,/filterFhir/);
 assert.ok(first.expressions.includes(decision.changedWhen));
 assert.deepEqual(decision.policySources.map(s=>[s.policy_id,s.legal_sources[0].provision]),[['1','제1조'],['2','제2조']]);
 assert.deepEqual(policies.authorization.rules[0].policySources,decision.policySources);
 assert.deepEqual(document,before);
 const second=adaptPolicyPlan(document,first.config,profile);assert.deepEqual(second.findings,[]);assert.deepEqual(second.config,first.config);
});

test('sequential deletion decisions evaluate the actual previous body and keep selected function indices',()=>{
 const one=sourcedCard('1',[fn({body_location:'root_json',paths:['birthDate']}),fn({body_location:'root_json',paths:['name[]']})]);
 const two=sourcedCard('2');const document=plan(one,two);
 const result=adaptPolicyPlan(document,cfg,profile);assert.deepEqual(result.findings,[]);
 const decisions=result.config.routes[0].policies.transformations.request.bodyDecisions;
 assert.equal(decisions.length,3);
 assert.deepEqual(decisions.map(d=>[d.policySources[0].policy_id,d.policySources[0].function_index]),[['1',0],['1',1],['2',0]]);
 assert.ok(decisions[1].changedWhen.includes('birthDate'));assert.ok(decisions[1].changedWhen.includes('name'));
 assert.ok(decisions[2].changedWhen.includes('birthDate'));assert.ok(decisions[2].changedWhen.includes('name'));assert.ok(decisions[2].changedWhen.includes('filterFhir'));
 const selected={version:1,bindings:{'TECHNICAL/1':{selectedFunctions:[1]},'TECHNICAL/2':{enabled:false}}};
 const limited=adaptPolicyPlan(document,cfg,selected);assert.deepEqual(limited.findings,[]);
 const active=limited.config.routes[0].policies.transformations.request.bodyDecisions;
 assert.equal(active.length,1);assert.equal(active[0].policySources[0].function_index,1);assert.equal(active[0].policySources[0].policy_id,'1');
});

test('distinct FHIR conditions retain separate source-aware validation and change decisions',()=>{
 const first=sourcedCard('1'),second=sourcedCard('2');second.applies_when={eq:{fact:'request.method',value:'PUT'}};
 const result=adaptPolicyPlan(plan(first,second),cfg,profile);assert.deepEqual(result.findings,[]);
 const policies=result.config.routes[0].policies;
 assert.equal(policies.authorization.rules.length,2);assert.equal(policies.transformations.request.bodyDecisions.length,2);
 assert.match(policies.authorization.rules[0].require,/POST/);assert.equal(policies.authorization.rules[0].policySources[0].policy_id,'1');
 assert.match(policies.authorization.rules[1].require,/PUT/);assert.equal(policies.authorization.rules[1].policySources[0].policy_id,'2');
});

test('notice/header/logging operations never claim to reject, mask, or delete data',()=>{
 const notice=sourcedCard('1',[{...fn(),action:'rewrite_body',parameters:{instruction_text:'AI 표시'}}]);
 const header=sourcedCard('2',[{...fn(),action:'set_header',parameters:{header:'X-AI-Generated',value:'true'}}]);
 const logging=sourcedCard('3',[{function_id:'AGW-ACCESS-LOG-TRACING',action:'log_access',direction:'exchange',traffic:'http',object:null,parameters:{reuse_existing_logging:true}}]);
 const result=adaptPolicyPlan(plan(notice,header,logging),cfg,profile);assert.deepEqual(result.findings,[]);
 const policies=result.config.routes[0].policies;
 assert.equal(policies.transformations.request.bodyDecisions,undefined);assert.equal(policies.authorization,undefined);assert.ok(!JSON.stringify(result.config).includes('policySources'));
});

test('updating an existing body decision preserves unrelated origins and atomically blocks an overflowing merge',()=>{
 const own=sourcedCard('1'),document=plan(own),first=adaptPolicyPlan(document,cfg,profile);
 const base=first.config,control=base.routes[0].policies.transformations.request.bodyDecisions[0];
 control.policySources.push({...structuredClone(control.policySources[0]),policy_id:'OTHER'});
 own.legal_sources[0].provision='제2조';
 const updated=adaptPolicyPlan(document,base,profile);assert.deepEqual(updated.findings,[]);
 const next=updated.config.routes[0].policies.transformations.request.bodyDecisions[0];
 assert.equal(next.policySources.length,2);assert.equal(next.policySources.find(s=>s.policy_id==='1').legal_sources[0].provision,'제2조');
 assert.equal(next.policySources.find(s=>s.policy_id==='OTHER').legal_sources[0].provision,'제1조');
 assert.deepEqual(adaptPolicyPlan(document,updated.config,profile).config,updated.config);
 const sources=Array.from({length:64},(_,index)=>({...structuredClone(control.policySources[0]),policy_id:`PREVIOUS_${index}`}));
 control.policySources=sources;
 const before=structuredClone(base),result=adaptPolicyPlan(document,base,profile);
 assert.ok(result.findings.length);assert.deepEqual(result.config,before);assert.deepEqual(base,before);
});

test('merged FHIR decision refreshes the card snapshot while retaining every current selected duplicate index',()=>{
 const own=sourcedCard('1',[fn(),fn(),fn()]),document=plan(own);
 const selected=(indices)=>({version:1,bindings:{'TECHNICAL/1':{selectedFunctions:indices}}});
 document.policy_packs[0].version='v1';const first=adaptPolicyPlan(document,cfg,selected([0,1]));assert.deepEqual(first.findings,[]);
 document.policy_packs[0].version='v2';own.legal_sources=[source('제2조')];
 const updated=adaptPolicyPlan(document,first.config,selected([1,2]));assert.deepEqual(updated.findings,[]);
 const policies=updated.config.routes[0].policies;
 for(const unit of [policies.transformations.request.bodyDecisions[0],policies.authorization.rules[0]]){
  assert.deepEqual(unit.policySources.map(s=>s.function_index),[1,2]);assert.ok(unit.policySources.every(s=>s.pack_version==='v2'&&s.legal_sources[0].provision==='제2조'));
 }
 assert.deepEqual(adaptPolicyPlan(document,updated.config,selected([1,2])).config,updated.config);
});

test('source-empty FHIR and root deletion revisions remove only their stale card attribution',()=>{
 for(const parameters of [{body_location:'request_fhir',fhir_filter:{version:1,allow_fields:{}}},{body_location:'root_json',paths:['birthDate']}]){
  for(const legal_sources of [[],[{revision_no:'unknown'}],[{law_name:'테스트 데이터 보호법'}],[{provision:'제1조'}]]){
   for(const retainOther of [false,true]){
    const own=sourcedCard('1',[fn(parameters)]),document=plan(own);document.policy_packs[0].version='v1';
    const first=adaptPolicyPlan(document,cfg,profile);assert.deepEqual(first.findings,[]);
    const base=structuredClone(first.config),previous=base.routes[0].policies;
    if(retainOther)for(const unit of [previous.transformations.request.bodyDecisions[0],...previous.authorization.rules])unit.policySources.push({...structuredClone(unit.policySources[0]),policy_id:'RETAINED_CARD'});
    const before=structuredClone(base);document.policy_packs[0].version='v2';own.legal_sources=legal_sources;
    const result=adaptPolicyPlan(parsePolicyPlan(JSON.stringify(document)),base,profile);assert.deepEqual(result.findings,[]);assert.deepEqual(base,before);
    const policies=result.config.routes[0].policies;
    assert.equal(policies.transformations.request.body,previous.transformations.request.body);
    assert.deepEqual(policies.authorization.rules.map(r=>r.require),previous.authorization.rules.map(r=>r.require));
    if(retainOther){
     for(const unit of [policies.transformations.request.bodyDecisions[0],...policies.authorization.rules]){
      assert.deepEqual(unit.policySources.map(s=>s.policy_id),['RETAINED_CARD']);assert.equal(unit.policySources[0].pack_version,'v1');assert.deepEqual(unit.policySources[0].legal_sources,[source('제1조')]);
     }
    }else{
     assert.equal(policies.transformations.request.bodyDecisions,undefined);assert.ok(policies.authorization.rules.every(r=>r.policySources===undefined));assert.ok(!JSON.stringify(result.config).includes('policySources'));
    }
    assert.deepEqual(adaptPolicyPlan(document,result.config,profile).config,result.config);
   }
  }
 }
});

test('a shared FHIR operation refreshes source-empty and sourced cards independently',()=>{
 const firstCard=sourcedCard('1'),secondCard=sourcedCard('2'),document=plan(firstCard,secondCard);
 const first=adaptPolicyPlan(document,cfg,profile);assert.deepEqual(first.findings,[]);
 document.policy_packs[0].version='v2';firstCard.legal_sources=[];secondCard.legal_sources=[source('제3조')];
 const result=adaptPolicyPlan(document,first.config,profile);assert.deepEqual(result.findings,[]);
 const policies=result.config.routes[0].policies;
 for(const unit of [policies.transformations.request.bodyDecisions[0],...policies.authorization.rules]){
  assert.deepEqual(unit.policySources.map(s=>[s.policy_id,s.pack_version,s.legal_sources[0].provision]),[['2','v2','제3조']]);
 }
 assert.equal(policies.transformations.request.body,first.config.routes[0].policies.transformations.request.body);
 assert.deepEqual(adaptPolicyPlan(document,result.config,profile).config,result.config);
});
