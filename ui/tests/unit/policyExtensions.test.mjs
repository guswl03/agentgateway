import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import { adaptPolicyPlan, parsePolicyPlan, parseProfile, policyFingerprint, regexTargetSupported } from '../../src/policyAdapter.ts';

const original = {
  gateways: { default: { port: 19210 } },
  llm: { port: 19212, models: [{ name: 'local-model', provider: 'openAI', params: { apiKey: 'fixture', baseUrl: 'http://127.0.0.1:19213/v1' } }] },
  routes: [{ name: 'http', matches: [{ path: { pathPrefix: '/protected' } }], backends: [{ host: '127.0.0.1:19211' }] }],
};
const profile = { version: 1, bindings: {} };
const plan = (functions, target = 'llm', condition = { constant: true }) => ({
  version: '1.1-draft', policy_packs: [{ pack_id: 'UNRELATED_PACK', version: 'fixture', priority: 19, policies: [{
    law_id: 'UNRELATED_LAW', policy_id: 'UNRELATED_CARD', policy_text: 'Technical fixture only',
    applies_when: condition, scope: { target_ref: target }, function_combination: 'all',
    function: functions, except: [], legal_sources: [{ revision_no: 'fixture', promulgation_date: '2020-01-01' }],
  }] }],
});
const regex = (direction = 'request', action = 'reject', parameters = {}) => ({
  function_id: `AGW-REGEX-GUARD-${direction.toUpperCase()}`, action, object: 'ARBITRARY_TEXT_CODE',
  direction, traffic: 'llm', parameters: {
    guardrail: { regex: { action, rules: [{ pattern: 'LOCAL_SECRET' }] }, ...(direction === 'request' ? { scope: ['messages'] } : {}) },
    ...(direction === 'response' ? { response_mode: 'non_streaming' } : {}), ...parameters,
  },
});
const jwtConfig = () => ({ issuer: 'https://fixture.example', audiences: ['local-api'], jwks: { url: 'http://127.0.0.1:19214/jwks' }, jwtValidationOptions: { requiredClaims: ['exp'] } });
const jwt = (auth = jwtConfig()) => ({ function_id: 'AGW-AUTH-AUTHZ-REQUEST', action: 'require_jwt', object: 'ARBITRARY_SUBJECT_CODE', direction: 'request', traffic: 'http', parameters: { jwt_auth: auth } });
const rateConfig = () => ({ maxTokens: 2, tokensPerFill: 2, fillInterval: '1m', type: 'requests', key: 'jwt.sub' });
const rate = (limit = rateConfig()) => ({ function_id: 'AGW-RATE-BUDGET-LIMIT', action: 'limit_requests', object: null, direction: 'exchange', traffic: 'llm', parameters: { local_rate_limit: limit } });
const adapt = (functions, base = original, target = 'llm', condition) => adaptPolicyPlan(plan(functions, target, condition), base, profile);
const legalSource = (provision = '제10조제1항', revision = 'v1') => ({ level: 'LAW', law_name: '테스트 보호법', provision, revision_no: revision, promulgation_date: '2020-01-01', effective_date: '2020-02-01', source_url: 'https://fixture.example/law' });
const sourcedPlan = (functions, target = 'llm', condition) => {
  const document = plan(functions, target, condition);
  document.policy_packs[0].policies[0].legal_sources = [legalSource()];
  return document;
};
function blocked(result, base = original) {
  assert.ok(result.findings.length > 0);
  assert.deepEqual(result.config, base);
}

test('native extensions produce pinned schema contracts for every direction/action without law identity', () => {
  const schema = JSON.parse(readFileSync(new URL('../../../schema/config.json', import.meta.url), 'utf8'));
  function clean(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.enum) && !value.enum.length) { delete value.enum; delete value.type; value.not = {}; }
    Object.values(value).forEach(clean);
  }
  clean(schema);
  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);
  for (const direction of ['request', 'response']) for (const action of ['reject', 'mask']) {
    const result = adapt([regex(direction, action)]);
    assert.deepEqual(result.findings, []);
    assert.ok(validate(result.config), JSON.stringify(validate.errors));
    assert.equal(result.config.llm.policies.guardrails[direction][0].regex.action, action);
    assert.deepEqual(result.config.routes, original.routes);
  }
  const result = adapt([jwt(), rate()], original, 'route:0');
  assert.deepEqual(result.findings, []);
  assert.equal(result.config.routes[0].policies.jwtAuth.mode, 'strict');
  assert.ok(validate(result.config), JSON.stringify(validate.errors));
  assert.deepEqual(original.llm.policies, undefined);
});

