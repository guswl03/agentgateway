/// <reference types="node" />

import { Buffer } from 'node:buffer';
import { expect, type Page, test } from '@playwright/test';

import { bareConfig, mockGateway } from './fixtures';

const policy = {
	law_id: 'TEST',
	policy_id: 'FIELD',
	policy_text: '테스트용 요청 필드 삭제',
	applies_when: null,
	scope: null,
	function_combination: 'all',
	except: [],
	legal_sources: [{ law_name: '테스트 법령', provision: '제1조' }],
	function: [
		{
			function_id: 'AGW-BODY-HEADER-TRANSFORM-REQUEST',
			action: 'remove_field',
			object: 'DATA_FIELD',
			traffic: 'http',
			direction: 'request',
			parameters: { body_location: 'root_json' },
			target: { mappings: [{ element_paths: ['Patient.birthDate'] }] }
		}
	]
};
const plan = {
	version: '1.1-draft',
	policy_packs: [{ pack_id: 'ANY_PACK', version: '1', priority: 10, policies: [policy] }]
};
const base = {
	...bareConfig(),
	gateways: { default: { port: 8080 } },
	routes: [{ name: 'FHIR 서비스', backends: [{ host: 'localhost:9000' }] }]
};

async function openCardSettings(page: Page, key: string, withScope = false) {
	const card = page.locator(`.policy-card[data-policy-key="${key}"]`);
	const editor = card.locator(':scope > .policy-card-editor');
	if ((await editor.getAttribute('open')) === null)
		await editor.locator(':scope > summary').click();
	await expect(editor).toHaveAttribute('data-active', 'true');
	if (withScope) {
		const scope = card.locator('.policy-card-scope');
		if ((await scope.getAttribute('open')) === null)
			await scope.locator(':scope > summary').click();
	}
}

async function registerReview(page: Page, key: string) {
	const row = page.locator(`[data-readiness-key="${key}"]`);
	await row.getByRole('button', { name: `${key} 정책 검토`, exact: true }).click();
	await page.getByRole('button', { name: `${key} 적용`, exact: true }).click();
	await page.getByLabel(`${key} 판단 담당자`, { exact: true }).fill('Synthetic reviewer');
	await page.getByLabel(`${key} 판단 이유`, { exact: true }).fill('Synthetic fixture scope');
	await page.getByLabel(`${key} 판단 근거`, { exact: true }).fill('test://scope');
	await page.getByLabel(`${key} 검증 방법`, { exact: true }).selectOption('gateway');
	await page
		.getByLabel(`${key} 검증 증거`, { exact: true })
		.fill('test://synthetic-candidate-observation');
	await page.getByRole('button', { name: `${key} 판단 기록 저장`, exact: true }).click();
}

for (const failure of [false, true]) {
	test(`hybrid DB route is visible and ${failure ? 'stale candidate is rejected' : 'policies are saved without file writes'}`, async ({
		page
	}) => {
		const gateway = await mockGateway(page, base);
		const file = { ...bareConfig(), gateways: base.gateways };
		await page.route('**/api/config', route => route.fulfill({ json: file }));
		await page.route('**/api/runtime', route =>
			route.fulfill({ json: { ui: { gatewayMode: 'standalone', configStoreMode: 'hybrid' } } })
		);
		let batch: any;
		await page.route('**/api/config/resources', route => {
			if (route.request().method() === 'PUT') {
				batch = route.request().postDataJSON();
				return route.fulfill({
					status: failure ? 409 : 200,
					json: failure
						? { message: 'Configuration changed; refresh before applying policies' }
						: { resources: batch.resources }
				});
			}
			return route.fulfill({
				json: {
					resources: [
						{ kind: 'traffic.route', id: base.routes[0].name, value: base.routes[0], revision: 1 }
					]
				}
			});
		});
		await page.goto('/policy-import');
		await page.getByRole('checkbox', { name: '수동 연결 모드', exact: true }).check();
		await page.getByText('JSON 직접 붙여넣기').click();
		const card = {
			...policy,
			applies_when: { constant: true },
			function: [
				{
					...policy.function[0],
					parameters: { paths: ['birthDate'], body_location: 'root_json', resource_type: 'Patient' }
				}
			]
		};
		await page
			.getByLabel('커넥터 JSON')
			.fill(
				JSON.stringify({ ...plan, policy_packs: [{ ...plan.policy_packs[0], policies: [card] }] })
			);
		await expect(page.getByText('기존 경로가 없습니다', { exact: true })).toHaveCount(0);
		await expect(page.getByLabel('TEST/FIELD 적용 경로')).toHaveValue('route:0');
		await registerReview(page, 'TEST/FIELD');
		await page.getByRole('button', { name: '설정 검사 후 적용' }).click();
		await expect(
			page.getByText(
				failure ? /처리 실패:/ : '정책 설정을 적용했습니다. 실제 요청으로 동작을 확인해 주세요.'
			)
		).toBeVisible();
		expect(batch.expectedConfig).toEqual(base);
		expect(batch.resources).toHaveLength(1);
		expect(batch.resources[0].kind).toBe('traffic.route');
		expect(batch.resources[0].value.backends).toEqual(base.routes[0].backends);
		expect(batch.resources[0].value.policies.transformations.request.body).toContain('birthDate');
		expect(gateway.postedConfigs).toHaveLength(0);
	});
}

