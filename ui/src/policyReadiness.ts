import {
	adaptPolicyPlan,
	type ImportProfile,
	type ImportResult,
	type JsonObject,
	policyFingerprint,
	policyKey
	// biome-ignore lint/style/noRestrictedImports: This pure module also runs directly under Node without the UI alias resolver.
} from './policyAdapter.ts';

export const reviewStorageKey = 'agentgateway.policy-import.review.v1';
export type Applicability = 'unknown' | 'applicable' | 'not_applicable';
export type VerificationMethod = 'none' | 'gateway' | 'external' | 'alternative';
export type ReviewDraft = {
	applicability: Applicability;
	reason: string;
	reviewer: string;
	evidence: string;
	verification: VerificationMethod;
	verificationEvidence: string;
};
export type PolicyReview = ReviewDraft & {
	reviewedAt: string;
	scopeFingerprint: string;
	candidateFingerprint: string;
};
export type ReviewProfile = { version: 1; reviews: Record<string, PolicyReview> };
export type ReadinessStatus =
	| 'unknown'
	| 'not_applicable'
	| 'pending'
	| 'configured'
	| 'verified'
	| 'external_verified'
	| 'alternative_verified'
	| 'unsupported'
	| 'conflict'
	| 'stale';
export const readinessLabels: Record<ReadinessStatus, string> = {
	unknown: '적용 판단 필요',
	not_applicable: '미적용 근거 확인',
	pending: '설정 필요',
	configured: '설정 생성 · 검증 대기',
	verified: '검증 기록 확인',
	external_verified: '외부 이행 기록 확인',
	alternative_verified: '대체 통제 기록 확인',
	unsupported: '현재 기능 미지원',
	conflict: '기존 설정 충돌',
	stale: '변경 후 재확인 필요'
};
export type ReadinessCard = {
	key: string;
	status: ReadinessStatus;
	label: string;
	applicability: Applicability;
	selected: boolean;
	technical: 'excluded' | 'missing' | 'configured' | 'external' | 'unsupported' | 'conflict';
	issues: string[];
	blocked: boolean;
};
export type ReadinessReport = {
	version: 1;
	cards: ReadinessCard[];
	counts: Record<ReadinessStatus, number>;
	compileOk: boolean;
	releaseReady: boolean;
	blockers: string[];
};
export const emptyReviewDraft = (): ReviewDraft => ({
	applicability: 'unknown',
	reason: '',
	reviewer: '',
	evidence: '',
	verification: 'none',
	verificationEvidence: ''
});
const object = (value: unknown): value is JsonObject =>
	Boolean(value && typeof value === 'object' && !Array.isArray(value));
const filled = (value: unknown) => typeof value === 'string' && Boolean(value.trim());
const draftKeys = ['reason', 'reviewer', 'evidence', 'verificationEvidence'] as const;

// A local change marker, not a signature or proof of legal/technical verification.
// Keep complete config values (including credentials) out of saved/exported review records.
function changeMarker(value: unknown): string {
	const text = JSON.stringify(value);
	return [2166136261, 3335557771, 1973829917, 1518500249]
		.map(seed => {
			let hash = seed;
			for (let index = 0; index < text.length; index++)
				hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
			return (hash >>> 0).toString(16).padStart(8, '0');
		})
		.join('');
}

export function parseReviewProfile(source: string): ReviewProfile {
	const value = JSON.parse(source);
	if (!object(value) || value.version !== 1 || !object(value.reviews))
		throw new Error('검토 기록 파일 형식이 올바르지 않습니다.');
	for (const review of Object.values(value.reviews)) {
		if (
			!object(review) ||
			!['unknown', 'applicable', 'not_applicable'].includes(review.applicability) ||
			!['none', 'gateway', 'external', 'alternative'].includes(review.verification) ||
			!draftKeys.every(key => typeof review[key] === 'string' && review[key].length <= 8192) ||
			!filled(review.reviewedAt) ||
			!Number.isFinite(Date.parse(review.reviewedAt)) ||
			!filled(review.scopeFingerprint) ||
			typeof review.candidateFingerprint !== 'string'
		)
			throw new Error('검토 기록의 판단·담당자·근거·지문을 확인해 주세요.');
	}
	return value as ReviewProfile;
}

