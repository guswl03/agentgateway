// biome-ignore lint/style/noRestrictedImports: These contract modules also execute directly in the Node TypeScript harness.
import type { ImportProfile, JsonObject, PolicyBinding } from './policyAdapter.ts';
import {
	adaptPolicyPlan,
	conditionCel,
	parseProfile,
	policyFingerprint,
	policyKey,
	policyTargets,
	regexTargetSupported,
	targetFingerprint
	// biome-ignore lint/style/noRestrictedImports: These contract modules also execute directly in the Node TypeScript harness.
} from './policyAdapter.ts';
// biome-ignore lint/style/noRestrictedImports: These contract modules also execute directly in the Node TypeScript harness.
import { builtinRegexChoices, functionMatch } from './policyChoices.ts';
// biome-ignore lint/style/noRestrictedImports: These contract modules also execute directly in the Node TypeScript harness.
import { validateFhirFilterProfile } from './policyFhir.ts';
// biome-ignore lint/style/noRestrictedImports: These contract modules also execute directly in the Node TypeScript harness.
import { existingTargetChoices } from './policyShared.ts';

export type QuickFeatureMember = {
	key: string;
	label: string;
	ready: boolean;
	enabled: boolean;
	reason?: string;
};
export type QuickFeatureGroup = {
	id: string;
	label: string;
	keys: string[];
	count: number;
	ready: boolean;
	enabled: boolean;
	readyCount: number;
	enabledCount: number;
	reason?: string;
	reasons: string[];
	members: QuickFeatureMember[];
};
export type QuickGroupEditResult = {
	profile: ImportProfile;
	changed: number;
	skipped: number;
	stale: number;
};

const object = (value: unknown): value is JsonObject =>
	Boolean(value && typeof value === 'object' && !Array.isArray(value));
const owns = (value: JsonObject, field: string) => Object.hasOwn(value, field);
const blank = (value: unknown) =>
	value === undefined || (object(value) && !Object.keys(value).length);
const cards = (plan: JsonObject): JsonObject[] =>
	(plan.policy_packs ?? []).flatMap((pack: JsonObject) => pack.policies ?? []);