test('pack selection invokes connector and feeds the existing adapter', async ({ page }) => {
	await mockGateway(page, base);
	await page.route('**/api/policy/packs', route =>
		route.fulfill({
			json: {
				packs: [
					{ id: 'ANY_PACK', label: '범용 테스트 팩', description: '동일 계약의 팩', card_count: 1 }
				]
			}
		})
	);
	let selected: unknown;
	await page.route('**/api/policy/compile', route => {
		selected = route.request().postDataJSON();
		return route.fulfill({ json: plan });
	});
	await page.goto('/policy-import');
	await page.getByRole('checkbox', { name: '수동 연결 모드', exact: true }).check();
	await page.getByLabel('범용 테스트 팩').check();
	await page.getByRole('button', { name: '선택한 팩으로 설정 만들기' }).click();
	await expect(page.locator('.policy-card').getByText('테스트 법령 · 제1조')).toBeVisible();
	expect(selected).toEqual({ pack_ids: ['ANY_PACK'], documents: [] });
	await expect(page.getByRole('button', { name: '중간 JSON 내려받기' })).toBeVisible();
	await expect(page.getByRole('button', { name: '설정 검사 후 적용' })).toBeDisabled();
});

test('full law packs show all card counts and compile without uploading files', async ({
	page
}) => {
	await mockGateway(page, base);
	const fullPacks = [
		{ id: 'KR_AI_BASIC_ACT_GATEWAY_ONLY_PACK', label: 'AI기본법 · 전체 팩', card_count: 8 },
		{ id: 'KR_MEDICAL_ACT_GATEWAY_ONLY_PACK', label: '의료법 · 전체 팩', card_count: 5 },
		{ id: 'KR_PIPA_GATEWAY_ONLY_PACK', label: '개인정보보호법 · 전체 팩', card_count: 11 }
	];
	const retainedPacks = [
		{ id: 'KR_PIPA_SAMPLE_PACK', label: '개인정보 보호법 · 임시 3카드', card_count: 3 },
		{ id: 'KR_AI_BASIC_ACT_SAMPLE_PACK', label: '인공지능 기본법 · 임시 3카드', card_count: 3 },
		{
			id: 'CODEX_AI_DISCLOSURE_TEST_PACK',
			label: 'AI 생성 표시 · Codex / LLM 채팅 요청 지시 테스트',
			card_count: 1
		}
	];
	await page.route('**/api/policy/packs', route =>
		route.fulfill({
			json: {
				packs: [...fullPacks, ...retainedPacks].map(pack => ({
					...pack,
					description: '같은 카드 계약을 사용하는 테스트 팩'
				}))
			}
		})
	);
	let selected: unknown;
	await page.route('**/api/policy/compile', route => {
		selected = route.request().postDataJSON();
		return route.fulfill({
			json: {
				...plan,
				policy_packs: fullPacks.map((pack, packIndex) => ({
					pack_id: pack.id,
					version: '1',
					priority: (fullPacks.length - packIndex) * 10,
					policies: Array.from({ length: pack.card_count }, (_, cardIndex) => ({
						...policy,
						policy_id: `FULL_${packIndex}_${cardIndex}`
					}))
				}))
			}
		});
	});
	await page.goto('/policy-import');
	await page.getByRole('checkbox', { name: '수동 연결 모드', exact: true }).check();
	await expect(page.locator('.policy-pack-option')).toHaveCount(6);
	for (const pack of fullPacks) {
		const option = page.locator('.policy-pack-option').filter({ hasText: pack.label });
		await expect(option.getByText(pack.label, { exact: true })).toBeVisible();
		await expect(option.locator('small')).toContainText(`${pack.card_count}개 정책`);
		await page.getByLabel(pack.label).check();
	}
	for (const pack of retainedPacks) {
		await expect(page.getByLabel(pack.label)).not.toBeChecked();
	}
	await page.getByRole('button', { name: '선택한 팩으로 설정 만들기' }).click();
	await expect(page.locator('.policy-card')).toHaveCount(24);
	await expect(
		page.getByText('3개 팩 · 24개 카드. 포트와 기존 목적지는 유지합니다.')
	).toBeVisible();
	for (let packIndex = 0; packIndex < fullPacks.length; packIndex++) {
		await expect(page.getByLabel(`TEST/FULL_${packIndex}_0 적용 경로`)).toHaveValue('route:0');
	}
	expect(selected).toEqual({ pack_ids: fullPacks.map(pack => pack.id), documents: [] });
	await expect(page.getByRole('button', { name: '중간 JSON 내려받기' })).toBeVisible();
	await expect(page.getByRole('button', { name: '설정 검사 후 적용' })).toBeDisabled();
});