function scopeFingerprint(
	plan: JsonObject,
	policy: JsonObject,
	config: JsonObject,
	profile: ImportProfile
) {
	const pack = plan.policy_packs.find((item: JsonObject) => item.policies.includes(policy));
	return changeMarker({
		pack: { id: pack?.pack_id, version: pack?.version, priority: pack?.priority },
		policy: policyFingerprint(policy),
		config,
		binding: profile.bindings[policyKey(policy)] ?? {}
	});
}

export function recordPolicyReview(
	plan: JsonObject,
	policy: JsonObject,
	config: JsonObject,
	profile: ImportProfile,
	result: ImportResult,
	draft: ReviewDraft
): PolicyReview {
	if (
		draft.applicability !== 'unknown' &&
		![draft.reason, draft.reviewer, draft.evidence].every(filled)
	)
		throw new Error('적용 판단의 이유·담당자·근거를 모두 입력해 주세요.');
	if (draft.verification !== 'none' && !filled(draft.verificationEvidence))
		throw new Error('검증 방법에 해당하는 실제 증거 위치와 범위를 입력해 주세요.');
	const review = {
		...draft,
		reviewedAt: new Date().toISOString(),
		scopeFingerprint: scopeFingerprint(plan, policy, config, profile),
		candidateFingerprint: changeMarker(result.config)
	};
	parseReviewProfile(JSON.stringify({ version: 1, reviews: { review } }));
	return review;
}

