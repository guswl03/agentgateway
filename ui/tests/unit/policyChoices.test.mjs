import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { nativePolicyChoices, builtinRegexChoices, functionMatch } from '../../src/policyChoices.ts';

const reject = { regex: { action: 'reject', rules: [{ pattern: 'REGISTERED_DENY' }] }, scope: ['messages'] };
const mask = { regex: { action: 'mask', rules: [{ builtin: 'email' }] }, scope: ['systemPrompt', 'messages'] };
const issuer = { issuer: 'https://issuer.test', audiences: ['gateway'], jwks: { url: 'https://issuer.test/jwks' }, mode: 'optional' };
const rate = { maxTokens: 10, tokensPerFill: 5, fillInterval: '1s', key: 'jwt.sub' };
const config = {
 llm: { policies: { guardrails: { request: [reject, mask], response: [{ regex: mask.regex }] }, jwtAuth: issuer } },
 routes: [{ name: 'private', policies: { localRateLimit: [rate, { ...rate, type: 'tokens' }] } }]
};

test('registered regex choices keep direction and action separate and preserve scope', () => {
 const choices = nativePolicyChoices(config, 'regex', 'request', 'reject');
 assert.equal(choices.length, 1);
 assert.deepEqual(choices[0].value, reject);
 assert.match(choices[0].label, /REGISTERED_DENY/);
 assert.equal(nativePolicyChoices(config, 'regex', 'response', 'reject').length, 0);
 assert.deepEqual(nativePolicyChoices(config, 'regex', 'response', 'mask')[0].value, { regex: mask.regex });
});

test('request guard choices make the actual native default scope explicit without touching config', () => {
 const before = JSON.stringify(config);
 const source = { llm: { policies: { guardrails: { request: [{ regex: mask.regex }] } } } };
 assert.deepEqual(nativePolicyChoices(source, 'regex', 'request', 'mask')[0].value.scope, ['systemPrompt', 'messages']);
 assert.equal(JSON.stringify(config), before);
});

test('JWT issuer choices reuse real keys and enforce strict mode and expiry on a copy', () => {
 const choices = nativePolicyChoices(config, 'jwt');
 assert.equal(choices.length, 1);
 assert.equal(choices[0].value.mode, 'strict');
 assert.deepEqual(choices[0].value.jwks, issuer.jwks);
 assert.deepEqual(choices[0].value.jwtValidationOptions.requiredClaims, ['exp']);
 assert.equal(issuer.mode, 'optional');
 assert.equal(issuer.jwtValidationOptions, undefined);
});

test('incomplete JWT providers never become selectable trusted issuers', () => {
 const incomplete = { issuer: 'https://issuer.test', jwks: issuer.jwks };
 assert.deepEqual(nativePolicyChoices({ policies: { jwtAuth: incomplete } }, 'jwt'), []);
 assert.deepEqual(nativePolicyChoices({ policies: { jwtAuth: { providers: [issuer, incomplete] } } }, 'jwt'), []);
});

test('request limit choices exclude token budgets and preserve the registered limit key', () => {
 const choices = nativePolicyChoices(config, 'rate');
 assert.equal(choices.length, 1);
 assert.deepEqual(choices[0].value, { ...rate, type: 'requests' });
 assert.match(choices[0].label, /10/);
 assert.match(choices[0].label, /1s/);
 assert.deepEqual(nativePolicyChoices({ policies: { localRateLimit: [{ ...rate, key: 'unregistered_expression()' }] } }, 'rate'), []);
});

test('conditional policies are not extracted as unconditional native presets', () => {
 const conditional = { conditional: [{ when: 'jwt.admin', jwtAuth: issuer, localRateLimit: [rate], ai: { promptGuard: { request: [reject] } } }] };
 for (const kind of ['jwt', 'rate', 'regex'])
  assert.deepEqual(nativePolicyChoices({ routes: [{ policies: conditional }] }, kind, 'request', 'reject'), []);
});

test('choice extraction deduplicates exact values but keeps distinct security configurations', () => {
 const duplicate = { ...config, policies: { jwtAuth: issuer }, gateways: { other: { policies: { jwtAuth: { ...issuer, audiences: ['another'] } } } } };
 assert.equal(nativePolicyChoices(duplicate, 'jwt').length, 2);
});

test('native choice reuse strips another policy legal origin while preserving its execution settings', () => {
 const attributed=structuredClone(config), origins=[{pack_id:'OTHER',policy_id:'PREVIOUS',legal_sources:[{law_name:'다른 법',provision:'제1조'}]}];
 attributed.llm.policies.guardrails.request[0].policySources=origins;
 attributed.llm.policies.jwtAuth.policySources=origins;
 attributed.routes[0].policies.localRateLimit[0].policySources=origins;
 const before=structuredClone(attributed);
 for(const kind of ['regex','jwt','rate']){
  const choices=nativePolicyChoices(attributed,kind,'request','reject');
  assert.equal(choices.length,1);assert.equal(choices[0].value.policySources,undefined);
 }
 assert.deepEqual(attributed,before);
 const same=structuredClone(attributed);same.routes.push({policies:{jwtAuth:{...structuredClone(attributed.llm.policies.jwtAuth),policySources:[{policy_id:'ANOTHER_ORIGIN'}]}}});
 assert.equal(nativePolicyChoices(same,'jwt').length,1);
});

test('feature names describe actual generic Gateway actions', () => {
 assert.match(functionMatch({ function_id: 'AGW-REGEX-GUARD-RESPONSE', action: 'mask' }), /응답.*정규식.*치환/);
 assert.match(functionMatch({ function_id: 'AGW-REGEX-GUARD-REQUEST', action: 'reject' }), /요청.*정규식.*거절/);
 assert.match(functionMatch({ function_id: 'AGW-AUTH-AUTHZ-REQUEST', action: 'require_jwt' }), /JWT/);
 assert.match(functionMatch({ function_id: 'AGW-RATE-BUDGET-LIMIT', action: 'limit_requests' }), /요청 횟수/);
});

test('built-in choices match the pinned Gateway enum and never claim Korean resident identifiers', () => {
 const schema = JSON.parse(readFileSync(new URL('../../src/generated/schema.json', import.meta.url), 'utf8'));
 const choices = builtinRegexChoices('request', 'mask');
 assert.deepEqual(choices.map(choice => choice.value.regex.rules[0].builtin).sort(), schema.$defs.Builtin.oneOf.map(value => value.const).sort());
 assert.ok(choices.every(choice => choice.value.regex.action === 'mask' && choice.value.scope.includes('messages')));
 assert.match(choices.find(choice => choice.value.regex.rules[0].builtin === 'ssn').label, /미국/);
 assert.ok(builtinRegexChoices('response', 'reject').every(choice => !('scope' in choice.value)));
});
