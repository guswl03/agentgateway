import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyQuickGroupFunction, buildQuickProfile, quickFeatureGroups } from '../../src/policyQuick.ts';
import { adaptPolicyPlan, policyFingerprint, targetFingerprint } from '../../src/policyAdapter.ts';

const empty = () => ({ version: 1, bindings: {} });
const ai = (name = 'ai') => ({ name, backends: [{ ai: { provider: { openAI: {} } } }] });
const cfg = () => ({ routes: [ai(), { name: 'http', backends: [{ host: 'localhost:9000' }] }] });
const functions = {
  fhir: ['AGW-BODY-HEADER-TRANSFORM-REQUEST', 'remove_field', 'request', 'http', 'PERSONAL_DATA'],
  header: ['AGW-BODY-HEADER-TRANSFORM-RESPONSE', 'set_header', 'response', 'http', 'AI_OUTPUT'],
  regex: ['AGW-REGEX-GUARD-REQUEST', 'reject', 'request', 'llm', 'PERSONAL_DATA'],
  mask: ['AGW-REGEX-GUARD-REQUEST', 'mask', 'request', 'llm', 'PERSONAL_DATA'],
  response: ['AGW-REGEX-GUARD-RESPONSE', 'mask', 'response', 'llm', 'PERSONAL_DATA'],
  jwt: ['AGW-AUTH-AUTHZ-REQUEST', 'require_jwt', 'request', 'http', 'CREDENTIAL'],
  quota: ['AGW-RATE-BUDGET-LIMIT', 'limit_requests', 'exchange', 'llm', 'REQUEST'],
  auth: ['AGW-AUTH-AUTHZ-REQUEST', 'authorize_require', 'request', 'http', 'BUSINESS_FACT'],
  destination: ['AGW-MODEL-DESTINATION-SELECT-REQUEST', 'route_to_backend', 'request', 'llm', 'DESTINATION'],
  log: ['AGW-ACCESS-LOG-TRACING', 'log_access', 'exchange', 'http', 'ACCESS_LOG'],
  trace: ['AGW-ACCESS-LOG-TRACING', 'trace', 'exchange', 'http', 'TRACE'],
};
const fn = (kind, parameters = kind === 'header' ? { header: 'x-ai-generated' } : {}, extra = {}) => {
  const [function_id, action, direction, traffic, object] = functions[kind];
  return { function_id, action, direction, traffic, object, parameters, ...extra };
};
const card = (id, kinds = ['fhir'], extra = {}) => ({ law_id: 'ANY', policy_id: id, policy_text: `Card ${id}`,
  function: kinds.map(kind => typeof kind === 'string' ? fn(kind) : kind), applies_when: null, scope: null,
  except: [], legal_sources: [{ law_name: '법 이름', provision: '제1조' }], ...extra });
const plan = (...policies) => ({ version: '1.1-draft', policy_packs: [{ pack_id: 'ANY', version: '1', priority: 1, policies }] });
const binding = (profile, id) => profile.bindings[`ANY/${id}`];

test('quick defaults protect all existing paths with a true missing condition and all whole-card functions', () => {
  const doc = plan(card('filter'), card('logs', ['log', 'trace']));
  const config = { ...cfg(), frontendPolicies: { tracing: { otlp: { endpoint: 'http://localhost:4317' } } } };
  const source = empty(), before = structuredClone({ doc, config, source });
  const next = buildQuickProfile(doc, config, source);
  assert.equal(binding(next, 'filter').target, 'all');
  assert.deepEqual(binding(next, 'filter').condition, { constant: true });
  assert.deepEqual(binding(next, 'logs').selectedFunctions, [0, 1]);
  assert.equal(binding(next, 'filter').enabled, true);
  assert.deepEqual(binding(next, 'filter').functions[0], { body_location: 'request_fhir', fhir_filter: { version: 1, allow_fields: {} } });
  assert.equal(binding(next, 'filter').policyFingerprint, policyFingerprint(doc.policy_packs[0].policies[0]));
  assert.equal(binding(next, 'filter').targetFingerprint, targetFingerprint(config, 'all'));
  assert.deepEqual(adaptPolicyPlan(doc, config, next).findings, []);
  assert.deepEqual({ doc, config, source }, before);
  assert.deepEqual(buildQuickProfile(doc, config, next), next);
});