function identity(input: unknown): string {
	function ordered(value: unknown): unknown {
		if (Array.isArray(value)) return value.map(ordered);
		if (!object(value)) return value;
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map(key => [key, ordered(value[key])])
		);
	}
	return JSON.stringify(ordered(input));
}
function selected(policy: JsonObject, binding: PolicyBinding): number[] {
	if (!Array.isArray(policy.function)) return [];
	const indices =
		binding.selectedFunctions ?? policy.function.map((_: unknown, index: number) => index);
	return Array.isArray(indices) &&
		indices.length &&
		new Set(indices).size === indices.length &&
		indices.every(index => Number.isInteger(index) && index >= 0 && index < policy.function.length)
		? indices
		: [];
}
function target(
	policy: JsonObject,
	config: JsonObject,
	binding: PolicyBinding
): string | undefined {
	return (
		binding.target ??
		policy.scope?.target_ref ??
		(policyTargets(config).length === 1 ? policyTargets(config)[0].id : undefined)
	);
}
function stale(policy: JsonObject, config: JsonObject, binding: PolicyBinding): boolean {
	if (
		binding.policyFingerprint !== undefined &&
		binding.policyFingerprint !== policyFingerprint(policy)
	)
		return true;
	if (binding.targetFingerprint === undefined) return false;
	const id = target(policy, config, binding),
		targets = policyTargets(config);
	return (
		!id ||
		!targets.length ||
		(id !== 'all' && !targets.some(item => item.id === id)) ||
		binding.targetFingerprint !== targetFingerprint(config, id)
	);
}
function validSource(policy: JsonObject): boolean {
	return (
		Array.isArray(policy.function) &&
		policy.function.length > 0 &&
		Array.isArray(policy.except) &&
		!policy.except.length &&
		(policy.scope == null ||
			(object(policy.scope) &&
				Object.keys(policy.scope).every(key => key === 'target_ref') &&
				(policy.scope.target_ref === undefined || typeof policy.scope.target_ref === 'string')))
	);
}
function defaultTarget(
	policy: JsonObject,
	config: JsonObject,
	binding: PolicyBinding
): string | undefined {
	const ids = policyTargets(config).map(item => item.id);
	if (!ids.length) return undefined;
	const requiresNative = selected(policy, binding).some(index =>
		/^AGW-REGEX-GUARD-(REQUEST|RESPONSE)$/.test(policy.function[index]?.function_id)
	);
	if (!requiresNative) return 'all';
	const supported = ids.filter(id => regexTargetSupported(config, id));
	if (supported.length === ids.length) return 'all';
	// Multiple compatible routes inside a mixed configuration cannot be represented
	// by one binding. Choosing one would silently narrow the user's broad scope.
	return supported.length === 1 ? supported[0] : undefined;
}
function fillCompatible(values: JsonObject, patch: JsonObject): JsonObject {
	if (
		Object.entries(patch).some(
			([key, value]) => owns(values, key) && identity(values[key]) !== identity(value)
		)
	)
		return {};
	return Object.fromEntries(Object.entries(patch).filter(([key]) => !owns(values, key)));
}
function defaultsFor(
	fn: JsonObject,
	config: JsonObject,
	id: string | undefined,
	values: JsonObject
): JsonObject {
	if (
		fn.function_id === 'AGW-BODY-HEADER-TRANSFORM-REQUEST' &&
		fn.direction === 'request' &&
		fn.traffic === 'http' &&
		fn.action === 'remove_field' &&
		blank(values)
	)
		return { body_location: 'request_fhir', fhir_filter: { version: 1, allow_fields: {} } };
	if (
		fn.function_id === 'AGW-BODY-HEADER-TRANSFORM-RESPONSE' &&
		fn.direction === 'response' &&
		fn.traffic === 'http' &&
		fn.action === 'set_header' &&
		fn.object === 'AI_OUTPUT' &&
		values.header === 'x-ai-generated'
	)
		return fillCompatible(values, { header: 'x-ai-generated', value: 'true' });

	const choices = existingTargetChoices(config, id, fn).filter(choice =>
		Object.entries(choice.value).every(
			([key, value]) => !owns(values, key) || identity(values[key]) === identity(value)
		)
	);
	if (choices.length === 1) return fillCompatible(values, choices[0].value);
	if (
		!/^AGW-REGEX-GUARD-(REQUEST|RESPONSE)$/.test(fn.function_id) ||
		fn.traffic !== 'llm' ||
		fn.direction !== (fn.function_id.endsWith('REQUEST') ? 'request' : 'response') ||
		!['reject', 'mask'].includes(fn.action)
	)
		return {};
	const response = fn.direction === 'response';
	if (owns(values, 'guardrail'))
		return response && !owns(values, 'response_mode') ? { response_mode: 'non_streaming' } : {};
	if (Object.keys(values).some(key => key !== 'response_mode')) return {};
	const builtins = builtinRegexChoices(fn.direction, fn.action);
	if (!builtins.length) return {};
	return {
		guardrail: {
			regex: { action: fn.action, rules: builtins.flatMap(choice => choice.value.regex.rules) },
			...(!response ? { scope: ['systemPrompt', 'messages', 'toolInput', 'toolOutput'] } : {})
		},
		...(response && !owns(values, 'response_mode') ? { response_mode: 'non_streaming' } : {})
	};
}
function oneCardPlan(plan: JsonObject, policy: JsonObject): JsonObject {
	const pack = plan.policy_packs?.find((item: JsonObject) => item.policies?.includes(policy));
	return { ...plan, policy_packs: [{ ...pack, policies: [policy] }] };
}
function readiness(
	plan: JsonObject,
	policy: JsonObject,
	config: JsonObject,
	profile: ImportProfile
): string[] {
	if (!Array.isArray(policy.function) || !policy.function.length)
		return [
			policy.function === null
				? 'Gateway 기능이 아직 검토되지 않았습니다.'
				: '연결된 Gateway 기능이 없습니다.'
		];
	try {
		const key = policyKey(policy),
			probe = structuredClone(profile);
		probe.bindings[key] = { ...probe.bindings[key], enabled: true };
		const findings = adaptPolicyPlan(oneCardPlan(plan, policy), config, probe).findings;
		return [...new Set(findings.map(item => item.message))];
	} catch (error) {
		return [(error as Error).message || '연결 정보를 확인해 주세요.'];
	}
}

