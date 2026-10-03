import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptPolicyPlan } from '../../src/policyAdapter.ts';
import { buildQuickProfile } from '../../src/policyQuick.ts';
import { assertPolicyReadiness, evaluatePolicyReadiness, parseReviewProfile, recordPolicyReview } from '../../src/policyReadiness.ts';

const card = (id = 'HEADER') => ({law_id: 'TEST', policy_id: id, policy_text: 'Fixture header', legal_sources: [{law_name: 'Fixture', provision: '1', revision_no: 'TEST', promulgation_date: '2020-01-01'}], except: [], scope: {target_ref: 'route:0'}, applies_when: {constant: true}, function_combination: 'all', function: [{function_id: 'AGW-BODY-HEADER-TRANSFORM-RESPONSE', action: 'set_header', traffic: 'http', direction: 'response', object: null, parameters: {header: `x-${id.toLowerCase()}`, value: 'true'}}]});
const draft = (patch = {}) => ({applicability: 'applicable', reason: 'Reviewed fixture scope', reviewer: 'Fixture reviewer', evidence: 'test://scope', verification: 'none', verificationEvidence: '', ...patch});
const empty = () => ({version: 1, reviews: {}});
function fixture(...items) {
	const doc = {version: '1.1-draft', policy_packs: [{pack_id: 'TEST', version: '1', priority: 1, policies: items.length ? items : [card()]}]};
	const cfg = {gateways: {default: {port: 3000}}, routes: [{name: 'review', gateways: ['default'], backends: [{host: '127.0.0.1:18080'}]}], binds: []};
	const profile = buildQuickProfile(doc, cfg, {version: 1, bindings: {}});
	return {doc, cfg, profile, result: adaptPolicyPlan(doc, cfg, profile)};
}
function review(f, item, values) { return recordPolicyReview(f.doc, item, f.cfg, f.profile, adaptPolicyPlan(f.doc, f.cfg, f.profile), draft(values)); }
function report(f, reviews = empty()) { return evaluatePolicyReadiness(f.doc, f.cfg, f.profile, reviews); }

