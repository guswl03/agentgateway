import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applySharedScope, sharedFunctionGroups, applySharedFunction, existingTargetChoices,
  reuseExistingSharedSettings, collectSharedPresets, applySharedPresets,
} from '../../src/policyShared.ts';
import { adaptPolicyPlan, policyFingerprint, targetFingerprint } from '../../src/policyAdapter.ts';

const empty = () => ({ version: 1, bindings: {} });
const nativeJwt = () => ({ mode: 'strict', issuer: 'https://issuer.example', audiences: ['gateway'], jwks: { url: 'https://issuer.example/jwks' }, jwtValidationOptions: { requiredClaims: ['exp'] } });
const nativeRate = () => ({ maxTokens: 5, tokensPerFill: 5, fillInterval: '1m', type: 'requests' });
const nativeGuard = () => ({ regex: { action: 'reject', rules: [{ pattern: 'SECRET' }] }, scope: ['messages'] });
const config = () => ({ routes: [
  { name: 'ai', backends: [{ ai: { provider: { openAI: {} } } }], policies: { jwtAuth: nativeJwt(), localRateLimit: [nativeRate()], ai: { promptGuard: { request: [nativeGuard()] } } } },
  { name: 'http', backends: [{ host: 'localhost:9000' }] },
] });
const fn = (kind = 'log', parameters = {}) => {
  const entries = {
    log: ['AGW-ACCESS-LOG-TRACING', 'log_access', 'exchange', 'http'],
    trace: ['AGW-ACCESS-LOG-TRACING', 'trace', 'exchange', 'http'],
    jwt: ['AGW-AUTH-AUTHZ-REQUEST', 'require_jwt', 'request', 'http'],
    regex: ['AGW-REGEX-GUARD-REQUEST', 'reject', 'request', 'llm'],
    response: ['AGW-REGEX-GUARD-RESPONSE', 'reject', 'response', 'llm'],
    rate: ['AGW-RATE-BUDGET-LIMIT', 'limit_requests', 'exchange', 'llm'],
    auth: ['AGW-AUTH-AUTHZ-REQUEST', 'authorize_require', 'request', 'http'],
    field: ['AGW-BODY-HEADER-TRANSFORM-REQUEST', 'remove_field', 'request', 'http'],
  };
  const [function_id, action, direction, traffic] = entries[kind];
  return { function_id, action, direction, traffic, object: 'DATA_CODE', parameters };
};
const card = (id, functions = [fn()], extras = {}) => ({ law_id: 'ARBITRARY', policy_id: id, policy_text: `Technical ${id}`, function: functions, applies_when: null, scope: null, except: [], legal_sources: [], ...extras });
const plan = (...cards) => ({ version: '1.1-draft', policy_packs: [{ pack_id: 'TEST', version: '1', priority: 10, policies: cards }] });
const scoped = (id, functions = [fn()], extras = {}) => card(id, functions, { scope: { target_ref: 'route:0' }, applies_when: { constant: true }, ...extras });

test('bulk scope fills absent values once, preserves source/per-card inputs and originals', () => {
  const doc = plan(card('missing'), scoped('source'), card('individual'));
  const cfg = config(); const profile = { version: 1, bindings: { 'ARBITRARY/individual': { target: 'route:1', condition: { constant: false } } } };
  const before = structuredClone({ doc, cfg, profile });
  const result = applySharedScope(doc, cfg, profile, { target: 'route:0', condition: { constant: true } });
  assert.equal(result.changed, 1); assert.equal(result.skipped, 2);
  assert.equal(result.profile.bindings['ARBITRARY/missing'].target, 'route:0');
  assert.deepEqual(result.profile.bindings['ARBITRARY/missing'].condition, { constant: true });
  assert.deepEqual(result.profile.bindings['ARBITRARY/individual'], profile.bindings['ARBITRARY/individual']);
  assert.equal(result.profile.bindings['ARBITRARY/source'], undefined);
  assert.deepEqual({ doc, cfg, profile }, before);
});