test('source and explicit selections, conditions, values and routes remain authoritative', () => {
  const scoped = card('one', [fn('fhir', { paths: ['name'], body_location: 'root_json' }), 'header'], {
    scope: { target_ref: 'route:0' }, applies_when: { constant: false }, function_combination: 'all' });
  const source = { version: 1, bindings: { 'ANY/one': { target: 'route:1', condition: { constant: true }, selectedFunctions: [0],
    functions: { 0: { paths: ['id'], body_location: 'root_json' }, 1: { header: 'x-explicit', value: 'yes' } } } } };
  const next = buildQuickProfile(plan(scoped), cfg(), source);
  assert.equal(binding(next, 'one').target, 'route:1');
  assert.deepEqual(binding(next, 'one').condition, { constant: true });
  assert.deepEqual(binding(next, 'one').selectedFunctions, [0]);
  assert.deepEqual(binding(next, 'one').functions, binding(source, 'one').functions);
  assert.deepEqual(scoped.applies_when, { constant: false });
});

test('manual exclusions are unchanged; an explicitly enabled unresolved card keeps blocking', () => {
  const doc = plan(card('excluded'), card('manual', ['jwt']), card('default', ['jwt']));
  const source = { version: 1, bindings: { 'ANY/excluded': { enabled: false, functions: { 0: {} }, policyFingerprint: 'old' }, 'ANY/manual': { enabled: true } } };
  const next = buildQuickProfile(doc, cfg(), source);
  assert.deepEqual(binding(next, 'excluded'), binding(source, 'excluded'));
  assert.equal(binding(next, 'manual').enabled, true);
  assert.equal(binding(next, 'default').enabled, false);
  assert.ok(adaptPolicyPlan(doc, cfg(), next).findings.some(item => item.policy === 'ANY/manual'));
  const members = quickFeatureGroups(doc, cfg(), next).flatMap(group => group.members);
  assert.equal(members.length, 3);
  assert.equal(members.find(item => item.key === 'ANY/default').ready, false);
  assert.ok(members.find(item => item.key === 'ANY/default').reason);
});

test('stale policy and target fingerprints are preserved without refreshing or filling parameters', () => {
  const doc = plan(card('policy'), card('route'));
  const source = { version: 1, bindings: { 'ANY/policy': { policyFingerprint: 'old' }, 'ANY/route': { target: 'route:0', targetFingerprint: 'old', enabled: true } } };
  const next = buildQuickProfile(doc, cfg(), source);
  assert.equal(binding(next, 'policy').policyFingerprint, 'old');
  assert.equal(binding(next, 'route').targetFingerprint, 'old');
  assert.equal(binding(next, 'policy').functions, undefined);
  assert.equal(binding(next, 'route').functions, undefined);
  assert.equal(binding(next, 'policy').enabled, true);
  assert.equal(binding(next, 'route').enabled, true);
  assert.ok(quickFeatureGroups(doc, cfg(), next).every(group => !group.ready));
});

test('regex uses all registered builtins and the broadest supported request content and target', () => {
  for (const [id, action] of [['reject', 'reject'], ['mask', 'mask']]) {
    const next = buildQuickProfile(plan(card(id, [id === 'reject' ? 'regex' : 'mask'])), cfg(), empty());
    assert.equal(binding(next, id).target, 'route:0');
    assert.equal(binding(next, id).enabled, true);
    assert.deepEqual(binding(next, id).functions[0].guardrail, { regex: { action, rules: [
      { builtin: 'email' }, { builtin: 'phoneNumber' }, { builtin: 'creditCard' }, { builtin: 'ssn' }, { builtin: 'caSin' }
    ] }, scope: ['systemPrompt', 'messages', 'toolInput', 'toolOutput'] });
  }
  const allConfig = { routes: [ai('one'), ai('two')] };
  assert.equal(binding(buildQuickProfile(plan(card('regex', ['regex'])), allConfig, empty()), 'regex').target, 'all');
  const mixed = { routes: [ai('one'), ai('two'), cfg().routes[1]] };
  const unresolved = buildQuickProfile(plan(card('regex', ['regex'])), mixed, empty());
  assert.equal(binding(unresolved, 'regex').target, undefined);
  assert.equal(binding(unresolved, 'regex').enabled, false);
  assert.ok(quickFeatureGroups(plan(card('regex', ['regex'])), mixed, unresolved)[0].reason);
});