test('native AI route uses promptGuard and preserves existing AI policy and backend', () => {
  const base = structuredClone(original);
  base.routes[0].backends = [{ ai: { name: 'fixture', provider: { openAI: { model: 'fixture' } } } }];
  base.routes[0].policies = { ai: { modelAliases: { local: 'fixture' } }, cors: { allowOrigins: ['*'] } };
  const result = adapt([regex()], base, 'route:0');
  assert.deepEqual(result.findings, []);
  assert.equal(result.config.routes[0].policies.ai.promptGuard.request[0].regex.action, 'reject');
  assert.deepEqual(result.config.routes[0].backends, base.routes[0].backends);
  assert.deepEqual(result.config.routes[0].policies.ai.modelAliases, base.routes[0].policies.ai.modelAliases);
  assert.deepEqual(result.config.routes[0].policies.cors, base.routes[0].policies.cors);
});

test('native bindings fill unresolved parameters and retain card metadata checks', () => {
  const doc = plan([regex()]); doc.policy_packs[0].policies[0].function[0].parameters = {};
  const bindings = { version: 1, bindings: { 'UNRELATED_LAW/UNRELATED_CARD': { functions: { 0: regex().parameters } } } };
  assert.deepEqual(adaptPolicyPlan(parsePolicyPlan(JSON.stringify(doc)), original, bindings).findings, []);
  doc.policy_packs[0].policies[0].function[0].traffic = 'http';
  blocked(adaptPolicyPlan(doc, original, bindings));
});

test('all native extensions are idempotent without modifying the source config', () => {
  const before = structuredClone(original);
  const first = adapt([regex(), regex('response', 'mask'), jwt(), rate()]);
  assert.deepEqual(first.findings, []);
  const second = adapt([regex(), regex('response', 'mask'), jwt(), rate()], first.config);
  assert.deepEqual(second.findings, []);
  assert.deepEqual(second.config, first.config);
  assert.deepEqual(original, before);
  assert.equal(second.config.llm.policies.authorization.rules.length, 1);
});

test('same guard used by unrelated cards runs once', () => {
  const doc = plan([regex()]);
  const second = structuredClone(doc.policy_packs[0].policies[0]); second.policy_id = 'SECOND_CARD';
  doc.policy_packs[0].policies.push(second);
  const result = adaptPolicyPlan(doc, original, profile);
  assert.deepEqual(result.findings, []);
  assert.equal(result.config.llm.policies.guardrails.request.length, 1);
});

test('legal identity attaches to each actual native control and the streaming blocker without changing technical settings', () => {
  const document = sourcedPlan([regex(), regex('response', 'mask'), jwt(), rate()]);
  const before = structuredClone(document);
  const result = adaptPolicyPlan(document, original, profile);
  assert.deepEqual(result.findings, []);
  const controls = result.config.llm.policies;
  for (const [unit, index] of [[controls.guardrails.request[0], 0], [controls.guardrails.response[0], 1], [controls.jwtAuth, 2], [controls.localRateLimit[0], 3], [controls.authorization.rules[0], 1]]) {
    assert.equal(unit.policySources.length, 1);
    assert.deepEqual(unit.policySources[0], { pack_id: 'UNRELATED_PACK', pack_version: 'fixture', law_id: 'UNRELATED_LAW', policy_id: 'UNRELATED_CARD', function_id: document.policy_packs[0].policies[0].function[index].function_id, function_index: index, action: document.policy_packs[0].policies[0].function[index].action, legal_sources: [legalSource()] });
  }
  assert.deepEqual(document, before);
  assert.deepEqual(adaptPolicyPlan(document, result.config, profile).config, result.config);
});