test('removal backs up config and clears only selected transformations', async ({ page }) => {
	const original = {
		...base,
		routes: [
			{
				...base.routes[0],
				policies: {
					transformations: { request: { body: '"old"' } },
					authorization: { rules: [{ require: 'true' }] }
				}
			}
		]
	};
	const gateway = await mockGateway(page, original);
	await page.goto('/policy-import');
	await page.getByRole('checkbox', { name: '수동 연결 모드', exact: true }).check();
	await page.getByText('기존 정책 변환 정리').click();
	await page.getByLabel('기존 변환 제거 경로').selectOption('route:0');
	const downloaded = page.waitForEvent('download');
	await page.getByRole('button', { name: '기존 본문·헤더 변환 제거' }).click();
	expect((await downloaded).suggestedFilename()).toBe('gateway-before-policy-removal.json');
	await expect(
		page.getByText('기존 본문·헤더 변환을 제거했습니다. 새 정책 팩을 적용할 수 있습니다.')
	).toBeVisible();
	const route = (gateway.postedConfigs[0].routes as any[])[0];
	expect(route.policies.transformations).toBeUndefined();
	expect(route.backends).toEqual(base.routes[0].backends);
	expect(route.policies.authorization).toEqual(original.routes[0].policies.authorization);
});

test('only missing information is shown and chosen fields can be applied', async ({ page }) => {
	const gateway = await mockGateway(page, base);
	await page.goto('/policy-import');
	await page.getByRole('checkbox', { name: '수동 연결 모드', exact: true }).check();
	await page.getByText('JSON 직접 붙여넣기').click();
	await page.getByLabel('커넥터 JSON').fill(JSON.stringify(plan));
	await expect(page.getByRole('button', { name: '설정 검사 후 적용' })).toBeDisabled();
	await expect(page.getByLabel('TEST/FIELD 적용 경로')).toHaveValue('route:0');
	await openCardSettings(page, 'TEST/FIELD', true);
	await page.getByLabel('TEST/FIELD 적용 경로').selectOption('all');
	await expect(page.locator('.policy-card').getByText('테스트 법령 · 제1조')).toBeVisible();
	await page.getByLabel('TEST/FIELD 적용 조건', { exact: true }).selectOption('always');
	await page.getByLabel('TEST/FIELD 리소스 종류').selectOption('Patient');
	await page.getByLabel('TEST/FIELD 삭제 필드 birthDate').check();
	await expect(page.locator('.policy-card input:not([type=checkbox])')).toHaveCount(0);
	await expect(page.getByText('연결 기능: 요청 · 본문 변환 → 지정 필드 삭제')).toBeVisible();
	await expect(page.getByLabel('FHIR/JSON이 요청 본문 자체에 있습니다')).toBeChecked();
	await registerReview(page, 'TEST/FIELD');
	await expect(page.getByRole('button', { name: '설정 검사 후 적용' })).toBeEnabled();
	await page.screenshot({ path: 'test-output/policy-import-desktop.png', fullPage: true });
	await page.getByRole('button', { name: '설정 검사 후 적용' }).click();
	await expect(
		page.getByText('정책 설정을 적용했습니다. 실제 요청으로 동작을 확인해 주세요.')
	).toBeVisible();
	expect(gateway.postedConfigs).toHaveLength(1);
	const route = (gateway.postedConfigs[0].routes as Array<Record<string, any>>)[0];
	expect(route.backends).toEqual(base.routes[0].backends);
	expect(route.policies.transformations.request.body).toContain('birthDate');
});

