import { useState } from 'react';

import { validateGatewayConfig } from '@/configValidation';
import { useApplyPolicyConfig, useEffectiveGatewayConfig, useRuntimeInfo } from '@/hooks';
import { policyTargets, removePolicyTransforms } from '@/policyAdapter';

export function PolicySettingsRemoval() {
	const config = useEffectiveGatewayConfig(),
		runtime = useRuntimeInfo(),
		update = useApplyPolicyConfig();
	const [target, setTarget] = useState('all'),
		[message, setMessage] = useState(''),
		[busy, setBusy] = useState(false);
	const targets = config.data ? policyTargets(config.data) : [];
	async function remove() {
		if (!config.data) return;
		setBusy(true);
		setMessage('');
		try {
			const next = removePolicyTransforms(
				config.data,
				target === 'all' ? targets.map(t => t.id) : [target]
			);
			await validateGatewayConfig(next);
			const url = URL.createObjectURL(
				new Blob([JSON.stringify(config.data, null, 2)], { type: 'application/json' })
			);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = 'gateway-before-policy-removal.json';
			anchor.click();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
			await update.mutateAsync({ before: config.data, after: next });
			setMessage('기존 본문·헤더 변환을 제거했습니다. 새 정책 팩을 적용할 수 있습니다.');
		} catch (e) {
			setMessage((e as Error).message);
		} finally {
			setBusy(false);
		}
	}
	return (
		<details>
			<summary>기존 정책 변환 정리</summary>
			<p className="muted-copy">
				선택한 경로의 기존 본문·헤더 변환을 제거합니다. 경로·모델·목적지·인증·인가 설정은 유지하며
				기존 설정을 백업 파일로 내려받습니다.
			</p>
			<label>
				제거할 경로
				<select
					aria-label="기존 변환 제거 경로"
					value={target}
					onChange={e => setTarget(e.target.value)}
				>
					<option value="all">모든 기존 경로</option>
					{targets.map(t => (
						<option key={t.id} value={t.id}>
							{t.label}
						</option>
					))}
				</select>
			</label>
			<button
				type="button"
				className="button secondary"
				disabled={
					busy ||
					update.isPending ||
					!targets.length ||
					!['file', 'hybrid'].includes(runtime.data?.ui.configStoreMode ?? '')
				}
				onClick={() => void remove()}
			>
				기존 본문·헤더 변환 제거
			</button>
			{message && <p role="status">{message}</p>}
		</details>
	);
}