test('response guards default to complete non-streaming inspection while explicit mode is preserved', () => {
  const doc = plan(card('response', ['response']));
  const next = buildQuickProfile(doc, cfg(), empty());
  assert.equal(binding(next, 'response').functions[0].response_mode, 'non_streaming');
  assert.equal(binding(next, 'response').functions[0].guardrail.scope, undefined);
  const guardrail = { regex: { action: 'reject', rules: [{ pattern: 'PRIVATE' }] } };
  const explicit = card('explicit', [fn('response', { guardrail, response_mode: 'streaming_partial' }, { action: 'reject' })]);
  assert.deepEqual(binding(buildQuickProfile(plan(explicit), cfg(), empty()), 'explicit').functions, undefined);
});

test('trusted selected-target native settings are reused only when uniquely matched', () => {
  const jwt_auth = { mode: 'strict', issuer: 'https://issuer.example', audiences: ['gw'], jwks: { url: 'https://issuer.example/jwks' }, jwtValidationOptions: { requiredClaims: ['exp'] } };
  const local_rate_limit = { maxTokens: 7, tokensPerFill: 7, fillInterval: '1m', type: 'requests' };
  const guardrail = { regex: { action: 'reject', rules: [{ pattern: 'PRIVATE' }] }, scope: ['messages'] };
  const config = { routes: [{ ...ai(), policies: { jwtAuth: jwt_auth, localRateLimit: [local_rate_limit], ai: { promptGuard: { request: [guardrail] } } } }] };
  const doc = plan(card('jwt', ['jwt']), card('quota', ['quota']), card('guard', ['regex']));
  const next = buildQuickProfile(doc, config, empty());
  assert.deepEqual(binding(next, 'jwt').functions[0], { jwt_auth });
  assert.deepEqual(binding(next, 'quota').functions[0], { local_rate_limit });
  assert.deepEqual(binding(next, 'guard').functions[0], { guardrail });
  config.routes[0].policies.localRateLimit.push({ ...local_rate_limit, maxTokens: 9 });
  const ambiguous = buildQuickProfile(plan(card('quota', ['quota'])), config, empty());
  assert.equal(binding(ambiguous, 'quota').enabled, false);
  assert.equal(binding(ambiguous, 'quota').functions, undefined);
});

test('quick defaults invent no credentials, business approval, destination, quota or trace collector', () => {
  const doc = plan(...['jwt', 'auth', 'destination', 'quota', 'trace'].map(kind => card(kind, [kind])));
  const next = buildQuickProfile(doc, cfg(), empty());
  for (const kind of ['jwt', 'auth', 'destination', 'quota', 'trace']) {
    assert.equal(binding(next, kind).enabled, false);
    assert.equal(binding(next, kind).functions, undefined);
  }
  assert.equal(quickFeatureGroups(doc, cfg(), next).reduce((sum, group) => sum + group.count, 0), 5);
});

test('all original unsupported and unreviewed cards remain visible and blocking, including exclusions', () => {
  const doc = plan(card('unknown', [fn('fhir', {}, { function_id: 'AGW-NEW-FUNCTION' })]), card('except', ['fhir'], { except: [{ law_id: 'ANY', policy_id: 'unknown' }] }),
    card('unreviewed', ['fhir'], { function: null }), card('none', ['fhir'], { function: [] }), card('scope', ['fhir'], { scope: { route_prefix: '/private' } }));
  const next = buildQuickProfile(doc, cfg(), empty());
  const members = quickFeatureGroups(doc, cfg(), next).flatMap(group => group.members);
  assert.deepEqual(members.map(item => item.key).sort(), ['ANY/except', 'ANY/none', 'ANY/scope', 'ANY/unknown', 'ANY/unreviewed']);
  assert.ok(members.every(item => !item.ready && item.reason));
  assert.ok(members.filter(item => item.key !== 'ANY/none').every(item => item.enabled));
  assert.equal(members.find(item => item.key === 'ANY/none').enabled, false);
  assert.deepEqual(doc.policy_packs[0].policies[1].except, [{ law_id: 'ANY', policy_id: 'unknown' }]);
});

