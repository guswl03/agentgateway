import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptPolicyPlan, parseProfile, policyFingerprint, targetFingerprint,
} from '../../src/policyAdapter.ts';
import {
  applySharedScope, sharedFunctionGroups, applySharedFunction, reuseExistingSharedSettings,
  collectSharedPresets, applySharedPresets,
} from '../../src/policyShared.ts';

const empty = () => ({ version: 1, bindings: {} });
const nativeJwt = () => ({ mode: 'strict', issuer: 'https://issuer.example', audiences: ['gateway'],
  jwks: { url: 'https://issuer.example/jwks' }, jwtValidationOptions: { requiredClaims: ['exp'] } });
const config = () => ({ gateways: { default: { port: 8123 } }, routes: [
  { name: 'existing', backends: [{ host: 'localhost:8124' }], policies: {
    jwtAuth: nativeJwt(), authorization: { rules: [{ require: 'jwt.scope == "existing"' }] },
    transformations: { response: { body: 'toJson(json(response.body))' } },
  } },
  { name: 'plain', backends: [{ host: 'localhost:8125' }] },
] });
const fn = (action = 'require_jwt', parameters = {}, extras = {}) => ({
  function_id: action === 'set_header' ? 'AGW-BODY-HEADER-TRANSFORM-REQUEST' : 'AGW-AUTH-AUTHZ-REQUEST',
  action, object: null, direction: 'request', traffic: 'http', parameters, ...extras,
});
const card = (id, functions = [fn()], extras = {}) => ({
  law_id: 'ARBITRARY', policy_id: id, policy_text: `Technical ${id}`, function: functions,
  scope: { target_ref: 'route:0' }, applies_when: { constant: true }, function_combination: 'all',
  except: [], legal_sources: [{ law_name: 'Technical source', provision: 'Fixture', revision_no: 'TEST', promulgation_date: '2020-01-01' }], ...extras,
});
const plan = (...policies) => ({ version: '1.1-draft', policy_packs: [{ pack_id: 'GENERIC', version: '1', priority: 1, policies }] });
const disabled = (id, binding = {}) => ({ version: 1, bindings: { [`ARBITRARY/${id}`]: { enabled: false, ...binding } } });

test('binding enabled is strictly boolean and omission retains legacy active semantics', () => {
  for (const value of [null, 0, 1, 'false', 'true', [], {}]) {
    assert.throws(() => parseProfile(JSON.stringify({ version: 1, bindings: { key: { enabled: value } } })), /적용|활성/);
  }
  for (const enabled of [true, false, undefined]) {
    const source = JSON.stringify({ version: 1, bindings: { key: { enabled } } });
    assert.deepEqual(parseProfile(source), JSON.parse(source));
  }
  const doc = plan(card('jwt'));
  for (const binding of [{}, { enabled: true }]) {
    const result = adaptPolicyPlan(doc, config(), { version: 1, bindings: { 'ARBITRARY/jwt': binding } });
    assert.ok(result.findings.some(finding => finding.policy === 'ARBITRARY/jwt'));
  }
});

test('disabled stored settings retain unresolved execution values while enforcing binding structure', () => {
  const profile = disabled('stored', {
    condition: { eq: { fact: 'unresolved.approval', value: true } },
    selectedFunctions: [0], policyFingerprint: 'old', targetFingerprint: 'old',
    functions: { 0: { jwt_auth: {}, guardrail: {}, local_rate_limit: {}, body_location: 'request_fhir', fhir_filter: {} } },
  });
  assert.deepEqual(parseProfile(JSON.stringify(profile)), profile);
  const enabled = structuredClone(profile); enabled.bindings['ARBITRARY/stored'].enabled = true;
  assert.throws(() => parseProfile(JSON.stringify(enabled)));
  for (const binding of [{ enabled: false, functions: [] }, { enabled: false, target: 3 },
    { enabled: false, selectedFunctions: 'none' }, { enabled: false, policyFingerprint: 3 }]) {
    assert.throws(() => parseProfile(JSON.stringify({ version: 1, bindings: { key: binding } })));
  }
});

