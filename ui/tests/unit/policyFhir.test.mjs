import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FHIR_KEEP_OPTIONS, applyFhirDefaults, validateFhirFilterProfile,
} from '../../src/policyFhir.ts';
import { policyFingerprint, targetFingerprint } from '../../src/policyAdapter.ts';

const empty = () => ({ version: 1, bindings: {} });
const config = () => ({ routes: [
  { name: 'first', matches: [{ path: { exact: '/protected' } }], backends: [{ host: 'localhost:9101' }] },
  { name: 'second', backends: [{ host: 'localhost:9102' }] },
] });
const fn = (parameters = {}, extras = {}) => ({
  function_id: 'AGW-BODY-HEADER-TRANSFORM-REQUEST', action: 'remove_field',
  object: 'UNMAPPED_TECHNICAL_FIELD', traffic: 'http', direction: 'request', parameters, ...extras,
});
const card = (id, functions = [fn()], extras = {}) => ({
  law_id: 'ARBITRARY', policy_id: id, policy_text: `Technical fixture ${id}`, function: functions,
  scope: null, applies_when: null, function_combination: 'all', except: [], legal_sources: [], ...extras,
});
const plan = (...policies) => ({ version: '1.1-draft', policy_packs: [{ pack_id: 'OTHER_PACK', priority: 2, version: '1', policies }] });
const defaults = () => ({ body_location: 'request_fhir', fhir_filter: { version: 1, allow_fields: {} } });

test('the technical keep registry exposes exactly the 13 reviewed privacy candidate paths, not audit logging', () => {
  const dictionary = JSON.parse(readFileSync(new URL('../fixtures/policy-packs/FHIR_개인정보보호법임시매핑사전.json', import.meta.url), 'utf8'));
  const expected = new Map();
  for (const entry of dictionary.objects.filter(x => ['PERSONAL_DATA', 'DATA_FIELD', 'SENSITIVE_DATA', 'UNIQUE_IDENTIFIER_DATA'].includes(x.object))) {
    for (const mapping of entry.mappings) {
      const paths = expected.get(mapping.resource_type) ?? new Set();
      mapping.element_paths.forEach(path => paths.add(path.slice(mapping.resource_type.length + 1)));
      expected.set(mapping.resource_type, paths);
    }
  }
  assert.deepEqual(Object.keys(FHIR_KEEP_OPTIONS).sort(), [...expected.keys()].sort());
  assert.equal(Object.values(FHIR_KEEP_OPTIONS).flat().length, 13);
  for (const [resource, options] of Object.entries(FHIR_KEEP_OPTIONS)) {
    assert.deepEqual(new Set(options.map(option => option.path)), expected.get(resource));
    assert.ok(options.every(option => typeof option.label === 'string' && /[가-힣]/.test(option.label)));
  }
  assert.equal(FHIR_KEEP_OPTIONS.AuditEvent, undefined);
});

test('default profile removes every nonstructural FHIR field without any keep exception', () => {
  assert.deepEqual(validateFhirFilterProfile({ version: 1, allow_fields: {} }), { version: 1, allow_fields: {} });
});

test('only explicit reviewed keep exceptions are accepted, including the two FHIR choice paths', () => {
  const profile = { version: 1, allow_fields: {
    Patient: ['birthDate', 'telecom[].value'],
    Condition: ['code'],
    Observation: ['value[x]', 'component[].value[x]'],
  } };
  const before = structuredClone(profile), parsed = validateFhirFilterProfile(profile);
  assert.deepEqual(parsed, { version: 1, allow_fields: {
    Patient: ['telecom[].value', 'birthDate'],
    Condition: ['code'],
    Observation: ['value[x]', 'component[].value[x]'],
  } });
  parsed.allow_fields.Patient.push('name[]');
  assert.deepEqual(profile, before);
});

test('equivalent keep selections normalize into registry order and omit empty resource arrays', () => {
  const canonical = { version: 1, allow_fields: {
    Patient: ['name[]', 'birthDate'], Observation: ['code', 'component[].value[x]'],
  } };
  const permuted = { version: 1, allow_fields: {
    Observation: ['component[].value[x]', 'code'], Condition: [], Patient: ['birthDate', 'name[]'],
  } };
  const before = structuredClone(permuted);
  assert.equal(JSON.stringify(validateFhirFilterProfile(permuted)), JSON.stringify(canonical));
  assert.deepEqual(validateFhirFilterProfile({ version: 1, allow_fields: { Patient: [], Observation: [], Condition: [] } }),
    { version: 1, allow_fields: {} });
  assert.deepEqual(validateFhirFilterProfile(validateFhirFilterProfile(permuted)), canonical);
  assert.deepEqual(permuted, before);
});

