// biome-ignore lint/style/noRestrictedImports: The same pure contract module is executed directly by Node runtime fixtures.
import type { ImportProfile, JsonObject, PolicyBinding } from './policyAdapter.ts';

export type FhirKeepResource = 'Patient' | 'Condition' | 'Observation';
export type FhirKeepOption = Readonly<{ path: string; label: string }>;
export type FhirFilterProfile = {
	version: 1;
	allow_fields: Partial<Record<FhirKeepResource, string[]>>;
};

// These are reviewed technical keep exceptions. They do not classify legal sensitive data
// or authorize disclosure. All other nonstructural fields remain excluded by the strict filter.
export const FHIR_KEEP_OPTIONS: Readonly<Record<FhirKeepResource, readonly FhirKeepOption[]>> =
	Object.freeze({
		Patient: Object.freeze([
			Object.freeze({ path: 'name[]', label: '이름' }),
			Object.freeze({ path: 'telecom[].value', label: '연락처 값' }),
			Object.freeze({ path: 'address[]', label: '주소' }),
			Object.freeze({ path: 'birthDate', label: '생년월일' }),
			Object.freeze({ path: 'identifier[].value', label: '식별번호 값' })
		]),
		Condition: Object.freeze([
			Object.freeze({ path: 'code', label: '진단·질환 코드' }),
			Object.freeze({ path: 'bodySite[]', label: '신체 부위' }),
			Object.freeze({ path: 'note[].text', label: '진단 메모' })
		]),
		Observation: Object.freeze([
			Object.freeze({ path: 'code', label: '검사·관찰 항목' }),
			Object.freeze({ path: 'value[x]', label: '검사·관찰 결과' }),
			Object.freeze({ path: 'component[].code', label: '세부 검사 항목' }),
			Object.freeze({ path: 'component[].value[x]', label: '세부 검사 결과' }),
			Object.freeze({ path: 'note[].text', label: '검사 메모' })
		])
	});

const record = (value: unknown): value is JsonObject =>
	Boolean(
		value &&
			typeof value === 'object' &&
			!Array.isArray(value) &&
			[Object.prototype, null].includes(Object.getPrototypeOf(value))
	);
const ownKeys = (value: object): string[] => {
	const keys = Reflect.ownKeys(value);
	if (keys.some(key => typeof key !== 'string'))
		throw new Error('FHIR 설정의 객체 키가 올바르지 않습니다.');
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Object.values(descriptors).some(descriptor => 'get' in descriptor || 'set' in descriptor))
		throw new Error('FHIR 설정은 값으로 구성된 JSON이어야 합니다.');
	return keys as string[];
};
function check(ok: unknown, message: string): asserts ok {
	if (!ok) throw new Error(message);
}

export function validateFhirFilterProfile(input: unknown): FhirFilterProfile {
	check(record(input), 'FHIR 반출 보호 설정은 JSON 객체여야 합니다.');
	const keys = ownKeys(input);
	check(
		keys.length === 2 && keys.includes('version') && keys.includes('allow_fields'),
		'FHIR 반출 보호 설정에는 version과 allow_fields만 사용할 수 있습니다.'
	);
	check(input.version === 1, 'FHIR 반출 보호 설정 버전은 1이어야 합니다.');
	check(record(input.allow_fields), 'FHIR 전달 허용 항목은 JSON 객체여야 합니다.');
	const resources = ownKeys(input.allow_fields);
	check(resources.length <= 3, 'FHIR 전달 허용 리소스 목록이 너무 큽니다.');
	const allowed: FhirFilterProfile['allow_fields'] = {};
	let total = 0;
	for (const resource of resources) {
		check(
			Object.hasOwn(FHIR_KEEP_OPTIONS, resource),
			'등록되지 않은 FHIR 리소스는 허용 항목으로 선택할 수 없습니다.'
		);
		const options = FHIR_KEEP_OPTIONS[resource as FhirKeepResource];
		const paths = input.allow_fields[resource];
		check(
			Array.isArray(paths) && Object.getPrototypeOf(paths) === Array.prototype,
			'FHIR 전달 허용 필드는 경로 목록이어야 합니다.'
		);
		const pathKeys = ownKeys(paths);
		check(
			pathKeys.length === paths.length + 1 &&
				pathKeys.every(key => key === 'length' || /^(0|[1-9]\d*)$/.test(key)),
			'FHIR 전달 허용 필드 목록은 연속된 JSON 배열이어야 합니다.'
		);
		check(paths.length <= options.length, 'FHIR 전달 허용 필드 목록이 너무 큽니다.');
		check(
			paths.every(
				path =>
					typeof path === 'string' &&
					path.length <= 128 &&
					options.some(option => option.path === path)
			),
			'등록되지 않은 FHIR 필드는 전달 허용 항목으로 선택할 수 없습니다.'
		);
		check(
			new Set(paths).size === paths.length,
			'FHIR 전달 허용 필드 목록에 중복된 경로가 있습니다.'
		);
		total += paths.length;
		if (paths.length)
			allowed[resource as FhirKeepResource] = options
				.filter(option => paths.includes(option.path))
				.map(option => option.path);
	}
	check(total <= 13, 'FHIR 전달 허용 필드 목록이 너무 큽니다.');
	const canonical: FhirFilterProfile['allow_fields'] = {};
	for (const resource of Object.keys(FHIR_KEEP_OPTIONS) as FhirKeepResource[]) {
		if (allowed[resource]) canonical[resource] = allowed[resource];
	}
	return { version: 1, allow_fields: canonical };
}