test('equal native execution merges different card origins once and replacing a legal snapshot removes the old revision', () => {
  const document = sourcedPlan([regex(), jwt(), rate()]);
  const second = structuredClone(document.policy_packs[0].policies[0]);
  second.policy_id = 'SECOND_CARD'; second.legal_sources = [legalSource('제12조', 'other')];
  document.policy_packs[0].policies.push(second);
  const first = adaptPolicyPlan(document, original, profile);
  assert.deepEqual(first.findings, []);
  for (const unit of [first.config.llm.policies.guardrails.request[0], first.config.llm.policies.jwtAuth, first.config.llm.policies.localRateLimit[0]]) assert.deepEqual(unit.policySources.map(s => s.policy_id), ['SECOND_CARD', 'UNRELATED_CARD']);
  assert.equal(first.config.llm.policies.guardrails.request.length, 1);
  assert.equal(first.config.llm.policies.localRateLimit.length, 1);
  assert.deepEqual(adaptPolicyPlan(document, first.config, profile).config, first.config);
  document.policy_packs[0].version = 'next';
  document.policy_packs[0].policies[0].legal_sources = [legalSource('제11조', 'v2')];
  const updated = adaptPolicyPlan(document, first.config, profile);
  assert.deepEqual(updated.findings, []);
  for (const unit of [updated.config.llm.policies.guardrails.request[0], updated.config.llm.policies.jwtAuth, updated.config.llm.policies.localRateLimit[0]]) {
    const own = unit.policySources.find(s => s.policy_id === 'UNRELATED_CARD');
    assert.equal(own.pack_version, 'next'); assert.equal(own.legal_sources[0].revision_no, 'v2'); assert.equal(unit.policySources.length, 2);
  }
});

test('reordering card functions replaces the old per-control indices and legal revision instead of accumulating stale origins', () => {
  const one=regex('request','mask',{guardrail:{regex:{action:'mask',rules:[{pattern:'ONE'}]},scope:['messages']}});
  const two=regex('request','mask',{guardrail:{regex:{action:'mask',rules:[{pattern:'TWO'}]},scope:['messages']}});
  const document=sourcedPlan([one,two]);document.policy_packs[0].version='v1';document.policy_packs[0].policies[0].legal_sources=[legalSource('제1조','one')];
  const first=adaptPolicyPlan(document,original,profile);assert.deepEqual(first.findings,[]);
  const previous=structuredClone(first.config);
  for(const guard of previous.llm.policies.guardrails.request)guard.policySources.push({...structuredClone(guard.policySources[0]),policy_id:'UNRELATED_RETAINED_CARD'});
  document.policy_packs[0].version='v2';document.policy_packs[0].policies[0].function.reverse();document.policy_packs[0].policies[0].legal_sources=[legalSource('제2조','two')];
  const updated=adaptPolicyPlan(document,previous,profile);assert.deepEqual(updated.findings,[]);
  for(const guard of updated.config.llm.policies.guardrails.request){
    const own=guard.policySources.filter(s=>s.policy_id==='UNRELATED_CARD');assert.equal(own.length,1);
    assert.equal(own[0].function_index,guard.regex.rules[0].pattern==='ONE'?1:0);assert.equal(own[0].pack_version,'v2');assert.equal(own[0].legal_sources[0].revision_no,'two');
    const retained=guard.policySources.find(s=>s.policy_id==='UNRELATED_RETAINED_CARD');assert.equal(retained.pack_version,'v1');assert.equal(retained.legal_sources[0].revision_no,'one');
  }
  assert.deepEqual(adaptPolicyPlan(document,updated.config,profile).config,updated.config);
  assert.deepEqual(first.config.llm.policies.guardrails.request.map(g=>g.policySources[0].function_index),[0,1]);
});

