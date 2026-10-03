import { useId, useState } from 'react';

import type { JsonObject } from '@/policyAdapter';
import { createJwtSetup, createRateSetup, editableNativeSetupDraft } from '@/policyNativeSetup';

export function PolicyNativeSetup({
	kind,
	label,
	value,
	onChange
}: {
	kind: 'jwt' | 'rate';
	label: string;
	value?: JsonObject;
	onChange: (value: JsonObject) => void;
}) {
	const editable = editableNativeSetupDraft(kind, value);
	const errorId = useId();
	const [jwt, setJwt] = useState(() =>
		editable?.kind === 'jwt' ? editable.draft : { issuer: '', jwksUrl: '', audiences: '' }
	);
	const [rate, setRate] = useState(() =>
		editable?.kind === 'rate'
			? editable.draft
			: { count: '', interval: '', unit: 'm', basis: 'shared' }
	);
	const [error, setError] = useState('');
	// Richer imported settings stay in the existing advanced editor without losing fields.
	if (value && !editable)
		return (
			<p className="muted-copy">연결된 설정을 사용합니다. 변경은 세부 설정에서 할 수 있습니다.</p>
		);
	const changed = () => setError('');
	const connect = () => {
		const result = kind === 'jwt' ? createJwtSetup(jwt) : createRateSetup(rate);
		if (!result.ok) {
			setError(result.error);
			return;
		}
		setError('');
		onChange(result.value);
	};
	return (
		<div className="policy-native-setup">
			<div className="policy-fields">
				{kind === 'jwt' ? (
					<>
						<label>
							발급자 주소 (Issuer)
							<input
								type="url"
								aria-label={`${label} 발급자 주소`}
								aria-describedby={error ? errorId : undefined}
								placeholder="https://인증서버/발급자"
								value={jwt.issuer}
								onChange={event => {
									setJwt(current => ({ ...current, issuer: event.target.value }));
									changed();
								}}
							/>
						</label>
						<label>
							검증키 주소 (JWKS)
							<input
								type="url"
								aria-label={`${label} 검증키 주소`}
								aria-describedby={error ? errorId : undefined}
								placeholder="https://인증서버/검증키"
								value={jwt.jwksUrl}
								onChange={event => {
									setJwt(current => ({ ...current, jwksUrl: event.target.value }));
									changed();
								}}
							/>
						</label>
						<label>
							허용 서비스 (Audience)
							<input
								aria-label={`${label} 허용 서비스`}
								aria-describedby={error ? errorId : undefined}
								placeholder="인증서버에 등록된 서비스 이름 · 여러 개면 쉼표"
								value={jwt.audiences}
								onChange={event => {
									setJwt(current => ({ ...current, audiences: event.target.value }));
									changed();
								}}
							/>
						</label>
					</>
				) : (
					<>
						<label>
							허용 횟수
							<input
								type="number"
								min="1"
								step="1"
								aria-label={`${label} 허용 횟수`}
								aria-describedby={error ? errorId : undefined}
								placeholder="횟수 입력"
								value={rate.count}
								onChange={event => {
									setRate(current => ({ ...current, count: event.target.value }));
									changed();
								}}
							/>
						</label>
						<label>
							시간 구간
							<input
								type="number"
								min="1"
								step="1"
								aria-label={`${label} 시간 구간`}
								aria-describedby={error ? errorId : undefined}
								placeholder="시간 입력"
								value={rate.interval}
								onChange={event => {
									setRate(current => ({ ...current, interval: event.target.value }));
									changed();
								}}
							/>
						</label>
						<label>
							시간 단위
							<select
								aria-label={`${label} 시간 단위`}
								value={rate.unit}
								onChange={event => {
									setRate(current => ({ ...current, unit: event.target.value }));
									changed();
								}}
							>
								<option value="s">초</option>
								<option value="m">분</option>
								<option value="h">시간</option>
								<option value="d">일</option>
							</select>
						</label>
						<label>
							제한 기준
							<select
								aria-label={`${label} 제한 기준`}
								value={rate.basis}
								onChange={event => {
									setRate(current => ({ ...current, basis: event.target.value }));
									changed();
								}}
							>
								<option value="shared">적용 대상별 요청을 함께 제한</option>
								<option value="path">요청 경로별</option>
								<option value="method">요청 메서드별</option>
							</select>
						</label>
					</>
				)}
			</div>
			{kind === 'rate' && (
				<p className="muted-copy">
					시간 구간마다 입력한 횟수만큼 충전하며, 최대 보유량도 같습니다.
				</p>
			)}
			{error && (
				<p id={errorId} className="policy-findings" role="alert">
					{error}
				</p>
			)}
			<button
				type="button"
				className="button primary"
				aria-label={`${label} 연결`}
				onClick={connect}
			>
				{kind === 'jwt' ? '인증 정보 연결' : '횟수 제한 연결'}
			</button>
		</div>
	);
}