test('combined native or original-config conflicts remain enabled and block application', () => {
  const doc = plan(card('reject', ['regex']), card('mask', ['mask']));
  const next = buildQuickProfile(doc, cfg(), { version: 1, bindings: { 'ANY/mask': { enabled: true } } });
  assert.ok(Object.values(next.bindings).every(item => item.enabled));
  assert.ok(adaptPolicyPlan(doc, cfg(), next).findings.some(item => item.kind === 'conflict'));
  const config = cfg(); config.routes[0].policies = { transformations: { response: { set: { 'x-existing': 'true' } } } };
  const originalConflict = buildQuickProfile(plan(card('header', ['header'])), config, empty());
  assert.equal(binding(originalConflict, 'header').enabled, true);
  assert.equal(quickFeatureGroups(plan(card('header', ['header'])), config, originalConflict)[0].ready, false);
  const mixed = buildQuickProfile(plan(card('mixed', ['header', 'jwt'])), config, empty());
  assert.equal(binding(mixed, 'mixed').enabled, true, 'missing JWT information must not hide a header merge conflict');
});

test('an existing body conflict cannot revive unrelated deferred infrastructure cards', () => {
  const config = cfg();
  config.routes[0].policies = { transformations: { request: { body: 'toJson(json(request.body))' } } };
  const doc = plan(card('fhir'), card('marker', ['header']), card('jwt', ['jwt']), card('auth', ['auth']),
    card('quota', ['quota']), card('link', [fn('header', { header: 'Link' })]), card('destination', ['destination']));
  const before = structuredClone({ config, doc });
  const next = buildQuickProfile(doc, config, empty());
  assert.equal(binding(next, 'fhir').enabled, true, 'the actual conflicting card still requires review');
  assert.equal(binding(next, 'marker').enabled, true);
  for (const id of ['jwt', 'auth', 'quota', 'link', 'destination'])
    assert.equal(binding(next, id).enabled, false, `${id} was not part of the combined conflict`);
  const result = adaptPolicyPlan(doc, config, next);
  assert.ok(result.findings.some(item => item.kind === 'conflict'));
  assert.deepEqual(result.config, config, 'the original transform must survive a blocked import');
  assert.deepEqual({ config, doc }, before);
  const explicit = { version: 1, bindings: { 'ANY/jwt': { enabled: true } } };
  const enabled = buildQuickProfile(doc, config, explicit);
  assert.equal(binding(enabled, 'jwt').enabled, true, 'an administrator enabled card must remain active');
  assert.ok(adaptPolicyPlan(doc, config, enabled).findings.some(item => item.policy === 'ANY/jwt'));
});

test('AI output headers require a precise source hint; blank, Link and high-impact meanings require setup', () => {
  const doc = plan(card('ai', ['header']), card('generic', [fn('header', {}, { object: 'HEADER' })]), card('impact', [fn('header', {}, { object: 'HIGH_IMPACT_AI' })]),
    card('blank', [fn('header', {})]), card('link', [fn('header', { header: 'Link' })]));
  const next = buildQuickProfile(doc, cfg(), empty());
  assert.deepEqual(binding(next, 'ai').functions[0], { value: 'true' });
  assert.deepEqual({ ...binding(next, 'ai').functions[0], ...doc.policy_packs[0].policies[0].function[0].parameters }, { header: 'x-ai-generated', value: 'true' });
  assert.equal(binding(next, 'ai').enabled, true);
  assert.equal(binding(next, 'generic').enabled, false); assert.equal(binding(next, 'generic').functions, undefined);
  assert.equal(binding(next, 'impact').enabled, false); assert.equal(binding(next, 'impact').functions, undefined);
  assert.equal(binding(next, 'blank').enabled, false); assert.equal(binding(next, 'blank').functions, undefined);
  assert.equal(binding(next, 'link').enabled, false); assert.equal(binding(next, 'link').functions, undefined);
  assert.deepEqual(doc.policy_packs[0].policies[4].function[0].parameters, { header: 'Link' });
});

