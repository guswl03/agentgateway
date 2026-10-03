import { dump } from 'js-yaml';
import { useEffect, useMemo, useRef, useState } from 'react';

import { PolicyNativeSetup } from '@/components/PolicyNativeSetup';
import { PolicyPackPicker } from '@/components/PolicyPackPicker';
import { PolicyReadiness } from '@/components/PolicyReadiness';
import { PolicySettingsRemoval } from '@/components/PolicySettingsRemoval';
import { PolicySharedInputs } from '@/components/PolicySharedInputs';
import { PageHeader, Panel, StatusBanner } from '@/components/Primitives';
import { validateGatewayConfig } from '@/configValidation';
import { useApplyPolicyConfig, useEffectiveGatewayConfig, useRuntimeInfo } from '@/hooks';
import type { ImportProfile, JsonObject, PolicyBinding } from '@/policyAdapter';
import {
	adaptPolicyPlan,
	parsePolicyPlan,
	parseProfile,
	policyFingerprint,
	policyKey,
	policyTargets,
	regexTargetSupported,
	targetFingerprint
} from '@/policyAdapter';
import {
	builtinRegexChoices,
	conditionChoices,
	fieldChoices,
	functionMatch,
	nativePolicyChoices
} from '@/policyChoices';
import { applyFhirDefaults, FHIR_KEEP_OPTIONS, validateFhirFilterProfile } from '@/policyFhir';
import { canEditNativeSetup } from '@/policyNativeSetup';
import { applyQuickGroupFunction, buildQuickProfile, quickFeatureGroups } from '@/policyQuick';
import {
	assertPolicyReadiness,
	evaluatePolicyReadiness,
	parseReviewProfile,
	type ReviewDraft,
	type ReviewProfile,
	recordPolicyReview,
	reviewStorageKey
} from '@/policyReadiness';
import {
	collectSharedPresets,
	existingTargetChoices,
	parseSharedPresets,
	type SharedPresets,
	sharedFunctionGroups
} from '@/policyShared';
import '@/styles/policy-import.css';

