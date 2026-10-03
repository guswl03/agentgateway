import type { JsonObject } from '@/policyAdapter';

export function fieldChoices(fn: JsonObject, values: JsonObject) {
	const choices = new Map<
		string,
		{ resource: string; path: string; label: string; supported: boolean }
	>();
	for (const mapping of fn.target?.mappings ?? [])
		for (const element of mapping.element_paths ?? []) {
			const resource = mapping.resource_type ?? String(element).split('.')[0];
			const path = String(element).startsWith(`${resource}.`)
				? String(element).slice(resource.length + 1)
				: String(element);
			choices.set(`${resource}/${path}`, {
				resource,
				path,
				label: String(element),
				supported: path.split('.').every(p => /^[A-Za-z_][A-Za-z0-9_]*(\[\])?$/.test(p))
			});
		}
	for (const path of values.paths ?? []) {
		const resource = values.resource_type ?? '';
		if (![...choices.values()].some(c => c.path === path && (!resource || resource === c.resource)))
			choices.set(`${resource}/${path}`, {
				resource,
				path,
				label: resource ? `${resource}.${path}` : path,
				supported: true
			});
	}
	return [...choices.values()];
}

export function conditionChoices(config: JsonObject, current?: JsonObject) {
	const paths = new Set<string>();
	const facts = new Set<string>();
	const values = new Map<string, unknown[]>();
	function add(fact: string, value: unknown) {
		facts.add(fact);
		const existing = values.get(fact) ?? [];
		if (!existing.some(v => JSON.stringify(v) === JSON.stringify(value))) existing.push(value);
		values.set(fact, existing);
	}
	function visit(value: unknown) {
		if (typeof value === 'string') {
			for (const match of value.matchAll(
				/\b(jwt\.[A-Za-z_][A-Za-z0-9_.]*)\s*==\s*(true|false|"(?:[^"\\]|\\.)*"|\d+)/g
			)) {
				try {
					add(match[1], JSON.parse(match[2]));
				} catch {
					/* Keep only parseable existing comparisons. */
				}
			}
		} else if (value && typeof value === 'object') {
			const object = value as JsonObject;
			if (typeof object.path?.exact === 'string') paths.add(object.path.exact);
			if (typeof object.eq?.fact === 'string' && object.eq.fact.startsWith('jwt.'))
				add(object.eq.fact, object.eq.value);
			Object.values(value).forEach(visit);
		}
	}
	visit(config);
	visit(current);
	if (current?.eq?.fact === 'request.path' && current.eq.value) paths.add(current.eq.value);
	return { paths: [...paths], facts: [...facts], values };
}

export function functionMatch(fn: JsonObject) {
	const direction = fn.function_id.endsWith('RESPONSE')
		? '응답'
		: fn.function_id.endsWith('REQUEST')
			? '요청'
			: '왕복';
	const labels: Record<string, string> = {
		remove_field: '본문 변환 → 지정 필드 삭제',
		set_header: '헤더 변환 → 값 설정',
		add_header: '헤더 변환 → 값 추가',
		remove_header: '헤더 변환 → 제거',
		rewrite_body: '본문 변환 → 표시 정보 삽입',
		authorize_require: 'HTTP 인가 → 필수 조건 검사',
		require_jwt: 'JWT 인증 → 서명·발급자·만료 검증 필수',
		rate_limit: '요청 횟수 제한 → 등록된 횟수·시간 구간',
		limit_requests: '요청 횟수 제한 → 등록된 횟수·시간 구간',
		reject: '내용 검사 → 일치하는 텍스트 거절',
		mask: '내용 검사 → 일치하는 텍스트 치환',
		route_to_backend: '라우팅 → 기존 백엔드 + 승인 검사',
		log_access: '접근 로그 → 기존 기록 설정',
		trace: '추적 → 기존 수집처·샘플링'
	};
	const match =
		/^AGW-REGEX-GUARD-/.test(fn.function_id) && ['reject', 'mask'].includes(fn.action)
			? `정규식 가드 → 일치하는 텍스트 ${fn.action === 'reject' ? '거절' : '치환'}`
			: (labels[fn.action] ?? fn.action);
	return `${direction} · ${match}`;
}

export type NativePolicyChoice = { label: string; value: JsonObject };

export function builtinRegexChoices(direction: string, action: string): NativePolicyChoice[] {
	if (!['reject', 'mask'].includes(action)) return [];
	const patterns: Record<string, string> = {
		email: '이메일 주소',
		phoneNumber: '전화번호',
		creditCard: '신용카드 번호',
		ssn: '미국 사회보장번호 · 한국 주민등록번호용 아님',
		caSin: '캐나다 사회보험번호'
	};
	return Object.entries(patterns).map(([builtin, label]) => ({
		label: `Gateway 기본 패턴 · ${label}`,
		value: {
			regex: { action, rules: [{ builtin }] },
			...(direction === 'request' ? { scope: ['systemPrompt', 'messages'] } : {})
		}
	}));
}