test('disabled cards skip unresolved scope, conditions, functions, exclusions and execution settings visibly', () => {
  const policies = [
    card('unknown-scope', [fn()], { scope: { unsupported_scope: true }, applies_when: null }),
    card('unknown-function', null, { except: null }),
    card('unsupported', [fn('unsupported_action', {}, { function_id: 'UNKNOWN_FUNCTION' })]),
    card('empty-selection'),
  ];
  const doc = plan(...policies), profile = { version: 1, bindings: Object.fromEntries(policies.map(item => [
    `ARBITRARY/${item.policy_id}`, { enabled: false, policyFingerprint: 'stale', selectedFunctions: [], functions: { 0: { jwt_auth: {} } } },
  ])) }, cfg = config();
  const snapshot = structuredClone({ doc, profile, cfg }), result = adaptPolicyPlan(doc, cfg, profile);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.config, cfg);
  assert.deepEqual(result.expressions, []);
  for (const item of policies) assert.ok(result.notes.some(note => note.includes(`ARBITRARY/${item.policy_id}`) && /제외|끄|비활성/.test(note)));
  assert.deepEqual({ doc, profile, cfg }, snapshot);
});

test('opting out preserves already installed JWT, transformations, authorization and route destinations', () => {
  const item = card('jwt'), cfg = config(), profile = disabled('jwt', {
    target: 'route:0', condition: { constant: true }, functions: { 0: { jwt_auth: nativeJwt() } },
  });
  const before = structuredClone(cfg), result = adaptPolicyPlan(plan(item), cfg, profile);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.config, before);
  assert.deepEqual(cfg, before);
});

test('active cards still execute while disabled cards cannot block them or modify existing policies', () => {
  const active = card('header', [fn('set_header', { header: 'x-active', value: 'selected' })], { scope: { target_ref: 'route:1' } });
  const pending = card('pending-jwt', [fn()], { scope: null, applies_when: null });
  const cfg = config(), result = adaptPolicyPlan(plan(active, pending), cfg, disabled('pending-jwt'));
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.config.routes[0], cfg.routes[0]);
  assert.match(result.config.routes[1].policies.transformations.request.replace, /x-active/);
  assert.ok(result.notes.some(note => note.includes('ARBITRARY/pending-jwt')));
});

test('reenabling restores missing/unsupported checks and never renews stale card or target snapshots', () => {
  const item = card('reenable'), doc = plan(item), cfg = config();
  const stored = disabled('reenable', { policyFingerprint: policyFingerprint(item), targetFingerprint: targetFingerprint(cfg, 'route:0'),
    functions: { 0: { jwt_auth: nativeJwt() } }, target: 'route:0' });
  const enable = input => { const result = structuredClone(input); result.bindings['ARBITRARY/reenable'].enabled = true; return result; };
  assert.deepEqual(adaptPolicyPlan(doc, cfg, enable(stored)).findings, []);
  const changedCard = structuredClone(doc); changedCard.policy_packs[0].policies[0].policy_text += ' changed';
  assert.ok(adaptPolicyPlan(changedCard, cfg, enable(stored)).findings.some(finding => /카드.*변경/.test(finding.message)));
  const changedTarget = structuredClone(cfg); changedTarget.routes[0].backends = [{ host: 'changed:9000' }];
  assert.ok(adaptPolicyPlan(doc, changedTarget, enable(stored)).findings.some(finding => /경로.*변경/.test(finding.message)));
  const unresolved = disabled('reenable', { functions: { 0: { jwt_auth: {} } } });
  assert.deepEqual(adaptPolicyPlan(doc, cfg, unresolved).findings, []);
  assert.ok(adaptPolicyPlan(doc, cfg, enable(unresolved)).findings.length > 0);
  const bad = plan(card('reenable', null, { except: null }));
  assert.ok(adaptPolicyPlan(bad, cfg, enable(disabled('reenable'))).findings.length > 0);
});

test('invalid activation flags passed directly to the adapter are findings rather than implicit exclusions', () => {
  for (const enabled of [null, 'false', 0]) {
    const cfg = config(), result = adaptPolicyPlan(plan(card('invalid')), cfg, { version: 1, bindings: { 'ARBITRARY/invalid': { enabled } } });
    assert.ok(result.findings.some(finding => /적용|활성/.test(finding.message)));
    assert.deepEqual(result.config, cfg);
  }
});

test('explicitly enabled cards require a Gateway execution function without changing legacy empty cards or opt-out', () => {
  const doc = plan(card('empty', [])), cfg = config();
  const result = adaptPolicyPlan(doc, cfg, { version: 1, bindings: { 'ARBITRARY/empty': { enabled: true } } });
  assert.ok(result.findings.some(finding => finding.policy === 'ARBITRARY/empty' &&
    finding.message === '적용할 Gateway 실행 기능이 없습니다.'));
  assert.deepEqual(result.config, cfg);
  assert.deepEqual(result.expressions, []);
  for (const profile of [empty(), disabled('empty')]) {
    const skipped = adaptPolicyPlan(doc, cfg, profile);
    assert.deepEqual(skipped.findings, []);
    assert.deepEqual(skipped.config, cfg);
    assert.deepEqual(skipped.expressions, []);
  }
});