test('invalid versions, unknown keys and unreviewed resources or paths are rejected', () => {
  for (const value of [null, [], 1, {}, { version: 1 }, { version: 2, allow_fields: {} },
    { version: 1, allow_fields: {}, allow_all: true },
    { version: 1, allow_fields: null }, { version: 1, allow_fields: [] },
    { version: 1, allow_fields: { AuditEvent: ['action'] } },
    { version: 1, allow_fields: { Patient: ['id'] } },
    { version: 1, allow_fields: { Patient: ['*'] } },
    { version: 1, allow_fields: { Patient: 'birthDate' } },
    { version: 1, allow_fields: { Patient: [null] } },
    { version: 1, allow_fields: { Patient: ['Patient.birthDate'] } },
    { version: 1, allow_fields: { Observation: ['valueString'] } },
  ]) assert.throws(() => validateFhirFilterProfile(value), /FHIR/);
});

test('duplicate, oversized and dangerous keep profiles cannot weaken the strict filter', () => {
  for (const value of [
    { version: 1, allow_fields: { Patient: ['birthDate', 'birthDate'] } },
    { version: 1, allow_fields: { Patient: Array(101).fill('birthDate') } },
    { version: 1, allow_fields: { Patient: ['x'.repeat(1000)] } },
    JSON.parse('{"version":1,"allow_fields":{"__proto__":[]}}'),
    JSON.parse('{"version":1,"allow_fields":{"constructor":[]}}'),
    { version: 1, allow_fields: Object.create({ Patient: ['birthDate'] }) },
    Object.assign(Object.create({ unexpected: true }), { version: 1, allow_fields: {} }),
    { version: 1, allow_fields: new Map() },
    { version: 1, allow_fields: new Date() },
  ]) assert.throws(() => validateFhirFilterProfile(value), /FHIR/);
  const hidden = { version: 1, allow_fields: {} };
  Object.defineProperty(hidden, 'allow_all', { enumerable: false, value: true });
  assert.throws(() => validateFhirFilterProfile(hidden), /FHIR/);
  const symbols = { version: 1, allow_fields: {} };
  symbols[Symbol('other')] = true;
  assert.throws(() => validateFhirFilterProfile(symbols), /FHIR/);
  const getter = {};
  Object.defineProperty(getter, 'version', { enumerable: true, get() { throw new Error('must not evaluate'); } });
  Object.defineProperty(getter, 'allow_fields', { enumerable: true, value: {} });
  assert.throws(() => validateFhirFilterProfile(getter), /FHIR/);
});

test('blank request deletion gets a generic strict default without requiring a mapped law object', () => {
  const doc = plan(card('first'), card('second', [fn({}, { object: 'DIFFERENT_OBJECT' })]));
  const cfg = config(), profile = empty(), before = structuredClone({ doc, cfg, profile });
  const result = applyFhirDefaults(doc, profile, cfg);
  assert.deepEqual(result.bindings['ARBITRARY/first'].functions[0], defaults());
  assert.deepEqual(result.bindings['ARBITRARY/second'].functions[0], defaults());
  assert.equal(result.bindings['ARBITRARY/first'].target, undefined);
  assert.equal(result.bindings['ARBITRARY/first'].condition, undefined);
  assert.deepEqual({ doc, cfg, profile }, before);
  result.bindings['ARBITRARY/first'].functions[0].fhir_filter.allow_fields.Patient = ['birthDate'];
  assert.deepEqual(result.bindings['ARBITRARY/second'].functions[0], defaults());
});

test('all three full-pack request deletion cards receive defaults although object mappings are absent', () => {
  const documents = ['full_ai_basic_act_policy_pack.json', 'full_medical_act_policy_pack.json', 'full_pipa_policy_pack.json']
    .map(name => JSON.parse(readFileSync(new URL(`../fixtures/policy-packs/${name}`, import.meta.url), 'utf8')));
  const cards = documents.flatMap(document => document.cards).map(item => ({ ...item, function: item.function.map(func => ({
    ...func, traffic: 'http', direction: 'request', target: { status: 'unmapped', mappings: [] }, parameters: {},
  })) }));
  const doc = plan(...cards), result = applyFhirDefaults(doc, empty(), config());
  const fieldCards = cards.filter(item => item.function.some(func => func.action === 'remove_field'));
  assert.equal(fieldCards.length, 3);
  assert.deepEqual(new Set(fieldCards.flatMap(item => item.function.filter(func => func.action === 'remove_field').map(func => func.object))), new Set(['IDENTIFIER_DATA', 'FIELD_SET', 'ADDITIONAL_INFORMATION']));
  for (const item of fieldCards) assert.deepEqual(result.bindings[`${item.law_id}/${item.policy_id}`].functions[0], defaults());
  assert.equal(Object.keys(result.bindings).length, 3);
});