const profileStorageKey = 'agentgateway.policy-import.profile.v1';
const sharedStorageKey = 'agentgateway.policy-import.shared.v1';
function savedSharedPresets(): SharedPresets {
	try {
		const value = localStorage.getItem(sharedStorageKey);
		return value ? parseSharedPresets(value) : { version: 1, entries: [] };
	} catch {
		return { version: 1, entries: [] };
	}
}
function savedProfile(): ImportProfile {
	try {
		const value = localStorage.getItem(profileStorageKey);
		return value ? parseProfile(value) : { version: 1, bindings: {} };
	} catch {
		return { version: 1, bindings: {} };
	}
}
function savedReviews(): ReviewProfile {
	try {
		const value = localStorage.getItem(reviewStorageKey);
		return value ? parseReviewProfile(value) : { version: 1, reviews: {} };
	} catch {
		return { version: 1, reviews: {} };
	}
}
function download(name: string, content: string, type: string) {
	const url = URL.createObjectURL(new Blob([content], { type }));
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = name;
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const actionNames: Record<string, string> = {
	remove_field: '요청 필드 삭제',
	set_header: '헤더 값 설정',
	rewrite_body: '본문 표시',
	log_access: '접속기록',
	trace: '처리 경로 추적',
	authorize_require: '승인된 요청만 허용',
	require_jwt: 'JWT 필수 인증',
	reject: '텍스트 거절',
	mask: '텍스트 치환',
	rate_limit: '요청 횟수 제한',
	limit_requests: '요청 횟수 제한',
	route_to_backend: '승인된 목적지로 전달'
};

function responseInspectionNotice(fn: JsonObject, values: JsonObject): string {
	if (fn.function_id !== 'AGW-REGEX-GUARD-RESPONSE') return '';
	if (fn.action === 'mask')
		return '응답 마스킹은 SSE 스트리밍을 지원하지 않습니다. stream: true 요청을 차단하며 클라이언트는 비스트리밍으로 요청해야 합니다.';
	return values.response_mode === 'streaming_partial'
		? '부분 스트림 검사는 이미 전달한 응답을 회수하지 못합니다. 전체 내용의 노출 방지를 보장하지 않습니다.'
		: '비스트리밍 검사에서는 stream: true 요청을 차단합니다. 전체 응답을 받은 뒤 검사합니다.';
}
function effectiveFunctionMatch(fn: JsonObject, values: JsonObject): string {
	return fn.action === 'remove_field' && values.body_location === 'request_fhir'
		? '요청 · 본문 변환 → FHIR 데이터 필터'
		: functionMatch(fn);
}
function policyFunctions(policy: JsonObject): JsonObject[] {
	return Array.isArray(policy.function) ? policy.function : [];
}
function policyFunctionMatches(policy: JsonObject, profile: ImportProfile): string {
	const binding = profile.bindings[policyKey(policy)] ?? {};
	return policyFunctions(policy)
		.map((fn: JsonObject, index: number) =>
			effectiveFunctionMatch(fn, {
				...binding.functions?.[String(index)],
				...fn.parameters
			})
		)
		.join(' / ');
}

export function PolicyImportPage() {
	const config = useEffectiveGatewayConfig();
	const runtime = useRuntimeInfo();
	const update = useApplyPolicyConfig(true);
	const [source, setSource] = useState('');
	const [profile, setProfile] = useState<ImportProfile>(savedProfile);
	const [reviews, setReviews] = useState<ReviewProfile>(savedReviews);
	const [reviewStorageError, setReviewStorageError] = useState('');
	const [sharedPresets, setSharedPresets] = useState<SharedPresets>(savedSharedPresets);
	const [compact, setCompact] = useState(true);
	const [manual, setManual] = useState(false);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [activePolicy, setActivePolicy] = useState<string | null>(null);
	const [quickEditor, setQuickEditor] = useState<string | null>(null);
	const quickEditorRef = useRef<HTMLElement>(null);
	const existingSettingsRef = useRef<HTMLDivElement>(null);
	const [scopeOpen, setScopeOpen] = useState<Record<string, boolean>>({});
	const [message, setMessage] = useState('');
	const [busy, setBusy] = useState(false);
	const [remember, setRemember] = useState(true);
	const state = useMemo(() => {
		if (!source.trim()) return { plan: null, result: null, error: '' };
		try {
			const plan = parsePolicyPlan(source);
			const effectiveProfile = config.data
				? manual
					? applyFhirDefaults(plan, profile, config.data)
					: buildQuickProfile(plan, config.data, profile)
				: profile;
			return {
				plan,
				effectiveProfile,
				result: config.data ? adaptPolicyPlan(plan, config.data, effectiveProfile) : null,
				error: ''
			};
		} catch (error) {
			return { plan: null, result: null, error: (error as Error).message };
		}
	}, [source, profile, config.data, manual]);
	const effectiveProfile = state.effectiveProfile ?? profile;
	const targets = config.data ? policyTargets(config.data) : [];
	const writable = ['file', 'hybrid'].includes(runtime.data?.ui.configStoreMode ?? '');
	const policies: JsonObject[] =
		state.plan?.policy_packs.flatMap((p: JsonObject) => p.policies) ?? [];
	const active = policies.filter(
		policy => effectiveProfile.bindings[policyKey(policy)]?.enabled !== false
	);
	const technicalReady = Boolean(
		active.length &&
			active.every(policy => policyFunctions(policy).length) &&
			state.result &&
			!state.result.findings.length
	);
	const readiness =
		state.plan && config.data && state.result
			? evaluatePolicyReadiness(state.plan, config.data, effectiveProfile, reviews, state.result)
			: null;
	const ready = Boolean(technicalReady && readiness?.releaseReady);
	const quickGroups =
		state.plan && config.data && !manual
			? quickFeatureGroups(state.plan, config.data, effectiveProfile)
			: [];
	const deferredGroups = quickGroups.filter(group => !group.ready && !group.enabledCount);
	const visibleGroups = quickGroups.filter(group => !deferredGroups.includes(group));
	const repeatedGroups =
		state.plan && config.data
			? sharedFunctionGroups(state.plan, config.data, effectiveProfile).filter(
					group => group.members.length > 1 && group.missingFields.length > 0
				)
			: [];
	const completed = active.filter(
		policy => !state.result?.findings.some(finding => finding.policy === policyKey(policy))
	);
	const setupKeys = active
		.filter(policy =>
			state.result?.findings.some(
				finding => finding.policy === policyKey(policy) && finding.kind !== 'conflict'
			)
		)
		.map(policyKey);
	const mergeFindings = state.result?.findings.filter(finding => finding.kind === 'conflict') ?? [];
	const applied =
		update.isSuccess && message === '정책 설정을 적용했습니다. 실제 요청으로 동작을 확인해 주세요.';
	useEffect(() => {
		if (!remember) {
			setReviewStorageError('');
			return;
		}
		try {
			localStorage.setItem(reviewStorageKey, JSON.stringify(reviews));
			setReviewStorageError('');
		} catch {
			setReviewStorageError(
				'이 브라우저에 검토 기록을 저장하지 못했습니다. 현재 화면의 입력은 유지됩니다. 화면을 닫기 전에 판단·검증 기록 저장 버튼으로 파일을 보관해 주세요.'
			);
		}
	}, [reviews, remember]);
	useEffect(() => {
		if (!quickEditor) return;
		const editor = quickEditorRef.current;
		editor?.scrollIntoView({ block: 'nearest' });
		const input = editor?.querySelector<HTMLElement>(
			'select:not([disabled]), input:not([disabled])'
		);
		(input ?? editor?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
	}, [quickEditor]);
	function resetCardEditors() {
		setActivePolicy(null);
		setScopeOpen({});
		setDetailsOpen(false);
		setQuickEditor(null);
	}
	function updateProfile(next: ImportProfile) {
		setMessage('');
		update.reset();
		setProfile(next);
	}
	function change(key: string, patch: Partial<PolicyBinding>) {
		setMessage('');
		update.reset();
		const target =
			patch.target ??
			effectiveProfile.bindings[key]?.target ??
			(targets.length === 1 ? targets[0].id : undefined);
		if (target && config.data) {
			patch.target = target;
			if (
				patch.targetFingerprint === undefined &&
				(patch.target !== effectiveProfile.bindings[key]?.target ||
					!effectiveProfile.bindings[key]?.targetFingerprint)
			)
				patch.targetFingerprint = targetFingerprint(config.data, target);
		}
		setProfile({
			...effectiveProfile,
			bindings: {
				...effectiveProfile.bindings,
				[key]: { ...effectiveProfile.bindings[key], ...patch }
			}
		});
	}
	function editCard(key: string) {
		setQuickEditor(null);
		setDetailsOpen(true);
		setActivePolicy(key);
		setScopeOpen(current => ({ ...current, [key]: true }));
	}
	function saveReview(key: string, draft: ReviewDraft) {
		if (!state.plan || !config.data || !state.result) throw new Error('설정을 먼저 불러와 주세요.');
		const policy = policies.find(item => policyKey(item) === key);
		if (!policy) throw new Error('현재 계획에 없는 카드입니다.');
		const nextProfile = structuredClone(effectiveProfile);
		if (
			draft.applicability === 'not_applicable' ||
			(draft.applicability === 'applicable' &&
				['external', 'alternative'].includes(draft.verification))
		)
			nextProfile.bindings[key] = { ...nextProfile.bindings[key], enabled: false };
		const result = adaptPolicyPlan(state.plan, config.data, nextProfile);
		const record = recordPolicyReview(state.plan, policy, config.data, nextProfile, result, draft);
		updateProfile(nextProfile);
		setReviews(current => ({ version: 1, reviews: { ...current.reviews, [key]: record } }));
	}
	function toggleCards(keys: string[], enabled: boolean) {
		const next = structuredClone(effectiveProfile);
		for (const key of keys) next.bindings[key] = { ...next.bindings[key], enabled };
		updateProfile(next);
		if (enabled) {
			const missing = quickGroups
				.flatMap(group => group.members)
				.find(member => keys.includes(member.key) && !member.ready);
			if (missing) setQuickEditor(missing.key);
		} else if (quickEditor && keys.includes(quickEditor)) {
			setQuickEditor(null);
		}
	}
	function quickRow(group: (typeof quickGroups)[number]) {
		const first = policies.find(policy => policyKey(policy) === group.keys[0]);
		const binding = effectiveProfile.bindings[group.keys[0]];
		const label = first
			? policyFunctions(first)
					.map((fn, index) => {
						const values = { ...binding?.functions?.[String(index)], ...fn.parameters };
						if (fn.action === 'set_header' && String(values.header).toLowerCase() === 'link')
							return '설명 링크 전달';
						if (fn.action === 'set_header' && values.header === 'x-ai-generated')
							return 'AI 생성 표시';
						const name = actionNames[fn.action] ?? functionMatch(fn);
						return /^AGW-REGEX-GUARD-/.test(fn.function_id)
							? `${fn.direction === 'response' ? '응답' : '요청'} ${name}`
							: name;
					})
					.join(' + ') || '기능 분류 필요'
			: group.label;
		const scope =
			binding?.target === 'all'
				? '모든 기존 경로'
				: (targets.find(target => target.id === binding?.target)?.label ?? '경로 설정 필요');
		const checked = group.enabledCount === group.count;
		const editorPolicy = policies.find(
			policy => policyKey(policy) === quickEditor && group.keys.includes(policyKey(policy))
		);
		const needsInput = group.keys.some(key => setupKeys.includes(key));
		const streamImpact =
			first &&
			policyFunctions(first).some((fn, index) => {
				const selected = binding?.selectedFunctions;
				if (selected && !selected.includes(index)) return false;
				const values = { ...binding?.functions?.[String(index)], ...fn.parameters };
				return (
					fn.function_id === 'AGW-REGEX-GUARD-RESPONSE' &&
					(fn.action === 'mask' || values.response_mode !== 'streaming_partial')
				);
			});
		return (
			<details
				className="policy-quick-row"
				key={JSON.stringify(group.keys)}
				open={editorPolicy ? true : undefined}
			>
				<summary>
					<span className="policy-quick-name">
						<strong>{label}</strong>
						<small>
							{group.count}개 카드 · {scope}
						</small>
						{group.ready && !group.enabledCount && group.reason && <small>{group.reason}</small>}
						{streamImpact && <small className="policy-stream-impact">스트리밍 요청 차단</small>}
					</span>
					<span className={`policy-pill ${group.ready ? 'ready' : ''}`}>
						{!group.ready
							? group.enabledCount && !needsInput && mergeFindings.length
								? '병합 확인'
								: '설정 필요'
							: group.enabledCount
								? checked
									? applied
										? '적용 완료'
										: '적용 예정'
									: '일부 선택'
								: '제외'}
					</span>
					<button
						type="button"
						role="switch"
						aria-checked={checked}
						aria-label={`${label} 적용`}
						className="policy-toggle"
						onClick={event => {
							event.preventDefault();
							event.stopPropagation();
							toggleCards(group.keys, !checked);
						}}
					>
						<span />
					</button>
				</summary>
				<div className="policy-quick-detail">
					{!editorPolicy && (
						<button
							type="button"
							className="button secondary"
							disabled={!group.enabledCount}
							onClick={() =>
								setQuickEditor(group.members.find(member => member.enabled)?.key ?? null)
							}
						>
							기능 설정
						</button>
					)}
					{editorPolicy && (
						<section className="policy-quick-setup" ref={quickEditorRef} aria-label="추가 설정">
							<div className="policy-section-title">
								<strong>필요한 내용만 설정</strong>
								<button
									type="button"
									className="button secondary"
									onClick={() => toggleCards(group.keys, false)}
								>
									이 기능 끄기
								</button>
							</div>
							<div className="policy-fields">
								{policyFunctions(editorPolicy).map((fn, index) => {
									const key = policyKey(editorPolicy);
									const selected = effectiveProfile.bindings[key]?.selectedFunctions;
									if (
										selected
											? !selected.includes(index)
											: editorPolicy.function_combination !== 'all' &&
												policyFunctions(editorPolicy).length > 1
									)
										return null;
									return (
										<FunctionParameters
											key={
												// biome-ignore lint/suspicious/noArrayIndexKey: Function indexes are stable identifiers in the intermediate contract.
												`${fn.function_id}-${index}`
											}
											config={config.data ?? {}}
											label={key}
											nativeLabel={`${key} 기능 ${index + 1}`}
											target={effectiveProfile.bindings[key]?.target}
											fn={fn}
											values={{
												...effectiveProfile.bindings[key]?.functions?.[String(index)],
												...fn.parameters
											}}
											onChange={patch => {
												if (!state.plan || !config.data) return;
												const result = applyQuickGroupFunction(
													state.plan,
													config.data,
													effectiveProfile,
													group.keys,
													key,
													index,
													patch
												);
												updateProfile(result.profile);
											}}
										/>
									);
								})}
							</div>
							<div className="button-row">
								<button
									type="button"
									className="button secondary"
									onClick={() => editCard(policyKey(editorPolicy))}
								>
									경로·조건 등 세부 설정
								</button>
								<button
									type="button"
									className="button secondary"
									onClick={() => setQuickEditor(null)}
								>
									닫기
								</button>
							</div>
						</section>
					)}
					{group.reason && <p className="policy-findings">{group.reason}</p>}
					{first &&
						policyFunctions(first).map((fn, index) => {
							const notice = responseInspectionNotice(fn, {
								...binding?.functions?.[String(index)],
								...fn.parameters
							});
							return notice ? (
								// biome-ignore lint/suspicious/noArrayIndexKey: Function indexes are stable identifiers in the intermediate contract.
								<p className="muted-copy" key={fn.function_id + index}>
									{notice}
								</p>
							) : null;
						})}
					<details className="policy-quick-laws">
						<summary>법령 근거 · 카드별 변경</summary>
						{group.members.map(member => (
							<div className="policy-quick-member" key={member.key}>
								<span>{member.label}</span>
								<button
									type="button"
									className="button secondary"
									aria-label={`${member.key} 세부 설정`}
									onClick={() => editCard(member.key)}
								>
									설정
								</button>
								<button
									type="button"
									role="switch"
									aria-checked={member.enabled}
									aria-label={`${member.key} 카드 적용`}
									className="policy-toggle"
									onClick={() => toggleCards([member.key], !member.enabled)}
								>
									<span />
								</button>
							</div>
						))}
					</details>
				</div>
			</details>
		);
	}
	function parameters(policy: JsonObject, index: number, patch: JsonObject) {
		const key = policyKey(policy),
			binding = effectiveProfile.bindings[key] ?? {};
		change(key, {
			functions: {
				...binding.functions,
				[String(index)]: { ...binding.functions?.[String(index)], ...patch }
			}
		});
	}
	async function finish(apply: boolean) {
		if (!state.result || !state.plan || !(apply ? ready : technicalReady) || !config.data) return;
		setBusy(true);
		setMessage('');
		try {
			if (apply)
				assertPolicyReadiness(
					state.plan,
					config.data,
					effectiveProfile,
					reviews,
					state.result.config
				);
			await validateGatewayConfig(state.result.config);
			if (apply) {
				await update.mutateAsync({
					before: config.data,
					after: state.result.config,
					reviewContext: { plan: state.plan, profile: effectiveProfile, reviews }
				});
				setMessage('정책 설정을 적용했습니다. 실제 요청으로 동작을 확인해 주세요.');
			} else {
				download(
					ready ? 'policy-config.yaml' : 'policy-config-review-only.yaml',
					dump(state.result.config, { noRefs: true, lineWidth: 100 }),
					'text/yaml'
				);
				setMessage(
					ready
						? '설정 검사를 통과한 YAML을 내려받았습니다.'
						: '검토용 YAML을 내려받았습니다. 적용 판단·실행 검증은 완료되지 않았습니다.'
				);
			}
			if (remember) {
				const saved = structuredClone(effectiveProfile);
				for (const policy of policies) {
					const key = policyKey(policy);
					if (saved.bindings[key]?.enabled === false) continue;
					const target =
						saved.bindings[key]?.target ??
						policy.scope?.target_ref ??
						(targets.length === 1 ? targets[0].id : undefined);
					saved.bindings[key] = {
						...saved.bindings[key],
						policyFingerprint: policyFingerprint(policy),
						...(target ? { target, targetFingerprint: targetFingerprint(config.data, target) } : {})
					};
				}
				localStorage.setItem(profileStorageKey, JSON.stringify(saved));
				const captured = collectSharedPresets(state.plan, config.data, saved);
				const entries = new Map(
					[...sharedPresets.entries, ...captured.entries].map(entry => [
						JSON.stringify([entry.groupIdentity, entry.target]),
						entry
					])
				);
				const nextShared: SharedPresets = { version: 1, entries: [...entries.values()] };
				localStorage.setItem(sharedStorageKey, JSON.stringify(nextShared));
				setSharedPresets(nextShared);
			}
		} catch (error) {
			setMessage(`처리 실패: ${(error as Error).message}`);
		} finally {
			setBusy(false);
		}
	}
	return (
		<div className="page-stack policy-import">
			<PageHeader
				title="정책 가져오기"
				description="법률의 요구사항을 우리 서비스의 실행 설정으로 연결합니다. 적용 이유와 이행 근거를 확인한 뒤 반영하세요."
				actions={
					<label className="policy-check policy-mode">
						<input
							type="checkbox"
							checked={manual}
							onChange={event => {
								setManual(event.target.checked);
								resetCardEditors();
							}}
						/>
						수동 연결 모드
					</label>
				}
			/>
			<ol className="policy-journey" aria-label="정책 검토 진행 순서">
				<li data-current={!state.plan}>
					<span className="policy-step-number">1</span>
					<div>
						<strong>검토 범위 선택</strong>
						<p>어떤 법률의 정책을 살펴볼지 정합니다.</p>
					</div>
				</li>
				<li data-current={Boolean(state.plan && !ready)}>
					<span className="policy-step-number">2</span>
					<div>
						<strong>정책별 판단과 근거</strong>
						<p>서비스 적용 여부와 실제 이행을 기록합니다.</p>
					</div>
				</li>
				<li data-current={ready}>
					<span className="policy-step-number">3</span>
					<div>
						<strong>설정 확인 후 적용</strong>
						<p>남은 작업을 해결하고 최종 설정을 반영합니다.</p>
					</div>
				</li>
			</ol>
			<Panel>
				<div className="policy-pack-stage">
					<h3>1. 검토할 정책 범위 선택</h3>
					<PolicyPackPicker
						onBegin={() => {
							setSource('');
							resetCardEditors();
							setMessage('');
							update.reset();
						}}
						onGenerated={plan => {
							setSource(JSON.stringify(plan, null, 2));
							resetCardEditors();
							setMessage(
								manual
									? '커넥터가 중간 JSON을 생성했습니다. 아래에서 설정을 확인하고 적용해 주세요.'
									: ''
							);
							update.reset();
						}}
					/>
				</div>
			</Panel>
			<Panel>
				<details className="policy-source-options" open={manual || undefined}>
					<summary>중간 JSON · 저장된 연결 정보</summary>
					<div className="policy-upload-row">
						<label className="button secondary">
							JSON 파일 선택
							<input
								aria-label="정책 JSON 파일"
								type="file"
								accept=".json,application/json"
								onChange={async event => {
									const file = event.target.files?.[0];
									if (file) {
										setSource(await file.text());
										resetCardEditors();
										setMessage('');
										update.reset();
									}
								}}
							/>
						</label>
						<label className="button secondary">
							저장된 연결 정보 가져오기
							<input
								aria-label="연결 정보 파일"
								type="file"
								accept=".json"
								onChange={async event => {
									const file = event.target.files?.[0];
									if (file) {
										try {
											setProfile(parseProfile(await file.text()));
											setMessage('연결 정보를 가져왔습니다.');
										} catch (error) {
											setMessage((error as Error).message);
										}
									}
								}}
							/>
						</label>
						<label className="button secondary">
							검토 기록 가져오기
							<input
								aria-label="검토 기록 파일"
								type="file"
								accept=".json"
								onChange={async event => {
									const file = event.target.files?.[0];
									if (!file) return;
									try {
										setReviews(parseReviewProfile(await file.text()));
										setMessage('검토 기록을 가져왔습니다. 현재 후보와 일치하는지 다시 확인합니다.');
										update.reset();
									} catch (error) {
										setMessage(`처리 실패: ${(error as Error).message}`);
									}
								}}
							/>
						</label>
					</div>
					<details>
						<summary>JSON 직접 붙여넣기</summary>
						<textarea
							aria-label="커넥터 JSON"
							rows={8}
							value={source}
							onChange={event => {
								setSource(event.target.value);
								resetCardEditors();
								setMessage('');
								update.reset();
							}}
						/>
					</details>
				</details>
				{state.error && (
					<StatusBanner state="bad" title="파일을 확인해 주세요">
						{state.error}
					</StatusBanner>
				)}
				{config.isLoading && (
					<StatusBanner state="loading" title="기존 Gateway 설정을 읽는 중입니다" />
				)}
				{config.error && (
					<StatusBanner state="bad" title="Gateway에 연결할 수 없습니다">
						{config.error.message}
					</StatusBanner>
				)}
			</Panel>
			{state.plan && (
				<Panel>
					<div className="policy-section-title">
						<div>
							<h3>2. 정책별 검토</h3>
							<p className="muted-copy">
								{state.plan.policy_packs.length}개 팩 · {policies.length}개 카드
								{manual ? '. 포트와 기존 목적지는 유지합니다.' : ''}
							</p>
						</div>
						{manual && (
							<span className={`policy-pill ${ready ? 'ready' : ''}`}>
								{ready ? '설정 생성 준비 완료' : '연결 정보 확인 필요'}
							</span>
						)}
						<button
							type="button"
							className="button secondary"
							onClick={() =>
								download(
									'connector-policy-plan.json',
									JSON.stringify(state.plan, null, 2),
									'application/json'
								)
							}
						>
							중간 JSON 내려받기
						</button>
					</div>
					<p className="muted-copy">
						차단·마스킹·필드 삭제가 발생하면 적용된 정책의 법령명과 조항을 응답에 안내합니다.
					</p>
					{readiness && (
						<PolicyReadiness
							key={source}
							policies={policies}
							report={readiness}
							reviews={reviews}
							onSave={saveReview}
							onEdit={editCard}
						/>
					)}
					{reviewStorageError && <p role="status">{reviewStorageError}</p>}
					{!config.isLoading && !config.error && targets.length === 0 && (
						<StatusBanner state="warn" title="기존 경로가 없습니다">
							<a href="/ui/traffic/routes">HTTP 경로 추가</a> 또는{' '}
							<a href="/ui/llm/models">LLM 모델 추가</a> 후 가져오세요.
						</StatusBanner>
					)}
					{!manual && (
						<div className="policy-quick">
							<div className="policy-quick-summary" role="status">
								<strong>
									활성 {active.length}개 · 제외 {policies.length - active.length}개
								</strong>
								<span>{applied ? '서버에 적용했습니다.' : '아직 서버에 적용되지 않았습니다.'}</span>
							</div>
							<div className={`policy-next-step ${ready ? 'ready' : ''}`} role="status">
								<strong>
									{applied
										? '정책 설정 적용 완료'
										: ready
											? '검토 기록과 설정 확인 후 적용할 수 있습니다'
											: technicalReady
												? '설정 생성 완료 · 적용 판단과 검증 기록 확인 필요'
												: setupKeys.length
													? `추가 설정 ${setupKeys.length}개 카드`
													: mergeFindings.length
														? '기존 설정 충돌'
														: '적용할 기능을 켜 주세요'}
								</strong>
								{ready && (
									<button
										type="button"
										className="button primary"
										disabled={busy || update.isPending || !writable}
										onClick={() => void finish(true)}
									>
										선택한 보호 적용
									</button>
								)}
								{setupKeys.length > 0 && (
									<>
										<span>
											필요한 값을 설정하세요. 기능을 꺼도 적용 판단과 이행 증거는 필요합니다.
										</span>
										<div className="button-row">
											<button
												type="button"
												className="button secondary"
												onClick={() => setQuickEditor(setupKeys[0])}
											>
												필요한 설정 열기
											</button>
											<button
												type="button"
												className="button secondary"
												onClick={() => toggleCards(setupKeys, false)}
											>
												추가 설정 기능 끄기
											</button>
										</div>
									</>
								)}
								{mergeFindings.length > 0 && (
									<div className="policy-merge-review">
										<p>
											기존 설정 충돌이 있습니다. 기존 정책 변환을 정리하거나 적용 경로를 바꾸세요.
										</p>
										<button
											type="button"
											className="button secondary"
											onClick={() => {
												const section = existingSettingsRef.current;
												const details = section?.querySelector('details');
												if (details) details.open = true;
												section?.scrollIntoView({ block: 'start' });
											}}
										>
											기존 정책 변환 확인
										</button>
										<details>
											<summary>충돌 내용 보기</summary>
											<ul>
												{[...new Set(mergeFindings.map(finding => finding.message))].map(text => (
													<li key={text}>{text}</li>
												))}
											</ul>
										</details>
									</div>
								)}
							</div>
							{visibleGroups.map(quickRow)}
							{config.data && (
								<FhirProtectionSummary
									plan={state.plan}
									config={config.data}
									profile={effectiveProfile}
									onProfile={updateProfile}
									compact
								/>
							)}
							{deferredGroups.length > 0 && (
								<details className="policy-quick-deferred">
									<summary>
										미연결 기능 {deferredGroups.length}개 · 현재 선택 제외
										<small className="policy-deferred-help">
											선택 제외는 법률 미적용을 뜻하지 않습니다. 위에서 카드별로 판단하세요.
										</small>
									</summary>
									{deferredGroups.map(quickRow)}
								</details>
							)}
						</div>
					)}
					{(manual || detailsOpen) && (
						<div className="policy-advanced-editor">
							{!manual && (
								<div className="policy-section-title">
									<h3>개별 세부 설정</h3>
									<button
										type="button"
										className="button secondary"
										onClick={() => {
											setDetailsOpen(false);
											setActivePolicy(null);
										}}
									>
										닫기
									</button>
								</div>
							)}
							{manual && policies.length > 1 && config.data && (
								<PolicySharedInputs
									key={source}
									plan={state.plan}
									config={config.data}
									profile={effectiveProfile}
									presets={sharedPresets}
									findings={state.result?.findings ?? []}
									onProfile={updateProfile}
									functionLabel={fn => actionNames[fn.action] ?? functionMatch(fn)}
									renderCondition={props => (
										<ConditionInput {...props} config={config.data ?? {}} />
									)}
									renderFunction={props => (
										<FunctionParameters {...props} config={config.data ?? {}} shared />
									)}
								/>
							)}
							{manual && config.data && state.plan && (
								<FhirProtectionSummary
									plan={state.plan}
									config={config.data}
									profile={effectiveProfile}
									onProfile={updateProfile}
								/>
							)}
							{manual && policies.length > 1 && (
								<div className="policy-review-summary">
									<p role="status">
										전체 {policies.length}개 카드 · 연결 완료 {completed.length}개 · 확인 필요{' '}
										{policies.length - completed.length}개
									</p>
									<label className="policy-check">
										<input
											type="checkbox"
											checked={compact}
											onChange={event => setCompact(event.target.checked)}
										/>
										확인 필요만 보기
									</label>
								</div>
							)}
							<div className="policy-card-grid">
								{policies.map(policy => {
									const key = policyKey(policy),
										binding = effectiveProfile.bindings[key] ?? {};
									const functions = policyFunctions(policy);
									const findings = state.result?.findings.filter(f => f.policy === key) ?? [];
									const groupedFindings = findings.filter(finding => {
										if (finding.kind === 'conflict' || finding.message.includes('변경되었습니다'))
											return false;
										if (
											policies.length > 1 &&
											(finding.message === '적용할 기존 경로를 연결해 주세요.' ||
												finding.message === '적용 조건 형식을 확인해 주세요.')
										)
											return true;
										const match = /^기능 (\d+):/.exec(finding.message);
										return (
											match &&
											repeatedGroups.some(group =>
												group.members.some(
													member =>
														member.policyKey === key && member.index === Number(match[1]) - 1
												)
											)
										);
									});
									const individualFindings = findings.filter(
										finding => !groupedFindings.includes(finding)
									);
									const selected: number[] =
										binding.selectedFunctions ??
										(policy.function_combination === 'all' || functions.length === 1
											? functions.map((_: unknown, i: number) => i)
											: []);
									const regexSelected = functions.some(
										(fn: JsonObject, index: number) =>
											selected.includes(index) && /^AGW-REGEX-GUARD-/.test(fn.function_id)
									);
									const availableTargets = targets.filter(
										target => !regexSelected || regexTargetSupported(config.data ?? {}, target.id)
									);
									return (
										<article
											className="policy-card"
											key={key}
											data-policy-key={key}
											hidden={
												manual
													? compact && policies.length > 1 && findings.length === 0
													: activePolicy !== key
											}
										>
											<div className="policy-section-title">
												<div>
													{policy.legal_sources?.length ? (
														policy.legal_sources.map((source: JsonObject) => (
															<strong className="policy-law" key={JSON.stringify(source)}>
																{source.law_name} · {source.provision}
															</strong>
														))
													) : (
														<strong>법령 근거 미등록 · {key}</strong>
													)}
												</div>
												<span className="policy-pill">
													{findings.length ? '확인 필요' : '연결됨'}
												</span>
											</div>
											<p className="policy-match">
												Gateway 기능:{' '}
												{policyFunctionMatches(policy, effectiveProfile) || '기능 분류 필요'}
											</p>
											{functions.map((fn: JsonObject, index: number) => {
												const notice = selected.includes(index)
													? responseInspectionNotice(fn, {
															...binding.functions?.[String(index)],
															...fn.parameters
														})
													: '';
												return notice ? (
													// biome-ignore lint/suspicious/noArrayIndexKey: Function indexes are stable identifiers in the intermediate contract.
													<p className="muted-copy" key={`response-notice-${index}`}>
														{notice}
													</p>
												) : null;
											})}
											<details
												className="policy-card-editor"
												data-active={activePolicy === key}
												open={activePolicy === key}
												onToggle={event => {
													if (event.target !== event.currentTarget) return;
													const opened = event.currentTarget.open;
													if (opened)
														setScopeOpen(current =>
															key in current ? current : { ...current, [key]: findings.length > 0 }
														);
													setActivePolicy(current =>
														opened ? key : current === key ? null : current
													);
												}}
											>
												<summary>
													{findings.length
														? individualFindings.length
															? '누락된 연결 정보 확인'
															: '공통 설정에서 확인 · 개별 설정 변경'
														: '자동 연결됨 · 설정 변경'}
												</summary>
												<details
													className="policy-card-scope"
													open={activePolicy === key && Boolean(scopeOpen[key])}
													onToggle={event => {
														if (event.target !== event.currentTarget || activePolicy !== key)
															return;
														const opened = event.currentTarget.open;
														setScopeOpen(current => ({ ...current, [key]: opened }));
													}}
												>
													<summary>적용 경로와 조건 · 개별 변경</summary>
													<div className="policy-fields">
														{findings.some(f => f.message.includes('변경되었습니다')) && (
															<button
																type="button"
																className="button secondary"
																onClick={() =>
																	setProfile(current => ({
																		...current,
																		bindings: { ...current.bindings, [key]: {} }
																	}))
																}
															>
																변경된 연결 정보 다시 설정
															</button>
														)}
														{targets.length > 0 ? (
															<label>
																적용 경로
																<select
																	aria-label={`${key} 적용 경로`}
																	value={
																		binding.target ??
																		policy.scope?.target_ref ??
																		(targets.length === 1 ? targets[0].id : '')
																	}
																	onChange={e => change(key, { target: e.target.value })}
																>
																	<option value="">특정 경로 선택</option>
																	<option
																		value="all"
																		disabled={availableTargets.length !== targets.length}
																	>
																		모든 기존 경로 · 카드의 적용 조건 유지
																	</option>
																	{targets.map(t => (
																		<option
																			key={t.id}
																			value={t.id}
																			disabled={
																				!availableTargets.some(target => target.id === t.id)
																			}
																		>
																			{t.label}
																			{!availableTargets.some(target => target.id === t.id) &&
																				' · 정규식 검사 미지원'}
																		</option>
																	))}
																</select>
															</label>
														) : null}
														{regexSelected && availableTargets.length !== targets.length && (
															<p className="muted-copy">
																정규식 검사는 지원되는 AI 메시지 경로에서만 선택할 수 있습니다. 일반
																HTTP·detect/opaque 경로는 사용할 수 없습니다.
															</p>
														)}
														{!policy.applies_when && (
															<ConditionInput
																config={config.data ?? {}}
																value={binding.condition}
																onChange={condition => change(key, { condition })}
																label={`${key} 적용 조건`}
															/>
														)}
													</div>
												</details>
												{!Array.isArray(policy.function) ? (
													<p>원본 카드의 기능 분류가 필요합니다.</p>
												) : (
													functions.map((fn: JsonObject, index: number) => {
														const values = {
															...binding.functions?.[String(index)],
															...fn.parameters
														};
														return (
															// biome-ignore lint/suspicious/noArrayIndexKey: Function indexes are stable identifiers in the intermediate contract.
															<div className="policy-function" key={`${fn.function_id}-${index}`}>
																{functions.length > 1 && policy.function_combination !== 'all' ? (
																	<label className="policy-check">
																		<input
																			type="checkbox"
																			checked={selected.includes(index)}
																			onChange={e =>
																				change(key, {
																					selectedFunctions: e.target.checked
																						? [...selected, index]
																						: selected.filter(i => i !== index)
																				})
																			}
																		/>
																		{actionNames[fn.action] ?? fn.action}
																	</label>
																) : (
																	<strong>{actionNames[fn.action] ?? fn.action}</strong>
																)}
																<p className="policy-match">
																	연결 기능: {effectiveFunctionMatch(fn, values)}
																</p>
																{selected.includes(index) && (
																	<div className="policy-fields">
																		<details>
																			<summary>기능 코드와 매핑 대상</summary>
																			<p>
																				{fn.function_id} · {fn.action} · {fn.object}
																			</p>
																		</details>
																		<FunctionParameters
																			config={config.data ?? {}}
																			label={key}
																			nativeLabel={`${key} 기능 ${index + 1}`}
																			fn={fn}
																			values={values}
																			onChange={patch => parameters(policy, index, patch)}
																		/>
																	</div>
																)}
															</div>
														);
													})
												)}
											</details>
											{individualFindings.length > 0 && (
												<ul className="policy-findings" hidden={activePolicy !== key}>
													{individualFindings.map(f => (
														<li key={`${f.policy}-${f.message}`}>{f.message}</li>
													))}
												</ul>
											)}
											<details className="policy-card-reference" hidden={activePolicy !== key}>
												<summary>정책 설명과 근거 상세</summary>
												<p>{policy.policy_text}</p>
												<p>{key}</p>
												<pre>
													{JSON.stringify(
														{
															sources: policy.legal_sources,
															target: functions.map((f: JsonObject) => f.target)
														},
														null,
														2
													)}
												</pre>
											</details>
										</article>
									);
								})}
							</div>
							{manual && compact && policies.length > 1 && completed.length > 0 && (
								<details className="policy-complete-list">
									<summary>연결 완료 {completed.length}개 카드</summary>
									{completed.map(policy => (
										<div className="policy-complete-row" key={policyKey(policy)}>
											<strong>
												{policy.legal_sources
													?.map((item: JsonObject) => `${item.law_name} · ${item.provision}`)
													.join(' / ') || policyKey(policy)}
											</strong>
											<span>
												{policyFunctionMatches(policy, effectiveProfile) || 'Gateway 기능 없음'}
											</span>
										</div>
									))}
									<p className="muted-copy">
										개별 설정을 변경하려면 ‘확인 필요만 보기’를 해제하세요.
									</p>
								</details>
							)}
						</div>
					)}
				</Panel>
			)}
			{state.result && (
				<Panel className={manual ? undefined : 'policy-apply-bar'}>
					<h3>3. 설정 확인하고 적용</h3>
					{manual &&
						state.result.findings.some(f => !policies.some(p => policyKey(p) === f.policy)) && (
							<StatusBanner state="warn" title="기존 설정과 병합 확인이 필요합니다">
								{state.result.findings
									.filter(f => !policies.some(p => policyKey(p) === f.policy))
									.map(f => f.message)
									.join(' ')}
							</StatusBanner>
						)}
					<label className={`policy-check ${manual ? '' : 'policy-remember'}`}>
						<input
							type="checkbox"
							checked={remember}
							onChange={e => setRemember(e.target.checked)}
						/>
						이 브라우저에 연결 정보를 저장해 다음 가져오기에 재사용
					</label>
					<div className="button-row">
						<button
							type="button"
							className="button primary"
							disabled={!ready || busy || update.isPending || !writable}
							onClick={() => void finish(true)}
						>
							설정 검사 후 적용
						</button>
						<button
							type="button"
							className="button secondary"
							disabled={!technicalReady || busy}
							onClick={() => void finish(false)}
						>
							{ready ? 'YAML 내려받기' : '검토용 YAML 내려받기'}
						</button>
						<button
							type="button"
							className="button secondary"
							onClick={() =>
								download(
									'policy-bindings.json',
									JSON.stringify(effectiveProfile, null, 2),
									'application/json'
								)
							}
						>
							연결 정보 저장
						</button>
						<button
							type="button"
							className="button secondary"
							onClick={() =>
								download(
									'policy-reviews.json',
									JSON.stringify(reviews, null, 2),
									'application/json'
								)
							}
						>
							판단·검증 기록 저장
						</button>
						{readiness && (
							<button
								type="button"
								className="button secondary"
								onClick={() =>
									download(
										'policy-readiness-report.json',
										JSON.stringify(readiness, null, 2),
										'application/json'
									)
								}
							>
								적용 상태 보고서 저장
							</button>
						)}
					</div>
					{!ready && readiness && (
						<p className="policy-findings" role="status">
							적용 준비 미완료 · {readiness.cards.filter(card => card.blocked).length}개 카드의
							판단·설정·검증을 확인해 주세요. 설정만 생성돼도 서버 적용은 진행하지 않습니다.
						</p>
					)}
					{!writable && (
						<p className="muted-copy">
							현재 저장 모드에서는 직접 적용할 수 없습니다. YAML을 내려받아 사용할 수 있습니다.
						</p>
					)}
					{state.result.notes.length > 0 && (
						<details>
							<summary>재사용 설정과 검토 사항</summary>
							<ul>
								{[...new Set(state.result.notes)].map(note => (
									<li key={note}>{note}</li>
								))}
							</ul>
						</details>
					)}
					{technicalReady && (
						<details>
							<summary>생성 설정 미리보기</summary>
							<pre>{dump(state.result.config, { noRefs: true })}</pre>
						</details>
					)}
				</Panel>
			)}
			{message && (
				<StatusBanner state={message.startsWith('처리 실패') ? 'bad' : 'info'} title={message} />
			)}
			<Panel>
				<h3>기존 설정 관리</h3>
				<p className="muted-copy">
					새 정책과 기존 변환이 충돌할 때 사용합니다. 검토를 시작할 때 기존 설정을 지울 필요는
					없습니다.
				</p>
				<div id="policy-existing-settings" ref={existingSettingsRef}>
					<PolicySettingsRemoval />
				</div>
			</Panel>
		</div>
	);
}

function FhirProtectionSummary({
	plan,
	config,
	profile,
	onProfile,
	compact = false
}: {
	plan: JsonObject;
	config: JsonObject;
	profile: ImportProfile;
	onProfile: (profile: ImportProfile) => void;
	compact?: boolean;
}) {
	const targets = policyTargets(config);
	const controls: {
		key: string;
		index: number;
		filter: ReturnType<typeof validateFhirFilterProfile>;
		locked: boolean;
	}[] = (plan.policy_packs.flatMap((pack: JsonObject) => pack.policies) as JsonObject[]).flatMap(
		policy => {
			const key = policyKey(policy);
			const binding = profile.bindings[key] ?? {};
			if (binding.enabled === false) return [];
			const functions = policyFunctions(policy);
			const selected =
				binding.selectedFunctions ??
				(policy.function_combination === 'all' || functions.length === 1
					? functions.map((_: unknown, index: number) => index)
					: []);
			const target =
				binding.target ??
				policy.scope?.target_ref ??
				(targets.length === 1 ? targets[0].id : undefined);
			const stale = Boolean(
				(binding.policyFingerprint && binding.policyFingerprint !== policyFingerprint(policy)) ||
					(binding.targetFingerprint &&
						(!target || binding.targetFingerprint !== targetFingerprint(config, target)))
			);
			return functions.flatMap((fn: JsonObject, index: number) => {
				const values = { ...binding.functions?.[String(index)], ...fn.parameters };
				if (
					!selected.includes(index) ||
					fn.function_id !== 'AGW-BODY-HEADER-TRANSFORM-REQUEST' ||
					fn.action !== 'remove_field' ||
					values.body_location !== 'request_fhir'
				)
					return [];
				try {
					return [
						{
							key,
							index,
							filter: validateFhirFilterProfile(values.fhir_filter),
							locked: stale || Object.keys(fn.parameters ?? {}).length > 0
						}
					];
				} catch {
					return [];
				}
			});
		}
	);
	if (!controls.length) return null;
	const editable = controls.filter(control => !control.locked);
	const fields = new Set(
		controls.flatMap(control =>
			Object.entries(control.filter.allow_fields).flatMap(([resource, paths]) =>
				(paths ?? []).map(path => `${resource}/${path}`)
			)
		)
	);
	function toggle(resource: string, path: string, keep: boolean) {
		const next = structuredClone(profile);
		for (const control of editable) {
			const allow_fields: Record<string, string[]> = structuredClone(control.filter.allow_fields);
			const current = allow_fields[resource] ?? [];
			const values = keep
				? [...new Set([...current, path])]
				: current.filter(item => item !== path);
			if (values.length) allow_fields[resource] = values;
			else delete allow_fields[resource];
			next.bindings[control.key] ??= {};
			const binding = next.bindings[control.key];
			binding.functions ??= {};
			binding.functions[String(control.index)] = {
				...binding.functions[String(control.index)],
				body_location: 'request_fhir',
				fhir_filter: validateFhirFilterProfile({ version: 1, allow_fields })
			};
		}
		onProfile(next);
	}
	return (
		<section
			className={`policy-fhir-summary ${compact ? 'policy-fhir-compact' : ''}`}
			aria-label="FHIR 기본 보호"
		>
			<strong>
				{fields.size
					? 'FHIR 기본 보호: 선택한 최소 필드만 전달'
					: 'FHIR 기본 보호: 데이터 필드 기본 차단'}
			</strong>
			<p className="muted-copy">
				{controls.length}개 기능에 적용 ·{' '}
				{fields.size ? `선택한 필드 ${fields.size}개만 추가 전달` : '전달 허용 필드 없음'}. 알 수
				없는 리소스와 필드도 제거하며 resourceType·Bundle과 contained의 구조는 유지합니다.
			</p>
			<details className="policy-fhir-options">
				<summary>전달할 최소 필드 선택</summary>
				<p className="muted-copy">
					관리자가 필요한 항목만 선택하세요. 이름·주소·코드처럼 묶인 항목은 하위 내용도 함께
					전달됩니다. 이 선택은 정보 제공의 적법성이나 개인정보 여부를 판정하지 않습니다.
				</p>
				<div className="policy-fhir-resource-grid">
					{Object.entries(FHIR_KEEP_OPTIONS).map(([resource, options]) => (
						<fieldset key={resource}>
							<legend>{resource}</legend>
							{options.map(option => {
								const displayed = editable.length ? editable : controls;
								const selected = displayed.filter(control =>
									(control.filter.allow_fields as Record<string, string[]>)[resource]?.includes(
										option.path
									)
								).length;
								return (
									<label className="policy-check" key={option.path}>
										<input
											type="checkbox"
											aria-label={`${resource} 전달 허용 ${option.path}`}
											checked={displayed.length > 0 && selected === displayed.length}
											disabled={editable.length === 0}
											ref={element => {
												if (element)
													element.indeterminate = selected > 0 && selected < displayed.length;
											}}
											onChange={event => toggle(resource, option.path, event.target.checked)}
										/>
										<span>
											{option.label}
											<small>{option.path}</small>
										</span>
									</label>
								);
							})}
						</fieldset>
					))}
				</div>
				{controls.some(control => control.locked) && (
					<p className="muted-copy">
						원본 또는 오래된 연결 정보에 지정된 필드는 그대로 유지합니다. 해당 카드의 상세에서
						확인하세요.
					</p>
				)}
			</details>
		</section>
	);
}

function FunctionParameters({
	config,
	label,
	nativeLabel,
	fn,
	values,
	target,
	shared = false,
	onChange
}: {
	config: JsonObject;
	label: string;
	nativeLabel?: string;
	fn: JsonObject;
	values: JsonObject;
	target?: string;
	shared?: boolean;
	onChange: (patch: JsonObject) => void;
}) {
	return (
		<>
			{fn.action === 'remove_field' && values.body_location !== 'request_fhir' && (
				<FieldSelector label={label} fn={fn} values={values} onChange={patch => onChange(patch)} />
			)}
			{fn.action === 'remove_field' && values.body_location === 'request_fhir' && (
				<p className="muted-copy">
					FHIR 기본 보호를 사용합니다. 전달할 최소 필드는 위의 공통 설정에서 확인할 수 있습니다.
				</p>
			)}
			{['set_header', 'add_header', 'remove_header'].includes(fn.action) && (
				<HeaderSelector label={label} fn={fn} values={values} onChange={patch => onChange(patch)} />
			)}
			{fn.action === 'route_to_backend' && (
				<>
					<label className="policy-check">
						<input
							type="checkbox"
							checked={values.reuse_existing_destination === true}
							onChange={e =>
								onChange({
									reuse_existing_destination: e.target.checked
								})
							}
						/>
						이 경로의 기존 목적지가 승인된 목적지입니다
					</label>
					<ConditionInput
						config={config}
						label={`${label} 이전 승인 조건`}
						value={values.require_when}
						approval
						onChange={require_when => onChange({ require_when })}
					/>
				</>
			)}
			{fn.action === 'log_access' && (
				<label className="policy-check">
					<input
						type="checkbox"
						checked={values.reuse_existing_logging === true}
						onChange={e =>
							onChange({
								reuse_existing_logging: e.target.checked
							})
						}
					/>
					현재 접속기록 설정을 재사용합니다
				</label>
			)}
			{fn.action === 'trace' && (
				<label className="policy-check">
					<input
						type="checkbox"
						checked={values.reuse_existing_tracing === true}
						onChange={e =>
							onChange({
								reuse_existing_tracing: e.target.checked
							})
						}
					/>
					현재 추적 수집처와 샘플링 설정을 재사용합니다
				</label>
			)}
			{fn.action === 'authorize_require' && (
				<ConditionInput
					config={config}
					label={`${label} 승인 조건`}
					value={values.require_when}
					approval
					onChange={require_when => onChange({ require_when })}
				/>
			)}
			{(/^AGW-REGEX-GUARD-(REQUEST|RESPONSE)$/.test(fn.function_id) ||
				fn.action === 'require_jwt' ||
				['rate_limit', 'limit_requests'].includes(fn.action)) && (
				<NativeSettingsSelector
					config={config}
					label={nativeLabel ?? label}
					fn={fn}
					values={values}
					choicesOverride={shared ? existingTargetChoices(config, target, fn) : undefined}
					onChange={patch => onChange(patch)}
				/>
			)}
			{fn.action === 'rewrite_body' && values.instruction_text && (
				<p className="muted-copy">
					채팅 요청에는 시스템 메시지, Responses 요청에는 지시를 추가합니다. 모델의 문구 준수는
					보장되지 않습니다.
				</p>
			)}
			{fn.action === 'rewrite_body' && !values.body_expression && !values.instruction_text && (
				<p className="muted-copy">
					본문 표시 형식은 관리자 연결 정보에서 가져옵니다. 헤더 표시로 충분하도록 검토했다면 헤더
					기능만 선택해 주세요.
				</p>
			)}
		</>
	);
}

function NativeSettingsSelector({
	config,
	label,
	fn,
	values,
	choicesOverride,
	onChange
}: {
	config: JsonObject;
	label: string;
	fn: JsonObject;
	values: JsonObject;
	choicesOverride?: { label: string; value: JsonObject }[];
	onChange: (patch: JsonObject) => void;
}) {
	const kind = /^AGW-REGEX-GUARD-/.test(fn.function_id)
		? 'regex'
		: fn.action === 'require_jwt'
			? 'jwt'
			: 'rate';
	const parameter =
		kind === 'regex' ? 'guardrail' : kind === 'jwt' ? 'jwt_auth' : 'local_rate_limit';
	const title =
		kind === 'regex' ? '정규식 규칙' : kind === 'jwt' ? 'JWT 발급자 설정' : '요청 횟수 제한 설정';
	const direction = fn.function_id.endsWith('RESPONSE') ? 'response' : 'request';
	const builtins = kind === 'regex' ? builtinRegexChoices(direction, fn.action) : [];
	const choices = [
		...(choicesOverride
			? choicesOverride.filter(choice => choice.value[parameter])
			: nativePolicyChoices(config, kind, direction, fn.action)),
		...builtins.map(choice =>
			choicesOverride
				? {
						label: choice.label,
						value: {
							[parameter]: choice.value,
							...(direction === 'response'
								? { response_mode: values.response_mode ?? 'non_streaming' }
								: {})
						}
					}
				: choice
		)
	].filter(
		(choice, index, all) =>
			all.findIndex(other => JSON.stringify(other.value) === JSON.stringify(choice.value)) === index
	);
	const current = values[parameter]
		? JSON.stringify(
				choicesOverride
					? {
							[parameter]: values[parameter],
							...(kind === 'regex' && direction === 'response' && values.response_mode
								? { response_mode: values.response_mode }
								: {})
						}
					: values[parameter]
			)
		: '';
	const locked = Boolean(fn.parameters?.[parameter]);
	const [advanced, setAdvanced] = useState('');
	const [error, setError] = useState('');
	const [editingNative, setEditingNative] = useState(false);
	const patch = (value: JsonObject | undefined) => {
		setError('');
		onChange({
			[parameter]: value,
			...(kind === 'regex' && direction === 'response' && !values.response_mode
				? { response_mode: 'non_streaming' }
				: {})
		});
	};
	return (
		<>
			{(choices.length > 0 || current || kind === 'regex') && (
				<label>
					{title}
					<select
						aria-label={`${label} ${title}`}
						disabled={locked}
						value={current}
						onChange={event => {
							if (choicesOverride && event.target.value) {
								setError('');
								onChange(JSON.parse(event.target.value));
							} else patch(event.target.value ? JSON.parse(event.target.value) : undefined);
						}}
					>
						<option value="">관리자가 등록한 설정 선택</option>
						{choices.map(choice => (
							<option key={JSON.stringify(choice.value)} value={JSON.stringify(choice.value)}>
								{choice.label}
							</option>
						))}
						{current && !choices.some(choice => JSON.stringify(choice.value) === current) && (
							<option value={current}>가져온 연결 정보 사용</option>
						)}
					</select>
				</label>
			)}
			{!locked &&
				(kind === 'jwt' || kind === 'rate') &&
				current &&
				!editingNative &&
				canEditNativeSetup(kind, values[parameter]) && (
					<button type="button" className="button secondary" onClick={() => setEditingNative(true)}>
						운영 정보 수정
					</button>
				)}
			{!locked && (!current || editingNative) && (kind === 'jwt' || kind === 'rate') && (
				<PolicyNativeSetup
					kind={kind}
					label={label}
					value={values[parameter]}
					onChange={value => {
						patch(value);
						setEditingNative(false);
					}}
				/>
			)}
			{!choices.length && !current && kind === 'regex' && (
				<p className="muted-copy">
					등록된 {title}이 없습니다. 관리자가 기존 Gateway 설정에 등록하거나 연결 정보를 가져와
					주세요.
				</p>
			)}
			{kind === 'regex' && (
				<>
					<p className="muted-copy">
						설정된 텍스트 패턴만 검사합니다. 구조화 필드 삭제와 개인정보·동의·법적 자격 판정은
						수행하지 않습니다.
						{fn.action === 'mask' &&
							' 사용자 정규식은 <masked>, 기본 패턴은 패턴별 Gateway 고정 치환값을 사용합니다.'}
					</p>
					{direction === 'request' && values.guardrail?.scope && (
						<p className="muted-copy">검사 범위: {values.guardrail.scope.join(', ')}</p>
					)}
					{direction === 'response' && (
						<label>
							응답 방식
							<select
								aria-label={`${label} 응답 방식`}
								disabled={Boolean(fn.parameters?.response_mode)}
								value={values.response_mode ?? ''}
								onChange={event => onChange({ response_mode: event.target.value || undefined })}
							>
								<option value="">응답 방식 선택</option>
								<option value="non_streaming">비스트리밍만 처리 · 스트림 요청 차단</option>
								{fn.action === 'reject' && (
									<option value="streaming_partial">
										부분 스트림 검사 · 앞선 응답은 회수 불가
									</option>
								)}
							</select>
						</label>
					)}
				</>
			)}
			{kind === 'jwt' && (
				<p className="muted-copy">
					JWT 서명·발급자·대상·만료 검증을 필수로 적용합니다. 기존 선택 경로의 인증 설정과 다르면
					병합을 보류합니다. 법적 동의나 업무 자격을 확인하는 기능은 아닙니다.
				</p>
			)}
			{kind === 'rate' && (
				<p className="muted-copy">
					등록된 요청 횟수와 충전 시간·제한 키를 재사용합니다. 토큰 사용 예산과 별개이며 같은 키의
					다른 제한값은 병합을 보류합니다.
				</p>
			)}
			{!locked && (
				<details>
					<summary>관리자 고급 설정</summary>
					<p className="muted-copy">
						검토한 Gateway {title} JSON을 입력하세요. 입력한 값도 설정 검사와 충돌 확인을 통과해야
						적용됩니다.
					</p>
					<textarea
						aria-label={`${label} 관리자 ${title} JSON`}
						rows={5}
						value={advanced}
						onChange={event => {
							setAdvanced(event.target.value);
							setError('');
						}}
					/>
					<button
						type="button"
						className="button secondary"
						disabled={!advanced.trim()}
						onClick={() => {
							try {
								const value = JSON.parse(advanced);
								if (!value || typeof value !== 'object' || Array.isArray(value))
									throw new Error('설정은 JSON 객체여야 합니다.');
								patch(value);
							} catch (cause) {
								setError(`입력 확인: ${(cause as Error).message}`);
							}
						}}
					>
						입력한 관리자 설정 연결
					</button>
					{error && <p role="alert">{error}</p>}
				</details>
			)}
		</>
	);
}

function FieldSelector({
	label,
	fn,
	values,
	onChange
}: {
	label: string;
	fn: JsonObject;
	values: JsonObject;
	onChange: (patch: JsonObject) => void;
}) {
	const choices = fieldChoices(fn, values),
		resources = [...new Set(choices.map(c => c.resource).filter(Boolean))];
	const locked = Boolean(fn.parameters?.paths);
	return (
		<>
			<label>
				FHIR 리소스 종류
				<select
					aria-label={`${label} 리소스 종류`}
					disabled={Boolean(fn.parameters?.resource_type)}
					value={values.resource_type ?? ''}
					onChange={e =>
						onChange({
							resource_type: e.target.value || undefined,
							...(locked ? {} : { paths: [] })
						})
					}
				>
					<option value="">리소스 선택</option>
					{resources.map(r => (
						<option key={r} value={r}>
							{r}
						</option>
					))}
				</select>
			</label>
			<fieldset>
				<legend>삭제할 필드 선택 · 선택한 필드만 요청에서 제거</legend>
				{choices
					.filter(c => !values.resource_type || !c.resource || c.resource === values.resource_type)
					.map(c => (
						<label className="policy-check" key={`${c.resource}/${c.path}`}>
							<input
								type="checkbox"
								aria-label={`${label} 삭제 필드 ${c.path}`}
								disabled={locked || !c.supported || Boolean(c.resource && !values.resource_type)}
								checked={(values.paths ?? []).includes(c.path)}
								onChange={e =>
									onChange({
										paths: e.target.checked
											? [...(values.paths ?? []), c.path]
											: (values.paths ?? []).filter((p: string) => p !== c.path)
									})
								}
							/>
							{c.label}
							{!c.supported && ' · 관리자 매핑 필요'}
						</label>
					))}
				{!choices.length && (
					<p className="muted-copy">
						선택할 필드가 없습니다. 필드 매핑이 포함된 연결 정보를 가져와 주세요.
					</p>
				)}
			</fieldset>
			<label className="policy-check">
				<input
					type="checkbox"
					disabled={Boolean(fn.parameters?.body_location)}
					checked={values.body_location === 'root_json'}
					onChange={e => onChange({ body_location: e.target.checked ? 'root_json' : undefined })}
				/>
				FHIR/JSON이 요청 본문 자체에 있습니다
			</label>
		</>
	);
}

function HeaderSelector({
	label,
	fn,
	values,
	onChange
}: {
	label: string;
	fn: JsonObject;
	values: JsonObject;
	onChange: (patch: JsonObject) => void;
}) {
	const [urlError, setUrlError] = useState('');
	if (String(values.header).toLowerCase() === 'link' && fn.action !== 'remove_header') {
		const url =
			typeof values.value === 'string'
				? (/^<([^>]+)>/.exec(values.value)?.[1] ?? values.value)
				: '';
		return (
			<label>
				설명 자료 URL
				<input
					aria-label={`${label} 설명 자료 URL`}
					type="url"
					defaultValue={url}
					placeholder="https://…"
					disabled={Boolean(fn.parameters?.value)}
					onChange={event => {
						const text = event.target.value.trim();
						try {
							const parsed = new URL(text);
							if (!['http:', 'https:'].includes(parsed.protocol)) throw Error('unsupported URL');
							setUrlError('');
							onChange({ value: `<${parsed.href}>; rel="describedby"` });
						} catch {
							setUrlError(text ? 'http 또는 https URL을 입력해 주세요.' : '');
							onChange({ value: undefined });
						}
					}}
				/>
				{urlError && <small role="alert">{urlError}</small>}
			</label>
		);
	}
	const current = values.header
		? JSON.stringify({
				header: values.header,
				...(fn.action !== 'remove_header' ? { value: values.value } : {})
			})
		: '';
	const preset = JSON.stringify({
		header: 'x-ai-generated',
		...(fn.action !== 'remove_header' ? { value: 'true' } : {})
	});
	return (
		<label>
			헤더 설정
			<select
				aria-label={`${label} 헤더 설정`}
				disabled={Boolean(fn.parameters?.header)}
				value={current}
				onChange={e =>
					onChange(
						e.target.value ? JSON.parse(e.target.value) : { header: undefined, value: undefined }
					)
				}
			>
				<option value="">설정 선택</option>
				<option value={preset}>
					{fn.action === 'remove_header'
						? 'AI 생성 표시 헤더 제거'
						: 'AI 생성 표시 · x-ai-generated: true'}
				</option>
				{current && current !== preset && (
					<option value={current}>
						가져온 설정 · {values.header}
						{fn.action !== 'remove_header' ? `: ${values.value}` : ''}
					</option>
				)}
			</select>
		</label>
	);
}

function ConditionInput(props: {
	value?: JsonObject;
	onChange: (value: JsonObject | undefined) => void;
	label: string;
	approval?: boolean;
	config: JsonObject;
}) {
	const { value, onChange, label, approval } = props,
		choices = conditionChoices(props.config, value);
	const fact = value?.eq?.fact;
	const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
	const options: { label: string; condition: JsonObject }[] = [];
	if (!approval) {
		options.push({ label: '선택한 경로에서 항상 적용', condition: { constant: true } });
		methods.forEach(
			method =>
				void options.push({
					label: `${method} 요청에 적용`,
					condition: { eq: { fact: 'request.method', value: method } }
				})
		);
		choices.paths.forEach(
			path =>
				void options.push({
					label: `경로 ${path}에 적용`,
					condition: { eq: { fact: 'request.path', value: path } }
				})
		);
	}
	choices.facts.forEach(
		f =>
			void choices.values.get(f)?.forEach(
				v =>
					void options.push({
						label: `검증된 정보 · ${f.slice(4)} = ${String(v)}`,
						condition: { eq: { fact: f, value: v } }
					})
			)
	);
	const encoded = value ? JSON.stringify(value) : '';
	if (value && !options.some(o => JSON.stringify(o.condition) === encoded))
		options.push({
			label: fact ? `가져온 조건 · ${fact} = ${String(value.eq.value)}` : '가져온 조건 사용',
			condition: value
		});
	return (
		<div className="policy-condition">
			<label>
				{approval ? '승인 정보' : '적용 시점'}
				<select
					aria-label={label}
					value={value?.constant === true && !approval ? 'always' : encoded}
					onChange={e =>
						onChange(
							e.target.value === 'always'
								? { constant: true }
								: e.target.value
									? JSON.parse(e.target.value)
									: undefined
						)
					}
				>
					<option value="">조건 선택</option>
					{options.map(o => (
						<option
							key={JSON.stringify(o.condition)}
							value={
								o.condition.constant === true && !approval ? 'always' : JSON.stringify(o.condition)
							}
						>
							{o.label}
						</option>
					))}
				</select>
			</label>
			{approval && !options.length && (
				<p className="muted-copy">
					기존 설정에 승인 정보 선택지가 없습니다. 관리자 연결 정보를 가져와 주세요.
				</p>
			)}
		</div>
	);
}
