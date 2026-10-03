import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { adaptPolicyPlan } from '../../src/policyAdapter.ts';
import { canEditNativeSetup, createJwtSetup, createRateSetup, editableNativeSetupDraft } from '../../src/policyNativeSetup.ts';

const schema = JSON.parse(readFileSync(new URL('../../../schema/config.json', import.meta.url), 'utf8'));
function clean(value) {
	if (!value || typeof value !== 'object') return;
	if (Array.isArray(value.enum) && !value.enum.length) {
		delete value.enum;
		delete value.type;
		value.not = {};
	}
	Object.values(value).forEach(clean);
}
clean(schema);
const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);
const original = {
	gateways: { default: { port: 19210 } },
	routes: [{ name: 'private', matches: [{ path: { pathPrefix: '/' } }], backends: [{ host: '127.0.0.1:19211' }] }]
};
const jwt = { issuer: 'https://identity.example/realm/', jwksUrl: 'https://identity.example/keys?version=2', audiences: 'gateway, clinical-agent, gateway' };
const rate = { count: '60', interval: '2', unit: 'm', basis: 'shared' };
function adapt(kind, value) {
	const fn = kind === 'jwt'
		? { function_id: 'AGW-AUTH-AUTHZ-REQUEST', action: 'require_jwt', object: null, direction: 'request', traffic: 'http', parameters: { jwt_auth: value } }
		: { function_id: 'AGW-RATE-BUDGET-LIMIT', action: 'limit_requests', object: null, direction: 'exchange', traffic: 'llm', parameters: { local_rate_limit: value } };
	return adaptPolicyPlan({ version: '1.1-draft', policy_packs: [{ pack_id: 'GENERIC', version: '1', priority: 1, policies: [{ law_id: 'UNRELATED', policy_id: 'CONTROL', policy_text: 'Technical input', function_combination: 'all', applies_when: { constant: true }, scope: { target_ref: 'route:0' }, function: [fn], except: [], legal_sources: [] }] }] }, original, { version: 1, bindings: {} });
}

test('JWT form produces strict pinned schema settings with expiry and exact issuer identity', () => {
	const result = createJwtSetup(jwt);
	assert.equal(result.ok, true);
	assert.equal(result.value.issuer, jwt.issuer);
	assert.deepEqual(result.value.audiences, ['gateway', 'clinical-agent']);
	assert.deepEqual(result.value.jwks, { url: jwt.jwksUrl });
	assert.equal(result.value.mode, 'strict');
	assert.deepEqual(result.value.jwtValidationOptions, { requiredClaims: ['exp'] });
	const candidate = adapt('jwt', result.value);
	assert.deepEqual(candidate.findings, []);
	assert.deepEqual(candidate.config.routes[0].policies.jwtAuth, result.value);
	assert.equal(validate(candidate.config), true, JSON.stringify(validate.errors));
	assert.equal(original.routes[0].policies, undefined);
});

test('incomplete or unsafe new issuer URLs never produce a connectable setting', () => {
	for (const patch of [
		{ issuer: '' }, { issuer: 'http://identity.example' }, { issuer: 'https://identity.example/#fragment' },
		{ issuer: 'https://name:secret@identity.example' }, { issuer: 'https://identity.example?tenant=1' },
		{ issuer: 'https://identity.example /realm' }, { issuer: 'javascript:alert(1)' }, { issuer: 'https:identity.example' },
		{ jwksUrl: '' }, { jwksUrl: 'http://identity.example/keys' }, { jwksUrl: 'https://identity.example/keys#fragment' },
		{ jwksUrl: 'https://name:secret@identity.example/keys' }, { audiences: '' }, { audiences: ' , , ' },
		{ audiences: 'gateway,,clinical-agent' }, { audiences: 'gateway\nclinical-agent' }
	]) {
		const result = createJwtSetup({ ...jwt, ...patch });
		assert.equal(result.ok, false, JSON.stringify(patch));
		assert.equal('value' in result, false);
		assert.ok(result.error.length > 0);
	}
});

test('request limit explicitly sets count and refill interval with selected shared/path/method buckets', () => {
	for (const [basis, key] of [['shared', undefined], ['path', 'request.path'], ['method', 'request.method']]) {
		const result = createRateSetup({ ...rate, basis });
		assert.equal(result.ok, true);
		assert.deepEqual(result.value, { maxTokens: 60, tokensPerFill: 60, fillInterval: '2m', type: 'requests', ...(key ? { key } : {}) });
		const candidate = adapt('rate', result.value);
		assert.deepEqual(candidate.findings, []);
		assert.deepEqual(candidate.config.routes[0].policies.localRateLimit, [result.value]);
		assert.equal(validate(candidate.config), true, JSON.stringify(validate.errors));
	}
});