test('source parameters and even partial or invalid explicit configurations remain authoritative', () => {
  for (const parameters of [
    { paths: ['birthDate'] }, { body_location: 'root_json' }, { resource_type: 'Patient' },
    { paths: [] }, { paths: null }, { extra: true }, defaults(), { fhir_filter: { version: 99 } },
  ]) {
    const sourced = plan(card('source', [fn(parameters)]));
    assert.deepEqual(applyFhirDefaults(sourced, empty(), config()), empty());
    const supplied = { version: 1, bindings: { 'ARBITRARY/individual': { functions: { 0: parameters } } } };
    assert.deepEqual(applyFhirDefaults(plan(card('individual')), supplied, config()), supplied);
  }
});

test('defaults preserve every explicit scope, condition and sibling function setting', () => {
  const doc = plan(card('one', [fn(), fn({}, { action: 'set_header' })], {
    scope: { target_ref: 'route:1' }, applies_when: { eq: { fact: 'request.method', value: 'POST' } },
  }));
  const profile = { version: 1, bindings: { 'ARBITRARY/one': {
    target: 'route:0', condition: { constant: false }, selectedFunctions: [0, 1],
    functions: { 1: { header: 'x-pinned', value: 'unchanged' } },
  } } };
  const result = applyFhirDefaults(doc, profile, config());
  assert.deepEqual(result.bindings['ARBITRARY/one'], {
    ...profile.bindings['ARBITRARY/one'], functions: { ...profile.bindings['ARBITRARY/one'].functions, 0: defaults() },
  });
});

test('unsupported functions, wrong direction/traffic, exclusions and unselected candidates get no defaults', () => {
  for (const extras of [
    { direction: 'response' }, { traffic: 'llm' }, { function_id: 'OTHER' }, { action: 'rewrite_body' },
  ]) assert.deepEqual(applyFhirDefaults(plan(card('skip', [fn({}, extras)])), empty(), config()), empty());
  for (const extras of [{ except: null }, { except: [{ law_id: 'OTHER', policy_id: 'EXCLUDED' }] }, { function: null }]) {
    assert.deepEqual(applyFhirDefaults(plan(card('skip', [fn()], extras)), empty(), config()), empty());
  }
  const doc = plan(card('choices', [fn(), fn()], { function_combination: null }));
  assert.deepEqual(applyFhirDefaults(doc, empty(), config()), empty());
  for (const selectedFunctions of [[], [1], [1, 1], [-1], [2]]) {
    const profile = { version: 1, bindings: { 'ARBITRARY/choices': { selectedFunctions } } };
    const result = applyFhirDefaults(doc, profile, config());
    if (selectedFunctions.length === 1 && selectedFunctions[0] === 1) {
      assert.deepEqual(result.bindings['ARBITRARY/choices'].functions[1], defaults());
      assert.equal(result.bindings['ARBITRARY/choices'].functions[0], undefined);
    } else assert.deepEqual(result, profile);
  }
});

test('stale fingerprints cannot be refreshed or bypassed by generic defaults', () => {
  const item = card('stale'), doc = plan(item), cfg = config();
  for (const binding of [{ policyFingerprint: 'old' }, { target: 'route:0', targetFingerprint: 'old' }, { targetFingerprint: 'old' }]) {
    const profile = { version: 1, bindings: { 'ARBITRARY/stale': binding } };
    assert.deepEqual(applyFhirDefaults(doc, profile, cfg), profile);
  }
});

test('changed legal provenance remains stale when FHIR default filling checks a saved adapter fingerprint', () => {
  const item=card('legal'),doc=plan(item),cfg=config();item.legal_sources=[{law_name:'보호법',provision:'제1조'}];
  const saved={version:1,bindings:{'ARBITRARY/legal':{policyFingerprint:policyFingerprint(item),target:'route:0',functions:{0:{}}}}};
  item.legal_sources[0].provision='제2조';
  assert.deepEqual(applyFhirDefaults(doc,saved,cfg),saved);
});

