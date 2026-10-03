import { useRef, useState } from 'react';

import type { JsonObject } from '@/policyAdapter';
import {
	emptyReviewDraft,
	type PolicyReview,
	type ReadinessCard,
	type ReadinessReport,
	type ReviewDraft,
	type ReviewProfile
} from '@/policyReadiness';

export function PolicyReadiness({
	policies,
	report,
	reviews,
	onSave,
	onEdit
}: {
	policies: JsonObject[];
	report: ReadinessReport;
	reviews: ReviewProfile;
	onSave: (key: string, draft: ReviewDraft) => void;
	onEdit: (key: string) => void;
}) {
	const [filter, setFilter] = useState('all');
	const [query, setQuery] = useState('');
	const [selectedKey, setSelectedKey] = useState('');
	const detailRef = useRef<HTMLElement>(null);
	const selectPolicy = (key: string) => {
		setSelectedKey(key);
		if (window.matchMedia('(max-width: 1000px)').matches)
			detailRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	};
	const [drafts, setDrafts] = useState<Record<string, { base?: PolicyReview; value: ReviewDraft }>>(
		{}
	);
	const groups = [
		{ id: 'all', label: '전체', count: report.cards.length },
		{ id: 'judgment', label: '판단 필요', count: report.counts.unknown },
		{
			id: 'setup',
			label: '설정·재확인',
			count:
				report.counts.pending +
				report.counts.unsupported +
				report.counts.conflict +
				report.counts.stale
		},
		{ id: 'verification', label: '검증 대기', count: report.counts.configured },
		{
			id: 'confirmed',
			label: '기록 확인',
			count:
				report.counts.verified +
				report.counts.external_verified +
				report.counts.alternative_verified
		},
		{ id: 'exempt', label: '미적용', count: report.counts.not_applicable }
	];
	const visible = report.cards.filter(card => {
		const policy = policies.find(item => `${item.law_id}/${item.policy_id}` === card.key);
		const match =
			filter === 'all' ||
			(filter === 'judgment' && card.status === 'unknown') ||
			(filter === 'setup' &&
				['pending', 'unsupported', 'conflict', 'stale'].includes(card.status)) ||
			(filter === 'verification' && card.status === 'configured') ||
			(filter === 'confirmed' &&
				['verified', 'external_verified', 'alternative_verified'].includes(card.status)) ||
			(filter === 'exempt' && card.status === 'not_applicable');
		return (
			match &&
			`${card.key} ${policy?.policy_text ?? ''} ${lawTitle(policy)}`
				.toLocaleLowerCase()
				.includes(query.trim().toLocaleLowerCase())
		);
	});
	const selected = visible.find(card => card.key === selectedKey) ?? visible[0];
	const selectedPolicy = policies.find(
		item => `${item.law_id}/${item.policy_id}` === selected?.key
	);
	const saved = selected ? reviews.reviews[selected.key] : undefined;
	const currentDraft =
		selected && drafts[selected.key]?.base === saved ? drafts[selected.key]?.value : undefined;
	const done = report.cards.filter(card => !card.blocked).length;
	return (
		<section className="policy-readiness" aria-label="적용 판단과 검증 상태">
			<div className="policy-section-title">
				<div>
					<h3>적용 판단과 검증 상태</h3>
					<p>정책을 선택하고, 우리 서비스에 적용되는 이유와 이행 근거를 기록하세요.</p>
				</div>
				<span className={`policy-pill ${report.releaseReady ? 'ready' : ''}`} role="status">
					{report.releaseReady ? '등록된 검토 기록 확인 완료' : '적용 준비 미완료'}
				</span>
			</div>
			<div className="policy-review-progress" role="status">
				<span>
					검토 기록 확인{' '}
					<strong>
						{done} / {report.cards.length}
					</strong>
				</span>
				<progress aria-label="검토 기록 확인 진행률" value={done} max={report.cards.length || 1} />
				<small>기능을 꺼도 적용 여부의 판단은 필요합니다.</small>
			</div>
			<fieldset className="policy-review-filters" aria-label="정책 상태 필터">
				{groups.map(group => (
					<button
						type="button"
						key={group.id}
						aria-pressed={filter === group.id}
						onClick={() => setFilter(group.id)}
					>
						{group.label} <strong>{group.count}</strong>
					</button>
				))}
			</fieldset>
			<label className="policy-review-search">
				정책 검색
				<input
					type="search"
					value={query}
					onChange={event => setQuery(event.target.value)}
					placeholder="법률명, 조항 또는 정책 내용으로 찾기"
				/>
			</label>
			<div className="policy-review-workbench">
				<div className="policy-review-catalog">
					<p className="muted-copy" role="status">
						{report.cards.length}개 정책 중 {visible.length}개 표시 · 정책을 선택하면 상세 검토가
						열립니다.
					</p>
					<div className="policy-review-table-scroll">
						<table className="policy-review-table" aria-label="정책 검토 목록">
							<thead>
								<tr>
									<th scope="col">정책 요구사항</th>
									<th scope="col">서비스 적용</th>
									<th scope="col">설정·검증 상태</th>
								</tr>
							</thead>
							<tbody>
								{visible.map(card => {
									const policy = policies.find(
										item => `${item.law_id}/${item.policy_id}` === card.key
									);
									const draft = drafts[card.key];
									const unsaved = draft && draft.base === reviews.reviews[card.key];
									const applicability = unsaved ? draft.value.applicability : card.applicability;
									return (
										<tr
											key={card.key}
											data-readiness-key={card.key}
											data-readiness-status={card.status}
											data-selected={selected?.key === card.key}
										>
											<td>
												<button
													type="button"
													className="policy-review-select"
													aria-label={`${card.key} 정책 검토`}
													aria-pressed={selected?.key === card.key}
													onClick={() => selectPolicy(card.key)}
												>
													<strong>{lawTitle(policy) || card.key}</strong>
													<span>{policy?.policy_text || card.key}</span>
												</button>
											</td>
											<td>
												{applicabilityLabels[applicability]}
												{unsaved && <small className="policy-review-unsaved">저장 전</small>}
												<small>{card.selected ? '기능 선택됨' : '이번 기능 선택 제외'}</small>
											</td>
											<td>
												<span className={`policy-pill ${card.blocked ? '' : 'ready'}`}>
													{card.label}
												</span>
												<small>{technicalLabels[card.technical]}</small>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
					{!visible.length && (
						<div className="policy-review-empty">
							<strong>해당하는 정책이 없습니다.</strong>
							<p>검색어나 상태 필터를 바꿔 보세요.</p>
							<button
								type="button"
								className="button secondary"
								onClick={() => {
									setFilter('all');
									setQuery('');
								}}
							>
								전체 정책 보기
							</button>
						</div>
					)}
				</div>
				{selected && (
					<aside
						ref={detailRef}
						className="policy-review-detail"
						aria-label="선택한 정책 상세 검토"
					>
						<div className="policy-review-detail-heading">
							<span className="policy-eyebrow">
								선택한 정책 · {visible.indexOf(selected) + 1} / {visible.length}
							</span>
							<h4>{lawTitle(selectedPolicy) || selected.key}</h4>
							<span className={`policy-pill ${selected.blocked ? '' : 'ready'}`}>
								{selected.label}
							</span>
						</div>
						<ReviewEditor
							key={selected.key}
							card={selected}
							policy={selectedPolicy}
							review={saved}
							draft={currentDraft ?? saved ?? emptyReviewDraft()}
							onChange={value =>
								setDrafts(current => ({ ...current, [selected.key]: { base: saved, value } }))
							}
							onSave={draft => onSave(selected.key, draft)}
							onEdit={() => onEdit(selected.key)}
						/>
						{visible.some(card => card.blocked && card.key !== selected.key) && (
							<button
								type="button"
								className="button secondary policy-review-next"
								onClick={() => {
									const start = visible.indexOf(selected);
									const ordered = [...visible.slice(start + 1), ...visible.slice(0, start)];
									const next = ordered.find(card => card.blocked);
									if (next) setSelectedKey(next.key);
								}}
							>
								다음 검토할 정책 →
							</button>
						)}
					</aside>
				)}
			</div>
			<p className="muted-copy policy-review-limit">
				설정 생성과 검증 기록을 구분합니다. 등록된 증거는 담당자의 기록이며 법률 준수 인증을 뜻하지
				않습니다.
			</p>
		</section>
	);
}

const technicalLabels: Record<ReadinessCard['technical'], string> = {
	excluded: '이번 기능 선택 제외',
	missing: '설정값 부족',
	configured: '설정 생성됨',
	external: '로그 운영 증거 필요',
	unsupported: '현재 기능 미지원',
	conflict: '기존 설정 충돌'
};
const applicabilityLabels: Record<ReviewDraft['applicability'], string> = {
	applicable: '적용',
	not_applicable: '미적용',
	unknown: '판단 전'
};
function lawTitle(policy?: JsonObject) {
	return (
		policy?.legal_sources
			?.map((source: JsonObject) => `${source.law_name} · ${source.provision}`)
			.join(' / ') || ''
	);
}
function ReviewEditor({
	card,
	policy,
	review,
	draft,
	onChange,
	onSave,
	onEdit
}: {
	card: ReadinessCard;
	policy?: JsonObject;
	review?: PolicyReview;
	draft: ReviewDraft;
	onChange: (draft: ReviewDraft) => void;
	onSave: (draft: ReviewDraft) => void;
	onEdit: () => void;
}) {
	const [error, setError] = useState('');
	const patch = (value: Partial<ReviewDraft>) => {
		onChange({ ...draft, ...value });
		setError('');
	};
	return (
		<div className="policy-readiness-editor">
			<div className="policy-review-requirement">
				<strong>이 정책이 요구하는 것</strong>
				<p>{policy?.policy_text || card.key}</p>
			</div>
			{card.issues.length > 0 && (
				<ul className="policy-findings">
					{card.issues.map(issue => (
						<li key={issue}>{issue}</li>
					))}
				</ul>
			)}
			<div className="policy-review-prompt">
				<strong>1. 우리 서비스에 적용되는가?</strong>
				<p>서비스 목적과 처리 범위를 바탕으로 판단하고 이유를 남깁니다.</p>
			</div>
			<div className="policy-fields">
				<fieldset className="policy-applicability" aria-label={`${card.key} 서비스 적용 여부`}>
					<legend>서비스 적용 여부</legend>
					<div className="policy-applicability-buttons">
						{(['applicable', 'not_applicable', 'unknown'] as const).map(value => (
							<button
								type="button"
								key={value}
								aria-label={`${card.key} ${applicabilityLabels[value]}`}
								aria-pressed={draft.applicability === value}
								onClick={() => patch({ applicability: value })}
							>
								{draft.applicability === value && <span aria-hidden="true">✓ </span>}
								{applicabilityLabels[value]}
							</button>
						))}
					</div>
					<small>선택 후 이유와 근거를 입력하고 판단 기록을 저장하세요.</small>
				</fieldset>
				<label>
					판단 담당자
					<input
						aria-label={`${card.key} 판단 담당자`}
						maxLength={8192}
						value={draft.reviewer}
						onChange={event => patch({ reviewer: event.target.value })}
						placeholder="담당자 또는 검토 조직"
					/>
				</label>
			</div>
			<label>
				판단 이유
				<textarea
					aria-label={`${card.key} 판단 이유`}
					maxLength={8192}
					rows={2}
					value={draft.reason}
					onChange={event => patch({ reason: event.target.value })}
					placeholder="서비스 목적·이용자·처리 범위와 적용 또는 예외 이유"
				/>
			</label>
			<label>
				판단 근거
				<input
					aria-label={`${card.key} 판단 근거`}
					maxLength={8192}
					value={draft.evidence}
					onChange={event => patch({ evidence: event.target.value })}
					placeholder="검토 문서·티켓·승인 기록의 위치 또는 식별자"
				/>
			</label>
			{draft.applicability === 'applicable' && (
				<>
					<div className="policy-review-prompt">
						<strong>2. 어떻게 이행했고 확인했는가?</strong>
						<p>기능 설정을 확인하고, 실제 동작이나 외부 이행의 증거를 기록합니다.</p>
					</div>
					<label>
						검증 방법
						<select
							aria-label={`${card.key} 검증 방법`}
							value={draft.verification}
							onChange={event =>
								patch({ verification: event.target.value as ReviewDraft['verification'] })
							}
						>
							<option value="none">실제 검증 기록 없음</option>
							<option value="gateway">현재 후보의 Gateway 동작 검증</option>
							<option value="external">외부 시스템에서 이행 확인</option>
							<option value="alternative">동등한 대체 통제 확인</option>
						</select>
					</label>
					{draft.verification !== 'none' && (
						<label>
							검증 증거
							<textarea
								aria-label={`${card.key} 검증 증거`}
								maxLength={8192}
								rows={3}
								value={draft.verificationEvidence}
								onChange={event => patch({ verificationEvidence: event.target.value })}
								placeholder="실행 결과·대상 환경·검증 범위와 증거 위치. 외부/대체 통제는 이행 시스템·담당자·충족 범위 포함."
							/>
						</label>
					)}
				</>
			)}
			{(draft.applicability === 'not_applicable' ||
				['external', 'alternative'].includes(draft.verification)) && (
				<p className="muted-copy">
					미적용 또는 외부·대체 이행으로 기록하면 이번 Gateway 기능 선택을 해제합니다. 기존 실행
					정책은 삭제하지 않습니다.
				</p>
			)}
			{review && (
				<p className="muted-copy">
					최근 기록: {new Date(review.reviewedAt).toLocaleString('ko-KR')} ·{' '}
					{review.reviewer || '담당자 미등록'}
				</p>
			)}
			<div className="button-row">
				<button
					type="button"
					className="button secondary"
					aria-label={`${card.key} 판단 기록 저장`}
					onClick={() => {
						try {
							onSave({
								...draft,
								...(draft.applicability !== 'applicable'
									? { verification: 'none', verificationEvidence: '' }
									: {})
							});
							setError('');
						} catch (cause) {
							setError((cause as Error).message);
						}
					}}
				>
					판단 기록 저장
				</button>
				<button type="button" className="button secondary" onClick={onEdit}>
					기능·경로 설정 열기
				</button>
			</div>
			{error && <p role="alert">{error}</p>}
		</div>
	);
}