test('a common route does not implicitly approve an absent condition or select all routes', () => {
  const doc = plan(card('one')); const cfg = config();
  const result = applySharedScope(doc, cfg, empty(), { target: 'route:0' });
  assert.equal(result.profile.bindings['ARBITRARY/one'].condition, undefined);
  assert.equal(result.profile.bindings['ARBITRARY/one'].target, 'route:0');
  const adapted = adaptPolicyPlan(doc, cfg, result.profile);
  assert.ok(adapted.findings.length); assert.deepEqual(adapted.config, cfg);
});

test('bulk native regex scope skips HTTP and mixed all routes while explicit all remains supported', () => {
  const doc = plan(card('regex', [fn('regex')]), card('log'));
  for (const target of ['route:1', 'all']) {
    const result = applySharedScope(doc, config(), empty(), { target, condition: { constant: true } });
    assert.equal(result.profile.bindings['ARBITRARY/regex'], undefined);
    assert.equal(result.profile.bindings['ARBITRARY/log'].target, target);
  }
  const cfg = config(); cfg.routes[1] = structuredClone(cfg.routes[0]);
  assert.equal(applySharedScope(doc, cfg, empty(), { target: 'all' }).profile.bindings['ARBITRARY/regex'].target, 'all');
});

test('bulk operations never renew stale policy or target fingerprints', () => {
  const one = card('one'); const doc = plan(one); const cfg = config();
  for (const binding of [{ policyFingerprint: 'old' }, { target: 'route:0', targetFingerprint: 'old' }]) {
    const profile = { version: 1, bindings: { 'ARBITRARY/one': binding } };
    const result = applySharedScope(doc, cfg, profile, { target: 'route:0', condition: { constant: true } });
    assert.equal(result.changed, 0); assert.equal(result.stale, 1); assert.deepEqual(result.profile, profile);
  }
});

test('groups require explicit function selection, exact semantics, mappings, scope and condition', () => {
  const first = scoped('first', [fn('log')]);
  const mapped = structuredClone(first); mapped.policy_id = 'mapped'; mapped.function[0].target = { object: 'DATA_CODE', mappings: [{ element_paths: ['Patient.id'] }] };
  const doc = plan(first, scoped('second'), mapped, scoped('other-route', [fn()], { scope: { target_ref: 'route:1' } }), scoped('conditional', [fn()], { applies_when: { constant: false } }), scoped('undecided', [fn(), fn('trace')]));
  const groups = sharedFunctionGroups(doc, config(), empty());
  assert.equal(groups.length, 4); assert.equal(groups.find(g => g.policyKeys.includes('ARBITRARY/first')).members.length, 2);
  assert.ok(!groups.some(g => g.policyKeys.includes('ARBITRARY/undecided')));
  const selected = { version: 1, bindings: { 'ARBITRARY/undecided': { selectedFunctions: [1] } } };
  assert.ok(sharedFunctionGroups(doc, config(), selected).some(g => g.fn.action === 'trace'));
});

test('group fill applies missing fields only, with source and explicit per-card values authoritative', () => {
  const doc = plan(scoped('one', [fn('log')]), scoped('source', [fn('log', { reuse_existing_logging: false })]), scoped('individual', [fn('log')]));
  const cfg = config(); const profile = { version: 1, bindings: { 'ARBITRARY/individual': { functions: { 0: { reuse_existing_logging: false } }, targetFingerprint: targetFingerprint(cfg, 'route:0'), policyFingerprint: policyFingerprint(doc.policy_packs[0].policies[2]) } } };
  const before = structuredClone({ doc, cfg, profile });
  const [group] = sharedFunctionGroups(doc, cfg, profile);
  const result = applySharedFunction(doc, cfg, profile, group.id, { reuse_existing_logging: true });
  assert.equal(result.changed, 1);
  assert.deepEqual(result.profile.bindings['ARBITRARY/one'].functions[0], { reuse_existing_logging: true });
  assert.equal(result.profile.bindings['ARBITRARY/source'], undefined);
  assert.deepEqual(result.profile.bindings['ARBITRARY/individual'], profile.bindings['ARBITRARY/individual']);
  assert.deepEqual({ doc, cfg, profile }, before);
});

