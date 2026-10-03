import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

import { mockGateway } from './fixtures';

const base = {
	config: {},
	gateways: { default: { port: 3000 } },
	routes: [{ name: '검토 경로', gateways: ['default'], backends: [{ host: '127.0.0.1:18080' }] }],
	binds: []
};
const card = {
	law_id: 'REVIEW',
	policy_id: 'NOTICE',
	policy_text: '시험용 표시 헤더',
	function_combination: 'all',
	scope: { target_ref: 'route:0' },
	applies_when: { constant: true },
	except: [],
	legal_sources: [
		{
			law_name: '시험 법령',
			provision: '제1조',
			revision_no: 'TEST',
			promulgation_date: '2020-01-01'
		}
	],
	function: [
		{
			function_id: 'AGW-BODY-HEADER-TRANSFORM-RESPONSE',
			action: 'set_header',
			object: null,
			direction: 'response',
			traffic: 'http',
			parameters: { header: 'x-ai-generated', value: 'true' }
		}
	]
};
const plan = {
	version: '1.1-draft',
	policy_packs: [{ pack_id: 'REVIEW', version: '1', priority: 1, policies: [card] }]
};

async function openPlan(page: Page, value = plan) {
	await page.route('**/api/policy/packs', route => route.fulfill({ json: { packs: [] } }));
	await page.goto('/policy-import');
	await page.getByRole('checkbox', { name: '수동 연결 모드', exact: true }).check();
	await page.getByText('JSON 직접 붙여넣기', { exact: true }).click();
	await page.getByLabel('커넥터 JSON').fill(JSON.stringify(value));
}
async function decide(page: Page, key: string, applicability = 'applicable') {
	const row = page.locator(`[data-readiness-key="${key}"]`);
	await row.getByRole('button', { name: `${key} 정책 검토`, exact: true }).click();
	await page
		.getByRole('button', {
			name: `${key} ${applicability === 'applicable' ? '적용' : '미적용'}`,
			exact: true
		})
		.click();
	await page.getByLabel(`${key} 판단 담당자`, { exact: true }).fill('시험 담당자');
	await page.getByLabel(`${key} 판단 이유`, { exact: true }).fill('시험용 서비스 범위 확인');
	await page.getByLabel(`${key} 판단 근거`, { exact: true }).fill('test://review/scope');
	return row;
}

test('review workbench preserves unsaved per-policy inputs through selection, search and filters', async ({
	page
}) => {
	const gateway = await mockGateway(page, base);
	const second = { ...card, policy_id: 'OTHER', policy_text: '두 번째 검토 대상' };
	const two = { ...plan, policy_packs: [{ ...plan.policy_packs[0], policies: [card, second] }] };
	await openPlan(page, two);
	await expect(page.getByRole('table', { name: '정책 검토 목록' })).toBeVisible();
	await expect(page.locator('details[data-readiness-key]')).toHaveCount(0);
	await decide(page, 'REVIEW/NOTICE');
	await page
		.getByLabel('REVIEW/NOTICE 판단 이유', { exact: true })
		.fill('저장하지 않은 첫 번째 판단');
	await page.getByRole('button', { name: 'REVIEW/OTHER 정책 검토', exact: true }).click();
	await page.getByLabel('REVIEW/OTHER 판단 이유', { exact: true }).fill('두 번째 임시 판단');
	await page.getByRole('button', { name: 'REVIEW/NOTICE 정책 검토', exact: true }).click();
	await expect(page.getByLabel('REVIEW/NOTICE 판단 이유', { exact: true })).toHaveValue(
		'저장하지 않은 첫 번째 판단'
	);
	await page.getByRole('button', { name: 'REVIEW/NOTICE 판단 기록 저장', exact: true }).click();
	await page.getByRole('button', { name: '다음 검토할 정책 →', exact: true }).click();
	await expect(page.getByLabel('REVIEW/OTHER 판단 이유', { exact: true })).toHaveValue(
		'두 번째 임시 판단'
	);
	await page.getByLabel('정책 검색', { exact: true }).fill('NOTICE');
	await expect(page.locator('[data-readiness-key]')).toHaveCount(1);
	await page.getByLabel('정책 검색', { exact: true }).fill('없는 검색어');
	await expect(page.getByText('해당하는 정책이 없습니다.', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: '전체 정책 보기', exact: true }).click();
	await page.getByRole('button', { name: /^검증 대기 1$/ }).click();
	await expect(page.locator('[data-readiness-key]')).toHaveCount(1);
	await expect(page.locator('[data-readiness-key]')).toHaveAttribute(
		'data-readiness-status',
		'configured'
	);
	await expect(page.getByRole('button', { name: '설정 검사 후 적용', exact: true })).toBeDisabled();
	expect(gateway.postedConfigs).toHaveLength(0);
});

