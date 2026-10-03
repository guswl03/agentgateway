import type { JsonObject } from '@/policyAdapter';

export type JwtSetupDraft = { issuer: string; jwksUrl: string; audiences: string };
export type RateSetupDraft = { count: string; interval: string; unit: string; basis: string };
export type NativeSetupResult = { ok: true; value: JsonObject } | { ok: false; error: string };
export type EditableNativeSetupDraft =
	| { kind: 'jwt'; draft: JwtSetupDraft }
	| { kind: 'rate'; draft: RateSetupDraft };

function httpsUrl(value: string, issuer = false): boolean {
	if (!/^https:\/\/[^/]/.test(value) || /[\s\\#]/.test(value)) return false;
	try {
		const url = new URL(value);
		return (
			url.protocol === 'https:' &&
			Boolean(url.hostname) &&
			!url.username &&
			!url.password &&
			!url.hash &&
			(!issuer || !value.includes('?'))
		);
	} catch {
		return false;
	}
}

export function createJwtSetup(draft: JwtSetupDraft): NativeSetupResult {
	const issuer = draft.issuer.trim();
	const jwksUrl = draft.jwksUrl.trim();
	if (!httpsUrl(issuer, true))
		return {
			ok: false,
			error: '발급자 주소를 HTTPS 주소로 입력해 주세요. 로그인 정보·쿼리·#은 제외합니다.'
		};
	if (!httpsUrl(jwksUrl))
		return {
			ok: false,
			error: '검증키 주소를 HTTPS 주소로 입력해 주세요. 로그인 정보와 #은 제외합니다.'
		};
	const audiences = draft.audiences.split(',').map(value => value.trim());
	if (
		[...draft.audiences].some(value => value.charCodeAt(0) < 32 || value.charCodeAt(0) === 127) ||
		audiences.some(value => !value)
	)
		return { ok: false, error: '허용할 서비스 이름을 입력해 주세요. 여러 개면 쉼표로 구분합니다.' };
	return {
		ok: true,
		value: {
			mode: 'strict',
			issuer,
			audiences: [...new Set(audiences)],
			jwks: { url: jwksUrl },
			jwtValidationOptions: { requiredClaims: ['exp'] }
		}
	};
}

function positiveInteger(value: string): number | undefined {
	if (!/^\d+$/.test(value.trim())) return;
	const number = Number(value.trim());
	return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

export function createRateSetup(draft: RateSetupDraft): NativeSetupResult {
	const count = positiveInteger(draft.count);
	if (count === undefined)
		return { ok: false, error: '허용 횟수는 1 이상의 정수로 입력해 주세요.' };
	const interval = positiveInteger(draft.interval);
	const scales: Record<string, bigint> = { s: 1000000000n, m: 60000000000n, h: 3600000000000n };
	if (
		interval === undefined ||
		!(Object.hasOwn(scales, draft.unit) || draft.unit === 'd') ||
		(draft.unit === 'd'
			? BigInt(interval) * 86400n > 18446744073709551615n
			: BigInt(interval) * scales[draft.unit] > 9223372036854775807n)
	)
		return { ok: false, error: '시간 구간은 지원 범위 안의 1 이상 정수와 단위로 입력해 주세요.' };
	const keys: Record<string, string | undefined> = {
		shared: undefined,
		path: 'request.path',
		method: 'request.method'
	};
	if (!Object.hasOwn(keys, draft.basis))
		return { ok: false, error: '제한 기준을 전체·경로별·메서드별 중에서 선택해 주세요.' };
	return {
		ok: true,
		value: {
			maxTokens: count,
			tokensPerFill: count,
			fillInterval: `${interval}${draft.unit}`,
			type: 'requests',
			...(keys[draft.basis] ? { key: keys[draft.basis] } : {})
		}
	};
}

function sameNativeShape(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (Array.isArray(left) || Array.isArray(right))
		return (
			Array.isArray(left) &&
			Array.isArray(right) &&
			left.length === right.length &&
			left.every((value, index) => sameNativeShape(value, right[index]))
		);
	if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
	const leftEntries = Object.entries(left);
	const rightObject = right as Record<string, unknown>;
	return (
		leftEntries.length === Object.keys(right).length &&
		leftEntries.every(
			([key, value]) => Object.hasOwn(rightObject, key) && sameNativeShape(value, rightObject[key])
		)
	);
}

export function editableNativeSetupDraft(
	kind: 'jwt' | 'rate',
	value?: JsonObject
): EditableNativeSetupDraft | undefined {
	if (!value) return;
	if (kind === 'jwt') {
		if (
			typeof value.issuer !== 'string' ||
			typeof value.jwks?.url !== 'string' ||
			!Array.isArray(value.audiences) ||
			!value.audiences.every((audience: unknown) => typeof audience === 'string')
		)
			return;
		const draft = {
			issuer: value.issuer,
			jwksUrl: value.jwks.url,
			audiences: value.audiences.join(', ')
		};
		const generated = createJwtSetup(draft);
		if (generated.ok && sameNativeShape(generated.value, value)) return { kind, draft };
		return;
	}
	if (typeof value.maxTokens !== 'number' || typeof value.fillInterval !== 'string') return;
	const interval = /^(\d+)(s|m|h|d)$/.exec(value.fillInterval);
	if (!interval) return;
	const draft = {
		count: String(value.maxTokens),
		interval: interval[1],
		unit: interval[2],
		basis:
			value.key === undefined
				? 'shared'
				: value.key === 'request.path'
					? 'path'
					: value.key === 'request.method'
						? 'method'
						: ''
	};
	const generated = createRateSetup(draft);
	if (generated.ok && sameNativeShape(generated.value, value)) return { kind, draft };
}

export function canEditNativeSetup(kind: 'jwt' | 'rate', value?: JsonObject): boolean {
	return Boolean(editableNativeSetupDraft(kind, value));
}