function knownFunction(fn: JsonObject): boolean {
	if (!object(fn)) return false;
	if (/^AGW-BODY-HEADER-TRANSFORM-(REQUEST|RESPONSE)$/.test(fn.function_id))
		return (
			fn.direction === (fn.function_id.endsWith('REQUEST') ? 'request' : 'response') &&
			fn.traffic === 'http' &&
			(['set_header', 'add_header', 'remove_header', 'rewrite_body'].includes(fn.action) ||
				(fn.action === 'remove_field' && fn.direction === 'request'))
		);
	if (/^AGW-REGEX-GUARD-(REQUEST|RESPONSE)$/.test(fn.function_id))
		return (
			fn.direction === (fn.function_id.endsWith('REQUEST') ? 'request' : 'response') &&
			fn.traffic === 'llm' &&
			['reject', 'mask'].includes(fn.action)
		);
	if (fn.function_id === 'AGW-AUTH-AUTHZ-REQUEST')
		return (
			fn.direction === 'request' &&
			fn.traffic === 'http' &&
			['require_jwt', 'authorize_require'].includes(fn.action)
		);
	if (fn.function_id === 'AGW-RATE-BUDGET-LIMIT')
		return fn.direction === 'exchange' && fn.traffic === 'llm' && fn.action === 'limit_requests';
	if (fn.function_id === 'AGW-MODEL-DESTINATION-SELECT-REQUEST')
		return fn.direction === 'request' && fn.traffic === 'llm' && fn.action === 'route_to_backend';
	return fn.function_id === 'AGW-ACCESS-LOG-TRACING' && ['log_access', 'trace'].includes(fn.action);
}
function missingSetup(policy: JsonObject, config: JsonObject, binding: PolicyBinding): boolean {
	if (Array.isArray(policy.function) && !policy.function.length) return true;
	if (!validSource(policy) || stale(policy, config, binding)) return false;
	const indices = selected(policy, binding);
	if (!indices.length || indices.some(index => !knownFunction(policy.function[index])))
		return false;
	let condition: string;
	try {
		condition = conditionCel(policy.applies_when ?? binding.condition);
	} catch {
		return false;
	}
	if (
		indices.some(
			index =>
				/^AGW-REGEX-GUARD-/.test(policy.function[index].function_id) ||
				policy.function[index].action === 'require_jwt' ||
				policy.function[index].action === 'limit_requests'
		) &&
		!['true', 'false'].includes(condition)
	)
		return false;
	const id = target(policy, config, binding),
		targets = policyTargets(config);
	if (!id || !targets.length || (id !== 'all' && !targets.some(item => item.id === id)))
		return true;
	const absent = (values: JsonObject, key: string) =>
		values[key] == null ||
		values[key] === '' ||
		(Array.isArray(values[key]) && !values[key].length);
	return indices.some(index => {
		const fn = policy.function[index],
			values = { ...binding.functions?.[String(index)], ...fn.parameters };
		if (/^AGW-REGEX-GUARD-/.test(fn.function_id))
			return (
				absent(values, 'guardrail') ||
				(fn.direction === 'response' && absent(values, 'response_mode'))
			);
		if (fn.action === 'require_jwt') {
			if (absent(values, 'jwt_auth')) return true;
			const jwt = values.jwt_auth;
			if (!object(jwt)) return false;
			const providers = Array.isArray(jwt.providers) ? jwt.providers : [jwt];
			return (
				!providers.length ||
				providers.some(
					(provider: JsonObject) =>
						object(provider) &&
						['issuer', 'audiences', 'jwks'].some(field => absent(provider, field))
				)
			);
		}
		if (fn.action === 'limit_requests')
			return (
				absent(values, 'local_rate_limit') ||
				(object(values.local_rate_limit) &&
					['maxTokens', 'tokensPerFill', 'fillInterval'].some(field =>
						absent(values.local_rate_limit, field)
					))
			);
		if (fn.action === 'remove_field')
			return values.body_location === 'request_fhir'
				? absent(values, 'fhir_filter')
				: absent(values, 'paths') || absent(values, 'body_location');
		if (['set_header', 'add_header', 'remove_header'].includes(fn.action))
			return absent(values, 'header') || (fn.action !== 'remove_header' && absent(values, 'value'));
		if (fn.action === 'rewrite_body')
			return absent(values, 'instruction_text') && absent(values, 'body_expression');
		if (fn.action === 'authorize_require') return absent(values, 'require_when');
		if (fn.action === 'route_to_backend')
			return values.reuse_existing_destination !== true || absent(values, 'require_when');
		if (fn.action === 'log_access') return values.reuse_existing_logging !== true;
		return (
			fn.action === 'trace' &&
			(values.reuse_existing_tracing !== true || !object(config.frontendPolicies?.tracing))
		);
	});
}