test('all currently selected duplicate indices remain attributable after snapshot replacement for every native control', () => {
  const deny={function_id:'AGW-AUTH-AUTHZ-REQUEST',action:'authorize_require',object:null,direction:'request',traffic:'http',parameters:{require_when:{constant:false}}};
  for(const control of [regex(),jwt(),rate(),deny]){
    const document=sourcedPlan([structuredClone(control),structuredClone(control),structuredClone(control)]);document.policy_packs[0].version='v1';
    const selected=(indices)=>({version:1,bindings:{'UNRELATED_LAW/UNRELATED_CARD':{selectedFunctions:indices}}});
    const first=adaptPolicyPlan(document,original,selected([0,1]));assert.deepEqual(first.findings,[]);
    document.policy_packs[0].version='v2';document.policy_packs[0].policies[0].legal_sources=[legalSource('제2조','two')];
    const updated=adaptPolicyPlan(document,first.config,selected([1,2]));assert.deepEqual(updated.findings,[]);
    const controls=updated.config.llm.policies;
    const unit=control.action==='require_jwt'?controls.jwtAuth:control.action==='limit_requests'?controls.localRateLimit[0]:control.action==='authorize_require'?controls.authorization.rules[0]:controls.guardrails.request[0];
    assert.deepEqual(unit.policySources.map(s=>s.function_index),[1,2]);assert.ok(unit.policySources.every(s=>s.pack_version==='v2'&&s.legal_sources[0].revision_no==='two'));
    assert.deepEqual(adaptPolicyPlan(document,updated.config,selected([1,2])).config,updated.config);
  }
});

test('attribution keeps distinct guards separate and includes only selected active cards/functions', () => {
  const document = sourcedPlan([regex(), regex('request', 'mask', { guardrail: { regex: { action: 'mask', rules: [{ pattern: 'OTHER_PATTERN' }] }, scope: ['messages'] } })]);
  const first = document.policy_packs[0].policies[0];
  const disabled = structuredClone(first); disabled.policy_id = 'DISABLED'; document.policy_packs[0].policies.push(disabled);
  const selected = { version: 1, bindings: { 'UNRELATED_LAW/UNRELATED_CARD': { selectedFunctions: [1] }, 'UNRELATED_LAW/DISABLED': { enabled: false } } };
  const result = adaptPolicyPlan(document, original, selected);
  assert.deepEqual(result.findings, []);
  assert.equal(result.config.llm.policies.guardrails.request.length, 1);
  assert.deepEqual(result.config.llm.policies.guardrails.request[0].policySources.map(s => [s.policy_id, s.function_index, s.action]), [['UNRELATED_CARD', 1, 'mask']]);
  const all = adaptPolicyPlan(sourcedPlan(first.function), original, profile);
  assert.equal(all.config.llm.policies.guardrails.request.length, 2);
  assert.deepEqual(all.config.llm.policies.guardrails.request.map(g => g.policySources[0].function_index), [0, 1]);
});

test('legal source changes invalidate saved bindings and false native conditions never gain attribution', () => {
  const document = sourcedPlan([regex()]), card = document.policy_packs[0].policies[0];
  const saved = { version: 1, bindings: { 'UNRELATED_LAW/UNRELATED_CARD': { policyFingerprint: policyFingerprint(card) } } };
  card.legal_sources[0].provision = '제99조';
  blocked(adaptPolicyPlan(document, original, saved));
  const noExecution = adaptPolicyPlan(sourcedPlan([regex()], 'llm', { constant: false }), original, profile);
  assert.deepEqual(noExecution.findings, []); assert.deepEqual(noExecution.config, original);
});

test('missing legal identity stays unknown and an attributed conflict still returns the original configuration', () => {
  for (const legal_sources of [[], [{ revision_no: 'fixture' }], [{ law_name: '테스트 보호법' }]]) {
    const document = sourcedPlan([regex()]); document.policy_packs[0].policies[0].legal_sources = legal_sources;
    const result = adaptPolicyPlan(document, original, profile);
    assert.deepEqual(result.findings, []); assert.equal(result.config.llm.policies.guardrails.request[0].policySources, undefined);
  }
  const existing = adaptPolicyPlan(sourcedPlan([regex()]), original, profile).config;
  const conflict = adaptPolicyPlan(sourcedPlan([regex('request', 'mask')]), existing, profile);
  blocked(conflict, existing);
});

