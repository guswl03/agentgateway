// This module never infers legal applicability or approves candidate field mappings.
// biome-ignore lint/style/noRestrictedImports: This pure contract module also runs directly under Node without the UI alias resolver.
import { validateFhirFilterProfile } from './policyFhir.ts';
export type JsonObject = Record<string, any>;
export type RegexGuardBinding = {
	guardrail: {
		regex: { action: 'reject' | 'mask'; rules: ({ pattern: string } | { builtin: string })[] };
		scope?: ('systemPrompt' | 'messages' | 'toolInput' | 'toolOutput')[];
		rejection?: JsonObject;
	};
	response_mode?: 'non_streaming' | 'streaming_partial';
};
export type JwtAuthBinding = { jwt_auth: JsonObject };
export type RequestRateLimitBinding = {
	local_rate_limit: {
		maxTokens: number;
		tokensPerFill: number;
		fillInterval: string;
		type: 'requests';
		key?: string;
	};
};
export type PolicyBinding = {
	enabled?: boolean;
	target?: string;
	targetFingerprint?: string;
	policyFingerprint?: string;
	condition?: JsonObject;
	selectedFunctions?: number[];
	functions?: Record<string, JsonObject>;
};
export type ImportProfile = { version: 1; bindings: Record<string, PolicyBinding> };
export type Finding = {
	policy: string;
	message: string;
	kind: 'missing' | 'unsupported' | 'conflict';
};
export type ImportResult = {
	config: JsonObject;
	findings: Finding[];
	notes: string[];
	expressions: string[];
};