function guardValues(policy: JsonObject, binding: PolicyBinding): JsonObject | undefined {
	if (
		!Array.isArray(policy.function) ||
		policy.function.length !== 1 ||
		selected(policy, binding)[0] !== 0
	)
		return undefined;
	const fn = policy.function[0];
	if (!knownFunction(fn) || !/^AGW-REGEX-GUARD-/.test(fn.function_id)) return undefined;
	const values = { ...binding.functions?.['0'], ...fn.parameters };
	if (values.guardrail?.regex?.action !== fn.action) return undefined;
	try {
		parseProfile(JSON.stringify({ version: 1, bindings: { guard: { functions: { 0: values } } } }));
		return values;
	} catch {
		return undefined;
	}
}
function sameGuardCoverage(
	left: JsonObject,
	right: JsonObject,
	config: JsonObject,
	profile: ImportProfile
): boolean {
	const a = profile.bindings[policyKey(left)] ?? {},
		b = profile.bindings[policyKey(right)] ?? {};
	const first = guardValues(left, a),
		second = guardValues(right, b);
	if (!first || !second || left.function[0].direction !== right.function[0].direction) return false;
	const scopes = (policy: JsonObject, binding: PolicyBinding) => {
		const id = target(policy, config, binding),
			ids = policyTargets(config).map(item => item.id);
		return id === 'all' ? ids : id && ids.includes(id) ? [id] : [];
	};
	try {
		if (
			conditionCel(left.applies_when ?? a.condition) !== 'true' ||
			conditionCel(right.applies_when ?? b.condition) !== 'true'
		)
			return false;
	} catch {
		return false;
	}
	return (
		identity(scopes(left, a)) === identity(scopes(right, b)) &&
		scopes(left, a).length > 0 &&
		identity(left.applies_when ?? a.condition) === identity(right.applies_when ?? b.condition) &&
		identity(first.guardrail.regex.rules) === identity(second.guardrail.regex.rules) &&
		identity(first.guardrail.scope) === identity(second.guardrail.scope) &&
		identity(first.response_mode) === identity(second.response_mode)
	);
}
function freshGuard(
	plan: JsonObject,
	policy: JsonObject,
	config: JsonObject,
	before: ImportProfile,
	after: ImportProfile
): boolean {
	const key = policyKey(policy),
		previous = before.bindings[key] ?? {},
		binding = after.bindings[key] ?? {};
	return (
		previous.enabled === undefined &&
		validSource(policy) &&
		!stale(policy, config, previous) &&
		policy.function.length === 1 &&
		blank(policy.function[0].parameters) &&
		blank(previous.functions?.['0']) &&
		Boolean(guardValues(policy, binding)) &&
		readiness(plan, policy, config, after).length === 0
	);
}
function maskNotice(
	policy: JsonObject,
	config: JsonObject,
	profile: ImportProfile,
	policies: JsonObject[]
): string | undefined {
	const binding = profile.bindings[policyKey(policy)] ?? {};
	if (
		binding.enabled !== false ||
		policy.function?.[0]?.action !== 'mask' ||
		!blank(policy.function[0].parameters) ||
		stale(policy, config, binding) ||
		!guardValues(policy, binding)
	)
		return undefined;
	return policies.some(
		other =>
			other.function?.[0]?.action === 'reject' &&
			profile.bindings[policyKey(other)]?.enabled !== false &&
			sameGuardCoverage(policy, other, config, profile)
	)
		? '기본 거절 보호 사용 · 치환은 제외'
		: undefined;
}