test('a source-empty card revision removes its previous origins while retaining protection and other cards', () => {
  const require = { function_id: 'AGW-AUTH-AUTHZ-REQUEST', action: 'authorize_require', object: null, direction: 'request', traffic: 'http', parameters: { require_when: { constant: false } } };
  const controls = (config) => {
    const policies = config.llm.policies;
    return [policies.guardrails.request[0], policies.guardrails.response[0], policies.jwtAuth, policies.localRateLimit[0], ...policies.authorization.rules];
  };
  for (const legal_sources of [[], [{ revision_no: 'unknown' }], [{ law_name: '테스트 보호법' }], [{ provision: '제1조' }]]) {
    for (const retainOther of [false, true]) {
      const document = sourcedPlan([regex(), regex('response', 'mask'), jwt(), rate(), require]);
      document.policy_packs[0].version = 'v1';
      const first = adaptPolicyPlan(document, original, profile);
      assert.deepEqual(first.findings, []);
      const base = structuredClone(first.config);
      if (retainOther) for (const unit of controls(base)) unit.policySources.push({ ...structuredClone(unit.policySources[0]), policy_id: 'RETAINED_CARD' });
      const before = structuredClone(base);
      document.policy_packs[0].version = 'v2';
      document.policy_packs[0].policies[0].legal_sources = legal_sources;
      const result = adaptPolicyPlan(parsePolicyPlan(JSON.stringify(document)), base, profile);
      assert.deepEqual(result.findings, []);
      assert.deepEqual(base, before);
      for (const [index, unit] of controls(result.config).entries()) {
        const technical = (value) => { const copy = structuredClone(value); delete copy.policySources; return copy; };
        assert.deepEqual(technical(unit), technical(controls(base)[index]));
        if (retainOther) {
          assert.deepEqual(unit.policySources.map(s => s.policy_id), ['RETAINED_CARD']);
          assert.equal(unit.policySources[0].pack_version, 'v1');
          assert.deepEqual(unit.policySources[0].legal_sources, [legalSource()]);
        } else assert.equal(unit.policySources, undefined);
      }
      assert.deepEqual(adaptPolicyPlan(document, result.config, profile).config, result.config);
    }
  }
});

test('require authorization and approved routing carry the origin of the failing requirement only', () => {
  for (const [action, parameters] of [['authorize_require', { require_when: { eq: { fact: 'request.method', value: 'POST' } } }], ['route_to_backend', { reuse_existing_destination: true, require_when: { constant: false } }]]) {
    const fn = { function_id: action === 'authorize_require' ? 'AGW-AUTH-AUTHZ-REQUEST' : 'AGW-MODEL-DESTINATION-SELECT-REQUEST', action, object: null, direction: 'request', traffic: 'http', parameters };
    const result = adaptPolicyPlan(sourcedPlan([fn], 'route:0'), original, profile);
    assert.deepEqual(result.findings, []); assert.equal(result.config.routes[0].policies.authorization.rules[0].policySources[0].action, action);
  }
});

test('legal attribution bounds reject unsafe or oversized metadata atomically', () => {
  for(const patch of [{law_name:'가'.repeat(342)},{provision:'제1조\nInjected'},{source_url:'x'.repeat(2049)}]){
    const document=sourcedPlan([regex()]);Object.assign(document.policy_packs[0].policies[0].legal_sources[0],patch);
    blocked(adaptPolicyPlan(document,original,profile));
  }
  const tooMany=sourcedPlan([regex()]);tooMany.policy_packs[0].policies[0].legal_sources=Array.from({length:17},()=>legalSource());
  blocked(adaptPolicyPlan(tooMany,original,profile));
  const tooManyOrigins=sourcedPlan([regex()]), first=tooManyOrigins.policy_packs[0].policies[0];
  tooManyOrigins.policy_packs[0].policies=Array.from({length:65},(_,index)=>({...structuredClone(first),policy_id:`CARD_${index}`}));
  blocked(adaptPolicyPlan(tooManyOrigins,original,profile));
});

test('nonstreaming response guards add an upstream-before-stream authorization requirement', () => {
  const result = adapt([regex('response', 'mask')]);
  assert.equal(result.config.llm.policies.guardrails.streaming, 'Disabled');
  assert.match(result.config.llm.policies.authorization.rules[0].require, /stream.*false/);
  assert.ok(result.expressions.includes(result.config.llm.policies.authorization.rules[0].require));
  assert.ok(result.notes.some(note => note.includes('SSE')));
});