test('bulk scope skips disabled cards without refreshing their old snapshots or hidden inputs', () => {
  const active = card('active', [fn('set_header')], { scope: null, applies_when: null });
  const inactive = card('inactive', [fn()], { scope: null, applies_when: null });
  const doc = plan(active, inactive), cfg = config(), profile = disabled('inactive', {
    policyFingerprint: 'old', targetFingerprint: 'old', functions: { 0: { jwt_auth: {} } },
  });
  const before = structuredClone({ doc, cfg, profile });
  const result = applySharedScope(doc, cfg, profile, { target: 'route:1', condition: { constant: true } });
  assert.equal(result.changed, 1); assert.equal(result.skipped, 1); assert.equal(result.stale, 0);
  assert.deepEqual(result.profile.bindings['ARBITRARY/inactive'], profile.bindings['ARBITRARY/inactive']);
  assert.equal(result.profile.bindings['ARBITRARY/active'].target, 'route:1');
  assert.deepEqual({ doc, cfg, profile }, before);
});

test('disabled functions disappear from shared groups and captured shared edits cannot reactivate them', () => {
  const doc = plan(card('first', [fn('set_header')]), card('second', [fn('set_header')]));
  const cfg = config(), [captured] = sharedFunctionGroups(doc, cfg, empty());
  assert.equal(captured.members.length, 2);
  const profile = disabled('second', { functions: { 0: { header: 'x-disabled', value: 'untouched' } } });
  const [active] = sharedFunctionGroups(doc, cfg, profile);
  assert.equal(active.members.length, 1); assert.deepEqual(active.policyKeys, ['ARBITRARY/first']);
  const result = applySharedFunction(doc, cfg, profile, captured.id, { header: 'x-active', value: 'applied' });
  assert.equal(result.changed, 1);
  assert.deepEqual(result.profile.bindings['ARBITRARY/second'], profile.bindings['ARBITRARY/second']);
  assert.deepEqual(result.profile.bindings['ARBITRARY/first'].functions[0], { header: 'x-active', value: 'applied' });
});

test('automatic existing native settings reuse and generic preset collection skip disabled cards', () => {
  const doc = plan(card('active'), card('inactive')), cfg = config();
  const profile = disabled('inactive'), before = structuredClone(profile);
  const reused = reuseExistingSharedSettings(doc, cfg, profile);
  assert.equal(reused.changed, 1);
  assert.deepEqual(reused.profile.bindings['ARBITRARY/active'].functions[0].jwt_auth, nativeJwt());
  assert.deepEqual(reused.profile.bindings['ARBITRARY/inactive'], before.bindings['ARBITRARY/inactive']);
  const presets = collectSharedPresets(doc, cfg, reused.profile);
  assert.equal(presets.entries.length, 1);
  const allDisabled = { version: 1, bindings: { 'ARBITRARY/active': { enabled: false }, 'ARBITRARY/inactive': { enabled: false } } };
  assert.deepEqual(collectSharedPresets(doc, cfg, allDisabled), { version: 1, entries: [] });
  const restored = applySharedPresets(doc, cfg, allDisabled, presets);
  assert.equal(restored.changed, 0); assert.deepEqual(restored.profile, allDisabled);
});

test('automatic shared operations retain all-function bundles and cannot revive an excluded bundle', () => {
  const functions = [fn(), fn('authorize_require', { require_when: { eq: { fact: 'request.method', value: 'POST' } } })];
  const item = card('bundle', functions), doc = plan(item), cfg = config(), profile = empty();
  const reused = reuseExistingSharedSettings(doc, cfg, profile);
  assert.equal(reused.profile.bindings['ARBITRARY/bundle'].selectedFunctions, undefined);
  assert.equal(sharedFunctionGroups(doc, cfg, reused.profile).length, 2);
  assert.deepEqual(adaptPolicyPlan(doc, cfg, reused.profile).findings, []);
  const pending = structuredClone(doc); pending.policy_packs[0].policies[0].function[1].parameters = {};
  const pendingReuse = reuseExistingSharedSettings(pending, cfg, profile);
  assert.equal(pendingReuse.profile.bindings['ARBITRARY/bundle'].selectedFunctions, undefined);
  assert.ok(adaptPolicyPlan(pending, cfg, pendingReuse.profile).findings.some(finding => /조건/.test(finding.message)));
  const optedOut = disabled('bundle', { functions: { 0: { jwt_auth: {} } } });
  assert.deepEqual(reuseExistingSharedSettings(doc, cfg, optedOut).profile, optedOut);
  assert.deepEqual(sharedFunctionGroups(doc, cfg, optedOut), []);
});
