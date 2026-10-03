function object(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function policyResponseNotices(value: unknown): string[] {
	if (!object(value)) return [];
	const report = value.gateway_policy;
	if (!object(report) || report.version !== 1 || !Array.isArray(report.decisions)) return [];
	const notices = new Set<string>();
	for (const decision of report.decisions) {
		if (!object(decision) || !Array.isArray(decision.sources)) continue;
		const action =
			decision.action === 'reject'
				? '거절'
				: decision.action === 'mask'
					? '마스킹'
					: decision.action === 'remove_field'
						? '필드 삭제'
						: undefined;
		const direction =
			decision.direction === 'request'
				? '요청'
				: decision.direction === 'response'
					? '응답'
					: undefined;
		if (!action || !direction) continue;
		for (const source of decision.sources) {
			if (!object(source) || !Array.isArray(source.legal_sources)) continue;
			for (const legal of source.legal_sources) {
				if (
					object(legal) &&
					typeof legal.law_name === 'string' &&
					legal.law_name.trim() &&
					typeof legal.provision === 'string' &&
					legal.provision.trim()
				)
					notices.add(`${direction} ${action} · ${legal.law_name} ${legal.provision}`);
			}
		}
	}
	return [...notices];
}

export function policyResponseError(value: unknown, fallback: string): string {
	if (object(value) && object(value.error) && typeof value.error.message === 'string')
		return value.error.message || fallback;
	return fallback;
}