test('partial SSE reject is explicit and records delivery limitation', () => {
  const result = adapt([regex('response', 'reject', { response_mode: 'streaming_partial' })]);
  assert.deepEqual(result.findings, []);
  assert.equal(result.config.llm.policies.guardrails.streaming, 'Enabled');
  assert.equal(result.config.llm.policies.authorization, undefined);
  assert.ok(result.notes.some(note => note.includes('회수')));
});

test('missing, mismatched and unsupported regex configuration is blocked', () => {
  for (const parameters of [ {}, { guardrail: null }, { guardrail: { regex: { action: 'mask', rules: [{ pattern: 'x' }] } } },
    { guardrail: { regex: { action: 'reject', rules: [] } } }, { guardrail: { regex: { action: 'reject', rules: [{ pattern: 3 }] } } },
    { guardrail: { regex: { action: 'reject', rules: [{ builtin: 'rrn' }] } } },
    { guardrail: { regex: { action: 'reject', rules: [{ pattern: 'x', builtin: 'email' }] } } },
    { guardrail: { regex: { action: 'reject', rules: [{ pattern: 'x' }], replacement: 'hidden' } } },
    { guardrail: { regex: { action: 'reject', rules: [{ pattern: 'x' }] }, scope: ['headers'] } },
    { guardrail: { regex: { action: 'reject', rules: [{ pattern: 'x' }] }, rejection: { status: 200 } } },
    { guardrail: { regex: { action: 'reject', rules: [{ pattern: 'x' }] }, rejection: { headers: { set: { 'x-test': 'bad\nvalue' } } } } },
  ]) { const fn = regex(); fn.parameters = parameters; blocked(adapt([fn])); }
  blocked(adapt([regex('response', 'mask', { response_mode: 'streaming_partial' })]));
  const fn = regex('response'); delete fn.parameters.response_mode; blocked(adapt([fn]));
  blocked(adapt([regex('response', 'reject', { guardrail: { ...regex().parameters.guardrail, scope: ['messages'] } })]));
});

test('regex on ordinary HTTP and opaque passthrough is never accepted as working control', () => {
  blocked(adapt([regex()], original, 'route:0'));
  const base = structuredClone(original); base.llm.models[0].passthrough = 'opaque';
  blocked(adapt([regex()], base), base);
  base.llm.models[0].passthrough = 'detect'; blocked(adapt([regex()], base), base);
  const falseAI = structuredClone(original); falseAI.routes[0].policies = { ai: {} };
  blocked(adapt([regex()], falseAI, 'route:0'), falseAI);
});

test('every AI route backend must resolve to native message processing without lower-level policy replacement', () => {
  const base = structuredClone(original);
  base.routes[0].backends = [{ backend: 'named-ai' }];
  base.backends = [{ name: 'named-ai', ai: { name: 'fixture', provider: { openAI: { model: 'fixture' } } } }];
  assert.equal(regexTargetSupported(base, 'route:0'), true);
  assert.deepEqual(adapt([regex()], base, 'route:0').findings, []);
  base.routes[0].backends.push({ host: '127.0.0.1:19211' });
  blocked(adapt([regex()], base, 'route:0'), base);
  base.routes[0].backends.pop(); base.backends[0].policies = { ai: { promptGuard: { request: [regex().parameters.guardrail] } } };
  assert.equal(regexTargetSupported(base, 'route:0'), false);
  blocked(adapt([regex()], base, 'route:0'), base);
  delete base.backends[0].policies; base.routes[0].policies = { ai: { routes: { '*': 'detect' } } };
  blocked(adapt([regex()], base, 'route:0'), base);
});

test('model-specific and implicit-disabled existing guards are not silently duplicated or switched', () => {
  const base = structuredClone(original);
  base.llm.models[0].guardrails = { request: [regex().parameters.guardrail] };
  blocked(adapt([regex()], base), base);
  delete base.llm.models[0].guardrails;
  base.llm.policies = { guardrails: { response: [regex('response').parameters.guardrail] } };
  blocked(adapt([regex('response', 'reject', { response_mode: 'streaming_partial' })], base), base);
});

