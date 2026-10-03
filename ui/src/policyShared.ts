// biome-ignore lint/style/noRestrictedImports: Node runtime fixtures execute this pure module without UI aliases.
import type { ImportProfile, JsonObject, PolicyBinding } from './policyAdapter.ts';
import {
	conditionCel,
	deleteFieldsCel,
	parseProfile,
	policyFingerprint,
	policyKey,
	policyTargets,
	policyTechnicalValue,
	regexTargetSupported,
	targetFingerprint
	// biome-ignore lint/style/noRestrictedImports: Node runtime fixtures execute this pure module without UI aliases.
} from './policyAdapter.ts';
// biome-ignore lint/style/noRestrictedImports: Node runtime fixtures execute this pure module without UI aliases.
import { validateFhirFilterProfile } from './policyFhir.ts';

export type SharedInputResult = {
	profile: ImportProfile;
	changed: number;
	skipped: number;
	stale: number;
};
export type SharedFunctionGroup = {
	id: string;
	label: string;
	fn: JsonObject;
	target?: string;
	condition?: JsonObject;
	policyKeys: string[];
	members: { policyKey: string; index: number }[];
	values: JsonObject;
	missingFields: string[];
	stale: number;
};
export type SharedPresets = {
	version: 1;
	entries: {
		groupIdentity: string;
		target: string;
		targetFingerprint: string;
		parameters: JsonObject;
	}[];
};
export type ExistingTargetChoice = { label: string; value: JsonObject };

const object = (value: unknown): value is JsonObject =>
	Boolean(value && typeof value === 'object' && !Array.isArray(value));