test('new blank overlapping regex defaults prefer rejection, keeping masks visible and excluded', () => {
  const doc = plan(card('reject', ['regex']), card('mask', ['mask']));
  const next = buildQuickProfile(doc, cfg(), empty());
  assert.equal(binding(next, 'reject').enabled, true); assert.equal(binding(next, 'mask').enabled, false);
  assert.deepEqual(adaptPolicyPlan(doc, cfg(), next).findings, []);
  const mask = quickFeatureGroups(doc, cfg(), next).find(group => group.keys.includes('ANY/mask'));
  assert.equal(mask.ready, true); assert.equal(mask.enabled, false); assert.match(mask.reason, /거절 보호.*치환.*제외/);
  const manuallyEnabled = structuredClone(next); binding(manuallyEnabled, 'mask').enabled = true;
  const preserved = buildQuickProfile(doc, cfg(), manuallyEnabled);
  assert.equal(binding(preserved, 'mask').enabled, true);
  assert.ok(adaptPolicyPlan(doc, cfg(), preserved).findings.some(item => item.kind === 'conflict'));
  const withRejectDisabled = structuredClone(preserved); binding(withRejectDisabled, 'reject').enabled = false;
  assert.deepEqual(adaptPolicyPlan(doc, cfg(), buildQuickProfile(doc, cfg(), withRejectDisabled)).findings, []);
  assert.deepEqual(buildQuickProfile(doc, cfg(), next), next);
});

test('source guards and multi-function cards are never silently excluded by default overlap resolution', () => {
  const blank = buildQuickProfile(plan(card('mask', ['mask'])), cfg(), empty());
  const source = card('source', [fn('mask', binding(blank, 'mask').functions[0])]);
  const doc = plan(card('reject', ['regex']), source, card('mixed', ['mask', 'fhir']));
  const next = buildQuickProfile(doc, cfg(), empty());
  assert.equal(binding(next, 'source').enabled, true); assert.equal(binding(next, 'mixed').enabled, true);
  assert.ok(adaptPolicyPlan(doc, cfg(), next).findings.some(item => item.kind === 'conflict'));
});

test('no existing route leaves every card requiring setup, without silently dropping it', () => {
  const doc = plan(card('one'));
  const next = buildQuickProfile(doc, {}, empty());
  assert.equal(binding(next, 'one').enabled, false);
  assert.equal(binding(next, 'one').target, undefined);
  const [group] = quickFeatureGroups(doc, {}, next);
  assert.equal(group.count, 1); assert.equal(group.ready, false); assert.ok(group.reason);
});

test('strict FHIR groups share effective protection across mappings and object codes, preserving legal members', () => {
  const first = card('first', [fn('fhir', {}, { object: 'IDENTIFIER_DATA', target: { object: 'IDENTIFIER_DATA', mappings: [{ resource_type: 'Patient', element_paths: ['Patient.id'] }] } })]);
  const second = card('second', [fn('fhir', {}, { object: 'ADDITIONAL_INFORMATION', target: { object: 'ADDITIONAL_INFORMATION', mappings: [{ resource_type: 'Condition', element_paths: ['Condition.note[].text'] }] } })]);
  const doc = plan(first, second), profile = buildQuickProfile(doc, cfg(), empty());
  const [group] = quickFeatureGroups(doc, cfg(), profile);
  assert.equal(quickFeatureGroups(doc, cfg(), profile).length, 1); assert.equal(group.count, 2);
  assert.deepEqual(group.keys, ['ANY/first', 'ANY/second']);
  const toggled = structuredClone(profile); binding(toggled, 'first').enabled = false;
  assert.equal(quickFeatureGroups(doc, cfg(), toggled)[0].id, group.id);
  binding(toggled, 'first').functions[0].fhir_filter.allow_fields.Patient = ['birthDate'];
  assert.equal(quickFeatureGroups(doc, cfg(), toggled).length, 2, 'different retained fields require separate groups');
});