test('rate form rejects missing count, invalid time, overflow and arbitrary bucket expressions', () => {
	for (const patch of [
		{ count: '' }, { count: '0' }, { count: '-2' }, { count: '1.5' }, { count: '1e3' }, { count: '9007199254740992' },
		{ interval: '' }, { interval: '0' }, { interval: '-1' }, { interval: '0.5' }, { interval: '1m30s' }, { interval: '2562048', unit: 'h' },
		{ unit: 'weeks' }, { unit: 'toString' }, { basis: 'jwt.unreviewed' }, { basis: '__proto__' }
	]) {
		const result = createRateSetup({ ...rate, ...patch });
		assert.equal(result.ok, false, JSON.stringify(patch));
		assert.equal('value' in result, false);
		assert.ok(result.error.length > 0);
	}
});

test('allowed time units match actual native duration semantics and never invent operational values', () => {
	for (const unit of ['s', 'm', 'h', 'd']) {
		const result = createRateSetup({ ...rate, unit });
		assert.equal(result.ok, true);
		assert.equal(result.value.fillInterval, `2${unit}`);
		assert.deepEqual(adapt('rate', result.value).findings, []);
	}
	assert.equal(createJwtSetup({ issuer: '', jwksUrl: '', audiences: '' }).ok, false);
	assert.equal(createRateSetup({ count: '', interval: '', unit: 'm', basis: 'shared' }).ok, false);
});

test('trimming form input never changes issuer slashes or mutates the supplied draft', () => {
	const draft = { ...jwt, issuer: ` ${jwt.issuer} `, audiences: ' gateway, clinical-agent ' };
	const before = structuredClone(draft);
	const result = createJwtSetup(draft);
	assert.equal(result.ok, true);
	assert.equal(result.value.issuer, jwt.issuer);
	assert.deepEqual(draft, before);
});

test('simple connected settings initialize edit fields and round-trip without losing native values', () => {
	const jwtValue = createJwtSetup(jwt).value;
	assert.equal(canEditNativeSetup('jwt', jwtValue), true);
	const editableJwt = editableNativeSetupDraft('jwt', jwtValue);
	assert.equal(editableJwt.kind, 'jwt');
	assert.deepEqual(createJwtSetup(editableJwt.draft).value, jwtValue);
	for (const basis of ['shared', 'path', 'method']) for (const unit of ['s', 'm', 'h', 'd']) {
		const rateValue = createRateSetup({ ...rate, basis, unit }).value;
		assert.equal(canEditNativeSetup('rate', rateValue), true);
		const editableRate = editableNativeSetupDraft('rate', rateValue);
		assert.equal(editableRate.kind, 'rate');
		assert.deepEqual(createRateSetup(editableRate.draft).value, rateValue);
	}
	const reordered = Object.fromEntries(Object.entries(jwtValue).reverse());
	assert.equal(canEditNativeSetup('jwt', reordered), true);
});

test('richer imported JWT authentication is never flattened into the compact issuer form', () => {
	const simple = createJwtSetup(jwt).value;
	for (const value of [
		{ mode: 'strict', providers: [simple] },
		{ ...simple, preserveToken: true },
		{ ...simple, location: { header: { name: 'x-session-token' } } },
		{ ...simple, jwtValidationOptions: { requiredClaims: ['exp', 'nbf'] } },
		{ ...simple, mode: 'optional' },
		{ ...simple, jwks: { file: '/data/keys.json' } },
		{ ...simple, audiences: ['gateway', 'gateway'] },
		{ ...simple, audiences: ['gateway,clinical-agent'] },
		{ ...simple, extra: undefined }
	]) {
		const before = structuredClone(value);
		assert.equal(canEditNativeSetup('jwt', value), false);
		assert.equal(editableNativeSetupDraft('jwt', value), undefined);
		assert.deepEqual(value, before);
	}
});

test('richer imported quotas keep refill, budget and custom-key settings in the existing editor', () => {
	const simple = createRateSetup(rate).value;
	for (const value of [
		{ ...simple, tokensPerFill: 10 }, { ...simple, type: 'tokens' },
		{ ...simple, key: 'jwt.sub' }, { ...simple, key: null },
		{ ...simple, fillInterval: '1m30s' }, { ...simple, fillInterval: '0.5s' },
		{ ...simple, maxTokens: '60' }, { ...simple, condition: 'request.path == "/private"' },
		{ ...simple, extra: undefined }
	]) {
		const before = structuredClone(value);
		assert.equal(canEditNativeSetup('rate', value), false);
		assert.equal(editableNativeSetupDraft('rate', value), undefined);
		assert.deepEqual(value, before);
	}
	assert.equal(canEditNativeSetup('jwt', undefined), false);
	assert.equal(canEditNativeSetup('rate', { fillInterval: '1m', maxTokens: null }), false);
});