// The user has authorized broad technical defaults and card-level opt-out. Source
// values, explicit bindings and stale confirmations remain authoritative.
export function buildQuickProfile(
	plan: JsonObject,
	config: JsonObject,
	profile: ImportProfile
): ImportProfile {
	const next = structuredClone(profile),
		policies = cards(plan);
	for (const policy of policies) {
		const key = policyKey(policy),
			previous = profile.bindings[key] ?? {};
		if (previous.enabled === false) continue;
		next.bindings[key] ??= {};
		const updated = next.bindings[key];
		if (stale(policy, config, previous) || !validSource(policy)) continue;
		updated.policyFingerprint ??= policyFingerprint(policy);
		updated.selectedFunctions ??= policy.function.map((_: unknown, index: number) => index);
		if (previous.target == null && policy.scope?.target_ref == null) {
			const id = defaultTarget(policy, config, updated);
			if (id) updated.target = id;
		}
		const id = target(policy, config, updated);
		if (id && policyTargets(config).some(item => id === 'all' || item.id === id))
			updated.targetFingerprint ??= targetFingerprint(config, id);
		if (policy.applies_when == null && previous.condition == null)
			updated.condition = { constant: true };
		if (updated.functions !== undefined && !object(updated.functions)) continue;
		for (const index of selected(policy, updated)) {
			const fn = policy.function[index];
			if (!object(fn) || (fn.parameters !== undefined && !object(fn.parameters))) continue;
			const old = updated.functions?.[String(index)];
			if (old !== undefined && !object(old)) continue;
			const values = { ...old, ...fn.parameters };
			const additions = defaultsFor(fn, config, id, values);
			if (Object.keys(additions).length) {
				updated.functions ??= {};
				updated.functions[String(index)] = { ...old, ...structuredClone(additions) };
			}
		}
	}
	for (const policy of policies) {
		const key = policyKey(policy),
			previous = profile.bindings[key] ?? {};
		if (previous.enabled !== undefined) continue;
		next.bindings[key] ??= {};
		const updated = next.bindings[key];
		const reasons = readiness(plan, policy, config, next);
		updated.enabled = !reasons.length || !missingSetup(policy, config, updated);
		if (!updated.enabled) {
			const probe = structuredClone(next);
			probe.bindings[key].enabled = true;
			try {
				if (
					adaptPolicyPlan(oneCardPlan(plan, policy), config, probe).findings.some(
						item => item.kind === 'conflict'
					)
				)
					updated.enabled = true;
			} catch {
				/* The original readiness reason remains visible. */
			}
		}
	}
	// For two newly generated blank single-function guards, maximum protection
	// selects rejection over masking of the same content. Saved/source/manual
	// settings and cards with additional functions never enter this default choice.
	const fresh = policies.filter(policy => freshGuard(plan, policy, config, profile, next));
	for (const policy of fresh) {
		if (
			policy.function[0].action === 'mask' &&
			fresh.some(
				other =>
					other.function[0].action === 'reject' &&
					next.bindings[policyKey(other)].enabled !== false &&
					sameGuardCoverage(policy, other, config, next)
			)
		)
			next.bindings[policyKey(policy)].enabled = false;
	}
	// The adapter still blocks conflicts among active cards. A deferred card did
	// not contribute to that combined execution and must not be reactivated by it.
	return next;
}

function label(policy: JsonObject): string {
	const legal = (policy.legal_sources ?? [])
		.map((source: JsonObject) => [source.law_name, source.provision].filter(Boolean).join(' · '))
		.filter(Boolean);
	return [...new Set(legal)].join(' / ') || policy.policy_text || policyKey(policy);
}