test('equal validated native guards share a group across source object mappings and keep different rules separate', () => {
  const guardrail = { regex: { action: 'reject', rules: [{ pattern: 'PRIVATE' }] }, scope: ['messages'] };
  const doc = plan(card('text', [fn('regex', { guardrail }, { object: 'TEXT_CONTENT', target: { object: 'TEXT_CONTENT', mappings: [{ note: 'one' }] } })]),
    card('data', [fn('regex', { guardrail }, { object: 'TRAINING_DATA', target: { object: 'TRAINING_DATA', mappings: [{ note: 'two' }] } })]));
  const profile = buildQuickProfile(doc, cfg(), empty());
  const [group] = quickFeatureGroups(doc, cfg(), profile);
  assert.equal(quickFeatureGroups(doc, cfg(), profile).length, 1); assert.equal(group.count, 2);
  doc.policy_packs[0].policies[1].function[0].parameters.guardrail = { ...guardrail, regex: { action: 'reject', rules: [{ pattern: 'OTHER' }] } };
  assert.equal(quickFeatureGroups(doc, cfg(), profile).length, 2);
});

test('native response overlap chooses complete rejection and a sole LLM target is selected in mixed routes', () => {
  const config = { llm: { models: [{ name: 'model' }] }, routes: [cfg().routes[1]] };
  const doc = plan(card('reject', [fn('response', {}, { action: 'reject' })]), card('mask', ['response']));
  const next = buildQuickProfile(doc, config, empty());
  assert.equal(binding(next, 'reject').target, 'llm');
  assert.equal(binding(next, 'reject').enabled, true); assert.equal(binding(next, 'mask').enabled, false);
  assert.equal(binding(next, 'reject').functions[0].response_mode, 'non_streaming');
  assert.deepEqual(adaptPolicyPlan(doc, config, next).findings, []);
});

test('fresh native default readiness retains the real pack identity for attributed protection', () => {
  const document=plan(card('reject',['regex']),card('mask',['mask']));
  document.policy_packs[0].pack_id='REAL_PACK';document.policy_packs[0].version='2026.10';
  const config=cfg(),next=buildQuickProfile(document,config,empty());
  assert.equal(binding(next,'reject').enabled,true);assert.equal(binding(next,'mask').enabled,false);
  const result=adaptPolicyPlan(document,config,next);assert.deepEqual(result.findings,[]);
  assert.deepEqual(result.config.routes[0].policies.ai.promptGuard.request[0].policySources.map(s=>[s.pack_id,s.pack_version,s.policy_id]),[['REAL_PACK','2026.10','reject']]);
});

