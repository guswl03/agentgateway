import assert from 'node:assert/strict';
import test from 'node:test';
import { policyResponseError, policyResponseNotices } from '../../src/policyResponse.ts';

const legal = { law_name: '검증용 가상 법률', provision: '제1조' };
const report = (action, direction, sources = [{ legal_sources: [legal] }]) => ({
	gateway_policy: { version: 1, decisions: [{ action, direction, sources }] }
});

test('shows actual action, direction, law and clause without including inspected content', () => {
	assert.deepEqual(policyResponseNotices({ ...report('mask', 'request'), choices: ['private'] }), [
		'요청 마스킹 · 검증용 가상 법률 제1조'
	]);
	assert.deepEqual(policyResponseNotices(report('reject', 'response')), [
		'응답 거절 · 검증용 가상 법률 제1조'
	]);
});

test('renders removal and all distinct law sources while collapsing repeated citations', () => {
	assert.deepEqual(
		policyResponseNotices(report('remove_field', 'request', [{
			action: 'mask', legal_sources: [legal, legal, { law_name: '가상 시행령', provision: '제2조' }]
		}])),
		['요청 필드 삭제 · 검증용 가상 법률 제1조', '요청 필드 삭제 · 가상 시행령 제2조']
	);
});

test('no notices for absent, malformed, future or unknown reports', () => {
	for (const value of [null, 'text', {}, { gateway_policy: null },
		{ gateway_policy: { version: 2, decisions: [] } },
		{ gateway_policy: { version: 1, decisions: [null] } },
		report('audit', 'request'), report('mask', 'unknown'),
		report('mask', 'request', [{ legal_sources: [null, { law_name: 'partial' }] }])])
		assert.deepEqual(policyResponseNotices(value), []);
});

test('Gateway denial uses human-readable error message and retains fallback for legacy errors', () => {
	assert.equal(policyResponseError({ error: { message: '검증용 가상 법률 제1조에 따라 거절했습니다.' } }, 'raw'),
		'검증용 가상 법률 제1조에 따라 거절했습니다.');
	for (const value of [null, 'legacy', { error: 'legacy' }, { error: { message: '' } }])
		assert.equal(policyResponseError(value, 'legacy error'), 'legacy error');
});