test('replacement source clears unsaved judgment and proof for a reused policy key', async ({
	page
}) => {
	const gateway = await mockGateway(page, base);
	await openPlan(page);
	await decide(page, 'REVIEW/NOTICE');
	await page.getByLabel('REVIEW/NOTICE 검증 방법', { exact: true }).selectOption('gateway');
	await page.getByLabel('REVIEW/NOTICE 검증 증거', { exact: true }).fill('test://old/proof');
	const replacement = {
		...plan,
		policy_packs: [
			{ ...plan.policy_packs[0], policies: [{ ...card, policy_text: '변경된 정책 요구사항' }] }
		]
	};
	await page.getByLabel('커넥터 JSON').fill(JSON.stringify(replacement));
	const row = page.locator('[data-readiness-key="REVIEW/NOTICE"]');
	await expect(row).toContainText('변경된 정책 요구사항');
	await expect(row).toHaveAttribute('data-readiness-status', 'unknown');
	await row.getByRole('button', { name: 'REVIEW/NOTICE 정책 검토', exact: true }).click();
	await expect(
		page.getByRole('button', { name: 'REVIEW/NOTICE 판단 전', exact: true })
	).toHaveAttribute('aria-pressed', 'true');
	for (const field of ['판단 담당자', '판단 이유', '판단 근거']) {
		await expect(page.getByLabel(`REVIEW/NOTICE ${field}`, { exact: true })).toHaveValue('');
	}
	await page.getByRole('button', { name: 'REVIEW/NOTICE 적용', exact: true }).click();
	await expect(page.getByLabel('REVIEW/NOTICE 검증 방법', { exact: true })).toHaveValue('none');
	await page.getByLabel('REVIEW/NOTICE 검증 방법', { exact: true }).selectOption('gateway');
	await expect(page.getByLabel('REVIEW/NOTICE 검증 증거', { exact: true })).toHaveValue('');
	await expect(page.getByRole('button', { name: '설정 검사 후 적용', exact: true })).toBeDisabled();
	expect(gateway.postedConfigs).toHaveLength(0);
});

test('one-click applicability choices show unsaved selection without certifying or writing it', async ({
	page
}) => {
	const gateway = await mockGateway(page, base);
	await openPlan(page);
	const row = page.locator('[data-readiness-key="REVIEW/NOTICE"]');
	for (const choice of ['적용', '미적용', '판단 전']) {
		const button = page.getByRole('button', { name: `REVIEW/NOTICE ${choice}`, exact: true });
		await button.click();
		await expect(button).toHaveAttribute('aria-pressed', 'true');
		await expect(
			page.getByLabel('REVIEW/NOTICE 서비스 적용 여부').locator('[aria-pressed="true"]')
		).toHaveCount(1);
		await expect(row).toContainText(choice);
		await expect(row).toContainText('저장 전');
		await expect(row).toHaveAttribute('data-readiness-status', 'unknown');
		await expect(
			page.getByRole('button', { name: '설정 검사 후 적용', exact: true })
		).toBeDisabled();
	}
	await page.getByRole('button', { name: 'REVIEW/NOTICE 적용', exact: true }).click();
	await page.getByRole('button', { name: 'REVIEW/NOTICE 판단 기록 저장', exact: true }).click();
	await expect(
		page.getByRole('complementary', { name: '선택한 정책 상세 검토' }).getByRole('alert')
	).toBeVisible();
	expect(gateway.postedConfigs).toHaveLength(0);
});

