import { useEffect, useState } from 'react';

import { requestJson } from '@/api/base';
import type { JsonObject } from '@/policyAdapter';

type Pack = { id: string; label: string; description: string; card_count: number };
export function PolicyPackPicker({
	onGenerated,
	onBegin
}: {
	onGenerated: (plan: JsonObject) => void;
	onBegin: () => void;
}) {
	const [packs, setPacks] = useState<Pack[]>([]),
		[selected, setSelected] = useState<string[]>([]);
	const [uploads, setUploads] = useState<{ id: string; name: string; document: JsonObject }[]>([]);
	const [error, setError] = useState(''),
		[loading, setLoading] = useState(true),
		[busy, setBusy] = useState(false);
	useEffect(() => {
		let active = true;
		requestJson<{ packs: Pack[] }>('/api/policy/packs')
			.then(data => {
				if (active) setPacks(data.packs);
			})
			.catch(e => {
				if (active) setError(e.message);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, []);
	async function generate() {
		onBegin();
		setBusy(true);
		setError('');
		try {
			const plan = await requestJson<JsonObject>('/api/policy/compile', {
				method: 'POST',
				body: JSON.stringify({ pack_ids: selected, documents: uploads.map(u => u.document) })
			});
			onGenerated(plan);
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	}
	return (
		<div className="policy-pack-picker">
			<p className="muted-copy">
				검토할 법률 범위를 선택하세요. 각 정책이 우리 서비스에 적용되는지는 다음 단계에서
				판단합니다.
			</p>
			{loading && <p>정책 팩 목록을 불러오는 중입니다.</p>}
			<div className="policy-pack-grid">
				{packs.map(pack => (
					<label key={pack.id} className="policy-pack-option">
						<input
							type="checkbox"
							aria-label={pack.label}
							checked={selected.includes(pack.id)}
							onChange={e =>
								setSelected(
									e.target.checked ? [...selected, pack.id] : selected.filter(id => id !== pack.id)
								)
							}
						/>
						<span>
							<strong>{pack.label}</strong>
							<small>{pack.card_count}개 정책</small>
						</span>
					</label>
				))}
			</div>
			<div className="button-row policy-pack-tools">
				<button
					type="button"
					className="button secondary"
					disabled={!packs.length || busy}
					onClick={() => setSelected(packs.map(pack => pack.id))}
				>
					전체 팩 선택
				</button>
				<label className="button secondary">
					다른 정책 팩 파일 추가
					<input
						aria-label="정책 팩 파일 추가"
						type="file"
						accept=".json,application/json"
						multiple
						onChange={async e => {
							try {
								const next: { id: string; name: string; document: JsonObject }[] = [];
								for (const file of Array.from(e.target.files ?? [])) {
									if (file.size > 2 * 1024 * 1024)
										throw new Error('팩 파일은 2MB 이하로 선택해 주세요.');
									const document = JSON.parse(await file.text());
									if (!Array.isArray(document.policy_packs) || !Array.isArray(document.cards))
										throw new Error(
											'정책 팩 파일에는 policy_packs와 cards가 있어야 합니다. 중간 JSON은 아래 가져오기에서 사용해 주세요.'
										);
									next.push({ id: crypto.randomUUID(), name: file.name, document });
								}
								setUploads(current => [...current, ...next]);
								setError('');
							} catch (error) {
								setError((error as Error).message);
							}
							e.target.value = '';
						}}
					/>
				</label>
			</div>
			{uploads.map((upload, i) => (
				<div className="policy-upload-row" key={upload.id}>
					<span>{upload.name}</span>
					<button
						className="button secondary"
						type="button"
						onClick={() => setUploads(current => current.filter((_, index) => index !== i))}
					>
						제외
					</button>
				</div>
			))}
			<div className="button-row policy-pack-start">
				<span role="status">
					{selected.length}개 팩 ·{' '}
					{packs
						.filter(pack => selected.includes(pack.id))
						.reduce((sum, pack) => sum + pack.card_count, 0)}
					개 정책 선택{uploads.length ? ` · 추가 파일 ${uploads.length}개` : ''}
				</span>
				<button
					className="button primary"
					type="button"
					disabled={busy || (!selected.length && !uploads.length)}
					onClick={() => void generate()}
					aria-label={busy ? '정책 목록 준비 중' : '선택한 팩으로 설정 만들기'}
				>
					{busy ? '정책 목록 준비 중…' : '선택한 정책 검토 시작 →'}
				</button>
			</div>
			{error && (
				<p className="policy-findings" role="alert">
					{error}
				</p>
			)}
		</div>
	);
}
