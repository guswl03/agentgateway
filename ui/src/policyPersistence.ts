import type { ConfigResource } from '@/api/configResourcesApi';
import type { JsonObject } from '@/policyAdapter';

export type PolicyResourceChange = {
	kind: 'traffic.route' | 'llm.policy';
	id: string;
	value: unknown;
};

// Only adapter-owned policy deltas may enter the DB batch. File-owned resources stay intact.
export function policyResourceChanges(
	before: JsonObject,
	after: JsonObject,
	resources: ConfigResource[],
	file: JsonObject
): PolicyResourceChange[] {
	const changes: PolicyResourceChange[] = [];
	const reconstructed = structuredClone(before);
	for (let index = 0; index < (before.routes ?? []).length; index++) {
		const original = before.routes[index],
			next = after.routes?.[index];
		if (JSON.stringify(original) === JSON.stringify(next)) continue;
		const owned = resources.find(r => r.kind === 'traffic.route' && r.id === original.name);
		if (!owned || (file.routes ?? []).some((r: JsonObject) => r.name === original.name))
			throw new Error(
				`파일에서 관리하는 경로 ${original.name ?? index}는 DB 정책 적용 대상으로 변경할 수 없습니다.`
			);
		const onlyPolicies = structuredClone(original);
		if (next?.policies === undefined) delete onlyPolicies.policies;
		else onlyPolicies.policies = next.policies;
		if (JSON.stringify(onlyPolicies) !== JSON.stringify(next))
			throw new Error('정책 적용 중 경로 또는 목적지 변경을 감지했습니다.');
		changes.push({ kind: 'traffic.route', id: owned.id, value: structuredClone(next) });
		reconstructed.routes[index] = next;
	}
	const oldPolicies = before.llm?.policies ?? {},
		nextPolicies = after.llm?.policies ?? {};
	for (const id of new Set([...Object.keys(oldPolicies), ...Object.keys(nextPolicies)])) {
		if (JSON.stringify(oldPolicies[id]) === JSON.stringify(nextPolicies[id])) continue;
		if (file.llm?.policies?.[id] !== undefined)
			throw new Error(`파일에서 관리하는 LLM 정책 ${id}는 DB에서 변경할 수 없습니다.`);
		// Empty policy objects remove adapter transformations without deleting another resource.
		changes.push({ kind: 'llm.policy', id, value: structuredClone(nextPolicies[id] ?? {}) });
		reconstructed.llm.policies ??= {};
		if (nextPolicies[id] === undefined) delete reconstructed.llm.policies[id];
		else reconstructed.llm.policies[id] = nextPolicies[id];
	}
	if (JSON.stringify(reconstructed) !== JSON.stringify(after))
		throw new Error('DB에서 지원하지 않는 설정 변경이 포함되어 있습니다. 파일 설정은 보존합니다.');
	return changes;
}