test('group aggregate shows only common effective values and only common source locks', () => {
  const doc = plan(scoped('one', [fn('field', { body_location: 'root_json', paths: ['id'] })]), scoped('two', [fn('field', { body_location: 'root_json' })]));
  const [group] = sharedFunctionGroups(doc, config(), empty());
  assert.deepEqual(group.values, { body_location: 'root_json' });
  assert.deepEqual(group.fn.parameters, { body_location: 'root_json' });
  assert.ok(group.missingFields.includes('paths'));
});

test('stale members stay blocked when an otherwise equal shared group is filled', () => {
  const doc = plan(scoped('one'), scoped('stale')); const cfg = config();
  const profile = { version: 1, bindings: { 'ARBITRARY/stale': { policyFingerprint: 'old' } } };
  const [group] = sharedFunctionGroups(doc, cfg, profile);
  assert.equal(group.stale, 1);
  const result = applySharedFunction(doc, cfg, profile, group.id, { reuse_existing_logging: true });
  assert.equal(result.changed, 1); assert.equal(result.stale, 1);
  assert.deepEqual(result.profile.bindings['ARBITRARY/stale'], profile.bindings['ARBITRARY/stale']);
  assert.ok(adaptPolicyPlan(doc, cfg, result.profile).findings.length);
});

test('native choices inspect only chosen target and never normalize JWT or detach conditional settings', () => {
  const cfg = config();
  assert.deepEqual(existingTargetChoices(cfg, 'route:1', fn('jwt')), []);
  assert.deepEqual(existingTargetChoices(cfg, undefined, fn('jwt')), []);
  assert.deepEqual(existingTargetChoices(cfg, 'route:0', fn('jwt'))[0].value, { jwt_auth: nativeJwt() });
  for (const jwt of [{ ...nativeJwt(), mode: 'optional' }, { ...nativeJwt(), mode: undefined }, { ...nativeJwt(), jwtValidationOptions: undefined }, { ...nativeJwt(), jwtValidationOptions: { requiredClaims: ['aud'] } }, { conditional: [nativeJwt()] }]) {
    cfg.routes[0].policies.jwtAuth = jwt;
    assert.deepEqual(existingTargetChoices(cfg, 'route:0', fn('jwt')), []);
  }
});

test('regex choices preserve native direction, action and explicit scope without defaults', () => {
  const cfg = config();
  assert.deepEqual(existingTargetChoices(cfg, 'route:0', fn('regex'))[0].value, { guardrail: nativeGuard() });
  assert.deepEqual(existingTargetChoices(cfg, 'route:1', fn('regex')), []);
  const parent = cfg.routes[0].policies.ai.promptGuard;
  parent.request = [{ regex: nativeGuard().regex }];
  assert.deepEqual(existingTargetChoices(cfg, 'route:0', fn('regex')), []);
  parent.request = [{ ...nativeGuard(), regex: { ...nativeGuard().regex, action: 'mask' } }, { conditional: [nativeGuard()] }];
  assert.deepEqual(existingTargetChoices(cfg, 'route:0', fn('regex')), []);
  parent.response = [{ regex: nativeGuard().regex }];
  assert.deepEqual(existingTargetChoices(cfg, 'route:0', fn('response')), []);
  parent.streaming = 'Disabled';
  assert.equal(existingTargetChoices(cfg, 'route:0', fn('response'))[0].value.response_mode, 'non_streaming');
});

test('all-target choices intersect exact settings and exclude extra backend/global policies', () => {
  const cfg = config(); cfg.routes[1] = structuredClone(cfg.routes[0]);
  assert.equal(existingTargetChoices(cfg, 'all', fn('jwt')).length, 1);
  cfg.routes[1].policies.jwtAuth.audiences = ['different'];
  assert.deepEqual(existingTargetChoices(cfg, 'all', fn('jwt')), []);
  delete cfg.routes[0].policies.jwtAuth;
  cfg.jwtAuth = nativeJwt(); cfg.routes[0].backends[0].policies = { jwtAuth: nativeJwt() };
  assert.deepEqual(existingTargetChoices(cfg, 'route:0', fn('jwt')), []);
});