export function evaluatePolicyReadiness(
	plan: JsonObject,
	config: JsonObject,
	profile: ImportProfile,
	reviews: ReviewProfile,
	result = adaptPolicyPlan(plan, config, profile)
): ReadinessReport {
	const counts = Object.fromEntries(Object.keys(readinessLabels).map(key => [key, 0])) as Record<
		ReadinessStatus,
		number
	>;
	const cards: ReadinessCard[] = plan.policy_packs
		.flatMap((pack: JsonObject) => pack.policies)
		.map((policy: JsonObject) => {
			const key = policyKey(policy);
			const binding = profile.bindings[key] ?? {};
			const selected = binding.enabled !== false;
			const review = reviews.reviews[key];
			// Probe excluded cards too: opt-out is a technical choice, never a legal exemption.
			const probe = structuredClone(profile);
			for (const pack of plan.policy_packs)
				for (const other of pack.policies) {
					const otherKey = policyKey(other);
					probe.bindings[otherKey] = { ...probe.bindings[otherKey], enabled: otherKey === key };
				}
			probe.bindings[key] = { ...binding, enabled: true };
			const findings = adaptPolicyPlan(plan, config, probe).findings.filter(
				item => item.policy === key
			);
			const selectedFindings = result.findings.filter(item => item.policy === key);
			const issues = [...new Set([...findings, ...selectedFindings].map(item => item.message))];
			const functions = Array.isArray(policy.function) ? policy.function : [];
			const indexes =
				binding.selectedFunctions ?? functions.map((_: unknown, index: number) => index);
			const external = indexes.some(index => functions[index]?.action === 'log_access');
			const conflict = [...findings, ...selectedFindings].some(item => item.kind === 'conflict');
			// "unsupported" is also used by the old adapter for missing parameters; retain that distinction.
			const unsupported =
				findings.some(item =>
					/미지원|지원하지|아직 지원|지원되지|해석할 수 없/.test(item.message)
				) || !functions.length;
			const technical = !selected
				? 'excluded'
				: conflict
					? 'conflict'
					: unsupported
						? 'unsupported'
						: issues.length
							? 'missing'
							: external
								? 'external'
								: 'configured';
			let status: ReadinessStatus;
			if (!review || review.applicability === 'unknown') {
				status = 'unknown';
				issues.unshift('서비스에 적용되는 의무인지 이유와 근거를 등록해 주세요.');
			} else if (review.scopeFingerprint !== scopeFingerprint(plan, policy, config, profile)) {
				status = 'stale';
				issues.unshift(
					'카드·설정·연결 범위가 바뀌었습니다. 판단과 검증 기록을 다시 확인해 주세요.'
				);
			} else if (![review.reason, review.reviewer, review.evidence].every(filled)) {
				status = 'unknown';
				issues.unshift('판단 이유·담당자·근거가 부족합니다.');
			} else if (review.applicability === 'not_applicable') {
				status = selected ? 'pending' : 'not_applicable';
				if (selected) issues.unshift('미적용으로 판단한 카드의 기능 선택을 꺼 주세요.');
				else issues.length = 0;
			} else if (
				review.verification !== 'none' &&
				review.candidateFingerprint !== changeMarker(result.config)
			) {
				status = 'stale';
				issues.unshift('검증한 후보 설정과 현재 후보가 다릅니다. 검증 증거를 다시 확인해 주세요.');
			} else if (conflict && selected) {
				status = 'conflict';
			} else if (
				['external', 'alternative'].includes(review.verification) &&
				filled(review.verificationEvidence) &&
				!selected
			) {
				status = review.verification === 'external' ? 'external_verified' : 'alternative_verified';
				issues.length = 0;
			} else if (!selected) {
				status = 'pending';
				issues.unshift(
					'기능이 제외됐습니다. 필요한 기능을 켜거나 외부·대체 이행 증거를 등록해 주세요.'
				);
			} else if (unsupported) {
				status = 'unsupported';
			} else if (issues.length) {
				status = 'pending';
			} else if (external) {
				status =
					review.verification === 'external' && filled(review.verificationEvidence)
						? 'external_verified'
						: 'configured';
				if (status === 'configured')
					issues.unshift(
						'기존 로그 재사용 확인만으로는 충분하지 않습니다. 실제 기록·보관·점검 증거를 등록해 주세요.'
					);
			} else if (review.verification === 'gateway' && filled(review.verificationEvidence)) {
				status = 'verified';
			} else {
				status = 'configured';
				issues.unshift('설정 생성은 완료됐지만 실제 동작 검증 기록이 없습니다.');
			}
			counts[status]++;
			return {
				key,
				status,
				label: readinessLabels[status],
				applicability: review?.applicability ?? 'unknown',
				selected,
				technical,
				issues,
				blocked: ![
					'not_applicable',
					'verified',
					'external_verified',
					'alternative_verified'
				].includes(status)
			};
		});
	const blockers = cards.filter(card => card.blocked).map(card => `${card.key}: ${card.label}`);
	const active = cards.filter(card => card.selected);
	const compileOk = Boolean(
		active.length &&
			active.every(card => card.technical === 'configured' || card.technical === 'external') &&
			!result.findings.length
	);
	if (!active.length) blockers.push('적용할 기능이 없습니다. 기존 실행 설정은 변경하지 않습니다.');
	for (const finding of result.findings)
		if (!cards.some(card => card.key === finding.policy)) blockers.push(finding.message);
	return {
		version: 1,
		cards,
		counts,
		compileOk,
		releaseReady: compileOk && !blockers.length,
		blockers
	};
}

export function assertPolicyReadiness(
	plan: JsonObject,
	config: JsonObject,
	profile: ImportProfile,
	reviews: ReviewProfile,
	candidate: JsonObject
) {
	const result = adaptPolicyPlan(plan, config, profile);
	if (JSON.stringify(result.config) !== JSON.stringify(candidate))
		throw new Error('검토한 설정과 적용 후보가 다릅니다. 다시 확인해 주세요.');
	const report = evaluatePolicyReadiness(plan, config, profile, reviews, result);
	if (!report.releaseReady) throw new Error(`적용 준비 미완료: ${report.blockers.join(' / ')}`);
}