test('scope selection explains the flow and mobile detail remains inside the screen', async ({
	page
}) => {
	await mockGateway(page, base);
	await page.route('**/api/policy/packs', route =>
		route.fulfill({
			json: { packs: [{ id: 'REVIEW', label: '시험 팩', description: 'fixture', card_count: 1 }] }
		})
	);
	await page.route('**/api/policy/compile', route => route.fulfill({ json: plan }));
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/policy-import');
	await expect(page.getByLabel('정책 검토 진행 순서')).toContainText('검토 범위 선택');
	await expect(page.getByLabel('정책 검토 진행 순서')).toContainText('정책별 판단과 근거');
	await page.getByRole('button', { name: '전체 팩 선택', exact: true }).click();
	await expect(page.getByRole('checkbox', { name: '시험 팩', exact: true })).toBeChecked();
	await page.getByRole('button', { name: '선택한 팩으로 설정 만들기', exact: true }).click();
	await page.getByRole('button', { name: 'REVIEW/NOTICE 정책 검토', exact: true }).click();
	const detail = page.getByRole('complementary', { name: '선택한 정책 상세 검토' });
	await expect(detail.getByText('이 정책이 요구하는 것', { exact: true })).toBeVisible();
	const bounds = await detail.boundingBox();
	expect(bounds).not.toBeNull();
	if (!bounds) throw new Error('Review detail is missing');
	expect(bounds.x).toBeGreaterThanOrEqual(0);
	expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
});

test('unavailable browser storage keeps review usable and reports non-fatal persistence failure', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.addInitScript(() => {
		Storage.prototype.setItem = () => {
			throw new DOMException('Quota exceeded', 'QuotaExceededError');
		};
	});
	await mockGateway(page, base);
	await openPlan(page);
	const row = await decide(page, 'REVIEW/NOTICE');
	await page.getByRole('button', { name: 'REVIEW/NOTICE 판단 기록 저장', exact: true }).click();
	await expect(row).toHaveAttribute('data-readiness-status', 'configured');
	await expect(
		page.getByText('이 브라우저에 검토 기록을 저장하지 못했습니다.', { exact: false })
	).toBeVisible();
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: '판단·검증 기록 저장', exact: true }).click();
	const file = await download;
	const filePath = await file.path();
	if (!filePath) throw new Error('Downloaded review was not saved');
	expect(JSON.parse(readFileSync(filePath, 'utf8')).reviews['REVIEW/NOTICE'].reviewer).toBe(
		'시험 담당자'
	);
	expect(errors).toEqual([]);
});

test('real 3-pack fixture exposes all 24 unknown cards and blocks writes despite compile success', async ({
	page
}) => {
	const full = JSON.parse(
		readFileSync(
			new URL('../fixtures/policy_readiness_full_plan.json', import.meta.url),
			'utf8'
		)
	);
	const gateway = await mockGateway(page, {
		...base,
		llm: {
			gateways: ['default'],
			models: [{ name: 'review-model', provider: 'openAI', params: { model: 'review-model' } }]
		}
	});
	await openPlan(page, full);
	await page.getByRole('checkbox', { name: '수동 연결 모드', exact: true }).uncheck();
	await expect(page.locator('[data-readiness-key]')).toHaveCount(24);
	await expect(page.locator('[data-readiness-status="unknown"]')).toHaveCount(24);
	await expect(page.getByRole('button', { name: '설정 검사 후 적용', exact: true })).toBeDisabled();
	await expect(
		page.getByRole('button', { name: '검토용 YAML 내려받기', exact: true })
	).toBeEnabled();
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: '적용 상태 보고서 저장', exact: true }).click();
	const file = await download;
	const filePath = await file.path();
	if (!filePath) throw new Error('Downloaded report was not saved');
	const content = JSON.parse(readFileSync(filePath, 'utf8'));
	expect(content.cards).toHaveLength(24);
	expect(content.releaseReady).toBe(false);
	expect(content.counts.unknown).toBe(24);
	expect(gateway.postedConfigs).toHaveLength(0);
	await page
		.getByRole('heading', { name: '적용 판단과 검증 상태', exact: true })
		.scrollIntoViewIfNeeded();
	await page.screenshot({ path: 'test-output/policy-readiness-full-packs.png', fullPage: false });
});