test('automatic reuse requires a resolved true condition, direct/native compatible target and one exact setting', () => {
  const doc = plan(scoped('jwt', [fn('jwt')]), scoped('regex', [fn('regex')]), scoped('rate', [fn('rate')]), scoped('response', [fn('response')]), card('missing-condition', [fn('jwt')], { scope: { target_ref: 'route:0' } }));
  const cfg = config(); const before = structuredClone(cfg);
  const result = reuseExistingSharedSettings(doc, cfg, empty());
  assert.equal(result.changed, 3);
  assert.deepEqual(result.profile.bindings['ARBITRARY/jwt'].functions[0], { jwt_auth: nativeJwt() });
  assert.deepEqual(result.profile.bindings['ARBITRARY/regex'].functions[0], { guardrail: nativeGuard() });
  assert.equal(result.profile.bindings['ARBITRARY/response'], undefined);
  assert.equal(result.profile.bindings['ARBITRARY/missing-condition'], undefined);
  assert.deepEqual(cfg, before);
  const complete = plan(...doc.policy_packs[0].policies.slice(0, 3));
  const adapted = adaptPolicyPlan(complete, cfg, result.profile);
  assert.deepEqual(adapted.findings, []); assert.deepEqual(adapted.config, cfg);
});

test('shared reuse copies technical settings without borrowing another card legal origin', () => {
  const cfg=config(), origins=[{pack_id:'PREVIOUS',law_id:'OTHER',policy_id:'OLD',legal_sources:[{law_name:'다른 법률',provision:'제1조'}]}];
  cfg.routes[0].policies.jwtAuth.policySources=origins;
  cfg.routes[0].policies.localRateLimit[0].policySources=origins;
  cfg.routes[0].policies.ai.promptGuard.request[0].policySources=origins;
  const document=plan(scoped('jwt',[fn('jwt')]),scoped('regex',[fn('regex')]),scoped('rate',[fn('rate')]));
  for(const card of document.policy_packs[0].policies)card.legal_sources=[{law_name:'현재 보호법',provision:'제2조'}];
  const before=structuredClone(cfg), reused=reuseExistingSharedSettings(document,cfg,empty());
  assert.equal(reused.changed,3);assert.ok(!JSON.stringify(reused.profile).includes('policySources'));
  for(const kind of ['jwt','regex','rate'])assert.ok(existingTargetChoices(cfg,'route:0',fn(kind)).every(c=>!JSON.stringify(c.value).includes('policySources')));
  const result=adaptPolicyPlan(document,cfg,reused.profile);assert.deepEqual(result.findings,[]);
  const policies=result.config.routes[0].policies;
  for(const control of [policies.jwtAuth,policies.localRateLimit[0],policies.ai.promptGuard.request[0]]){
    assert.equal(control.policySources.length,2);
    assert.ok(control.policySources.some(s=>s.law_id==='ARBITRARY'&&s.legal_sources[0].law_name==='현재 보호법'));
    assert.ok(control.policySources.some(s=>s.law_id==='OTHER'));
  }
  assert.deepEqual(cfg,before);
});

test('automatic reuse rejects built-in regex guesses, ambiguous rates and missing native type', () => {
  const cfg = config(); cfg.routes[0].policies.ai.promptGuard.request = [{ regex: { action: 'reject', rules: [{ builtin: 'email' }] }, scope: ['messages'] }];
  cfg.routes[0].policies.localRateLimit.push({ ...nativeRate(), key: 'jwt.sub' });
  assert.equal(reuseExistingSharedSettings(plan(scoped('regex', [fn('regex')]), scoped('rate', [fn('rate')])), cfg, empty()).changed, 0);
  cfg.routes[0].policies.localRateLimit = [{ ...nativeRate(), type: undefined }];
  assert.deepEqual(existingTargetChoices(cfg, 'route:0', fn('rate')), []);
});

