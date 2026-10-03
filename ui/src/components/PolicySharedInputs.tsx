import { type ReactNode, useMemo, useState } from 'react';

import type { Finding, ImportProfile, JsonObject } from '@/policyAdapter';
import { policyKey, policyTargets, regexTargetSupported } from '@/policyAdapter';
import {
	applySharedFunction,
	applySharedPresets,
	applySharedScope,
	reuseExistingSharedSettings,
	type SharedPresets,
	sharedFunctionGroups
} from '@/policyShared';

type FunctionEditor = {
	label: string;
	fn: JsonObject;
	values: JsonObject;
	target?: string;
	onChange: (patch: JsonObject) => void;
};
type ConditionEditor = {
	label: string;
	value?: JsonObject;
	onChange: (condition: JsonObject | undefined) => void;
};

export function PolicySharedInputs({
	plan,
	config,
	profile,
	presets,
	findings,
	onProfile,
	functionLabel,
	renderCondition,
	renderFunction
}: {
	plan: JsonObject;
	config: JsonObject;
	profile: ImportProfile;
	presets: SharedPresets;
	findings: Finding[];
	onProfile: (profile: ImportProfile) => void;
	functionLabel: (fn: JsonObject) => string;
	renderCondition: (props: ConditionEditor) => ReactNode;
	renderFunction: (props: FunctionEditor) => ReactNode;
}) {
	const targets = policyTargets(config);
	const [target, setTarget] = useState(targets.length === 1 ? targets[0].id : '');
	const [condition, setCondition] = useState<JsonObject>();
	const [drafts, setDrafts] = useState<Record<string, JsonObject>>({});
	const [notice, setNotice] = useState('');
	const [error, setError] = useState('');
	const policies: JsonObject[] = plan.policy_packs.flatMap((pack: JsonObject) => pack.policies);
	const groups = useMemo(
		() => sharedFunctionGroups(plan, config, profile),
		[plan, config, profile]
	).filter(group => group.members.length > 1 && group.missingFields.length > 0);
	const missingScope = policies.filter(policy => {
		const binding = profile.bindings[policyKey(policy)];
		if (binding?.enabled === false) return false;
		return (
			(!policy.scope?.target_ref && !binding?.target) ||
			(!policy.applies_when && !binding?.condition)
		);
	}).length;
	const needsRegexTarget = policies.some(policy => {
		const binding = profile.bindings[policyKey(policy)];
		if (binding?.enabled === false) return false;
		if (policy.scope?.target_ref || binding?.target) return false;
		return policy.function?.some(
			(fn: JsonObject, index: number) =>
				/^AGW-REGEX-GUARD-/.test(fn.function_id) &&
				(binding?.selectedFunctions?.includes(index) ??
					(policy.function_combination === 'all' || policy.function.length === 1))
		);
	});
	const availableTargets = targets.filter(
		item => !needsRegexTarget || regexTargetSupported(config, item.id)
	);
	function confirmScope() {
		setError('');
		try {
			const scope = applySharedScope(plan, config, profile, {
				...(target ? { target } : {}),
				...(condition ? { condition } : {})
			});
			const saved = applySharedPresets(plan, config, scope.profile, presets);
			// A stale saved connection must be reviewed before another source can silently replace it.
			const existing =
				saved.stale > 0
					? { profile: saved.profile, changed: 0, skipped: 0, stale: 0 }
					: reuseExistingSharedSettings(plan, config, saved.profile);
			onProfile(existing.profile);
			setDrafts({});
			setNotice(
				`공통 설정 연결 ${scope.changed}개 카드 · 저장된 공통 설정 재사용 ${saved.changed}개 기능 · 기존 설정 자동 재사용 ${existing.changed}개 기능 · 오래된 연결 정보: 공통 경로 ${scope.stale}개 카드 / 저장 설정 ${saved.stale}개 기능 / 기존 연결 ${existing.stale}개 기능`
			);
		} catch (cause) {
			setError(`공통 연결 확인: ${(cause as Error).message}`);
		}
	}
	function confirmFunction(groupId: string, draft: JsonObject) {
		setError('');
		try {
			const patch = Object.fromEntries(
				Object.entries(draft).filter(([, value]) => value !== undefined)
			);
			const result = applySharedFunction(plan, config, profile, groupId, patch);
			onProfile(result.profile);
			setDrafts(current => ({ ...current, [groupId]: {} }));
			setNotice(
				`공통 입력 연결 ${result.changed}개 기능 · 기존 입력 유지 ${result.skipped}개 · 오래된 연결 정보 ${result.stale}개`
			);
		} catch (cause) {
			setError(`공통 연결 확인: ${(cause as Error).message}`);
		}
	}
	return (
		<section className="policy-shared-inputs" aria-label="공통 입력">
			<div className="policy-section-title">
				<div>
					<h4>공통 설정 · 한 번 확인</h4>
					<p className="muted-copy">
						{missingScope}개 카드의 미입력 경로·조건을 함께 연결합니다. 카드에 이미 지정된 내용과
						개별 입력은 유지합니다.
					</p>
				</div>
			</div>
			<div className="policy-fields">
				<label>
					공통 적용 경로
					<select
						aria-label="공통 적용 경로"
						value={target}
						onChange={event => setTarget(event.target.value)}
					>
						<option value="">기존 경로 선택</option>
						<option
							value="all"
							disabled={availableTargets.length !== targets.length || targets.length === 0}
						>
							모든 기존 경로 · 카드의 적용 조건 유지
						</option>
						{targets.map(item => (
							<option
								key={item.id}
								value={item.id}
								disabled={!availableTargets.some(available => available.id === item.id)}
							>
								{item.label}
								{!availableTargets.some(available => available.id === item.id) &&
									' · 정규식 검사 미지원'}
							</option>
						))}
					</select>
				</label>
				{renderCondition({ label: '공통 적용 조건', value: condition, onChange: setCondition })}
				<button
					type="button"
					className="button primary"
					disabled={!target && !condition}
					onClick={confirmScope}
				>
					공통 설정 확인하고 연결
				</button>
			</div>
			{presets.entries.length > 0 && (
				<p className="muted-copy">
					저장된 공통 기술 설정 {presets.entries.length}개 · 경로와 적용 조건을 확인하면 일치하는
					설정을 재사용합니다.
				</p>
			)}
			{notice && (
				<p className="policy-shared-notice" role="status">
					{notice}
				</p>
			)}
			{error && (
				<p className="policy-findings" role="alert">
					{error}
				</p>
			)}
			{groups.length > 0 && <h4 className="policy-shared-heading">같은 연결 정보는 한 번 입력</h4>}
			{groups.map((group, groupIndex) => {
				const label = functionLabel(group.fn);
				const draft = drafts[group.id] ?? {};
				const values = { ...group.values, ...draft };
				const groupFindings = findings.filter(finding => {
					const match = /^기능 (\d+):/.exec(finding.message);
					return (
						match &&
						group.members.some(
							member => member.policyKey === finding.policy && member.index === Number(match[1]) - 1
						)
					);
				});
				const messages = [
					...new Set(groupFindings.map(finding => finding.message.replace(/^기능 \d+:\s*/, '')))
				];
				return (
					<section
						className="policy-shared-group"
						key={group.id}
						aria-label={`공통 기능 ${groupIndex + 1}`}
						data-action={group.fn.action}
					>
						<div className="policy-section-title">
							<strong>{label}</strong>
							<span className="policy-pill">
								{group.members.length}개 기능 · {group.policyKeys.length}개 카드
							</span>
						</div>
						<p className="muted-copy">
							{targets.find(item => item.id === group.target)?.label ??
								(group.target === 'all' ? '모든 기존 경로' : '경로 미연결')}{' '}
							· 미입력 항목에만 연결합니다.
						</p>
						{(!group.target || !group.condition) && (
							<p className="policy-findings">먼저 적용 경로와 조건을 확인해 주세요.</p>
						)}
						<fieldset
							className="policy-shared-editor"
							disabled={!group.target || !group.condition || group.stale === group.members.length}
						>
							<legend>{label} 공통 연결 정보</legend>
							<div className="policy-fields">
								{renderFunction({
									label: `공통 기능 ${groupIndex + 1}`,
									fn: group.fn,
									values,
									target: group.target,
									onChange: patch =>
										setDrafts(current => ({
											...current,
											[group.id]: { ...current[group.id], ...patch }
										}))
								})}
							</div>
							<button
								type="button"
								className="button secondary"
								disabled={!Object.keys(draft).length}
								onClick={() => confirmFunction(group.id, draft)}
							>
								{group.members.length}개 기능에 연결
							</button>
						</fieldset>
						{messages.length > 0 && (
							<ul className="policy-findings">
								{messages.map(message => (
									<li key={message}>{message}</li>
								))}
							</ul>
						)}
						<details>
							<summary>연결할 카드 목록</summary>
							<ul>
								{group.policyKeys.map(key => (
									<li key={key}>{key}</li>
								))}
							</ul>
						</details>
					</section>
				);
			})}
		</section>
	);
}