test('header and request condition use choices without text entry', async ({ page }) => {
	await mockGateway(page, base);
	const headerPolicy = {
		...policy,
		policy_id: 'HEADER',
		function: [
			{
				function_id: 'AGW-BODY-HEADER-TRANSFORM-RESPONSE',
				action: 'set_header',
				object: 'AI_OUTPUT',
				traffic: 'http',
				direction: 'response',
				parameters: {},
				target: { mappings: [] }
			}
		]
	};
	await page.goto('/policy-import');
	await page.getByRole('checkbox', { name: '수동 연결 모드', exact: true }).check();
	await page.getByText('JSON 직접 붙여넣기').click();
	await page.getByLabel('커넥터 JSON').fill(
		JSON.stringify({
			...plan,
			policy_packs: [{ ...plan.policy_packs[0], policies: [headerPolicy] }]
		})
	);
	await openCardSettings(page, 'TEST/HEADER', true);
	await page
		.getByLabel('TEST/HEADER 적용 조건', { exact: true })
		.selectOption({ label: 'POST 요청에 적용' });
	await page
		.getByLabel('TEST/HEADER 헤더 설정')
		.selectOption({ label: 'AI 생성 표시 · x-ai-generated: true' });
	await registerReview(page, 'TEST/HEADER');
	await expect(page.getByRole('button', { name: '설정 검사 후 적용' })).toBeEnabled();
	await expect(page.locator('.policy-card input:not([type=checkbox])')).toHaveCount(0);
	await expect(page.getByText('Gateway 기능: 응답 · 헤더 변환 → 값 설정')).toBeVisible();
});

test('saved bindings permit review download but do not bypass applicability review', async ({
	page
}) => {
	await mockGateway(page, base);
	await page.addInitScript(() =>
		localStorage.setItem(
			'agentgateway.policy-import.profile.v1',
			JSON.stringify({
				version: 1,
				bindings: {
					'TEST/FIELD': {
						condition: { constant: true },
						functions: {
							'0': { paths: ['birthDate'], body_location: 'root_json', resource_type: 'Patient' }
						}
					}
				}
			})
		)
	);
	await page.goto('/policy-import');
	await page.getByRole('checkbox', { name: '수동 연결 모드', exact: true }).check();
	await page.getByLabel('정책 JSON 파일').setInputFiles({
		name: 'plan.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(plan))
	});
	await expect(page.getByRole('button', { name: '설정 검사 후 적용' })).toBeDisabled();
	await expect(page.getByRole('button', { name: '검토용 YAML 내려받기' })).toBeEnabled();
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: '검토용 YAML 내려받기' }).click();
	expect((await download).suggestedFilename()).toBe('policy-config-review-only.yaml');
});

test('invalid input cannot apply stale config and mobile page remains usable', async ({ page }) => {
	await mockGateway(page, base);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/policy-import');
	await page.getByRole('checkbox', { name: '수동 연결 모드', exact: true }).check();
	await page.getByText('JSON 직접 붙여넣기').click();
	await page.getByLabel('커넥터 JSON').fill('{bad');
	await expect(page.getByText('파일을 확인해 주세요')).toBeVisible();
	await expect(page.getByRole('button', { name: '설정 검사 후 적용' })).toHaveCount(0);
	await page.screenshot({ path: 'test-output/policy-import-mobile.png', fullPage: true });
});