test('reuse preserves explicit/source values and cannot infer legal approval or missing field mapping', () => {
  const doc = plan(scoped('jwt', [fn('jwt', { jwt_auth: { ...nativeJwt(), issuer: 'https://other.example' } })]), scoped('auth', [fn('auth')]), scoped('field', [fn('field')]));
  const profile = { version: 1, bindings: { 'ARBITRARY/jwt': { functions: { 0: { jwt_auth: nativeJwt() } } } } };
  const result = reuseExistingSharedSettings(doc, config(), profile);
  assert.deepEqual(result.profile, profile); assert.equal(result.changed, 0);
});

test('shared presets reuse only matching semantic identity, target and current fingerprint', () => {
  const cfg = config(); const doc = plan(scoped('one', [fn('jwt')]));
  const profile = { version: 1, bindings: { 'ARBITRARY/one': { functions: { 0: { jwt_auth: nativeJwt() } } } } };
  const presets = collectSharedPresets(doc, cfg, profile);
  assert.equal(presets.entries.length, 1);
  const next = plan(scoped('different-id', [fn('jwt')]));
  const applied = applySharedPresets(next, cfg, empty(), presets);
  assert.equal(applied.changed, 1);
  assert.deepEqual(applied.profile.bindings['ARBITRARY/different-id'].functions[0], { jwt_auth: nativeJwt() });
  const changed = config(); changed.routes[0].backends[0].ai.provider = { anthropic: {} };
  const stale = applySharedPresets(next, changed, empty(), presets);
  assert.equal(stale.changed, 0); assert.equal(stale.stale, 1);
  const mapped = structuredClone(next); mapped.policy_packs[0].policies[0].function[0].target = { mappings: [{ element_paths: ['other'] }] };
  assert.equal(applySharedPresets(mapped, cfg, empty(), presets).changed, 0);
});

test('preset validation rejects malformed native parameters and never carries approvals', () => {
  const cfg = config(); const doc = plan(scoped('one', [fn('jwt')]));
  const preset = collectSharedPresets(doc, cfg, { version: 1, bindings: { 'ARBITRARY/one': { functions: { 0: { jwt_auth: nativeJwt() } } } } });
  for (const invalid of [{ version: 2, entries: [] }, { version: 1, entries: [{}] }, { ...preset, entries: [{ ...preset.entries[0], parameters: { jwt_auth: { ...nativeJwt(), mode: 'optional' } } }] }]) {
    assert.throws(() => applySharedPresets(doc, cfg, empty(), invalid));
  }
  const auth = plan(scoped('auth', [fn('auth', { require_when: { eq: { fact: 'jwt.role', value: 'approved' } } })]));
  assert.deepEqual(collectSharedPresets(auth, cfg, empty()).entries, []);
});

test('helper choices and presets do not dispatch by law or policy identity', () => {
  const cfg = config(); const doc = plan(scoped('one', [fn('jwt')]));
  const result = reuseExistingSharedSettings(doc, cfg, empty());
  doc.policy_packs[0].policies[0].law_id = 'UNRELATED_LAW'; doc.policy_packs[0].policies[0].policy_id = 'UNRELATED_CARD';
  const renamed = reuseExistingSharedSettings(doc, cfg, empty());
  assert.deepEqual(Object.values(renamed.profile.bindings)[0].functions, Object.values(result.profile.bindings)[0].functions);
});