function effectiveFunction(fn: JsonObject, parameters: JsonObject): JsonObject {
	let mappings = fn?.target,
		effective = parameters,
		objectCode = fn?.object;
	if (
		fn?.action === 'remove_field' &&
		fn?.function_id === 'AGW-BODY-HEADER-TRANSFORM-REQUEST' &&
		fn?.direction === 'request' &&
		fn?.traffic === 'http' &&
		parameters.body_location === 'request_fhir' &&
		Object.keys(parameters).every(field => ['body_location', 'fhir_filter'].includes(field))
	) {
		try {
			effective = {
				body_location: 'request_fhir',
				fhir_filter: validateFhirFilterProfile(parameters.fhir_filter)
			};
			mappings = undefined;
			objectCode = undefined;
		} catch {
			/* An invalid filter remains a separate unresolved setting. */
		}
	}
	if (
		knownFunction(fn) &&
		/^AGW-REGEX-GUARD-/.test(fn.function_id) &&
		(!fn.target || fn.target.object === fn.object) &&
		parameters.guardrail?.regex?.action === fn.action
	) {
		try {
			parseProfile(
				JSON.stringify({ version: 1, bindings: { guard: { functions: { 0: parameters } } } })
			);
			objectCode = undefined;
			mappings = undefined;
		} catch {
			/* Unsupported guards keep their complete source identity. */
		}
	}
	return {
		id: fn?.function_id,
		action: fn?.action,
		object: objectCode,
		direction: fn?.direction,
		traffic: fn?.traffic,
		mappings,
		parameters: effective
	};
}
function effectiveGroupId(policy: JsonObject, config: JsonObject, binding: PolicyBinding): string {
	const functions = selected(policy, binding).map(index =>
		effectiveFunction(policy.function[index], {
			...binding.functions?.[String(index)],
			...policy.function[index]?.parameters
		})
	);
	return identity({
		// Source indexes are local to each card. Grouping does not change execution order.
		functions: functions.map(identity).sort(),
		target: target(policy, config, binding),
		condition: policy.applies_when ?? binding.condition,
		...(!functions.length ? { card: policyKey(policy) } : {})
	});
}
function checkQuickPatch(value: unknown, optional = false): void {
	if (optional && value === undefined) return;
	if (value === null || ['string', 'boolean'].includes(typeof value)) return;
	if (typeof value === 'number' && Number.isFinite(value)) return;
	if (Array.isArray(value)) {
		for (const item of value) checkQuickPatch(item);
		return;
	}
	if (!object(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
		throw new Error('기능 설정은 JSON 객체여야 합니다.');
	for (const [field, child] of Object.entries(value)) {
		if (['__proto__', 'constructor', 'prototype'].includes(field))
			throw new Error('기능 설정에 허용하지 않는 객체 키가 있습니다.');
		checkQuickPatch(child, true);
	}
}

// An explicit quick-row edit updates only the currently equivalent, enabled
// cards represented by that row. General shared presets remain fill-only.
export function applyQuickGroupFunction(
	plan: JsonObject,
	config: JsonObject,
	profile: ImportProfile,
	groupKeys: string[],
	editorKey: string,
	functionIndex: number,
	patch: JsonObject
): QuickGroupEditResult {
	if (!object(patch)) throw new Error('기능 설정은 JSON 객체여야 합니다.');
	checkQuickPatch(patch);
	const next = structuredClone(profile),
		keys = [...new Set(groupKeys)],
		policies = new Map(cards(plan).map(policy => [policyKey(policy), policy])),
		editor = policies.get(editorKey),
		editorBinding = profile.bindings[editorKey] ?? {};
	const result = { profile: next, changed: 0, skipped: 0, stale: 0 };
	if (
		!editor ||
		!keys.includes(editorKey) ||
		editorBinding.enabled === false ||
		!validSource(editor) ||
		!selected(editor, editorBinding).includes(functionIndex) ||
		!knownFunction(editor.function[functionIndex])
	) {
		result.skipped = keys.length;
		return result;
	}
	if (stale(editor, config, editorBinding)) {
		result.skipped = keys.length;
		result.stale = 1;
		return result;
	}
	const groupId = effectiveGroupId(editor, config, editorBinding),
		editorFunctionId = identity(
			effectiveFunction(editor.function[functionIndex], {
				...editorBinding.functions?.[String(functionIndex)],
				...editor.function[functionIndex].parameters
			})
		);
	for (const key of keys) {
		const policy = policies.get(key),
			binding = profile.bindings[key] ?? {};
		if (!policy || binding.enabled === false || !validSource(policy)) {
			result.skipped++;
			continue;
		}
		if (stale(policy, config, binding)) {
			result.skipped++;
			result.stale++;
			continue;
		}
		if (effectiveGroupId(policy, config, binding) !== groupId) {
			result.skipped++;
			continue;
		}
		const indices = selected(policy, binding).filter(
			index =>
				identity(
					effectiveFunction(policy.function[index], {
						...binding.functions?.[String(index)],
						...policy.function[index].parameters
					})
				) === editorFunctionId
		);
		// Multiple identical functions in one card are ambiguous; keep them for individual review.
		if (indices.length !== 1) {
			result.skipped++;
			continue;
		}
		const index = indices[0],
			fn = policy.function[index],
			previous = binding.functions?.[String(index)] ?? {};
		if (
			(fn.parameters !== undefined && !object(fn.parameters)) ||
			!object(previous) ||
			Object.entries(patch).some(
				([field, value]) =>
					owns(fn.parameters ?? {}, field) && identity(fn.parameters[field]) !== identity(value)
			)
		) {
			result.skipped++;
			continue;
		}
		const parameters = structuredClone(previous);
		for (const [field, value] of Object.entries(patch)) {
			if (owns(fn.parameters ?? {}, field)) continue;
			if (value === undefined) delete parameters[field];
			else parameters[field] = structuredClone(value);
		}
		if (identity(parameters) === identity(previous)) {
			result.skipped++;
			continue;
		}
		next.bindings[key] = {
			...binding,
			functions: { ...binding.functions, [String(index)]: parameters }
		};
		result.changed++;
	}
	return result;
}
export function quickFeatureGroups(
	plan: JsonObject,
	config: JsonObject,
	profile: ImportProfile
): QuickFeatureGroup[] {
	const groups = new Map<string, QuickFeatureGroup>();
	const policies = cards(plan);
	let combinedFindings: ReturnType<typeof adaptPolicyPlan>['findings'] = [];
	try {
		combinedFindings = adaptPolicyPlan(plan, config, profile).findings;
	} catch {
		/* Recorded per card below. */
	}
	for (const policy of policies) {
		const key = policyKey(policy),
			binding = profile.bindings[key] ?? {};
		const indices = selected(policy, binding),
			functions = indices.map(index => policy.function[index]);
		const id = effectiveGroupId(policy, config, binding);
		const reasons = readiness(plan, policy, config, profile);
		const targetId = target(policy, config, binding);
		if (binding.enabled !== false)
			for (const finding of combinedFindings) {
				if (
					finding.policy === key ||
					(finding.kind === 'conflict' &&
						(finding.policy === targetId ||
							(targetId === 'all' &&
								policyTargets(config).some(item => item.id === finding.policy))))
				)
					if (!reasons.includes(finding.message)) reasons.push(finding.message);
			}
		const member: QuickFeatureMember = {
			key,
			label: label(policy),
			ready: !reasons.length,
			enabled: binding.enabled !== false,
			...(reasons.length ? { reason: reasons.join(' ') } : {})
		};
		const notice = member.ready ? maskNotice(policy, config, profile, policies) : undefined;
		if (notice) {
			member.reason = notice;
			reasons.push(notice);
		}
		if (!groups.has(id))
			groups.set(id, {
				id,
				label:
					functions
						.filter(object)
						.map(fn => (typeof fn.function_id === 'string' ? functionMatch(fn) : '연결 확인 필요'))
						.join(' / ') || '연결 확인 필요',
				keys: [],
				members: [],
				count: 0,
				ready: true,
				enabled: true,
				readyCount: 0,
				enabledCount: 0,
				reasons: []
			});
		const group = groups.get(id);
		if (!group) continue;
		group.keys.push(key);
		group.members.push(member);
		group.count++;
		group.ready &&= member.ready;
		group.enabled &&= member.enabled;
		if (member.ready) group.readyCount++;
		if (member.enabled) group.enabledCount++;
		for (const reason of reasons) if (!group.reasons.includes(reason)) group.reasons.push(reason);
	}
	for (const group of groups.values())
		if (group.reasons.length) group.reason = group.reasons.join(' ');
	return [...groups.values()];
}