test('same pattern with different action and incompatible streaming modes conflict atomically', () => {
  const base = adapt([regex()]).config;
  const result = adapt([regex('request', 'mask')], base);
  blocked(result, base); assert.equal(result.findings[0].kind, 'conflict');
  const stream = adapt([regex('response', 'reject', { response_mode: 'streaming_partial' })]).config;
  const conflict = adapt([regex('response', 'mask')], stream);
  blocked(conflict, stream); assert.equal(conflict.findings[0].kind, 'conflict');
});

test('missing or dynamic conditions cannot be widened for native extensions', () => {
  for (const fn of [regex(), jwt(), rate()]) {
    blocked(adapt([fn], original, 'llm', null));
    blocked(adapt([fn], original, 'llm', { eq: { fact: 'request.path', value: '/narrow' } }));
    const inactive = adapt([fn], original, 'llm', { constant: false });
    assert.deepEqual(inactive.findings, []);
    assert.deepEqual(inactive.config, original);
  }
});

test('JWT missing audience/key, invalid mode/options and fabricated claims are rejected', () => {
  for (const auth of [ {}, { ...jwtConfig(), issuer: '' }, { ...jwtConfig(), audiences: [] }, { ...jwtConfig(), audiences: null },
    { ...jwtConfig(), jwks: null }, { ...jwtConfig(), jwks: '{}' }, { ...jwtConfig(), jwks: { url: 3 } },
    { ...jwtConfig(), mode: 'optional' }, { ...jwtConfig(), jwtValidationOptions: { requiredClaims: [] } },
    { ...jwtConfig(), jwtValidationOptions: { requiredClaims: ['exp', 'jti'] } }, { ...jwtConfig(), businessApproval: true },
    { ...jwtConfig(), location: { expression: 'request.headers.approved' } },
  ]) blocked(adapt([jwt(auth)]));
});

test('JWT providers support is bounded to explicit trusted communication issuers', () => {
  const result = adapt([jwt({ providers: [jwtConfig(), { ...jwtConfig(), issuer: 'https://second.example' }], preserveToken: true })]);
  assert.deepEqual(result.findings, []);
  assert.equal(result.config.llm.policies.jwtAuth.providers.length, 2);
  blocked(adapt([jwt({ ...jwtConfig(), providers: [jwtConfig()] })]));
});

test('inline JWKS rejects ambiguous key IDs and unsupported key families before candidate creation', () => {
  const { publicKey } = generateKeyPairSync('ed25519');
  const key = { ...publicKey.export({ format: 'jwk' }), kid: 'one' };
  const inline = keys => jwt({ ...jwtConfig(), jwks: JSON.stringify({ keys }) });
  assert.deepEqual(adapt([inline([key])]).findings, []);
  blocked(adapt([inline([key, key])]));
  blocked(adapt([inline([{ ...key, kid: undefined }])]));
  blocked(adapt([inline([{ kty: 'oct', kid: 'one', k: 'fixture' }])]));
  blocked(adapt([inline([{ ...key, crv: 'X25519' }])]));
});

test('nonstring source target references cannot throw or widen a native policy', () => {
  const doc = plan([regex()]); doc.policy_packs[0].policies[0].scope.target_ref = 7;
  blocked(adaptPolicyPlan(doc, original, profile));
});

test('existing JWT and authorization are preserved and mismatching JWT is an atomic conflict', () => {
  const base = adapt([jwt()]).config;
  base.llm.policies.authorization = { rules: [{ require: 'request.method == "POST"' }] };
  const repeated = adapt([jwt()], base); assert.deepEqual(repeated.config, base);
  const result = adapt([regex(), jwt({ ...jwtConfig(), audiences: ['other'] })], base);
  blocked(result, base); assert.equal(result.findings[0].kind, 'conflict');
  const optional = structuredClone(base); optional.llm.policies.jwtAuth.mode = 'optional';
  blocked(adapt([jwt()], optional), optional);
});

test('JWT strict and existing security role/path authorization are composed without inventing approvals', () => {
  const require = { function_id: 'AGW-AUTH-AUTHZ-REQUEST', action: 'authorize_require', object: 'ARBITRARY_DATA_CODE', direction: 'request', traffic: 'http', parameters: { require_when: { all: [{ eq: { fact: 'jwt.role', value: 'reader' } }, { eq: { fact: 'request.method', value: 'GET' } }] } } };
  const result = adapt([jwt(), require], original, 'route:0');
  assert.deepEqual(result.findings, []);
  assert.match(result.config.routes[0].policies.authorization.rules[0].require, /jwt.role.*reader/);
  assert.equal(result.config.routes[0].policies.jwtAuth.mode, 'strict');
});