test('disabled cards preserve hidden FHIR settings byte-for-byte while active cards receive defaults', () => {
  const off = card('off'), on = card('on'), doc = plan(off, on), cfg = config();
  const profile = { version: 1, bindings: { 'ARBITRARY/off': {
    enabled: false, target: 'route:0', condition: { constant: false }, selectedFunctions: [0],
    policyFingerprint: policyFingerprint(off), targetFingerprint: targetFingerprint(cfg, 'route:0'),
    functions: { 0: {} },
  } } };
  const before = structuredClone({ doc, cfg, profile }), bindingBytes = JSON.stringify(profile.bindings['ARBITRARY/off']);
  const result = applyFhirDefaults(doc, profile, cfg);
  assert.equal(JSON.stringify(result.bindings['ARBITRARY/off']), bindingBytes);
  assert.deepEqual(result.bindings['ARBITRARY/on'].functions[0], defaults());
  assert.deepEqual({ doc, cfg, profile }, before);
});

test('re-enabling FHIR cards fills only fresh gaps and never refreshes stale saved snapshots', () => {
  const item = card('reenable'), doc = plan(item), cfg = config();
  const profile = { version: 1, bindings: { 'ARBITRARY/reenable': {
    enabled: false, target: 'route:0', policyFingerprint: policyFingerprint(item),
    targetFingerprint: targetFingerprint(cfg, 'route:0'), functions: { 0: {} },
  } } };
  assert.deepEqual(applyFhirDefaults(doc, profile, cfg), profile);
  const enabled = structuredClone(profile);
  enabled.bindings['ARBITRARY/reenable'].enabled = true;
  const result = applyFhirDefaults(doc, enabled, cfg);
  assert.deepEqual(result.bindings['ARBITRARY/reenable'], {
    ...enabled.bindings['ARBITRARY/reenable'], functions: { 0: defaults() },
  });
  const changedCard = structuredClone(doc);
  changedCard.policy_packs[0].policies[0].function[0].object = 'CHANGED_OBJECT';
  const changedDestination = structuredClone(cfg);
  changedDestination.routes[0].backends[0].host = 'changed:9101';
  assert.deepEqual(applyFhirDefaults(changedCard, enabled, cfg), enabled);
  assert.deepEqual(applyFhirDefaults(doc, enabled, changedDestination), enabled);
  const explicit = structuredClone(enabled);
  explicit.bindings['ARBITRARY/reenable'].functions[0] = { paths: ['birthDate'], body_location: 'root_json', resource_type: 'Patient' };
  assert.deepEqual(applyFhirDefaults(doc, explicit, cfg), explicit);
});

test('fresh adapter fingerprints work for explicit, sourced, sole, all and legacy bind targets', () => {
  const configs = [
    { cfg: config(), target: 'route:0' },
    { cfg: config(), target: 'route:1', sourced: true },
    { cfg: { llm: { models: [{ name: 'provider/*' }] } }, target: 'llm', sole: true },
    { cfg: { ...config(), llm: { models: [] } }, target: 'all' },
    { cfg: { binds: [{ port: 8080, listeners: [{ name: 'legacy', routes: [{ name: 'old', hostnames: ['test.example'], backends: [{ host: 'localhost:9103' }] }] }] }] }, target: 'bind:0:0:0' },
  ];
  for (const { cfg, target, sourced, sole } of configs) {
    const item = card('fresh', [fn()], sourced ? { scope: { target_ref: target } } : {});
    const profile = { version: 1, bindings: { 'ARBITRARY/fresh': {
      ...(!sourced && !sole ? { target } : {}),
      policyFingerprint: policyFingerprint(item), targetFingerprint: targetFingerprint(cfg, target),
    } } };
    const result = applyFhirDefaults(plan(item), profile, cfg);
    assert.deepEqual(result.bindings['ARBITRARY/fresh'].functions[0], defaults());
    assert.equal(result.bindings['ARBITRARY/fresh'].targetFingerprint, profile.bindings['ARBITRARY/fresh'].targetFingerprint);
    const changed = structuredClone(cfg);
    if (changed.llm) changed.llm.models.push({ name: 'new-model' });
    else if (changed.routes) changed.routes[Number(target.split(':')[1])].backends = [{ host: 'changed:9000' }];
    else changed.binds[0].listeners[0].routes[0].hostnames = ['changed.example'];
    assert.deepEqual(applyFhirDefaults(plan(item), profile, changed), profile);
  }
});