const owns = (value: JsonObject, name: string) => Object.hasOwn(value, name);
const present = (value: JsonObject, name: string) => owns(value, name) && value[name] !== undefined;
function assertJson(value: unknown): void {
	if (value === null || ['string', 'boolean'].includes(typeof value)) return;
	if (typeof value === 'number' && Number.isFinite(value)) return;
	if (Array.isArray(value)) {
		value.forEach(assertJson);
		return;
	}
	if (!object(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
		throw new Error('공통 연결 정보는 JSON 객체여야 합니다.');
	for (const [key, child] of Object.entries(value)) {
		if (['__proto__', 'constructor', 'prototype'].includes(key))
			throw new Error('공통 연결 정보에 허용하지 않는 객체 키가 있습니다.');
		assertJson(child);
	}
}
function identity(value: unknown): string {
	function ordered(input: unknown): unknown {
		if (Array.isArray(input)) return input.map(ordered);
		if (!object(input)) return input;
		return Object.fromEntries(
			Object.keys(input)
				.sort()
				.map(key => [key, ordered(input[key])])
		);
	}
	return JSON.stringify(ordered(value));
}
const cards = (plan: JsonObject): JsonObject[] =>
	(plan.policy_packs ?? []).flatMap((pack: JsonObject) => pack.policies ?? []);
function selectedFunctions(policy: JsonObject, binding: PolicyBinding): number[] {
	if (binding.enabled === false) return [];
	if (!Array.isArray(policy.function) || !Array.isArray(policy.except) || policy.except.length)
		return [];
	const selected =
		binding.selectedFunctions ??
		(policy.function.length === 1 || policy.function_combination === 'all'
			? policy.function.map((_: unknown, index: number) => index)
			: []);
	if (
		!Array.isArray(selected) ||
		new Set(selected).size !== selected.length ||
		selected.some(index => !Number.isInteger(index) || index < 0 || index >= policy.function.length)
	)
		return [];
	return selected;
}
function effectiveTarget(
	policy: JsonObject,
	config: JsonObject,
	binding: PolicyBinding
): string | undefined {
	const target =
		binding.target ??
		policy.scope?.target_ref ??
		(policyTargets(config).length === 1 ? policyTargets(config)[0].id : undefined);
	return typeof target === 'string' ? target : undefined;
}
const effectiveCondition = (policy: JsonObject, binding: PolicyBinding): JsonObject | undefined =>
	policy.applies_when ?? binding.condition;
function targetIds(config: JsonObject, target?: string): string[] {
	const all = policyTargets(config).map(item => item.id);
	return target === 'all'
		? all
		: typeof target === 'string' && all.includes(target)
			? [target]
			: [];
}
function resolveTarget(config: JsonObject, id: string): JsonObject | undefined {
	if (id === 'llm') return config.llm;
	const parts = id.split(':');
	if (parts[0] === 'route') return config.routes?.[Number(parts[1])];
	if (parts[0] === 'bind')
		return config.binds?.[Number(parts[1])]?.listeners?.[Number(parts[2])]?.routes?.[
			Number(parts[3])
		];
	return undefined;
}
function validScope(policy: JsonObject): boolean {
	return (
		policy.scope == null ||
		(object(policy.scope) &&
			Object.keys(policy.scope).every(key => key === 'target_ref') &&
			(policy.scope.target_ref === undefined || typeof policy.scope.target_ref === 'string'))
	);
}
function staleBinding(policy: JsonObject, config: JsonObject, binding: PolicyBinding): boolean {
	const target = effectiveTarget(policy, config, binding);
	return (
		(binding.policyFingerprint !== undefined &&
			binding.policyFingerprint !== policyFingerprint(policy)) ||
		(binding.targetFingerprint !== undefined &&
			(!target || binding.targetFingerprint !== targetFingerprint(config, target)))
	);
}
function annotatedBinding(
	policy: JsonObject,
	config: JsonObject,
	binding: PolicyBinding
): PolicyBinding {
	const next = { ...binding };
	next.policyFingerprint ??= policyFingerprint(policy);
	const target = effectiveTarget(policy, config, binding);
	if (target && targetIds(config, target).length)
		next.targetFingerprint ??= targetFingerprint(config, target);
	return next;
}

// A shared confirmation expands into ordinary card bindings. It never changes the plan.
export function applySharedScope(
	plan: JsonObject,
	config: JsonObject,
	profile: ImportProfile,
	patch: { target?: string; condition?: JsonObject }
): SharedInputResult {
	if (
		patch.target !== undefined &&
		(typeof patch.target !== 'string' || !targetIds(config, patch.target).length)
	)
		throw new Error('공통 적용 경로를 찾을 수 없습니다.');
	if (patch.condition !== undefined) {
		assertJson(patch.condition);
		conditionCel(patch.condition);
	}
	const next = structuredClone(profile);
	let changed = 0,
		skipped = 0,
		stale = 0;
	for (const policy of cards(plan)) {
		const key = policyKey(policy),
			binding = profile.bindings[key] ?? {};
		if (binding.enabled === false) {
			skipped++;
			continue;
		}
		if (staleBinding(policy, config, binding)) {
			skipped++;
			stale++;
			continue;
		}
		if (
			!validScope(policy) ||
			!Array.isArray(policy.function) ||
			!policy.function.length ||
			!Array.isArray(policy.except) ||
			policy.except.length
		) {
			skipped++;
			continue;
		}
		const selected = selectedFunctions(policy, binding);
		const prospectiveTarget = effectiveTarget(policy, config, binding) ?? patch.target;
		if (
			patch.target &&
			selected.some(index => /^AGW-REGEX-GUARD-/.test(policy.function[index].function_id)) &&
			!targetIds(config, prospectiveTarget).every(id => regexTargetSupported(config, id))
		) {
			skipped++;
			continue;
		}
		const updated = { ...binding };
		let didChange = false;
		if (patch.target !== undefined && binding.target == null && policy.scope?.target_ref == null) {
			updated.target = patch.target;
			updated.targetFingerprint ??= targetFingerprint(config, patch.target);
			didChange = true;
		}
		if (patch.condition !== undefined && policy.applies_when == null && binding.condition == null) {
			updated.condition = structuredClone(patch.condition);
			didChange = true;
		}
		if (didChange) {
			next.bindings[key] = annotatedBinding(policy, config, updated);
			changed++;
		} else skipped++;
	}
	return { profile: next, changed, skipped, stale };
}

function commonValues(values: JsonObject[]): JsonObject {
	if (!values.length) return {};
	return structuredClone(
		Object.fromEntries(
			Object.entries(values[0]).filter(
				([key, value]) =>
					value !== undefined &&
					values.every(item => present(item, key) && identity(item[key]) === identity(value))
			)
		)
	);
}
function missingFields(fn: JsonObject, values: JsonObject): string[] {
	if (fn.action === 'remove_field' && values.body_location === 'request_fhir') {
		try {
			validateFhirFilterProfile(values.fhir_filter);
			return [];
		} catch {
			return ['fhir_filter'];
		}
	}
	const required: Record<string, string[]> = {
		log_access: ['reuse_existing_logging'],
		trace: ['reuse_existing_tracing'],
		require_jwt: ['jwt_auth'],
		limit_requests: ['local_rate_limit'],
		rate_limit: ['local_rate_limit'],
		authorize_require: ['require_when'],
		route_to_backend: ['reuse_existing_destination', 'require_when'],
		remove_field: ['paths', 'body_location'],
		set_header: ['header', 'value'],
		add_header: ['header', 'value'],
		remove_header: ['header']
	};
	const fields = /^AGW-REGEX-GUARD-/.test(fn.function_id)
		? ['guardrail', ...(fn.direction === 'response' ? ['response_mode'] : [])]
		: fn.action === 'rewrite_body'
			? values.instruction_text || values.body_expression
				? []
				: ['instruction_text']
			: (required[fn.action] ?? []);
	return fields.filter(
		key =>
			values[key] == null ||
			(Array.isArray(values[key]) && !values[key].length) ||
			(typeof values[key] === 'string' && !values[key].trim()) ||
			(key.startsWith('reuse_existing_') && values[key] !== true)
	);
}
function groupIdentity(
	fn: JsonObject,
	target: string | undefined,
	condition: JsonObject | undefined
): string {
	return identity({
		function_id: fn.function_id,
		action: fn.action,
		object: fn.object,
		direction: fn.direction,
		traffic: fn.traffic,
		mappings: fn.target,
		target,
		condition
	});
}

function compatiblePatch(
	fn: JsonObject,
	previous: JsonObject,
	patch: JsonObject,
	group: SharedFunctionGroup
): boolean {
	const values = { ...previous, ...fn.parameters };
	// Related fields form one setting. A new value cannot be attached to a different
	// existing header, resource, guard, issuer or quota through a partial fill.
	if (
		Object.entries(patch).some(
			([key, value]) =>
				value !== undefined && present(values, key) && identity(values[key]) !== identity(value)
		)
	)
		return false;
	const contextMatches = (key: string) => {
		if (!present(values, key)) return true;
		const context = present(patch, key) ? patch[key] : group.values[key];
		return context !== undefined && identity(context) === identity(values[key]);
	};
	if (present(patch, 'value') && !contextMatches('header')) return false;
	if (
		present(patch, 'paths') &&
		(!contextMatches('resource_type') || !contextMatches('body_location'))
	)
		return false;
	if (present(patch, 'response_mode') && !contextMatches('guardrail')) return false;
	return true;
}

export function sharedFunctionGroups(
	plan: JsonObject,
	config: JsonObject,
	profile: ImportProfile
): SharedFunctionGroup[] {
	const groups = new Map<string, SharedFunctionGroup>();
	const effective = new Map<string, JsonObject[]>(),
		sources = new Map<string, JsonObject[]>();
	for (const policy of cards(plan)) {
		const key = policyKey(policy),
			binding = profile.bindings[key] ?? {};
		if (binding.enabled === false) continue;
		const target = effectiveTarget(policy, config, binding),
			condition = effectiveCondition(policy, binding);
		for (const index of selectedFunctions(policy, binding)) {
			const fn = policy.function[index],
				id = groupIdentity(fn, target, condition);
			if (!groups.has(id)) {
				groups.set(id, {
					id,
					label: `${fn.function_id} · ${fn.action}`,
					fn: structuredClone(fn),
					target,
					condition: structuredClone(condition),
					policyKeys: [],
					members: [],
					values: {},
					missingFields: [],
					stale: 0
				});
				effective.set(id, []);
				sources.set(id, []);
			}
			const group = groups.get(id);
			if (!group) throw new Error('공통 기능 그룹을 구성할 수 없습니다.');
			group.members.push({ policyKey: key, index });
			if (!group.policyKeys.includes(key)) group.policyKeys.push(key);
			if (staleBinding(policy, config, binding)) group.stale++;
			const values = { ...binding.functions?.[String(index)], ...fn.parameters };
			effective.get(id)?.push(values);
			sources.get(id)?.push(fn.parameters ?? {});
			for (const field of missingFields(fn, values))
				if (!group.missingFields.includes(field)) group.missingFields.push(field);
		}
	}
	for (const [id, group] of groups) {
		group.values = commonValues(effective.get(id) ?? []);
		// A representative must not lock a field supplied by just one source card.
		group.fn.parameters = commonValues(sources.get(id) ?? []);
	}
	return [...groups.values()];
}

export function applySharedFunction(
	plan: JsonObject,
	config: JsonObject,
	profile: ImportProfile,
	groupId: string,
	patch: JsonObject
): SharedInputResult {
	if (!object(patch) || ![Object.prototype, null].includes(Object.getPrototypeOf(patch)))
		throw new Error('공통 기능 연결 정보는 JSON 객체여야 합니다.');
	patch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
	assertJson(patch);
	const next = structuredClone(profile);
	const group = sharedFunctionGroups(plan, config, profile).find(item => item.id === groupId);
	if (!group) return { profile: next, changed: 0, skipped: 0, stale: 0 };
	const policies = new Map(cards(plan).map(policy => [policyKey(policy), policy]));
	let changed = 0,
		skipped = 0,
		stale = 0;
	for (const member of group.members) {
		const policy = policies.get(member.policyKey),
			binding = profile.bindings[member.policyKey] ?? {};
		if (!policy) {
			skipped++;
			continue;
		}
		if (binding.enabled === false) {
			skipped++;
			continue;
		}
		if (staleBinding(policy, config, binding)) {
			skipped++;
			stale++;
			continue;
		}
		if (!validScope(policy)) {
			skipped++;
			continue;
		}
		const fn = policy.function[member.index],
			previous = binding.functions?.[String(member.index)] ?? {};
		if (!compatiblePatch(fn, previous, patch, group)) {
			skipped++;
			continue;
		}
		const additions = Object.fromEntries(
			Object.entries(patch).filter(
				([key, value]) =>
					value !== undefined && !present(fn.parameters, key) && !present(previous, key)
			)
		);
		if (!Object.keys(additions).length) {
			skipped++;
			continue;
		}
		next.bindings[member.policyKey] = {
			...annotatedBinding(policy, config, binding),
			functions: {
				...binding.functions,
				[String(member.index)]: { ...previous, ...structuredClone(additions) }
			}
		};
		changed++;
	}
	return { profile: next, changed, skipped, stale };
}

function validateParameters(parameters: JsonObject): boolean {
	try {
		assertJson(parameters);
		parseProfile(
			JSON.stringify({ version: 1, bindings: { shared: { functions: { 0: parameters } } } })
		);
		return true;
	} catch {
		return false;
	}
}
function nativeKind(fn: JsonObject): 'regex' | 'jwt' | 'rate' | undefined {
	if (
		/^AGW-REGEX-GUARD-(REQUEST|RESPONSE)$/.test(fn.function_id) &&
		fn.traffic === 'llm' &&
		fn.direction === (fn.function_id.endsWith('REQUEST') ? 'request' : 'response') &&
		['reject', 'mask'].includes(fn.action)
	)
		return 'regex';
	if (
		fn.function_id === 'AGW-AUTH-AUTHZ-REQUEST' &&
		fn.action === 'require_jwt' &&
		fn.direction === 'request' &&
		fn.traffic === 'http'
	)
		return 'jwt';
	if (
		fn.function_id === 'AGW-RATE-BUDGET-LIMIT' &&
		fn.action === 'limit_requests' &&
		fn.direction === 'exchange' &&
		fn.traffic === 'llm'
	)
		return 'rate';
	return undefined;
}
function directChoices(config: JsonObject, id: string, fn: JsonObject): ExistingTargetChoice[] {
	const target = resolveTarget(config, id);
	if (!target || !object(target.policies) || owns(target.policies, 'conditional')) return [];
	const policies = target.policies,
		kind = nativeKind(fn);
	const result: ExistingTargetChoice[] = [];
	const add = (label: string, value: JsonObject) => {
		if (
			validateParameters(value) &&
			!result.some(choice => JSON.stringify(choice.value) === JSON.stringify(value))
		)
			result.push({ label, value: structuredClone(value) });
	};
	if (kind === 'jwt') {
		const jwt = policies.jwtAuth;
		const providers = Array.isArray(jwt?.providers) ? jwt.providers : [jwt];
		if (
			object(jwt) &&
			jwt.mode === 'strict' &&
			providers.length &&
			providers.every(
				(provider: unknown) =>
					object(provider) &&
					Array.isArray(provider.jwtValidationOptions?.requiredClaims) &&
					provider.jwtValidationOptions.requiredClaims.includes('exp')
			)
		)
			add(`선택 경로의 JWT · ${id}`, { jwt_auth: policyTechnicalValue(jwt) });
	} else if (kind === 'rate') {
		for (const rate of Array.isArray(policies.localRateLimit) ? policies.localRateLimit : [])
			if (object(rate) && rate.type === 'requests')
				add(`선택 경로의 요청 제한 · ${id}`, { local_rate_limit: policyTechnicalValue(rate) });
	} else if (kind === 'regex' && regexTargetSupported(config, id)) {
		const guards = id === 'llm' ? policies.guardrails : policies.ai?.promptGuard;
		if (
			!object(guards) ||
			owns(guards, 'conditional') ||
			(object(policies.ai) && owns(policies.ai, 'conditional'))
		)
			return [];
		for (const guard of Array.isArray(guards[fn.direction]) ? guards[fn.direction] : []) {
			if (
				!object(guard) ||
				!object(guard.regex) ||
				guard.regex.action !== fn.action ||
				(fn.direction === 'request' && !Array.isArray(guard.scope))
			)
				continue;
			if (fn.direction === 'request')
				add(`선택 경로의 요청 정규식 · ${id}`, { guardrail: policyTechnicalValue(guard) });
			else if (['Disabled', 'Enabled'].includes(guards.streaming))
				add(`선택 경로의 응답 정규식 · ${id}`, {
					guardrail: policyTechnicalValue(guard),
					response_mode: guards.streaming === 'Disabled' ? 'non_streaming' : 'streaming_partial'
				});
		}
	}
	return result;
}

// Only direct selected-route settings are eligible; nested backend/model and conditional policies are excluded.
export function existingTargetChoices(
	config: JsonObject,
	target: string | undefined,
	fn: JsonObject
): ExistingTargetChoice[] {
	const ids = targetIds(config, target);
	if (!ids.length) return [];
	if (fn.function_id === 'AGW-ACCESS-LOG-TRACING' && fn.action === 'log_access')
		return [
			{ label: '선택 경로의 Gateway 접속기록 재사용 확인', value: { reuse_existing_logging: true } }
		];
	if (
		fn.function_id === 'AGW-ACCESS-LOG-TRACING' &&
		fn.action === 'trace' &&
		object(config.frontendPolicies?.tracing)
	)
		return [
			{ label: '이 Gateway의 공통 추적 설정 재사용 확인', value: { reuse_existing_tracing: true } }
		];
	const choices = ids.map(id => directChoices(config, id, fn));
	return choices[0].filter(choice =>
		choices.every(items =>
			items.some(item => JSON.stringify(item.value) === JSON.stringify(choice.value))
		)
	);
}

export function reuseExistingSharedSettings(
	plan: JsonObject,
	config: JsonObject,
	profile: ImportProfile
): SharedInputResult {
	let next = structuredClone(profile),
		changed = 0,
		skipped = 0,
		stale = 0;
	for (const group of sharedFunctionGroups(plan, config, profile)) {
		const kind = nativeKind(group.fn);
		let condition: string | undefined;
		try {
			condition = conditionCel(group.condition);
		} catch {
			/* Unresolved applicability remains unresolved. */
		}
		if (!kind || condition !== 'true' || (kind === 'regex' && group.fn.direction !== 'request')) {
			skipped += group.members.length;
			continue;
		}
		const choices = existingTargetChoices(config, group.target, group.fn).filter(
			choice =>
				kind !== 'regex' ||
				choice.value.guardrail.regex.rules.every(
					(rule: JsonObject) => typeof rule.pattern === 'string'
				)
		);
		if (choices.length !== 1) {
			skipped += group.members.length;
			continue;
		}
		const result = applySharedFunction(plan, config, next, group.id, choices[0].value);
		next = result.profile;
		changed += result.changed;
		skipped += result.skipped;
		stale += result.stale;
	}
	return { profile: next, changed, skipped, stale };
}

function presetParameters(fn: JsonObject, parameters: JsonObject): JsonObject {
	const fields: Record<string, string[]> = {
		log_access: ['reuse_existing_logging'],
		trace: ['reuse_existing_tracing'],
		require_jwt: ['jwt_auth'],
		limit_requests: ['local_rate_limit'],
		rate_limit: ['local_rate_limit'],
		remove_field: ['paths', 'resource_type', 'body_location'],
		set_header: ['header', 'value'],
		add_header: ['header', 'value'],
		remove_header: ['header'],
		rewrite_body: ['instruction_text', 'body_expression']
	};
	const allowed = /^AGW-REGEX-GUARD-/.test(fn.function_id)
		? ['guardrail', 'response_mode']
		: (fields[fn.action] ?? []);
	return Object.fromEntries(
		Object.entries(parameters).filter(
			([key, value]) => allowed.includes(key) && value !== undefined
		)
	);
}

function validPresetSemantics(fn: JsonObject, parameters: JsonObject): boolean {
	try {
		if (/^AGW-REGEX-GUARD-/.test(fn.function_id))
			return nativeKind(fn) === 'regex' && parameters.guardrail?.regex?.action === fn.action;
		if (fn.action === 'require_jwt') return nativeKind(fn) === 'jwt';
		if (['rate_limit', 'limit_requests'].includes(fn.action)) return nativeKind(fn) === 'rate';
		if (['log_access', 'trace'].includes(fn.action))
			return (
				fn.function_id === 'AGW-ACCESS-LOG-TRACING' &&
				parameters[
					fn.action === 'log_access' ? 'reuse_existing_logging' : 'reuse_existing_tracing'
				] === true
			);
		if (
			!/^AGW-BODY-HEADER-TRANSFORM-(REQUEST|RESPONSE)$/.test(fn.function_id) ||
			fn.traffic !== 'http' ||
			fn.direction !== (fn.function_id.endsWith('REQUEST') ? 'request' : 'response')
		)
			return false;
		if (['set_header', 'add_header', 'remove_header'].includes(fn.action))
			return (
				typeof parameters.header === 'string' &&
				/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(parameters.header) &&
				(fn.action === 'remove_header' ||
					(typeof parameters.value === 'string' && !/[\r\n]/.test(parameters.value)))
			);
		if (fn.action === 'remove_field') {
			if (
				fn.direction !== 'request' ||
				parameters.body_location !== 'root_json' ||
				!Array.isArray(parameters.paths) ||
				(parameters.resource_type !== undefined && !/^[A-Za-z]+$/.test(parameters.resource_type))
			)
				return false;
			deleteFieldsCel(parameters.paths);
			return true;
		}
		if (fn.action === 'rewrite_body')
			return (
				(typeof parameters.body_expression === 'string' &&
					Boolean(parameters.body_expression.trim())) ||
				(fn.direction === 'request' &&
					typeof parameters.instruction_text === 'string' &&
					Boolean(parameters.instruction_text.trim()))
			);
		return false;
	} catch {
		return false;
	}
}

export function collectSharedPresets(
	plan: JsonObject,
	config: JsonObject,
	profile: ImportProfile
): SharedPresets {
	const entries: SharedPresets['entries'] = [];
	for (const group of sharedFunctionGroups(plan, config, profile)) {
		if (
			!group.target ||
			!targetIds(config, group.target).length ||
			group.stale ||
			group.missingFields.length
		)
			continue;
		const parameters = presetParameters(group.fn, group.values);
		if (
			Object.keys(parameters).length &&
			validateParameters(parameters) &&
			validPresetSemantics(group.fn, parameters)
		)
			entries.push({
				groupIdentity: group.id,
				target: group.target,
				targetFingerprint: targetFingerprint(config, group.target),
				parameters: structuredClone(parameters)
			});
	}
	return { version: 1, entries };
}

function checkedPresets(value: unknown): SharedPresets {
	assertJson(value);
	if (
		!object(value) ||
		value.version !== 1 ||
		!Array.isArray(value.entries) ||
		Object.keys(value).some(key => !['version', 'entries'].includes(key))
	)
		throw new Error('저장된 공통 설정의 형식이 올바르지 않습니다.');
	const identities = new Set<string>();
	for (const entry of value.entries) {
		if (
			!object(entry) ||
			Object.keys(entry).some(
				key => !['groupIdentity', 'target', 'targetFingerprint', 'parameters'].includes(key)
			) ||
			!['groupIdentity', 'target', 'targetFingerprint'].every(
				key => typeof entry[key] === 'string' && entry[key]
			) ||
			!object(entry.parameters) ||
			!Object.keys(entry.parameters).length ||
			!validateParameters(entry.parameters) ||
			identities.has(entry.groupIdentity)
		)
			throw new Error('저장된 공통 기능 설정을 확인해 주세요.');
		let semantics: JsonObject;
		try {
			semantics = JSON.parse(entry.groupIdentity);
		} catch {
			throw new Error('저장된 공통 기능 식별값이 올바르지 않습니다.');
		}
		assertJson(semantics);
		if (
			!object(semantics) ||
			typeof semantics.function_id !== 'string' ||
			typeof semantics.action !== 'string' ||
			Object.keys(semantics).some(
				key =>
					![
						'function_id',
						'action',
						'object',
						'direction',
						'traffic',
						'mappings',
						'target',
						'condition'
					].includes(key)
			) ||
			!validPresetSemantics(semantics, entry.parameters) ||
			semantics.target !== entry.target ||
			identity(semantics) !== entry.groupIdentity ||
			identity(presetParameters(semantics, entry.parameters)) !== identity(entry.parameters)
		)
			throw new Error('저장된 공통 설정의 기능 의미가 올바르지 않습니다.');
		identities.add(entry.groupIdentity);
	}
	return structuredClone(value) as SharedPresets;
}
export function parseSharedPresets(source: string): SharedPresets {
	return checkedPresets(JSON.parse(source));
}

// The caller invokes this only after the user confirms the matching target and applicability.
export function applySharedPresets(
	plan: JsonObject,
	config: JsonObject,
	profile: ImportProfile,
	presets: SharedPresets
): SharedInputResult {
	const saved = checkedPresets(presets),
		groups = sharedFunctionGroups(plan, config, profile);
	let next = structuredClone(profile),
		changed = 0,
		skipped = 0,
		stale = 0;
	for (const entry of saved.entries) {
		const group = groups.find(
			item => item.id === entry.groupIdentity && item.target === entry.target
		);
		if (!group) {
			skipped++;
			continue;
		}
		if (
			!targetIds(config, entry.target).length ||
			targetFingerprint(config, entry.target) !== entry.targetFingerprint
		) {
			skipped += group.members.length;
			stale += group.members.length;
			continue;
		}
		const result = applySharedFunction(plan, config, next, group.id, entry.parameters);
		next = result.profile;
		changed += result.changed;
		skipped += result.skipped;
		stale += result.stale;
	}
	return { profile: next, changed, skipped, stale };
}