test('coupled header patches cannot insert a new value under another source or individual header', () => {
  const header = parameters => ({ ...fn('field', parameters), action: 'set_header' });
  const doc = plan(scoped('missing', [header({})]), scoped('source', [header({ header: 'x-source' })]), scoped('individual', [header({})]));
  const cfg = config(); const profile = { version: 1, bindings: { 'ARBITRARY/individual': { functions: { 0: { header: 'x-individual' } } } } };
  const [group] = sharedFunctionGroups(doc, cfg, profile);
  const result = applySharedFunction(doc, cfg, profile, group.id, { header: 'x-shared', value: 'shared' });
  assert.equal(result.changed, 1); assert.equal(result.skipped, 2);
  assert.deepEqual(result.profile.bindings['ARBITRARY/missing'].functions[0], { header: 'x-shared', value: 'shared' });
  assert.equal(result.profile.bindings['ARBITRARY/source'], undefined);
  assert.deepEqual(result.profile.bindings['ARBITRARY/individual'], profile.bindings['ARBITRARY/individual']);
  const nextGroup = sharedFunctionGroups(doc, cfg, result.profile)[0];
  const valueOnly = applySharedFunction(doc, cfg, result.profile, nextGroup.id, { value: 'shared' });
  assert.equal(valueOnly.changed, 0);
});

test('resource and field presets remain a compatible set across partial source inputs', () => {
  const doc = plan(scoped('missing', [fn('field')]), scoped('source', [fn('field', { resource_type: 'Observation' })]));
  const cfg = config(); const [group] = sharedFunctionGroups(doc, cfg, empty());
  const result = applySharedFunction(doc, cfg, empty(), group.id, { resource_type: 'Patient', body_location: 'root_json', paths: ['birthDate'] });
  assert.equal(result.changed, 1); assert.equal(result.profile.bindings['ARBITRARY/source'], undefined);
  const nextGroup = sharedFunctionGroups(doc, cfg, result.profile)[0];
  const pathsOnly = applySharedFunction(doc, cfg, result.profile, nextGroup.id, { paths: ['birthDate'] });
  assert.equal(pathsOnly.changed, 0);
  assert.equal(pathsOnly.profile.bindings['ARBITRARY/source'], undefined);
});

test('public shared helpers reject non-JSON input and prototype pollution payloads', () => {
  const doc = plan(scoped('one')); const cfg = config(); const [group] = sharedFunctionGroups(doc, cfg, empty());
  for (const patch of [null, [], 1, new Date(), JSON.parse('{"__proto__":{"polluted":true}}'), { value: Number.NaN }])
    assert.throws(() => applySharedFunction(doc, cfg, empty(), group.id, patch));
  assert.throws(() => applySharedScope(doc, cfg, empty(), { target: 3 }));
  assert.throws(() => applySharedScope(doc, cfg, empty(), { condition: [] }));
  assert.equal({}.polluted, undefined);
  const unchanged = applySharedFunction(doc, cfg, empty(), group.id, { reuse_existing_logging: undefined });
  assert.deepEqual(unchanged.profile, empty());
});

test('malformed source scope cannot crash shared helpers or escape the adapter block', () => {
  const doc = plan(scoped('one', [fn('jwt')], { scope: { target_ref: 7 } }));
  const cfg = config(); const profile = { version: 1, bindings: { 'ARBITRARY/one': { targetFingerprint: 'old' } } };
  const result = applySharedScope(doc, cfg, profile, { target: 'route:0', condition: { constant: true } });
  assert.equal(result.changed, 0); assert.deepEqual(result.profile, profile);
  assert.equal(reuseExistingSharedSettings(doc, cfg, profile).changed, 0);
  const adapted = adaptPolicyPlan(doc, cfg, result.profile);
  assert.ok(adapted.findings.length); assert.deepEqual(adapted.config, cfg);
});

test('zero/invalid function selections and unresolved exclusions are never silently completed', () => {
  const doc = plan(scoped('one'), scoped('unreviewed', [fn()], { except: null }), scoped('multifunction', [fn(), fn('trace')]));
  const cfg = config();
  for (const selectedFunctions of [[], [3], [0, 0], [0.5]]) {
    const profile = { version: 1, bindings: { 'ARBITRARY/one': { selectedFunctions } } };
    assert.deepEqual(sharedFunctionGroups(doc, cfg, profile), []);
    const result = reuseExistingSharedSettings(doc, cfg, profile);
    assert.deepEqual(result.profile, profile);
    const adapted = adaptPolicyPlan(doc, cfg, result.profile);
    assert.ok(adapted.findings.length); assert.deepEqual(adapted.config, cfg);
  }
});