// These choices reuse actual Gateway settings. No legal facts or data patterns are invented.
export function nativePolicyChoices(
	config: JsonObject,
	kind: 'regex' | 'jwt' | 'rate',
	direction = 'request',
	action = 'reject'
): NativePolicyChoice[] {
	const choices = new Map<string, NativePolicyChoice>();
	const isObject = (value: unknown): value is JsonObject =>
		Boolean(value && typeof value === 'object' && !Array.isArray(value));
	const add = (label: string, value: JsonObject) => {
		const copy = structuredClone(value);
		delete copy.policySources;
		const identity = JSON.stringify(copy);
		if (!choices.has(identity)) choices.set(identity, { label, value: copy });
	};
	function strictJwt(value: JsonObject): JsonObject | undefined {
		const providers = Array.isArray(value.providers) ? value.providers : [value];
		if (
			!providers.length ||
			providers.some(
				(provider: JsonObject) =>
					!isObject(provider) ||
					typeof provider.issuer !== 'string' ||
					!provider.issuer.trim() ||
					!Array.isArray(provider.audiences) ||
					!provider.audiences.length ||
					!provider.audiences.every(
						(audience: unknown) => typeof audience === 'string' && audience.trim()
					) ||
					!provider.jwks
			)
		)
			return;
		const copy = structuredClone(value);
		copy.mode = 'strict';
		for (const provider of Array.isArray(copy.providers) ? copy.providers : [copy]) {
			provider.jwtValidationOptions ??= {};
			provider.jwtValidationOptions.requiredClaims = [
				...new Set([...(provider.jwtValidationOptions.requiredClaims ?? []), 'exp'])
			];
		}
		return copy;
	}
	function visit(node: unknown, path: string) {
		if (Array.isArray(node)) {
			node.forEach((child, index) => {
				visit(child, `${path}[${index}]`);
			});
			return;
		}
		if (!isObject(node)) return;
		for (const [key, value] of Object.entries(node)) {
			// A condition-bearing policy cannot be detached and presented as an unconditional preset.
			if (key === 'conditional') continue;
			const location = path ? `${path}.${key}` : key;
			if (kind === 'regex' && ['guardrails', 'promptGuard'].includes(key) && isObject(value)) {
				for (const [index, guard] of (Array.isArray(value[direction])
					? value[direction]
					: []
				).entries()) {
					if (
						!isObject(guard) ||
						!isObject(guard.regex) ||
						(guard.regex.action ?? 'mask') !== action
					)
						continue;
					if (!Array.isArray(guard.regex.rules) || !guard.regex.rules.length) continue;
					const copy = structuredClone(guard);
					copy.regex.action = action;
					if (direction === 'request') copy.scope ??= ['systemPrompt', 'messages'];
					const patterns = guard.regex.rules
						.map((rule: JsonObject) => rule.pattern ?? rule.builtin ?? '')
						.join(' / ');
					add(`기존 규칙 · ${location}.${direction}[${index}] · ${patterns}`, copy);
				}
			} else if (kind === 'jwt' && key === 'jwtAuth' && isObject(value)) {
				const strict = strictJwt(value);
				if (strict) {
					const names = (strict.providers ?? [strict])
						.map((provider: JsonObject) => provider.issuer)
						.join(' / ');
					add(`기존 발급자 · ${names} · JWT 필수`, strict);
				}
			} else if (kind === 'rate' && key === 'localRateLimit' && Array.isArray(value)) {
				for (const limit of value) {
					if (!isObject(limit) || (limit.type !== undefined && limit.type !== 'requests')) continue;
					if (
						!Number.isSafeInteger(limit.maxTokens) ||
						limit.maxTokens <= 0 ||
						!Number.isSafeInteger(limit.tokensPerFill) ||
						limit.tokensPerFill <= 0 ||
						typeof limit.fillInterval !== 'string' ||
						!limit.fillInterval.trim()
					)
						continue;
					if (
						limit.key !== undefined &&
						limit.key !== null &&
						(typeof limit.key !== 'string' ||
							!/^(request\.(path|method)|jwt\.[A-Za-z_][A-Za-z0-9_.]*)$/.test(limit.key))
					)
						continue;
					add(
						`기존 제한 · 최대 ${limit.maxTokens}회 / ${limit.fillInterval}마다 ${limit.tokensPerFill}회 충전${limit.key ? ' · 키별 제한' : ' · 공통 제한'}`,
						{ ...limit, type: 'requests' }
					);
				}
			}
			visit(value, location);
		}
	}
	visit(config, '');
	return [...choices.values()];
}