test('judgment, evidence and actual choice are distinct; a saved proof can expire', async ({
	page
}) => {
	const gateway = await mockGateway(page, base);
	await openPlan(page);
	const row = await decide(page, 'REVIEW/NOTICE');
	await page.getByLabel('REVIEW/NOTICE 판단 근거', { exact: true }).fill('');
	await page.getByRole('button', { name: 'REVIEW/NOTICE 판단 기록 저장', exact: true }).click();
	await expect(
		page.getByRole('complementary', { name: '선택한 정책 상세 검토' }).getByRole('alert')
	).toContainText('근거');
	await page.getByLabel('REVIEW/NOTICE 판단 근거', { exact: true }).fill('test://review/scope');
	await page.getByRole('button', { name: 'REVIEW/NOTICE 판단 기록 저장', exact: true }).click();
	await expect(row).toHaveAttribute('data-readiness-status', 'configured');
	await expect(page.getByRole('button', { name: '설정 검사 후 적용', exact: true })).toBeDisabled();
	await page.getByLabel('REVIEW/NOTICE 검증 방법', { exact: true }).selectOption('gateway');
	await page
		.getByLabel('REVIEW/NOTICE 검증 증거', { exact: true })
		.fill('test://runtime/synthetic-candidate-header-observed');
	await page.getByRole('button', { name: 'REVIEW/NOTICE 판단 기록 저장', exact: true }).click();
	await expect(row).toHaveAttribute('data-readiness-status', 'verified');
	await expect(page.getByRole('button', { name: '설정 검사 후 적용', exact: true })).toBeEnabled();
	await page.getByRole('checkbox', { name: '수동 연결 모드', exact: true }).uncheck();
	await page.getByRole('switch', { name: 'AI 생성 표시 적용', exact: true }).click();
	await expect(row).toHaveAttribute('data-readiness-status', 'stale');
	await expect(page.getByRole('button', { name: '설정 검사 후 적용', exact: true })).toBeDisabled();
	expect(gateway.postedConfigs).toHaveLength(0);
});

test('not-applicable judgment keeps the card visible and does not permit zero-control writes', async ({
	page
}) => {
	const gateway = await mockGateway(page, base);
	await openPlan(page);
	const row = await decide(page, 'REVIEW/NOTICE', 'not_applicable');
	await page.getByRole('button', { name: 'REVIEW/NOTICE 판단 기록 저장', exact: true }).click();
	await expect(row).toHaveAttribute('data-readiness-status', 'not_applicable');
	await expect(row).toContainText('이번 기능 선택 제외');
	await expect(page.getByRole('button', { name: '설정 검사 후 적용', exact: true })).toBeDisabled();
	expect(gateway.postedConfigs).toHaveLength(0);
});

test('verified candidate uses the existing file apply path, without an automatic legal verdict', async ({
	page
}) => {
	const gateway = await mockGateway(page, base);
	await openPlan(page);
	await decide(page, 'REVIEW/NOTICE');
	await page.getByLabel('REVIEW/NOTICE 검증 방법', { exact: true }).selectOption('gateway');
	await page
		.getByLabel('REVIEW/NOTICE 검증 증거', { exact: true })
		.fill('test://runtime/synthetic-candidate');
	await page.getByRole('button', { name: 'REVIEW/NOTICE 판단 기록 저장', exact: true }).click();
	await page.getByRole('button', { name: '설정 검사 후 적용', exact: true }).click();
	await expect(
		page.getByText('정책 설정을 적용했습니다. 실제 요청으로 동작을 확인해 주세요.', { exact: true })
	).toBeVisible();
	expect(gateway.postedConfigs).toHaveLength(1);
	expect(gateway.postedConfigs[0].routes).toMatchObject([{ backends: base.routes[0].backends }]);
	await expect(page.getByText('법률 준수 완료', { exact: true })).toHaveCount(0);
});