// Keep the persisted fingerprint representation identical to the adapter. A type-only import
// prevents the adapter's strict-profile validation from creating a runtime import cycle.
function cardFingerprint(policy: JsonObject): string {
	return JSON.stringify({
		text: policy.policy_text,
		legal_sources: policy.legal_sources,
		functions: policy.function?.map((fn: JsonObject) => ({
			id: fn.function_id,
			action: fn.action,
			object: fn.object,
			direction: fn.direction,
			traffic: fn.traffic,
			target: fn.target,
			parameters: fn.parameters
		})),
		except: policy.except,
		condition: policy.applies_when,
		scope: policy.scope,
		combination: policy.function_combination
	});
}
function targetIds(config: JsonObject): string[] {
	const ids: string[] = [];
	if (record(config.llm)) ids.push('llm');
	(config.routes ?? []).forEach((_: unknown, index: number) => {
		ids.push(`route:${index}`);
	});
	(config.binds ?? []).forEach((bind: JsonObject, b: number) => {
		(bind.listeners ?? []).forEach((listener: JsonObject, l: number) => {
			(listener.routes ?? []).forEach((_: unknown, r: number) => {
				ids.push(`bind:${b}:${l}:${r}`);
			});
		});
	});
	return ids;
}
function routeFingerprint(config: JsonObject, target: string): string {
	if (target === 'all')
		return JSON.stringify(targetIds(config).map(id => [id, routeFingerprint(config, id)]));
	const parts = target.split(':');
	const value =
		target === 'llm'
			? config.llm
			: parts[0] === 'route'
				? config.routes?.[Number(parts[1])]
				: parts[0] === 'bind'
					? config.binds?.[Number(parts[1])]?.listeners?.[Number(parts[2])]?.routes?.[
							Number(parts[3])
						]
					: undefined;
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
function stale(policy: JsonObject, binding: PolicyBinding, config: JsonObject): boolean {
	if (
		binding.policyFingerprint !== undefined &&
		binding.policyFingerprint !== cardFingerprint(policy)
	)
		return true;
	if (binding.targetFingerprint === undefined) return false;
	const ids = targetIds(config);
	const target =
		binding.target ?? policy.scope?.target_ref ?? (ids.length === 1 ? ids[0] : undefined);
	return (
		typeof target !== 'string' ||
		(target !== 'all' && !ids.includes(target)) ||
		(target === 'all' && !ids.length) ||
		binding.targetFingerprint !== routeFingerprint(config, target)
	);
}
function selected(policy: JsonObject, binding: PolicyBinding): number[] {
	const indices =
		binding.selectedFunctions ??
		(policy.function.length === 1 || policy.function_combination === 'all'
			? policy.function.map((_: unknown, index: number) => index)
			: []);
	return Array.isArray(indices) &&
		new Set(indices).size === indices.length &&
		indices.every(index => Number.isInteger(index) && index >= 0 && index < policy.function.length)
		? indices
		: [];
}
function blank(value: unknown): boolean {
	return record(value) && Reflect.ownKeys(value).length === 0;
}

// This fills technical settings only; it never chooses a route, condition, law or candidate.
export function applyFhirDefaults(
	plan: JsonObject,
	profile: ImportProfile,
	config: JsonObject
): ImportProfile {
	check(
		record(profile) && profile.version === 1 && record(profile.bindings),
		'FHIR 기본 설정을 연결할 정책 연결 정보가 올바르지 않습니다.'
	);
	const result = structuredClone(profile);
	for (const pack of plan.policy_packs ?? []) {
		for (const policy of pack.policies ?? []) {
			if (
				!record(policy) ||
				!Array.isArray(policy.function) ||
				!Array.isArray(policy.except) ||
				policy.except.length
			)
				continue;
			if (
				policy.scope != null &&
				(!record(policy.scope) ||
					Reflect.ownKeys(policy.scope).some(key => key !== 'target_ref') ||
					(policy.scope.target_ref !== undefined && typeof policy.scope.target_ref !== 'string'))
			)
				continue;
			const key = `${policy.law_id}/${policy.policy_id}`;
			const binding = Object.hasOwn(profile.bindings, key) ? profile.bindings[key] : {};
			if (
				!record(binding) ||
				binding.enabled === false ||
				stale(policy, binding, config) ||
				(binding.functions !== undefined && !record(binding.functions))
			)
				continue;
			for (const index of selected(policy, binding)) {
				const fn = policy.function[index];
				if (
					!record(fn) ||
					fn.function_id !== 'AGW-BODY-HEADER-TRANSFORM-REQUEST' ||
					fn.action !== 'remove_field' ||
					fn.direction !== 'request' ||
					fn.traffic !== 'http' ||
					!blank(fn.parameters)
				)
					continue;
				const parameters = binding.functions?.[String(index)];
				if (parameters !== undefined && !blank(parameters)) continue;
				result.bindings[key] ??= {};
				const updated = result.bindings[key];
				updated.functions ??= {};
				updated.functions[String(index)] = {
					body_location: 'request_fhir',
					fhir_filter: { version: 1, allow_fields: {} }
				};
			}
		}
	}
	return result;
}