test('one explicit quick-group edit and later URL keystrokes configure every enabled equivalent card', () => {
  const doc = plan(...['one', 'two', 'three'].map(id => card(id, [fn('header', { header: 'Link' })])));
  const config = cfg(), initial = buildQuickProfile(doc, config, empty());
  for (const value of Object.values(initial.bindings)) value.enabled = true;
  const before = structuredClone({ doc, config, initial });
  const keys = ['ANY/one', 'ANY/two', 'ANY/three'];
  const first = applyQuickGroupFunction(doc, config, initial, keys, keys[0], 0, { value: 'https://example.org/first' });
  assert.equal(first.changed, 3); assert.equal(first.skipped, 0);
  for (const id of ['one', 'two', 'three'])
    assert.deepEqual(binding(first.profile, id).functions[0], { value: 'https://example.org/first' });
  assert.deepEqual({ doc, config, initial }, before, 'source cards, configuration and old profile remain immutable');
  const initialGroup = quickFeatureGroups(doc, config, first.profile);
  assert.equal(initialGroup.length, 1); assert.deepEqual(initialGroup[0].keys, keys);
  const finalUrl = 'https://example.org/updated-disclosure';
  const second = applyQuickGroupFunction(doc, config, first.profile, initialGroup[0].keys, keys[0], 0, { value: finalUrl });
  assert.equal(second.changed, 3);
  assert.deepEqual(quickFeatureGroups(doc, config, second.profile)[0].keys, keys, 'the group key stays stable while typing');
  const result = adaptPolicyPlan(doc, config, second.profile);
  assert.deepEqual(result.findings, []);
  for (const route of result.config.routes) {
    const expression = route.policies.transformations.response.replace;
    assert.equal((expression.match(/\.with\(h,/g) ?? []).length, 1, 'identical headers execute only once');
    assert.match(expression, /updated-disclosure/);
    assert.doesNotMatch(expression, /example\.org\/first/);
  }
  assert.ok(result.notes.some(note => note.includes('ANY/three')), 'each legal source remains traceable');
});

test('equivalent quick groups map selected functions independently of their source index or law', () => {
  const first = card('one', [fn('header', { header: 'Link' }), 'log']);
  const second = card('two', ['log', fn('header', { header: 'Link' })], { law_id: 'UNRELATED' });
  const doc = plan(first, second), config = cfg(), initial = buildQuickProfile(doc, config, empty());
  for (const value of Object.values(initial.bindings)) value.enabled = true;
  const [group] = quickFeatureGroups(doc, config, initial);
  assert.equal(quickFeatureGroups(doc, config, initial).length, 1);
  assert.deepEqual(group.keys, ['ANY/one', 'UNRELATED/two']);
  const result = applyQuickGroupFunction(doc, config, initial, group.keys, 'ANY/one', 0, { value: 'https://example.org/disclosure' });
  assert.equal(result.changed, 2);
  assert.deepEqual(binding(result.profile, 'one').functions[0], { value: 'https://example.org/disclosure' });
  assert.deepEqual(result.profile.bindings['UNRELATED/two'].functions[1], { value: 'https://example.org/disclosure' });
  assert.deepEqual(binding(result.profile, 'one').functions[1], binding(initial, 'one').functions[1]);
  assert.deepEqual(result.profile.bindings['UNRELATED/two'].functions[0], initial.bindings['UNRELATED/two'].functions[0]);
  assert.deepEqual(binding(result.profile, 'one').selectedFunctions, [0, 1]);
  assert.deepEqual(result.profile.bindings['UNRELATED/two'].selectedFunctions, [0, 1]);
  assert.deepEqual(adaptPolicyPlan(doc, config, result.profile).findings, []);
});

test('captured quick-group edits preserve disabled, stale and separately configured cards', () => {
  const doc = plan(...['editor', 'peer', 'off', 'stale', 'individual', 'scope', 'condition', 'selection'].map(
    id => card(id, [fn('header', { header: 'Link' }), 'log'])
  ));
  const config = cfg(), initial = buildQuickProfile(doc, config, empty());
  for (const value of Object.values(initial.bindings)) value.enabled = true;
  const keys = quickFeatureGroups(doc, config, initial)[0].keys;
  const seed = applyQuickGroupFunction(doc, config, initial, keys, 'ANY/editor', 0, { value: 'https://example.org/seed' }).profile;
  binding(seed, 'off').enabled = false;
  binding(seed, 'stale').policyFingerprint = 'stale-source';
  binding(seed, 'individual').functions[0].value = 'https://individual.example.org';
  binding(seed, 'scope').target = 'route:0'; binding(seed, 'scope').targetFingerprint = targetFingerprint(config, 'route:0');
  binding(seed, 'condition').condition = { constant: false };
  binding(seed, 'selection').selectedFunctions = [0];
  const before = structuredClone({ doc, config, seed });
  const result = applyQuickGroupFunction(doc, config, seed, keys, 'ANY/editor', 0, { value: 'https://example.org/shared' });
  assert.equal(result.changed, 2); assert.equal(result.skipped, 6); assert.equal(result.stale, 1);
  for (const id of ['off', 'stale', 'individual', 'scope', 'condition', 'selection'])
    assert.deepEqual(binding(result.profile, id), binding(seed, id), `${id} must preserve its existing binding`);
  assert.equal(binding(result.profile, 'editor').functions[0].value, 'https://example.org/shared');
  assert.equal(binding(result.profile, 'peer').functions[0].value, 'https://example.org/shared');
  assert.deepEqual({ doc, config, seed }, before);
});

test('source-fixed parameters are authoritative and an editor cannot change a locked header or source value', () => {
  const fixed = card('fixed', [fn('header', { header: 'Link', value: 'https://example.org/seed' })]);
  const doc = plan(card('editor', [fn('header', { header: 'Link' })]), fixed);
  const config = cfg(), initial = buildQuickProfile(doc, config, empty());
  binding(initial, 'editor').enabled = true;
  binding(initial, 'editor').functions = { 0: { value: 'https://example.org/seed' } };
  const before = structuredClone({ doc, config, initial });
  const keys = quickFeatureGroups(doc, config, initial)[0].keys;
  assert.equal(keys.length, 2);
  const result = applyQuickGroupFunction(doc, config, initial, keys, 'ANY/editor', 0, { value: 'https://example.org/new' });
  assert.equal(result.changed, 1); assert.equal(result.skipped, 1);
  assert.deepEqual(binding(result.profile, 'fixed'), binding(initial, 'fixed'));
  const locked = applyQuickGroupFunction(doc, config, initial, keys, 'ANY/editor', 0, { header: 'x-ai-generated', value: 'true' });
  assert.equal(locked.changed, 0);
  assert.deepEqual(locked.profile, initial);
  assert.deepEqual({ doc, config, initial }, before);
  const blocked = adaptPolicyPlan(doc, config, result.profile);
  assert.ok(blocked.findings.some(item => item.message.includes('같은 헤더')), 'different source and chosen values still require review');
  assert.deepEqual(blocked.config, config, 'a shared edit cannot apply mismatching source values');
});

test('quick-group clearing preserves source and inactive values and never repairs stale editor confirmations', () => {
  const doc = plan(...['editor', 'peer', 'off'].map(id => card(id, [fn('header', { header: 'Link' })])));
  const config = cfg(), initial = buildQuickProfile(doc, config, empty());
  for (const value of Object.values(initial.bindings)) value.enabled = true;
  const keys = ['ANY/editor', 'ANY/peer', 'ANY/off'];
  const filled = applyQuickGroupFunction(doc, config, initial, keys, 'ANY/editor', 0, { value: 'https://example.org/shared' }).profile;
  binding(filled, 'off').enabled = false;
  const cleared = applyQuickGroupFunction(doc, config, filled, keys, 'ANY/editor', 0, { value: undefined });
  assert.equal(cleared.changed, 2); assert.deepEqual(binding(cleared.profile, 'editor').functions[0], {});
  assert.equal(binding(cleared.profile, 'off').functions[0].value, 'https://example.org/shared');
  assert.deepEqual(doc.policy_packs[0].policies[0].function[0].parameters, { header: 'Link' });
  const staleProfile = structuredClone(filled); binding(staleProfile, 'editor').targetFingerprint = 'old-target';
  const staleResult = applyQuickGroupFunction(doc, config, staleProfile, keys, 'ANY/editor', 0, { value: 'https://example.org/new' });
  assert.equal(staleResult.changed, 0); assert.equal(staleResult.stale, 1);
  assert.deepEqual(staleResult.profile, staleProfile);
  binding(staleProfile, 'editor').targetFingerprint = targetFingerprint(config, 'all');
  binding(staleProfile, 'editor').enabled = false;
  assert.equal(applyQuickGroupFunction(doc, config, staleProfile, keys, 'ANY/editor', 0, { value: 'new' }).changed, 0);
});

test('quick-group patches reject unsafe or non-JSON values without changing any source or bindings', () => {
  const doc = plan(card('editor', [fn('header', { header: 'Link' })]));
  const config = cfg(), initial = buildQuickProfile(doc, config, empty()); binding(initial, 'editor').enabled = true;
  const before = structuredClone({ doc, config, initial });
  for (const patch of [null, [], new Date(), { value: Number.NaN }, { value: new Date() }, JSON.parse('{"__proto__":{"polluted":true}}')])
    assert.throws(() => applyQuickGroupFunction(doc, config, initial, ['ANY/editor'], 'ANY/editor', 0, patch), /JSON|객체 키/);
  assert.deepEqual({ doc, config, initial }, before);
  assert.equal(Object.prototype.polluted, undefined);
  const unknown = applyQuickGroupFunction(doc, config, initial, ['ANY/editor'], 'ANY/editor', 4, { value: 'new' });
  assert.equal(unknown.changed, 0); assert.deepEqual(unknown.profile, initial);
});