test('request limits reject token accounting, zero/noninteger bounds and untrusted keys', () => {
  for (const limit of [ {}, { ...rateConfig(), type: 'tokens' }, { ...rateConfig(), maxTokens: 0 },
    { ...rateConfig(), tokensPerFill: 1.5 }, { ...rateConfig(), maxTokens: Number.MAX_SAFE_INTEGER + 1 },
    { ...rateConfig(), fillInterval: '0s' }, { ...rateConfig(), fillInterval: '' },
    { ...rateConfig(), fillInterval: '1.5d' }, { ...rateConfig(), fillInterval: '1h1d' },
    { ...rateConfig(), fillInterval: '1s 1m' }, { ...rateConfig(), fillInterval: '0.1ns' },
    { ...rateConfig(), fillInterval: '10000000000h' }, { ...rateConfig(), fillInterval: '18446744073709551615d' },
    { ...rateConfig(), key: 'request.headers.approved' }, { ...rateConfig(), key: 3 },
    { ...rateConfig(), condition: 'true' },
  ]) blocked(adapt([rate(limit)]));
});

test('request limit duration follows leading integer day and Go compound contract', () => {
  for (const fillInterval of ['1m30s', '1d12h30m', '30d', '0.5s', '100µs']) {
    const result = adapt([rate({ ...rateConfig(), fillInterval })]);
    assert.deepEqual(result.findings, []);
    assert.equal(result.config.llm.policies.localRateLimit[0].fillInterval, fillInterval);
  }
});

test('request limits preserve unrelated token limits and reject different quotas for same key', () => {
  const base = structuredClone(original);
  base.routes[0].policies = { localRateLimit: [{ maxTokens: 1000, tokensPerFill: 1000, fillInterval: '1m', type: 'tokens' }] };
  const result = adapt([rate()], base, 'route:0');
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.config.routes[0].policies.localRateLimit[0], base.routes[0].policies.localRateLimit[0]);
  const conflict = adapt([rate({ ...rateConfig(), maxTokens: 3 })], result.config, 'route:0');
  blocked(conflict, result.config); assert.equal(conflict.findings[0].kind, 'conflict');
});

test('conditional existing local limit cannot be silently replaced with an array', () => {
  const base = structuredClone(original);
  base.routes[0].policies = { localRateLimit: { conditional: [{ ...rateConfig(), condition: 'request.path == "/old"' }] } };
  const result = adapt([rate()], base, 'route:0'); blocked(result, base);
  assert.equal(result.findings[0].kind, 'conflict');
});

test('native parameter changes invalidate saved policy fingerprints', () => {
  const first = plan([regex()]).policy_packs[0].policies[0];
  const changed = structuredClone(first); changed.function[0].parameters.guardrail.regex.rules[0].pattern = 'CHANGED';
  assert.notEqual(policyFingerprint(first), policyFingerprint(changed));
  const bindings = { version: 1, bindings: { 'UNRELATED_LAW/UNRELATED_CARD': { policyFingerprint: policyFingerprint(first) } } };
  blocked(adaptPolicyPlan(plan(changed.function), original, bindings));
});

test('binding file indices and selected function indices cannot be fractional or noncanonical', () => {
  assert.throws(() => parseProfile(JSON.stringify({ version: 1, bindings: { p: { functions: { '-1': {} } } } })));
  const bindings = { version: 1, bindings: { 'UNRELATED_LAW/UNRELATED_CARD': { selectedFunctions: [0.5] } } };
  blocked(adaptPolicyPlan(plan([regex()]), original, bindings));
  assert.throws(() => parseProfile(JSON.stringify({ version: 1, bindings: { p: { functions: { 0: { jwt_auth: [] } } } } })));
  assert.throws(() => parseProfile(JSON.stringify({ version: 1, bindings: { p: { functions: { 0: { local_rate_limit: { ...rateConfig(), type: 'tokens' } } } } } })));
});