test('compile success cannot satisfy unknown applicability, including excluded cards', () => {
	const f = fixture(card(), card('SECOND')); f.profile.bindings['TEST/SECOND'].enabled = false;
	assert.equal(f.result.findings.length, 0);
	const output = report(f);
	assert.equal(output.counts.unknown, 2); assert.equal(output.releaseReady, false);
	assert.equal(output.cards[1].technical, 'excluded');
	assert.throws(() => assertPolicyReadiness(f.doc, f.cfg, f.profile, empty(), adaptPolicyPlan(f.doc, f.cfg, f.profile).config), /미완료/);
});
test('successful generation remains awaiting real verification evidence', () => {
	const f = fixture(), item = f.doc.policy_packs[0].policies[0];
	const reviews = {version: 1, reviews: {'TEST/HEADER': review(f, item)}};
	assert.equal(report(f, reviews).cards[0].status, 'configured'); assert.equal(report(f, reviews).releaseReady, false);
});
test('recorded Gateway evidence unblocks only the exact candidate', () => {
	const f = fixture(), item = f.doc.policy_packs[0].policies[0];
	const reviews = {version: 1, reviews: {'TEST/HEADER': review(f, item, {verification: 'gateway', verificationEvidence: 'test://runtime result header observed'})}};
	assert.equal(report(f, reviews).cards[0].status, 'verified'); assert.equal(report(f, reviews).releaseReady, true);
	assert.doesNotThrow(() => assertPolicyReadiness(f.doc, f.cfg, f.profile, reviews, f.result.config));
});
test('non-applicability requires reasons and exclusion; zero controls cannot be applied', () => {
	const f = fixture(), item = f.doc.policy_packs[0].policies[0];
	assert.throws(() => review(f, item, {applicability: 'not_applicable', reason: ''}), /이유/);
	let reviews = {version: 1, reviews: {'TEST/HEADER': review(f, item, {applicability: 'not_applicable'})}};
	assert.equal(report(f, reviews).cards[0].status, 'pending');
	f.profile.bindings['TEST/HEADER'].enabled = false;
	reviews = {version: 1, reviews: {'TEST/HEADER': review(f, item, {applicability: 'not_applicable'})}};
	assert.equal(report(f, reviews).cards[0].status, 'not_applicable'); assert.equal(report(f, reviews).releaseReady, false);
});
test('configuration, card, pack revision and scope changes invalidate judgments', () => {
	for (const mutate of [f => { f.cfg.routes[0].backends[0].host = 'other:9000'; }, f => { f.doc.policy_packs[0].policies[0].policy_text += ' new scope'; }, f => { f.doc.policy_packs[0].version = '2'; }, f => { f.profile.bindings['TEST/HEADER'].condition = {constant: false}; }]) {
		const f = fixture(); const reviews = {version: 1, reviews: {'TEST/HEADER': review(f, f.doc.policy_packs[0].policies[0])}};
		mutate(f); assert.equal(report(f, reviews).cards[0].status, 'stale');
	}
});
test('verification evidence expires when another card changes the full candidate', () => {
	const f = fixture(card(), card('SECOND'));
	const reviews = {version: 1, reviews: {'TEST/HEADER': review(f, f.doc.policy_packs[0].policies[0], {verification: 'gateway', verificationEvidence: 'test://candidate'})}};
	f.profile.bindings['TEST/SECOND'].enabled = false;
	assert.equal(report(f, reviews).cards[0].status, 'stale');
});
test('existing logging boolean never earns Gateway verification', () => {
	const logger = {...card('LOG'), function: [{function_id: 'AGW-ACCESS-LOG-TRACING', action: 'log_access', object: null, traffic: 'gateway', direction: 'exchange', parameters: {reuse_existing_logging: true}}]};
	const f = fixture(logger);
	const reviews = {version: 1, reviews: {'TEST/LOG': review(f, logger, {verification: 'gateway', verificationEvidence: 'test://just boolean'})}};
	assert.equal(report(f, reviews).cards[0].technical, 'external'); assert.equal(report(f, reviews).cards[0].status, 'configured');
	assert.match(report(f, reviews).cards[0].issues[0], /로그/);
});
test('external or alternative evidence can account for an excluded applicable control', () => {
	for (const method of ['external', 'alternative']) {
		const f = fixture(card(), card('SECOND')); f.profile.bindings['TEST/SECOND'].enabled = false;
		const reviews = {version: 1, reviews: {'TEST/SECOND': review(f, f.doc.policy_packs[0].policies[1], {verification: method, verificationEvidence: 'test://full-scope external evidence'})}};
		assert.equal(report(f, reviews).cards[1].status, `${method}_verified`); assert.equal(report(f, reviews).cards[1].blocked, false);
	}
});
test('verification records cannot override missing selected functions or merge conflicts', () => {
	const missing = card(); missing.function[0].parameters = {}; const f = fixture(missing);
	f.profile.bindings['TEST/HEADER'].enabled = true; f.profile.bindings['TEST/HEADER'].functions = {};
	const reviews = {version: 1, reviews: {'TEST/HEADER': review(f, missing, {verification: 'gateway', verificationEvidence: 'test://claim'})}};
	assert.notEqual(report(f, reviews).cards[0].status, 'verified');
	const result = adaptPolicyPlan(f.doc, f.cfg, f.profile); result.findings.push({policy: 'TEST/HEADER', kind: 'conflict', message: 'fixture conflict'});
	assert.equal(evaluatePolicyReadiness(f.doc, f.cfg, f.profile, reviews, result).cards[0].status, 'conflict');
});
test('incomplete review files and candidate mismatch are rejected', () => {
	const f = fixture(), item = f.doc.policy_packs[0].policies[0];
	assert.throws(() => review(f, item, {reviewer: ''}), /담당자/);
	assert.throws(() => review(f, item, {verification: 'gateway', verificationEvidence: ''}), /증거/);
	assert.throws(() => parseReviewProfile('{"version":2,"reviews":{}}'));
	assert.throws(() => parseReviewProfile('{"version":1,"reviews":{"test":{"applicability":"verified"}}}'));
	const reviews = {version: 1, reviews: {'TEST/HEADER': review(f, item, {verification: 'gateway', verificationEvidence: 'test://proof'})}};
	assert.deepEqual(parseReviewProfile(JSON.stringify(reviews)), reviews);
	const candidate = structuredClone(f.result.config); candidate.routes[0].backends[0].host = 'other:9000';
	assert.throws(() => assertPolicyReadiness(f.doc, f.cfg, f.profile, reviews, candidate), /후보/);
});
test('saved review change markers contain no credentials or full config', () => {
	const f = fixture(); f.cfg.secretFixture = 'do-not-export-this-secret';
	const record = review(f, f.doc.policy_packs[0].policies[0]);
	assert.equal(JSON.stringify(record).includes('do-not-export-this-secret'), false); assert.equal(record.scopeFingerprint.length, 32);
});

test('unsupported extra source scope is distinct from missing configuration', () => {
	const item = card(); item.scope.purpose = 'uninterpreted source purpose';
	const f = fixture(item); f.profile.bindings['TEST/HEADER'].enabled = true;
	const reviews = {version: 1, reviews: {'TEST/HEADER': review(f, item)}};
	assert.equal(report(f, reviews).cards[0].status, 'unsupported');
	assert.equal(report(f, reviews).cards[0].technical, 'unsupported');
	assert.equal(report(f, reviews).releaseReady, false);
});