function object(value: unknown): value is JsonObject {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function check(ok: unknown, message: string): asserts ok {
	if (!ok) throw new Error(message);
}
const keyOf = (policy: JsonObject) => `${policy.law_id}/${policy.policy_id}`;

export { keyOf as policyKey };

export function policyFingerprint(policy: JsonObject): string {
	return JSON.stringify({
		text: policy.policy_text,
		legal_sources: policy.legal_sources,
		functions: policy.function?.map((f: JsonObject) => ({
			id: f.function_id,
			action: f.action,
			object: f.object,
			direction: f.direction,
			traffic: f.traffic,
			target: f.target,
			parameters: f.parameters
		})),
		except: policy.except,
		condition: policy.applies_when,
		scope: policy.scope,
		combination: policy.function_combination
	});
}

export function parsePolicyPlan(source: string): JsonObject {
	const plan = JSON.parse(source);
	check(
		object(plan) &&
			plan.version === '1.1-draft' &&
			Array.isArray(plan.policy_packs) &&
			plan.policy_packs.length,
		'커넥터 출력 1.1-draft JSON을 넣어 주세요.'
	);
	const keys = new Set<string>();
	const priorities = new Set<number>();
	const packs = new Set<string>();
	for (const pack of plan.policy_packs) {
		check(
			object(pack) &&
				typeof pack.pack_id === 'string' &&
				typeof pack.version === 'string' &&
				Number.isInteger(pack.priority) &&
				Array.isArray(pack.policies) &&
				pack.policies.length,
			'정책 팩 형식이 올바르지 않습니다.'
		);
		check(
			!packs.has(pack.pack_id) && !priorities.has(pack.priority),
			'팩 ID와 우선순위는 중복될 수 없습니다.'
		);
		packs.add(pack.pack_id);
		priorities.add(pack.priority);
		for (const policy of pack.policies) {
			check(
				object(policy) &&
					typeof policy.law_id === 'string' &&
					typeof policy.policy_id === 'string' &&
					typeof policy.policy_text === 'string',
				'카드 ID와 정책 내용이 필요합니다.'
			);
			check(!keys.has(keyOf(policy)), '중복 카드가 있습니다.');
			keys.add(keyOf(policy));
			check(
				policy.function === null || Array.isArray(policy.function),
				'function은 배열 또는 null이어야 합니다.'
			);
			check(
				policy.except === null || Array.isArray(policy.except),
				'except는 배열 또는 null이어야 합니다.'
			);
			check(Array.isArray(policy.legal_sources), '법령 근거 배열이 필요합니다.');
			for (const func of policy.function ?? [])
				check(
					object(func) &&
						typeof func.function_id === 'string' &&
						typeof func.action === 'string' &&
						(func.object === null || typeof func.object === 'string') &&
						object(func.parameters),
					'기능 항목 형식이 올바르지 않습니다.'
				);
		}
	}
	for (const pack of plan.policy_packs)
		for (const policy of pack.policies)
			for (const ref of policy.except ?? []) {
				check(
					object(ref) && keys.has(`${ref.law_id}/${ref.policy_id}`),
					'배제 카드 참조가 없습니다.'
				);
				const owner = plan.policy_packs.find((p: JsonObject) =>
					p.policies.some(
						(c: JsonObject) => c.law_id === ref.law_id && c.policy_id === ref.policy_id
					)
				);
				check(
					owner.priority < pack.priority && owner.pack_id === ref.pack_id,
					'배제는 낮은 우선순위 팩의 카드만 참조할 수 있습니다.'
				);
			}
	return plan;
}

export function parseProfile(source: string): ImportProfile {
	const profile = JSON.parse(source);
	check(
		object(profile) && profile.version === 1 && object(profile.bindings),
		'연결 정보 파일의 형식이 올바르지 않습니다.'
	);
	for (const binding of Object.values(profile.bindings)) {
		check(object(binding), '연결 항목이 올바르지 않습니다.');
		if (binding.enabled !== undefined)
			check(typeof binding.enabled === 'boolean', '카드 적용 여부는 true 또는 false여야 합니다.');
		if (binding.target !== undefined)
			check(typeof binding.target === 'string', '경로 참조가 올바르지 않습니다.');
		if (binding.selectedFunctions !== undefined)
			check(
				Array.isArray(binding.selectedFunctions) &&
					binding.selectedFunctions.every((i: unknown) => Number.isInteger(i) && Number(i) >= 0),
				'선택 기능 인덱스가 올바르지 않습니다.'
			);
		if (binding.functions !== undefined)
			check(
				object(binding.functions) &&
					Object.entries(binding.functions).every(
						([index, value]) => /^(0|[1-9]\d*)$/.test(index) && object(value)
					),
				'기능 연결 정보가 올바르지 않습니다.'
			);
		for (const name of ['targetFingerprint', 'policyFingerprint'])
			if (binding[name] !== undefined)
				check(typeof binding[name] === 'string', '저장된 연결 정보의 식별값이 올바르지 않습니다.');
		// Inactive settings are preserved for later review, not executed or silently repaired.
		// Re-enabling restores all condition and execution-parameter validation below.
		if (binding.enabled === false) continue;
		if (binding.condition !== undefined) conditionCel(binding.condition);
		for (const parameters of Object.values(binding.functions ?? {}) as JsonObject[]) {
			if ('fhir_filter' in parameters) {
				check(
					parameters.body_location === 'request_fhir',
					'FHIR 보호의 본문 처리 형식을 확인해 주세요.'
				);
				onlyKeys(
					parameters,
					['body_location', 'fhir_filter'],
					'FHIR 보호와 지정 필드 삭제를 함께 설정할 수 없습니다.'
				);
				validateFhirFilterProfile(parameters.fhir_filter);
			}
			if ('guardrail' in parameters)
				regexGuard(
					parameters,
					parameters.guardrail?.regex?.action,
					parameters.response_mode === undefined ? 'request' : 'response'
				);
			if ('jwt_auth' in parameters) jwtAuthentication(parameters.jwt_auth);
			if ('local_rate_limit' in parameters) requestRateLimit(parameters.local_rate_limit);
		}
	}
	return profile as ImportProfile;
}

export function policyTargets(config: JsonObject): { id: string; label: string }[] {
	const targets: { id: string; label: string }[] = [];
	if (object(config.llm)) targets.push({ id: 'llm', label: '기존 LLM 경로' });
	(config.routes ?? []).forEach(
		(route: JsonObject, i: number) =>
			void targets.push({ id: `route:${i}`, label: route.name ?? `HTTP 경로 ${i + 1}` })
	);
	(config.binds ?? []).forEach(
		(bind: JsonObject, b: number) =>
			void (bind.listeners ?? []).forEach(
				(listener: JsonObject, l: number) =>
					void (listener.routes ?? []).forEach(
						(route: JsonObject, r: number) =>
							void targets.push({
								id: `bind:${b}:${l}:${r}`,
								label: `${listener.name ?? bind.port} / ${route.name ?? r + 1}`
							})
					)
			)
	);
	return targets;
}

export function targetFingerprint(config: JsonObject, target: string): string {
	if (target === 'all')
		return JSON.stringify(policyTargets(config).map(t => [t.id, targetFingerprint(config, t.id)]));
	const value = resolveTarget(config, target);
	return JSON.stringify(
		value
			? {
					name: value.name,
					matches: value.matches,
					hostnames: value.hostnames,
					backends: value.backends,
					models: value.models,
					gateways: value.gateways
				}
			: null
	);
}

export function removePolicyTransforms(original: JsonObject, targets: string[]): JsonObject {
	const config = structuredClone(original);
	check(targets.length > 0, '제거할 경로를 선택해 주세요.');
	for (const id of targets) {
		const target = resolveTarget(config, id);
		check(target, '제거할 경로를 찾을 수 없습니다.');
		if (target.policies) delete target.policies.transformations;
	}
	return config;
}

function resolveTarget(config: JsonObject, target: string): JsonObject | undefined {
	if (target === 'llm') return config.llm;
	const parts = target.split(':');
	if (parts[0] === 'route') return config.routes?.[Number(parts[1])];
	if (parts[0] === 'bind')
		return config.binds?.[Number(parts[1])]?.listeners?.[Number(parts[2])]?.routes?.[
			Number(parts[3])
		];
	return undefined;
}

const literal = (value: unknown) => JSON.stringify(value);
// Transport-aware instruction insertion; independent of policy/card identity.
export function requestInstructionCel(text: unknown): string {
	check(typeof text === 'string' && text.trim(), '요청에 추가할 표시 지시가 필요합니다.');
	const instruction = literal(text);
	return `json(request.body).with(b, ("messages" in b && type(b.messages) == list) ? b.merge({"messages": [{"role": "system", "content": ${instruction}}] + b.messages}) : b.merge({"instructions": (("instructions" in b && b.instructions != null) ? b.instructions + "\\n\\n" : "") + ${instruction}}))`;
}
export function conditionCel(node: unknown, depth = 0): string {
	check(
		depth < 32 && object(node) && Object.keys(node).length === 1,
		'적용 조건 형식을 확인해 주세요.'
	);
	const [op, operand] = Object.entries(node)[0];
	if (op === 'constant') {
		check(typeof operand === 'boolean', '상수 조건은 true/false여야 합니다.');
		return String(operand);
	}
	if (op === 'all' || op === 'any') {
		check(Array.isArray(operand) && operand.length, '조건 목록이 필요합니다.');
		return `(${operand.map(n => conditionCel(n, depth + 1)).join(op === 'all' ? ' && ' : ' || ')})`;
	}
	if (op === 'not') return `!(${conditionCel(operand, depth + 1)})`;
	check(['eq', 'in', 'exists'].includes(op) && object(operand), '지원하지 않는 조건입니다.');
	const fact = operand.fact;
	// Only Gateway-native facts are accepted. Approval headers are not trusted implicitly.
	check(
		typeof fact === 'string' &&
			/^(request\.(path|method)|jwt\.[A-Za-z_][A-Za-z0-9_.]*)$/.test(fact),
		'이 조건의 정보원은 아직 연결되지 않았습니다. 검증된 JWT 값 또는 요청 경로·메서드를 사용해 주세요.'
	);
	if (op === 'exists') return `has(${fact})`;
	if (op === 'in') check(Array.isArray(operand.value), 'in 조건은 값 목록이 필요합니다.');
	else
		check(
			operand.value === null || ['string', 'number', 'boolean'].includes(typeof operand.value),
			'비교할 값이 필요합니다.'
		);
	return `(${fact} ${op === 'in' ? 'in' : '=='} ${literal(operand.value)})`;
}

// Relative element paths, e.g. telecom[].value. Missing keys stay unchanged.
export function deleteFieldsCel(paths: string[], base = 'b'): string {
	check(paths.length > 0 && paths.length <= 100, '삭제할 필드 목록이 필요합니다.');
	function removeAt(expr: string, parts: string[], depth: number): string {
		const part = parts[0];
		check(
			/^[A-Za-z_][A-Za-z0-9_]*(\[\])?$/.test(part),
			'필드 경로는 name 또는 telecom[].value 같은 형식으로 입력해 주세요.'
		);
		const array = part.endsWith('[]');
		const key = array ? part.slice(0, -2) : part;
		if (parts.length === 1) return `${expr}.filterKeys(k${depth}, k${depth} != ${literal(key)})`;
		const value = `${expr}[${literal(key)}]`;
		const next = array
			? `${value}.map(v${depth}, ${removeAt(`v${depth}`, parts.slice(1), depth + 1)})`
			: removeAt(value, parts.slice(1), depth + 1);
		return `(${literal(key)} in ${expr} && ${value} != null ? ${expr}.merge({${literal(key)}: ${next}}) : ${expr})`;
	}
	return paths.reduce((expr, path, index) => {
		check(path.split('.').length <= 12, '필드 경로가 너무 깊습니다.');
		return `${expr}.with(d${index}, ${removeAt(`d${index}`, path.split('.'), 0)})`;
	}, base);
}

class NativeConflict extends Error {}
function onlyKeys(value: JsonObject, allowed: string[], message: string): void {
	check(
		Object.keys(value).every(key => allowed.includes(key)),
		message
	);
}
function sameValue(left: unknown, right: unknown): boolean {
	const stable = (value: unknown): unknown =>
		Array.isArray(value)
			? value.map(stable)
			: object(value)
				? Object.fromEntries(
						Object.keys(value)
							.sort()
							.map(key => [key, stable(value[key])])
					)
				: value;
	return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

// A preset shares execution settings, never the legal identity of its previous owner.
export function policyTechnicalValue(value: JsonObject): JsonObject {
	const technical = structuredClone(value);
	delete technical.policySources;
	return technical;
}

function sourceIdentity(source: JsonObject): string {
	return JSON.stringify([
		source.pack_id,
		source.law_id,
		source.policy_id,
		source.function_id,
		source.function_index,
		source.action
	]);
}

function sourceCardIdentity(source: JsonObject): string {
	return JSON.stringify([source.pack_id, source.law_id, source.policy_id]);
}

type SourceUpdates = WeakMap<JsonObject, Set<string>>;
type SourceCards = WeakMap<JsonObject, string[]>;

function attributionText(value: unknown, maxBytes: number): value is string {
	return (
		typeof value === 'string' &&
		Boolean(value.trim()) &&
		!/\p{Cc}/u.test(value) &&
		new TextEncoder().encode(value).length <= maxBytes
	);
}

function mergePolicySources(
	control: JsonObject,
	sources: JsonObject[],
	updates?: SourceUpdates,
	cards: string[] = sources.map(sourceCardIdentity)
): void {
	if (!sources.length && !updates) return;
	check(
		control.policySources === undefined ||
			(Array.isArray(control.policySources) && control.policySources.every(object)),
		'기존 정책의 법령 근거 설정을 확인해 주세요.'
	);
	const merged = new Map<string, JsonObject>();
	for (const source of control.policySources ?? [])
		merged.set(sourceIdentity(source), structuredClone(source));
	// On first reuse of this execution unit, replace the card's previous snapshot
	// as a whole. Indices can move between revisions; later selected indices from
	// this same import are accumulated instead of deleting each other.
	if (updates) {
		const refreshed = updates.get(control) ?? new Set<string>();
		for (const card of cards) {
			if (refreshed.has(card)) continue;
			for (const [identity, previous] of merged)
				if (sourceCardIdentity(previous) === card) merged.delete(identity);
			refreshed.add(card);
		}
		updates.set(control, refreshed);
	}
	for (const source of sources) merged.set(sourceIdentity(source), structuredClone(source));
	check(merged.size <= 64, '한 실행 항목의 법령 근거는 최대 64개 카드까지 연결할 수 있습니다.');
	if (merged.size)
		control.policySources = [...merged.entries()]
			.sort(([left], [right]) => left.localeCompare(right, 'en'))
			.map(([, source]) => source);
	else delete control.policySources;
}

function executionSources(pack: JsonObject, policy: JsonObject, index: number): JsonObject[] {
	const legal = (policy.legal_sources ?? []).filter(
		(source: unknown) =>
			object(source) &&
			typeof source.law_name === 'string' &&
			source.law_name.trim() &&
			typeof source.provision === 'string' &&
			source.provision.trim()
	);
	// Technical fixtures and unresolved identities must never invent a statutory basis.
	if (!legal.length) return [];
	check(legal.length <= 16, '한 카드의 법령 근거는 최대 16개까지 연결할 수 있습니다.');
	const sources = legal.map((source: JsonObject) => {
		check(
			attributionText(source.law_name, 1024) && attributionText(source.provision, 1024),
			'법령명과 조항은 제어 문자가 없는 1024바이트 이하 문자열이어야 합니다.'
		);
		const result: JsonObject = { law_name: source.law_name, provision: source.provision };
		for (const field of [
			'level',
			'source_url',
			'revision_no',
			'promulgation_date',
			'effective_date'
		]) {
			if (source[field] === undefined || source[field] === null) continue;
			check(attributionText(source[field], 2048), '법령 근거의 판본과 출처 정보를 확인해 주세요.');
			result[field] = source[field];
		}
		return result;
	});
	const fn = policy.function[index];
	check(
		[pack.pack_id, pack.version, policy.law_id, policy.policy_id, fn.function_id, fn.action].every(
			value => attributionText(value, 256)
		),
		'정책과 기능의 식별값은 제어 문자가 없는 256바이트 이하 문자열이어야 합니다.'
	);
	return [
		{
			pack_id: pack.pack_id,
			pack_version: pack.version,
			law_id: policy.law_id,
			policy_id: policy.policy_id,
			function_id: fn.function_id,
			function_index: index,
			action: fn.action,
			legal_sources: sources
		}
	];
}

function sourcedRule(require: string, sources: JsonObject[]): JsonObject {
	const rule: JsonObject = { require };
	mergePolicySources(rule, sources);
	return rule;
}

function bodyDecision(
	before: string,
	after: string,
	condition: string,
	sources: JsonObject[]
): JsonObject {
	const decision: JsonObject = {
		action: 'remove_field',
		changedWhen: `(${condition}) && (${before}).with(p, (${after}).with(n, p != n))`
	};
	mergePolicySources(decision, sources);
	return decision;
}

function mergeBodyDecisions(
	existing: unknown,
	next: JsonObject[],
	updates: SourceUpdates,
	sourceCards: SourceCards
): JsonObject[] {
	check(
		existing === undefined || (Array.isArray(existing) && existing.every(object)),
		'기존 본문 처리의 법령 근거 설정을 확인해 주세요.'
	);
	const merged: JsonObject[] = structuredClone(existing ?? []);
	for (const decision of next) {
		const previous = merged.find(value =>
			sameValue(policyTechnicalValue(value), policyTechnicalValue(decision))
		);
		const cards = sourceCards.get(decision) ?? [];
		if (previous) mergePolicySources(previous, decision.policySources ?? [], updates, cards);
		else {
			const added = structuredClone(decision);
			mergePolicySources(added, added.policySources ?? [], updates, cards);
			merged.push(added);
		}
	}
	const result = merged.filter(decision => decision.policySources?.length);
	check(
		result.length <= 64,
		'한 본문 변환의 법령 근거 판별은 최대 64개 삭제 단계까지 연결할 수 있습니다.'
	);
	return result;
}
const headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
function rejectResponse(value: unknown): JsonObject {
	check(value === undefined || object(value), '거부 응답 설정은 객체여야 합니다.');
	const rejection = structuredClone(value ?? {});
	onlyKeys(rejection, ['status', 'body', 'headers'], '지원하지 않는 거부 응답 설정입니다.');
	rejection.status ??= 403;
	rejection.body ??= 'The request was rejected due to inappropriate content';
	check(
		Number.isInteger(rejection.status) && rejection.status >= 400 && rejection.status <= 599,
		'거부 응답은 400~599 상태 코드여야 합니다.'
	);
	check(typeof rejection.body === 'string', '거부 응답 본문은 문자열이어야 합니다.');
	if (rejection.headers !== undefined && rejection.headers !== null) {
		check(object(rejection.headers), '거부 응답 헤더 설정을 확인해 주세요.');
		onlyKeys(
			rejection.headers,
			['set', 'add', 'remove'],
			'지원하지 않는 거부 응답 헤더 설정입니다.'
		);
		for (const operation of ['set', 'add']) {
			const headers = rejection.headers[operation];
			if (headers === undefined) continue;
			check(
				object(headers) &&
					Object.entries(headers).every(
						([name, text]) =>
							headerName.test(name) && typeof text === 'string' && !/[\r\n]/.test(text)
					),
				'거부 응답 헤더 이름과 값을 확인해 주세요.'
			);
		}
		if (rejection.headers.remove !== undefined)
			check(
				Array.isArray(rejection.headers.remove) &&
					rejection.headers.remove.every(
						(name: unknown) => typeof name === 'string' && headerName.test(name)
					),
				'제거할 거부 응답 헤더 목록을 확인해 주세요.'
			);
	}
	return rejection;
}
function regexGuard(params: JsonObject, action: string, direction: string): JsonObject {
	onlyKeys(
		params,
		['guardrail', 'response_mode'],
		'정규식 연결에는 guardrail과 응답 방식만 지원합니다.'
	);
	check(
		object(params.guardrail) && object(params.guardrail.regex),
		'검토된 정규식 검사 설정을 연결해 주세요.'
	);
	const guard = structuredClone(params.guardrail);
	onlyKeys(
		guard,
		direction === 'request' ? ['regex', 'scope', 'rejection'] : ['regex', 'rejection'],
		'이 방향에서 지원하지 않는 정규식 검사 범위 또는 설정입니다.'
	);
	onlyKeys(
		guard.regex,
		['action', 'rules'],
		'정규식은 rules와 action만 지원합니다. 임의 치환값은 지원하지 않습니다.'
	);
	check(
		['reject', 'mask'].includes(action) && guard.regex.action === action,
		'카드 동작과 정규식 동작이 일치해야 합니다.'
	);
	check(
		Array.isArray(guard.regex.rules) &&
			guard.regex.rules.length > 0 &&
			guard.regex.rules.length <= 100,
		'검토된 정규식 또는 기본 패턴 목록이 필요합니다.'
	);
	for (const rule of guard.regex.rules) {
		check(object(rule) && Object.keys(rule).length === 1, '정규식 규칙 형식이 올바르지 않습니다.');
		if ('pattern' in rule)
			check(
				typeof rule.pattern === 'string' && rule.pattern.trim() && rule.pattern.length <= 16384,
				'정규식 패턴은 비어 있지 않은 문자열이어야 합니다.'
			);
		else
			check(
				['ssn', 'creditCard', 'phoneNumber', 'email', 'caSin'].includes(rule.builtin),
				'Gateway에서 지원하지 않는 기본 정규식 패턴입니다.'
			);
	}
	if (direction === 'request') {
		check(params.response_mode === undefined, '응답 방식은 응답 정규식에만 설정할 수 있습니다.');
		guard.scope ??= ['systemPrompt', 'messages'];
		check(
			Array.isArray(guard.scope) &&
				guard.scope.length > 0 &&
				new Set(guard.scope).size === guard.scope.length &&
				guard.scope.every((scope: unknown) =>
					['systemPrompt', 'messages', 'toolInput', 'toolOutput'].includes(String(scope))
				),
			'요청 검사 범위는 systemPrompt, messages, toolInput, toolOutput 중 선택해 주세요.'
		);
	} else {
		check(
			['non_streaming', 'streaming_partial'].includes(params.response_mode),
			'응답의 비스트림 또는 부분 스트림 검사 방식을 선택해 주세요.'
		);
		check(
			action !== 'mask' || params.response_mode === 'non_streaming',
			'응답 정규식 mask는 SSE 스트리밍에서 지원하지 않습니다.'
		);
	}
	if (action === 'reject') guard.rejection = rejectResponse(guard.rejection);
	else check(guard.rejection === undefined, 'mask에는 거부 응답 설정을 적용할 수 없습니다.');
	return guard;
}
function jwtAuthentication(value: unknown): JsonObject {
	check(object(value), 'JWT 발급자·대상·검증키 설정을 연결해 주세요.');
	const jwt = structuredClone(value);
	onlyKeys(
		jwt,
		[
			'mode',
			'issuer',
			'audiences',
			'jwks',
			'jwtValidationOptions',
			'providers',
			'location',
			'preserveToken'
		],
		'지원하지 않는 JWT 설정입니다. 업무 승인 또는 법적 판정값을 인증 설정으로 사용하지 않습니다.'
	);
	check(jwt.mode === undefined || jwt.mode === 'strict', 'JWT 통신 인증은 strict 모드여야 합니다.');
	jwt.mode = 'strict';
	if (jwt.preserveToken !== undefined)
		check(typeof jwt.preserveToken === 'boolean', 'JWT 보존 설정은 true/false여야 합니다.');
	if (jwt.location !== undefined) {
		check(
			object(jwt.location) && Object.keys(jwt.location).length === 1,
			'JWT 위치 설정을 확인해 주세요.'
		);
		const [kind, location] = Object.entries(jwt.location)[0];
		check(
			['header', 'queryParameter', 'cookie'].includes(kind) && object(location),
			'JWT는 헤더·쿼리 매개변수·쿠키에서만 읽습니다.'
		);
		onlyKeys(
			location,
			kind === 'header' ? ['name', 'prefix'] : ['name'],
			'JWT 위치 설정을 확인해 주세요.'
		);
		check(
			typeof location.name === 'string' && location.name.trim() && !/[\r\n]/.test(location.name),
			'JWT 위치 이름을 확인해 주세요.'
		);
		if (kind === 'header') {
			check(headerName.test(location.name), 'JWT 헤더 이름을 확인해 주세요.');
			if (location.prefix !== undefined && location.prefix !== null)
				check(
					typeof location.prefix === 'string' && !/[\r\n]/.test(location.prefix),
					'JWT 헤더 접두사를 확인해 주세요.'
				);
		}
	}
	let providers: JsonObject[];
	if (jwt.providers !== undefined) {
		check(
			Array.isArray(jwt.providers) && jwt.providers.length > 0 && jwt.providers.every(object),
			'JWT 검증 제공자 목록이 필요합니다.'
		);
		check(
			['issuer', 'audiences', 'jwks', 'jwtValidationOptions'].every(name => !(name in jwt)),
			'단일 JWT 발급자와 providers를 동시에 설정할 수 없습니다.'
		);
		providers = jwt.providers;
	} else providers = [jwt];
	for (const provider of providers) {
		if (provider !== jwt)
			onlyKeys(
				provider,
				['issuer', 'audiences', 'jwks', 'jwtValidationOptions'],
				'JWT 제공자 설정을 확인해 주세요.'
			);
		check(
			typeof provider.issuer === 'string' && provider.issuer.trim(),
			'고정 JWT 발급자가 필요합니다.'
		);
		check(
			Array.isArray(provider.audiences) &&
				provider.audiences.length > 0 &&
				provider.audiences.every(
					(audience: unknown) => typeof audience === 'string' && audience.trim()
				),
			'고정 JWT audience 목록이 필요합니다.'
		);
		const jwks = provider.jwks;
		if (typeof jwks === 'string') {
			let keys: unknown;
			try {
				keys = JSON.parse(jwks);
			} catch {
				throw new Error('인라인 JWKS는 JSON 문자열이어야 합니다.');
			}
			check(
				object(keys) && Array.isArray(keys.keys) && keys.keys.length > 0 && keys.keys.every(object),
				'인라인 JWKS의 검증키 목록이 필요합니다.'
			);
			const ids = new Set<string>();
			for (const key of keys.keys) {
				check(
					typeof key.kid === 'string' && key.kid.trim() && !ids.has(key.kid),
					'JWKS에는 중복 없는 검증키 kid가 필요합니다.'
				);
				ids.add(key.kid);
				check(
					['RSA', 'EC', 'OKP'].includes(key.kty) && (key.kty !== 'OKP' || key.crv === 'Ed25519'),
					'JWT 검증키는 RSA, EC 또는 OKP Ed25519만 지원합니다.'
				);
			}
		} else {
			check(
				object(jwks) && Object.keys(jwks).length === 1,
				'JWKS JSON 문자열 또는 파일·URL 참조가 필요합니다.'
			);
			if ('file' in jwks)
				check(typeof jwks.file === 'string' && jwks.file.trim(), 'JWKS 파일 참조가 필요합니다.');
			else
				check(
					typeof jwks.url === 'string' && /^https?:\/\/[^\s]+$/.test(jwks.url),
					'JWKS URL은 HTTP 또는 HTTPS 주소여야 합니다.'
				);
		}
		provider.jwtValidationOptions ??= { requiredClaims: ['exp'] };
		check(object(provider.jwtValidationOptions), 'JWT 검증 옵션을 확인해 주세요.');
		onlyKeys(
			provider.jwtValidationOptions,
			['requiredClaims'],
			'지원하지 않는 JWT 검증 옵션입니다.'
		);
		provider.jwtValidationOptions.requiredClaims ??= ['exp'];
		const claims = provider.jwtValidationOptions.requiredClaims;
		check(
			Array.isArray(claims) &&
				claims.includes('exp') &&
				new Set(claims).size === claims.length &&
				claims.every((claim: unknown) =>
					['exp', 'nbf', 'aud', 'iss', 'sub'].includes(String(claim))
				),
			'JWT는 만료(exp)를 요구해야 하며 exp, nbf, aud, iss, sub 존재 검사만 지원합니다.'
		);
	}
	return jwt;
}
function nativeDuration(value: unknown): boolean {
	if (
		typeof value !== 'string' ||
		value.length > 128 ||
		!/^(?:\d+d)?(?:(?:\d+(?:\.\d+)?|\.\d+)(?:ns|us|µs|ms|s|m|h))*$/.test(value) ||
		!value
	)
		return false;
	const day = /^(\d+)d/.exec(value);
	const days = day ? BigInt(day[1]) : 0n;
	const remainder = day ? value.slice(day[0].length) : value;
	const units: Record<string, bigint> = {
		ns: 1n,
		us: 1000n,
		µs: 1000n,
		ms: 1000000n,
		s: 1000000000n,
		m: 60000000000n,
		h: 3600000000000n
	};
	let nanos = 0n;
	for (const match of remainder.matchAll(/(\d+(?:\.\d+)?|\.\d+)(ns|us|µs|ms|s|m|h)/g)) {
		const [whole, fraction = ''] = match[1].split('.');
		const scale = units[match[2]];
		nanos += BigInt(whole || '0') * scale;
		if (fraction) nanos += (BigInt(fraction) * scale) / 10n ** BigInt(fraction.length);
	}
	// The Go-style remainder is i64 nanoseconds; leading integer days extend Duration seconds.
	return (
		nanos <= 9223372036854775807n &&
		days * 86400n + nanos / 1000000000n <= 18446744073709551615n &&
		(days > 0n || nanos > 0n)
	);
}
function requestRateLimit(value: unknown): JsonObject {
	check(object(value), '요청 횟수·시간 구간·제한 키 설정을 연결해 주세요.');
	const rate = structuredClone(value);
	onlyKeys(
		rate,
		['maxTokens', 'tokensPerFill', 'fillInterval', 'type', 'key'],
		'지원하지 않는 요청 횟수 제한 설정입니다.'
	);
	check(
		rate.type === 'requests',
		'토큰 예산은 요청 횟수 제한으로 사용할 수 없습니다. type은 requests여야 합니다.'
	);
	check(
		[rate.maxTokens, rate.tokensPerFill].every(n => Number.isSafeInteger(n) && n > 0),
		'요청 한도와 구간당 충전 횟수는 양의 안전한 정수여야 합니다.'
	);
	check(
		nativeDuration(rate.fillInterval),
		'시간 구간은 공백 없이 1s, 1m30s, 1d12h 같은 양의 기간이어야 합니다. 일수는 맨 앞의 정수만 지원합니다.'
	);
	if (rate.key !== undefined && rate.key !== null)
		check(
			typeof rate.key === 'string' &&
				/^(request\.(path|method)|jwt\.[A-Za-z_][A-Za-z0-9_.]*)$/.test(rate.key),
			'제한 키는 검증된 JWT 값 또는 요청 경로·메서드여야 합니다.'
		);
	return rate;
}
export function regexTargetSupported(config: JsonObject, targetId: string): boolean {
	const target = resolveTarget(config, targetId);
	if (!target) return false;
	if (targetId === 'llm')
		return (
			Array.isArray(target.models) &&
			!target.models.some(
				(model: JsonObject) => model.passthrough !== undefined && model.passthrough !== null
			)
		);
	if (!Array.isArray(target.backends) || !target.backends.length) return false;
	const supportedRoutes = (ai: JsonObject | undefined) =>
		!ai?.routes ||
		(object(ai.routes) &&
			Object.values(ai.routes).every(value =>
				['completions', 'messages', 'responses', 'generateContent', 'models'].includes(
					String(value)
				)
			));
	if (!supportedRoutes(target.policies?.ai)) return false;
	return target.backends.every((backend: JsonObject) => {
		const referenced =
			typeof backend.backend === 'string'
				? (config.backends ?? []).filter((item: JsonObject) => item.name === backend.backend)
				: [];
		const actual =
			typeof backend.backend === 'string'
				? referenced.length === 1
					? referenced[0]
					: undefined
				: backend;
		if (!actual || !object(actual.ai) || backend.policies?.ai || actual.policies?.ai) return false;
		if (actual.ai.groups !== undefined && !Array.isArray(actual.ai.groups)) return false;
		const providers = actual.ai.groups
			? actual.ai.groups.flatMap((group: JsonObject) =>
					Array.isArray(group.providers) ? group.providers : []
				)
			: [actual.ai];
		return (
			Array.isArray(providers) &&
			providers.length > 0 &&
			providers.every((provider: JsonObject) => object(provider.provider) && !provider.policies?.ai)
		);
	});
}
function mergeRegexGuard(
	config: JsonObject,
	target: JsonObject,
	targetId: string,
	direction: string,
	guard: JsonObject,
	mode: unknown,
	sources: JsonObject[],
	updates: SourceUpdates,
	card: string
): void {
	check(
		regexTargetSupported(config, targetId),
		'정규식 가드는 실제 AI 백엔드의 메시지 경로만 지원합니다. 일반 HTTP·detect/opaque 또는 별도 백엔드 AI 정책은 자동 연결할 수 없습니다.'
	);
	target.policies ??= {};
	const policies = target.policies;
	let parent: JsonObject;
	let field: string;
	if (targetId === 'llm') {
		for (const model of target.models ?? []) {
			const existing = model.guardrails;
			if (!existing) continue;
			if (
				direction === 'response' &&
				existing.response?.length &&
				(existing.streaming ?? 'Disabled') !==
					(mode === 'streaming_partial' ? 'Enabled' : 'Disabled')
			)
				throw new NativeConflict(
					'모델별 응답 가드의 스트리밍 방식이 달라 공통 검사와 병합할 수 없습니다.'
				);
			if (
				(existing[direction] ?? []).some((previous: JsonObject) =>
					previous.regex?.rules?.some((rule: unknown) =>
						guard.regex.rules.some((next: unknown) => sameValue(rule, next))
					)
				)
			)
				throw new NativeConflict(
					'동일 정규식이 모델별 가드에 이미 있습니다. 공통·모델별 검사 중복을 검토해 주세요.'
				);
		}
		parent = policies;
		field = 'guardrails';
	} else {
		policies.ai ??= {};
		check(object(policies.ai), '기존 AI 정책 설정을 확인해 주세요.');
		parent = policies.ai;
		field = 'promptGuard';
	}
	parent[field] ??= {};
	const guards = parent[field];
	check(object(guards), '기존 LLM 가드 설정을 확인해 주세요.');
	if (direction === 'response') {
		const streaming = mode === 'streaming_partial' ? 'Enabled' : 'Disabled';
		if (
			(guards.streaming !== undefined || guards.response?.length) &&
			(guards.streaming ?? 'Disabled') !== streaming
		)
			throw new NativeConflict(
				'기존 응답 가드의 스트리밍 방식이 다릅니다. 병합 검토가 필요합니다.'
			);
		guards.streaming = streaming;
	}
	guards[direction] ??= [];
	check(Array.isArray(guards[direction]), '기존 정규식 가드 목록을 확인해 주세요.');
	for (const previous of guards[direction]) {
		if (!object(previous) || !object(previous.regex)) continue;
		const existing = policyTechnicalValue(previous);
		existing.regex.action ??= 'mask';
		if (direction === 'request') existing.scope ??= ['systemPrompt', 'messages'];
		if (existing.regex.action === 'reject') existing.rejection = rejectResponse(existing.rejection);
		if (sameValue(existing, guard)) {
			mergePolicySources(previous, sources, updates, [card]);
			return;
		}
		if (
			Array.isArray(existing.regex.rules) &&
			existing.regex.rules.some((rule: unknown) =>
				guard.regex.rules.some((next: unknown) => sameValue(rule, next))
			)
		)
			throw new NativeConflict(
				'같은 정규식에 다른 동작·검사 범위·거부 응답이 이미 있습니다. 병합 검토가 필요합니다.'
			);
	}
	mergePolicySources(guard, sources, updates, [card]);
	guards[direction].push(guard);
}

export function adaptPolicyPlan(
	plan: JsonObject,
	original: JsonObject,
	profile: ImportProfile
): ImportResult {
	const config = structuredClone(original);
	const findings: Finding[] = [];
	const notes: string[] = [];
	const expressions: string[] = [];
	const sourceUpdates: SourceUpdates = new WeakMap();
	const sourceCards: SourceCards = new WeakMap();
	const sourced = (require: string, sources: JsonObject[], cards: string[]) => {
		const rule = sourcedRule(require, sources);
		sourceCards.set(rule, cards);
		return rule;
	};
	const removed = (
		before: string,
		after: string,
		condition: string,
		sources: JsonObject[],
		cards: string[]
	) => {
		const decision = bodyDecision(before, after, condition, sources);
		sourceCards.set(decision, cards);
		return decision;
	};
	const buffers = new Map<
		string,
		{
			target: JsonObject;
			bodies: Record<string, string>;
			headers: Record<string, JsonObject>;
			rules: JsonObject[];
			fhir: Map<string, { encoded: string; sources: JsonObject[]; cards: string[] }>;
			bodyDecisions: JsonObject[];
		}
	>();
	const targets = policyTargets(config);
	const add = (policy: string, message: string, kind: Finding['kind'] = 'missing') =>
		findings.push({ policy, message, kind });
	for (const pack of plan.policy_packs)
		for (const policy of pack.policies) {
			const key = keyOf(policy),
				binding = profile.bindings[key] ?? {};
			if (binding.enabled !== undefined && typeof binding.enabled !== 'boolean') {
				add(key, '카드 적용 여부는 true 또는 false여야 합니다.', 'unsupported');
				continue;
			}
			if (binding.enabled === false) {
				notes.push(`${key}: 이번 가져오기에서 적용 제외 · 기존 Gateway 설정은 유지합니다.`);
				continue;
			}
			if (
				policy.scope &&
				(!object(policy.scope) ||
					Object.keys(policy.scope).some(k => k !== 'target_ref') ||
					(policy.scope.target_ref !== undefined && typeof policy.scope.target_ref !== 'string'))
			) {
				add(key, '입력의 추가 적용 범위는 이번 어댑터에서 아직 해석할 수 없습니다.', 'unsupported');
				continue;
			}
			if (binding.policyFingerprint && binding.policyFingerprint !== policyFingerprint(policy)) {
				add(key, '카드 내용 또는 기능이 변경되었습니다. 저장된 연결 정보를 다시 확인해 주세요.');
				continue;
			}
			if (policy.function === null || policy.except === null) {
				add(key, '기능 또는 배제 관계가 미검토입니다.');
				continue;
			}
			if (policy.except.length) {
				add(key, '조건부 카드 배제는 이번 어댑터에서 아직 지원하지 않습니다.', 'unsupported');
				continue;
			}
			if (policy.function.length === 0) {
				if (binding.enabled === true) add(key, '적용할 Gateway 실행 기능이 없습니다.');
				else notes.push(`${key}: 검토 결과 Gateway 기능 없음`);
				continue;
			}
			const targetId =
				binding.target ??
				policy.scope?.target_ref ??
				(targets.length === 1 ? targets[0].id : undefined);
			const targetIds = targetId === 'all' ? targets.map(t => t.id) : [targetId];
			if (!targetIds.length) {
				add(key, '적용 경로가 없습니다.');
				continue;
			}
			for (const selectedTargetId of targetIds) {
				const target = selectedTargetId && resolveTarget(config, selectedTargetId);
				if (!target || !selectedTargetId || !targetId) {
					add(key, '적용할 기존 경로를 연결해 주세요.');
					continue;
				}
				if (
					binding.targetFingerprint &&
					binding.targetFingerprint !== targetFingerprint(config, targetId)
				) {
					add(
						key,
						'저장된 경로의 목적지 또는 범위가 변경되었습니다. 적용 경로를 다시 연결해 주세요.'
					);
					continue;
				}
				let condition: string;
				try {
					condition = conditionCel(policy.applies_when ?? binding.condition);
				} catch (error) {
					add(key, (error as Error).message);
					continue;
				}
				let selected = binding.selectedFunctions;
				if (!selected) {
					if (policy.function.length > 1 && policy.function_combination !== 'all') {
						add(key, '여러 기능 중 적용할 기능을 확인해 주세요.');
						continue;
					}
					selected = policy.function.map((_: unknown, index: number) => index);
				}
				if (
					!selected?.length ||
					new Set(selected).size !== selected.length ||
					selected.some(i => !Number.isInteger(i) || i < 0 || i >= policy.function.length)
				) {
					add(key, '적용할 기능 선택이 올바르지 않습니다.');
					continue;
				}
				if (selected.length !== policy.function.length)
					notes.push(`${key}: 사용자가 확인한 기능 ${selected.map(i => i + 1).join(', ')}만 적용`);
				if (!buffers.has(selectedTargetId))
					buffers.set(selectedTargetId, {
						target,
						bodies: {},
						headers: {},
						rules: [],
						fhir: new Map(),
						bodyDecisions: []
					});
				const buffer = buffers.get(selectedTargetId);
				check(buffer, 'Missing transformation buffer');
				for (const index of selected) {
					const fn = policy.function[index];
					const params = { ...(binding.functions?.[String(index)] ?? {}), ...fn.parameters };
					try {
						const sources = executionSources(pack, policy, index);
						const card = sourceCardIdentity({
							pack_id: pack.pack_id,
							law_id: policy.law_id,
							policy_id: policy.policy_id
						});
						if (
							/^AGW-REGEX-GUARD-(REQUEST|RESPONSE)$/.test(fn.function_id) ||
							(fn.function_id === 'AGW-AUTH-AUTHZ-REQUEST' && fn.action === 'require_jwt') ||
							(fn.function_id === 'AGW-RATE-BUDGET-LIMIT' && fn.action === 'limit_requests')
						) {
							check(
								fn.object === null || typeof fn.object === 'string',
								'기능 대상 코드가 올바르지 않습니다.'
							);
							check(
								!fn.target || fn.target.object === fn.object,
								'기능의 대상 코드와 매핑 대상이 일치하지 않습니다.'
							);
							if (condition === 'false') {
								notes.push(`${key}: 고정 false 조건으로 이 기능은 적용하지 않음`);
								continue;
							}
							check(
								condition === 'true',
								'이 네이티브 기능은 개별 동적 조건을 지원하지 않습니다. 고정 적용 경로와 검토된 true 조건이 필요합니다.'
							);
							if (fn.function_id.startsWith('AGW-REGEX-GUARD-')) {
								const direction = fn.function_id.endsWith('REQUEST') ? 'request' : 'response';
								check(
									fn.direction === direction && fn.traffic === 'llm',
									'정규식 가드의 방향·트래픽 정보가 일치하지 않습니다.'
								);
								const guard = regexGuard(params, fn.action, direction);
								mergeRegexGuard(
									config,
									target,
									selectedTargetId,
									direction,
									guard,
									params.response_mode,
									sources,
									sourceUpdates,
									card
								);
								if (direction === 'response' && params.response_mode === 'non_streaming')
									buffer.rules.push(
										sourced(
											'json(request.body).with(b, !("stream" in b) || b.stream == false)',
											sources,
											[card]
										)
									);
								if (direction === 'response' && params.response_mode === 'streaming_partial')
									notes.push(
										`${key}: 부분 스트림 reject; 먼저 전달된 구간은 회수하지 못하며 전체 노출 방지를 보장하지 않음`
									);
								if (fn.action === 'mask')
									notes.push(
										`${key}: 문자열 패턴만 치환; custom pattern은 <masked>, 기본 패턴은 Gateway 고정 치환값 사용; 응답 mask는 SSE 미지원`
									);
							} else if (fn.action === 'require_jwt') {
								check(
									fn.direction === 'request' && fn.traffic === 'http',
									'JWT 통신 인증의 방향·트래픽 정보가 일치하지 않습니다.'
								);
								onlyKeys(
									params,
									['jwt_auth'],
									'JWT 연결에는 jwt_auth 통신 인증 설정만 지원합니다.'
								);
								const jwt = jwtAuthentication(params.jwt_auth);
								target.policies ??= {};
								const existing = target.policies.jwtAuth;
								if (
									existing !== undefined &&
									existing !== null &&
									(existing.mode !== 'strict' ||
										!sameValue(jwtAuthentication(policyTechnicalValue(existing)), jwt))
								)
									throw new NativeConflict(
										'기존 JWT 인증 설정과 다릅니다. 발급자·대상·키·모드 병합을 검토해 주세요.'
									);
								if (existing === undefined || existing === null) target.policies.jwtAuth = jwt;
								mergePolicySources(target.policies.jwtAuth, sources, sourceUpdates, [card]);
								notes.push(
									`${key}: JWT 서명·발급자·대상·만료 통신 인증만 적용; 동의·자격·업무 적법성 판단 아님`
								);
							} else {
								check(
									fn.direction === 'exchange' && fn.traffic === 'llm',
									'요청 횟수 제한의 방향·트래픽 정보가 일치하지 않습니다.'
								);
								onlyKeys(
									params,
									['local_rate_limit'],
									'요청 횟수 제한에는 local_rate_limit 설정만 지원합니다.'
								);
								const rate = requestRateLimit(params.local_rate_limit);
								target.policies ??= {};
								target.policies.localRateLimit ??= [];
								const existing = target.policies.localRateLimit;
								if (!Array.isArray(existing))
									throw new NativeConflict('기존 조건부 요청 제한은 자동 병합할 수 없습니다.');
								let duplicate = false;
								for (const previous of existing) {
									check(object(previous), '기존 요청 횟수 제한 설정을 확인해 주세요.');
									const normalized = {
										...policyTechnicalValue(previous),
										type: previous.type ?? 'requests'
									};
									if (sameValue(normalized, rate)) {
										duplicate = true;
										mergePolicySources(previous, sources, sourceUpdates, [card]);
									} else if (
										normalized.type === 'requests' &&
										(previous.key ?? null) === (rate.key ?? null)
									)
										throw new NativeConflict(
											'같은 제한 키에 다른 요청 횟수·시간 구간이 이미 있습니다. 병합 검토가 필요합니다.'
										);
								}
								if (!duplicate) {
									mergePolicySources(rate, sources, sourceUpdates, [card]);
									existing.push(rate);
								}
								notes.push(
									`${key}: 단일 Gateway 인스턴스의 요청 횟수 제한; 누락·평가 오류·비문자열 키는 공유 버킷 사용, 기본 초과 응답 429`
								);
							}
						} else if (/^AGW-BODY-HEADER-TRANSFORM-(REQUEST|RESPONSE)$/.test(fn.function_id)) {
							const direction = fn.function_id.endsWith('REQUEST') ? 'request' : 'response';
							check(
								fn.direction === direction && fn.traffic === 'http',
								'기능의 방향·트래픽 정보가 일치하지 않습니다.'
							);
							if (['set_header', 'add_header', 'remove_header'].includes(fn.action)) {
								check(
									typeof params.header === 'string' &&
										/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(params.header),
									'헤더 이름을 확인해 주세요.'
								);
								check(
									fn.action === 'remove_header' ||
										(typeof params.value === 'string' && !/[\r\n]/.test(params.value)),
									'헤더 값을 확인해 주세요.'
								);
								buffer.headers[direction] ??= {};
								const name = params.header.toLowerCase();
								const previous = buffer.headers[direction][name];
								const value = fn.action === 'remove_header' ? undefined : params.value;
								check(
									!previous ||
										(fn.action !== 'add_header' &&
											previous.action === fn.action &&
											previous.value === value &&
											previous.condition === condition),
									'같은 헤더를 수정하는 정책이 중복됩니다.'
								);
								buffer.headers[direction][name] = {
									action: fn.action,
									value,
									condition
								};
								if (previous) notes.push(`${key}: 같은 조건·값의 헤더 통제를 함께 사용합니다.`);
							} else if (fn.action === 'remove_field' && direction === 'request') {
								if (params.body_location === 'request_fhir' || params.fhir_filter !== undefined) {
									check(
										params.body_location === 'request_fhir',
										'FHIR 보호의 본문 처리 형식을 확인해 주세요.'
									);
									onlyKeys(
										params,
										['body_location', 'fhir_filter'],
										'FHIR 보호와 지정 필드 삭제를 함께 설정할 수 없습니다.'
									);
									const fhirProfile = validateFhirFilterProfile(params.fhir_filter);
									const encoded = literal(fhirProfile);
									const previous = buffer.fhir.get(condition);
									if (previous !== undefined && previous.encoded !== encoded)
										throw new NativeConflict(
											'같은 적용 조건에 다른 FHIR 유지 예외가 있습니다. 관리자 설정을 하나로 맞춰 주세요.'
										);
									const origin: JsonObject = { policySources: previous?.sources ?? [] };
									mergePolicySources(origin, sources);
									buffer.fhir.set(condition, {
										encoded,
										sources: origin.policySources ?? [],
										cards: [...new Set([...(previous?.cards ?? []), card])]
									});
									notes.push(
										`${key}: FHIR 내용 기본 차단 · 등록된 유지 예외만 전달 · JSON 본문과 LLM JSON 문자열 자동 처리`
									);
									continue;
								}
								check(
									params.body_location === 'root_json',
									'FHIR/JSON이 요청 본문 자체에 있는지 확인해 주세요. 중첩 LLM 메시지는 아직 지원하지 않습니다.'
								);
								check(
									Array.isArray(params.paths) &&
										params.paths.every((p: unknown) => typeof p === 'string'),
									'삭제 승인된 필드 목록이 필요합니다.'
								);
								const transformed = deleteFieldsCel(params.paths);
								check(
									params.resource_type === undefined ||
										(typeof params.resource_type === 'string' &&
											/^[A-Za-z]+$/.test(params.resource_type)),
									'리소스 종류가 올바르지 않습니다.'
								);
								const filtered = params.resource_type
									? `("resourceType" in b && b.resourceType == ${literal(params.resource_type)} ? ${transformed} : b)`
									: transformed;
								const before = buffer.bodies.request ?? 'json(request.body)';
								const after = `(${before}).with(b, (${condition}) ? ${filtered} : b)`;
								buffer.bodies.request = after;
								buffer.bodyDecisions.push(removed(before, after, condition, sources, [card]));
								// Evaluate the same operation during require-authorization so malformed/oversized
								// bodies cannot silently bypass a deletion when transformation evaluation fails.
								buffer.rules.push(
									sourced(
										`!(${condition}) || size(toJson(json(request.body).with(b, ${filtered}))) >= 0`,
										sources,
										[card]
									)
								);
							} else if (fn.action === 'rewrite_body') {
								if (params.instruction_text !== undefined)
									check(direction === 'request', '표시 지시는 요청에만 추가할 수 있습니다.');
								const expression =
									params.instruction_text !== undefined
										? requestInstructionCel(params.instruction_text)
										: params.body_expression;
								check(
									typeof expression === 'string' && expression.trim(),
									'본문 표시 방식이 아직 정해지지 않았습니다. 헤더 표시만 선택하거나 관리자 연결 정보를 가져와 주세요.'
								);
								check(
									!buffer.bodies[direction],
									'동일 방향의 본문 변환이 중복되어 병합 검토가 필요합니다.'
								);
								buffer.bodies[direction] =
									`(${condition}) ? (${expression}) : json(${direction}.body)`;
							} else throw new Error('이 본문 변환 동작은 아직 지원하지 않습니다.');
						} else if (
							fn.function_id === 'AGW-AUTH-AUTHZ-REQUEST' &&
							fn.action === 'authorize_require'
						) {
							check(fn.direction === 'request', '인가 기능 방향이 올바르지 않습니다.');
							const requirement = conditionCel(params.require_when);
							buffer.rules.push(sourced(`!(${condition}) || (${requirement})`, sources, [card]));
						} else if (
							fn.function_id === 'AGW-MODEL-DESTINATION-SELECT-REQUEST' &&
							fn.action === 'route_to_backend'
						) {
							check(
								params.reuse_existing_destination === true,
								'현재 경로의 목적지를 승인된 목적지로 사용할지 확인해 주세요.'
							);
							check(
								selectedTargetId !== 'llm' && target.backends?.length === 1,
								'목적지가 하나인 기존 HTTP 경로만 재사용할 수 있습니다.'
							);
							const approval = conditionCel(params.require_when);
							buffer.rules.push(sourced(`!(${condition}) || (${approval})`, sources, [card]));
							notes.push(`${key}: 기존 경로의 단일 목적지 재사용; 정책 적용 시 승인 조건 검사`);
						} else if (fn.function_id === 'AGW-ACCESS-LOG-TRACING' && fn.action === 'log_access') {
							// Existing frontend filtering/storage must be reviewed rather than silently replaced.
							check(
								params.reuse_existing_logging === true,
								'현재 접속기록 설정을 재사용하도록 확인해 주세요.'
							);
							notes.push(`${key}: 기존 접속기록 사용; 보관·점검·위변조 방지는 별도 운영 절차`);
						} else if (fn.function_id === 'AGW-ACCESS-LOG-TRACING' && fn.action === 'trace') {
							check(params.reuse_existing_tracing === true, '기존 추적 설정 연결이 필요합니다.');
							check(
								object(original.frontendPolicies?.tracing),
								'Gateway의 공통 추적 설정이 없습니다. 관리자에게 수집처 연결을 요청해 주세요.'
							);
							notes.push(`${key}: 기존 추적 설정 사용; 샘플링·필터 범위는 관리자 연결 정보 기준`);
						} else throw new Error(`아직 지원하지 않는 기능: ${fn.function_id} / ${fn.action}`);
					} catch (error) {
						add(
							key,
							`기능 ${index + 1}: ${(error as Error).message}`,
							error instanceof NativeConflict ? 'conflict' : 'unsupported'
						);
					}
				}
			}
			if (policy.legal_sources.some((s: JsonObject) => !s.revision_no || !s.promulgation_date))
				notes.push(`${key}: 법령 판본 미확정 — 기술 설정 생성과 법률 검토 완료는 별개`);
		}
	for (const [targetId, buffer] of buffers) {
		try {
			// FHIR sanitization is the final step, independent of card order. Require evaluates
			// the exact composed body before upstream; transformation errors alone don't block.
			if (buffer.fhir.size) {
				let body = buffer.bodies.request ?? 'json(request.body)';
				for (const [condition, { encoded, sources, cards }] of buffer.fhir) {
					const before = body;
					body = `(${body}).with(f, (${condition}) ? filterFhir(f, ${encoded}) : f)`;
					buffer.bodyDecisions.push(removed(before, body, condition, sources, cards));
					buffer.rules.push(
						sourced(`!(${condition}) || size(toJson(${body})) >= 0`, sources, cards)
					);
				}
				buffer.bodies.request = body;
			}
			if (
				!Object.keys(buffer.bodies).length &&
				!Object.keys(buffer.headers).length &&
				!buffer.rules.length
			)
				continue;
			buffer.target.policies ??= {};
			const policies = buffer.target.policies;
			const transform = policies.transformations;
			const next: JsonObject = {};
			for (const direction of ['request', 'response']) {
				const data: JsonObject = {};
				if (buffer.bodies[direction]) data.body = `toJson(${buffer.bodies[direction]})`;
				if (direction === 'request' && buffer.bodyDecisions.length)
					data.bodyDecisions = buffer.bodyDecisions;
				let headers = `${direction}.headers`;
				for (const [name, change] of Object.entries(buffer.headers[direction] ?? {})) {
					const updated =
						change.action === 'remove_header'
							? `h.filterKeys(k, k != ${literal(name)})`
							: change.action === 'add_header'
								? `h.merge({${literal(name)}: (${literal(name)} in h ? [h[${literal(name)}], ${literal(change.value)}] : [${literal(change.value)}])})`
								: `h.merge({${literal(name)}: ${literal(change.value)}})`;
					headers = `${headers}.with(h, (${change.condition}) ? ${updated} : h)`;
				}
				if (buffer.headers[direction]) data.replace = headers;
				if (Object.keys(data).length) next[direction] = data;
				for (const value of Object.values(data))
					if (typeof value === 'string') expressions.push(value);
			}
			if (Object.keys(next).length) {
				const merged: JsonObject = structuredClone(transform ?? {});
				let conflict = false;
				for (const [direction, data] of Object.entries(next)) {
					const existing = merged[direction] ?? {};
					const headerKeys = ['set', 'add', 'remove', 'replace'];
					if (
						headerKeys.some(k => k in data) &&
						headerKeys.some(k => k in existing) &&
						JSON.stringify(
							Object.fromEntries(headerKeys.filter(k => k in existing).map(k => [k, existing[k]]))
						) !==
							JSON.stringify(
								Object.fromEntries(headerKeys.filter(k => k in data).map(k => [k, data[k]]))
							)
					)
						conflict = true;
					for (const [field, value] of Object.entries(data)) {
						if (field === 'bodyDecisions') {
							data.bodyDecisions = mergeBodyDecisions(
								existing.bodyDecisions,
								value as JsonObject[],
								sourceUpdates,
								sourceCards
							);
							if (!data.bodyDecisions.length) {
								delete data.bodyDecisions;
								delete existing.bodyDecisions;
							}
							for (const decision of data.bodyDecisions ?? [])
								expressions.push(decision.changedWhen);
							continue;
						}
						if (field in existing && JSON.stringify(existing[field]) !== JSON.stringify(value))
							conflict = true;
					}
					merged[direction] = { ...existing, ...data };
				}
				if (conflict) {
					add(
						targetId,
						'동일한 본문 또는 헤더 변환이 이미 있습니다. 기존 변환을 확인해 주세요.',
						'conflict'
					);
					continue;
				}
				policies.transformations = merged;
			}
			if (buffer.rules.length) {
				policies.authorization ??= { rules: [] };
				check(Array.isArray(policies.authorization.rules), '기존 인가 설정을 확인해 주세요.');
				for (const rule of buffer.rules) {
					const previous = policies.authorization.rules.find(
						(r: JsonObject) =>
							object(r) && sameValue(policyTechnicalValue(r), policyTechnicalValue(rule))
					);
					if (previous)
						mergePolicySources(
							previous,
							rule.policySources ?? [],
							sourceUpdates,
							sourceCards.get(rule) ?? []
						);
					else {
						mergePolicySources(
							rule,
							rule.policySources ?? [],
							sourceUpdates,
							sourceCards.get(rule) ?? []
						);
						policies.authorization.rules.push(rule);
					}
					expressions.push(rule.require);
				}
			}
		} catch (error) {
			add(
				targetId,
				(error as Error).message,
				error instanceof NativeConflict ? 'conflict' : 'unsupported'
			);
		}
	}
	return {
		config: findings.length ? structuredClone(original) : config,
		findings,
		notes,
		expressions
	};
}
