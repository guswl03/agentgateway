import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
	Activity,
	ArrowUpRight,
	Bot,
	CheckCircle2,
	CircleAlert,
	Coins,
	MessageSquareText,
	Network,
	RotateCw,
	ScrollText,
	Server,
	Settings,
	ShieldCheck,
	Wrench,
	X
} from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { McpSettingsResource } from '@/api/configResourcesApi';
import { refreshBaseCosts } from '@/api/costsApi';
import { analyticsSummary } from '@/api/logsApi';
import { PageHeader, StatusBanner } from '@/components/Primitives';
import { ensureLlm, fileOwnedMcpSettingFields } from '@/config';
import { refreshBaseCostsAndConfigure } from '@/costs';
import {
	useConfigDumpMode,
	useEnableSurface,
	useLlmConfigData,
	useMcpConfigData,
	useTrafficConfigData,
	useUpdateConfig,
	useUpsertConfigResource
} from '@/hooks';
import { McpSettingsDrawer } from '@/pages/McpServers';
import { LlmSettingsDrawer } from '@/pages/models/LlmSettingsDrawer';
import { ReadonlyModeBanner, TrafficDumpOverview } from '@/pages/traffic/TrafficConfigDumpPanel';
import { useSchemaHelp } from '@/schemaHelp';
import { trafficStats } from '@/traffic';
import type { AnalyticsSummaryResponse, GatewayConfig } from '@/types';

const uiAuthPolicyKeys = ['oidc', 'jwtAuth', 'extAuthz', 'basicAuth', 'apiKey', 'authorization'];
const projectStartupSurface = 'traffic';

type DashboardPeriod = '15m' | '1h' | '24h';
type GatewayMapNode = 'request' | 'listener' | 'policy' | 'router' | 'llm' | 'mcp' | 'api';

const dashboardPeriods: Record<
	DashboardPeriod,
	{ bucketSeconds: number; durationMs: number; label: string; summaryLabel: string }
> = {
	'15m': {
		bucketSeconds: 75,
		durationMs: 15 * 60 * 1000,
		label: '15분',
		summaryLabel: '최근 15분'
	},
	'1h': {
		bucketSeconds: 5 * 60,
		durationMs: 60 * 60 * 1000,
		label: '1시간',
		summaryLabel: '최근 1시간'
	},
	'24h': {
		bucketSeconds: 2 * 60 * 60,
		durationMs: 24 * 60 * 60 * 1000,
		label: '24시간',
		summaryLabel: '최근 24시간'
	}
};

export function HomePage() {
	const mode = useConfigDumpMode();
	const dumpMode = mode.data?.mode === 'dump';
	const {
		config,
		rawConfig,
		runtime,
		hybrid,
		models,
		virtualModels,
		providers,
		warnings,
		isLoading: configDataLoading,
		error: configDataError
	} = useLlmConfigData({
		enabled: Boolean(mode.data && mode.data.mode !== 'dump')
	});
	const mcpData = useMcpConfigData({
		enabled: Boolean(mode.data && mode.data.mode !== 'dump')
	});
	const trafficData = useTrafficConfigData({
		enabled: Boolean(mode.data && mode.data.mode !== 'dump')
	});
	const update = useUpdateConfig();
	const enable = useEnableSurface();
	const upsertResource = useUpsertConfigResource();
	const help = useSchemaHelp();
	const projectSurfaceInitializationStarted = useRef(false);
	const hasLlm = Boolean(
		config.data?.llm || models.length || virtualModels.length || providers.length
	);
	const hasMcp = Boolean(mcpData.data?.mcp);
	const hasTraffic = Boolean(
		trafficData.data &&
			(Boolean(trafficData.data.binds?.length) ||
				'gateways' in trafficData.data ||
				'routes' in trafficData.data ||
				'tcpRoutes' in trafficData.data)
	);
	const hasBinds = Boolean(config.data?.binds?.length);
	const mcpServers = mcpData.data?.mcp?.targets ?? [];
	const fileOwnedMcpSettings = fileOwnedMcpSettingFields(rawConfig.data, hybrid);
	const pageDataLoading = configDataLoading || mcpData.isLoading || trafficData.isLoading;
	const pageDataError = configDataError ?? mcpData.error ?? trafficData.error;
	const uiGatewayNeedsAuthWarning =
		!runtime.isLoading && !runtime.isError && uiExposedWithoutAuth(config.data);
	const callableModels = models.length + virtualModels.length;
	const traffic = trafficStats(trafficData.data);
	const enabledSurfaceCount = Number(hasLlm) + Number(hasMcp) + Number(hasTraffic);
	const totalRoutes = traffic.httpRoutes + traffic.tcpRoutes;
	const setupIssueCount =
		Number(hasLlm && callableModels === 0) +
		Number(hasMcp && mcpServers.length === 0) +
		Number(hasTraffic && (hasBinds ? traffic.listeners === 0 : traffic.gateways === 0));
	const attentionCount = warnings.length + Number(uiGatewayNeedsAuthWarning) + setupIssueCount;
	const configuredPolicyCount =
		Object.keys(config.data?.llm?.policies ?? {}).length +
		Object.keys(mcpData.data?.mcp?.policies ?? {}).length;
	const [dashboardPeriod, setDashboardPeriod] = useState<DashboardPeriod>('1h');
	const [selectedMapNode, setSelectedMapNode] = useState<GatewayMapNode | null>(null);
	const selectedPeriod = dashboardPeriods[dashboardPeriod];
	const recentActivity = useQuery({
		queryKey: ['dashboardAnalytics', dashboardPeriod],
		queryFn: () => {
			const to = new Date();
			const from = new Date(to.getTime() - selectedPeriod.durationMs);
			return analyticsSummary({
				timeRange: { from: from.toISOString(), to: to.toISOString() },
				groupBy: [{ field: 'httpStatus' }],
				bucketCount: 12,
				bucketSeconds: selectedPeriod.bucketSeconds
			});
		},
		enabled: hasLlm && !pageDataLoading,
		refetchInterval: 15_000,
		retry: false
	});
	const recentRequestSeries = useMemo(
		() =>
			dashboardRequestSeries(
				recentActivity.data,
				selectedPeriod.durationMs,
				selectedPeriod.bucketSeconds
			),
		[recentActivity.data, selectedPeriod]
	);
	const recentRequests =
		recentActivity.data?.buckets.reduce((sum, item) => sum + item.requests, 0) ?? 0;
	const recentTokens =
		recentActivity.data?.buckets.reduce((sum, item) => sum + item.totalTokens, 0) ?? 0;
	const recentCost =
		recentActivity.data?.buckets.reduce((sum, item) => sum + (item.cost ?? 0), 0) ?? 0;
	const recentErrors =
		recentActivity.data?.groups.reduce((sum, item) => {
			const status = Number(item.group.httpStatus);
			return Number.isFinite(status) && status >= 400 ? sum + item.requests : sum;
		}, 0) ?? 0;
	const successRate =
		recentRequests === 0 ? 100 : ((recentRequests - recentErrors) / recentRequests) * 100;
	const dashboardUpdatedAt = recentActivity.dataUpdatedAt
		? new Date(recentActivity.dataUpdatedAt)
		: null;
	const [costRefreshError, setCostRefreshError] = useState<string | null>(null);
	const [llmSettingsOpen, setLlmSettingsOpen] = useState(false);
	const [mcpSettingsOpen, setMcpSettingsOpen] = useState(false);

	useEffect(() => {
		if (!selectedMapNode) return;
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setSelectedMapNode(null);
		};
		window.addEventListener('keydown', closeOnEscape);
		return () => window.removeEventListener('keydown', closeOnEscape);
	}, [selectedMapNode]);

	useEffect(() => {
		if (
			!config.data ||
			pageDataLoading ||
			pageDataError ||
			hasTraffic ||
			projectSurfaceInitializationStarted.current
		) {
			return;
		}
		projectSurfaceInitializationStarted.current = true;
		enable.mutate({ surface: projectStartupSurface });
	}, [config.data, enable, hasTraffic, pageDataError, pageDataLoading]);

	async function enableSurface(surface: StartupSurface) {
		setCostRefreshError(null);
		try {
			const { hybrid } = await enable.mutateAsync({
				surface: surface === 'apis' ? 'traffic' : surface
			});
			if (surface === 'llm') {
				try {
					if (hybrid) await refreshBaseCosts();
					else await refreshBaseCostsAndConfigure(update);
				} catch (err) {
					setCostRefreshError(
						err instanceof Error ? err.message : 'Failed to refresh base cost catalog'
					);
				}
			}
		} catch {
			// The enable mutation exposes the save error.
		}
	}

	if (mode.isLoading || (!dumpMode && pageDataLoading)) {
		return (
			<div className="page-stack">
				<StatusBanner state="loading" title="Loading gateway configuration" />
			</div>
		);
	}

	if (dumpMode) {
		return (
			<div className="page-stack">
				<PageHeader title="Gateway Overview" />
				<ReadonlyModeBanner />
				<TrafficDumpOverview dump={mode.data?.dump} />
			</div>
		);
	}

	return (
		<div className="page-stack">
			<PageHeader title="Gateway Overview" />

			{enable.isError || update.isError ? (
				<StatusBanner state="bad" title="Save failed">
					{enable.error?.message ?? update.error?.message}
				</StatusBanner>
			) : null}

			{pageDataLoading ? (
				<StatusBanner state="loading" title="Loading gateway configuration" />
			) : pageDataError ? (
				<StatusBanner state="bad" title="Configuration API unavailable">
					{pageDataError.message}
				</StatusBanner>
			) : costRefreshError ? (
				<StatusBanner state="warn" title="Cost catalog refresh failed">
					{costRefreshError}
				</StatusBanner>
			) : !hasLlm && !hasMcp && !hasTraffic ? (
				<StatusBanner state="warn" title="No gateway surfaces enabled yet">
					Enable the capabilities you want to operate from the setup path.
				</StatusBanner>
			) : warnings.length ? (
				<StatusBanner
					state="warn"
					title={`${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}
				>
					<ul className="banner-warning-list">
						{warnings.map(warning => (
							<li key={warning}>{warning}</li>
						))}
					</ul>
				</StatusBanner>
			) : null}
			{uiGatewayNeedsAuthWarning ? (
				<StatusBanner
					state="warn"
					title="UI is exposed without authentication"
					action={
						<Link className="button" to="/settings">
							Configure UI policies
						</Link>
					}
				>
					Unauthenticated users can access the UI; consider adding authentication or authorization
					policies to secure the UI.
				</StatusBanner>
			) : null}

			<div className="dashboard-commandbar" aria-label="대시보드 조회 조건" role="toolbar">
				<div className="dashboard-environment">
					<span>현재 환경</span>
					<strong>
						<i className="dashboard-environment-dot" />
						로컬 게이트웨이
					</strong>
				</div>
				<div className="dashboard-sync-state" aria-live="polite">
					<span>
						<i className="dashboard-sync-dot" />
						실시간 감시
					</span>
					<time dateTime={dashboardUpdatedAt?.toISOString()}>
						{dashboardUpdatedAt
							? `${dashboardUpdatedAt.toLocaleTimeString('ko-KR', {
									hour: '2-digit',
									minute: '2-digit',
									second: '2-digit'
								})} 갱신`
							: '데이터 대기 중'}
					</time>
				</div>
				<fieldset className="dashboard-period-control">
					<legend>조회 기간</legend>
					{(Object.keys(dashboardPeriods) as DashboardPeriod[]).map(period => (
						<button
							className={dashboardPeriod === period ? 'active' : ''}
							key={period}
							type="button"
							onClick={() => setDashboardPeriod(period)}
						>
							{dashboardPeriods[period].label}
						</button>
					))}
				</fieldset>
				<button
					className="dashboard-refresh-button"
					disabled={recentActivity.isFetching}
					type="button"
					onClick={() => recentActivity.refetch()}
				>
					<RotateCw className={recentActivity.isFetching ? 'spinning' : ''} size={15} />
					{recentActivity.isFetching ? '동기화 중' : '새로고침'}
				</button>
			</div>

			<section className="admin-dashboard-hero" aria-labelledby="admin-dashboard-title">
				<div className="admin-dashboard-copy">
					<span className="admin-dashboard-eyebrow">
						<Activity size={15} />
						게이트웨이 운영
					</span>
					<h2 id="admin-dashboard-title">시스템 현황</h2>
					<p>트래픽, 연결 상태, 정책 점검 항목을 확인합니다.</p>
				</div>
				<div className={attentionCount === 0 ? 'admin-health ok' : 'admin-health attention'}>
					<div className="admin-health-signal">
						{attentionCount === 0 ? <CheckCircle2 size={22} /> : <CircleAlert size={22} />}
						<span aria-hidden="true">
							<i className="admin-health-bar health-bar-one" />
							<i className="admin-health-bar health-bar-two" />
							<i className="admin-health-bar health-bar-three" />
							<i className="admin-health-bar health-bar-four" />
						</span>
					</div>
					<div>
						<span>전체 상태</span>
						<strong>
							{attentionCount === 0 ? '정상 운영 중' : `확인 필요 ${attentionCount}건`}
						</strong>
					</div>
				</div>
			</section>

			<div className="admin-visual-grid">
				<section
					className="admin-visual-panel gateway-flow-panel"
					aria-labelledby="gateway-flow-title"
				>
					<div className="admin-panel-heading">
						<div>
							<span>연결 구조</span>
							<h3 id="gateway-flow-title">게이트웨이 처리 흐름</h3>
						</div>
						<span className="admin-live-badge">
							<i />
							자동 갱신
						</span>
					</div>
					<GatewayFlowDiagram
						llm={{ enabled: hasLlm, count: callableModels }}
						mcp={{ enabled: hasMcp, count: mcpServers.length }}
						onSelect={setSelectedMapNode}
						policyCount={configuredPolicyCount}
						ports={`${config.data?.llm?.port ?? 4000} · ${mcpData.data?.mcp?.port ?? 3000}`}
						recentRequests={recentRequests}
						selected={selectedMapNode}
						traffic={{ enabled: hasTraffic, count: totalRoutes }}
					/>
					<div className="gateway-flow-legend">
						<span>
							<i className="connection" /> 활성 연결
						</span>
						<span>
							<i className="packet" /> 요청 · 응답 양방향
						</span>
						<span className="interaction-hint">노드를 누르면 실시간 상세가 열립니다.</span>
					</div>
				</section>
			</div>

			{selectedMapNode ? (
				<GatewayNodeInspector
					attentionCount={attentionCount}
					llm={{ enabled: hasLlm, count: callableModels, requests: recentRequests }}
					mcp={{ enabled: hasMcp, count: mcpServers.length }}
					onClose={() => setSelectedMapNode(null)}
					policyCount={configuredPolicyCount}
					ports={`${config.data?.llm?.port ?? 4000} · ${mcpData.data?.mcp?.port ?? 3000}`}
					selected={selectedMapNode}
					traffic={{ enabled: hasTraffic, count: totalRoutes }}
					uiNeedsAuth={uiGatewayNeedsAuthWarning}
					warningCount={warnings.length + setupIssueCount}
				/>
			) : null}

			<section className="admin-metric-grid" aria-label="핵심 운영 지표">
				<DashboardMetric
					icon={<Activity size={19} />}
					label="처리 요청"
					value={recentRequests.toLocaleString()}
					detail={selectedPeriod.summaryLabel}
				/>
				<DashboardMetric
					icon={<CheckCircle2 size={19} />}
					label="요청 성공률"
					value={`${successRate.toFixed(recentRequests === 0 ? 0 : 1)}%`}
					detail={recentErrors === 0 ? '오류 없음' : `오류 ${recentErrors.toLocaleString()}건`}
				/>
				<DashboardMetric
					icon={<Bot size={19} />}
					label="사용 토큰"
					value={compactNumber(recentTokens)}
					detail={`${callableModels}개 모델 연결`}
				/>
				<DashboardMetric
					icon={<Coins size={19} />}
					label="예상 비용"
					value={formatDashboardCost(recentCost)}
					detail="기록된 모델 사용량 기준"
				/>
			</section>

			<section className="admin-traffic-panel" aria-labelledby="recent-traffic-title">
				<div className="admin-traffic-heading">
					<div>
						<span>{selectedPeriod.summaryLabel}</span>
						<h3 id="recent-traffic-title">요청 흐름</h3>
						<p>
							{recentActivity.isError
								? '요청 기록을 불러올 수 없습니다.'
								: recentActivity.isLoading
									? '요청 기록을 불러오는 중입니다.'
									: recentRequests === 0
										? '최근 처리된 LLM 요청이 없습니다.'
										: `${selectedPeriod.summaryLabel} 동안 ${recentRequests.toLocaleString()}건을 처리했습니다.`}
						</p>
					</div>
					<div className="admin-traffic-totals">
						<div>
							<span>요청</span>
							<strong>{recentRequests.toLocaleString()}</strong>
						</div>
						<div>
							<span>토큰</span>
							<strong>{recentTokens.toLocaleString()}</strong>
						</div>
						<Link to="/llm/analytics">
							상세 분석
							<ArrowUpRight size={15} />
						</Link>
					</div>
				</div>
				<RequestTrendChart loading={recentActivity.isLoading} series={recentRequestSeries} />
			</section>

			<div className="admin-dashboard-grid">
				<section
					className="admin-dashboard-panel service-panel"
					aria-labelledby="service-status-title"
				>
					<div className="admin-panel-heading">
						<div>
							<span>서비스 상태</span>
							<h3 id="service-status-title">기능별 가동 현황</h3>
						</div>
						<span className="admin-panel-count">{enabledSurfaceCount}개 사용 중</span>
					</div>
					<div className="admin-service-list">
						<DashboardServiceRow
							icon={<Bot size={18} />}
							title="LLM 게이트웨이"
							enabled={hasLlm}
							metric={`${callableModels}개 모델`}
							detail={`${providers.length}개 공용 프로바이더 · ${surfaceEndpointLabel(config.data?.llm?.gateways, config.data?.llm?.port ?? 4000)}`}
							to="/llm/models"
						/>
						<DashboardServiceRow
							icon={<Server size={18} />}
							title="MCP 게이트웨이"
							enabled={hasMcp}
							metric={`${mcpServers.length}개 서버`}
							detail={surfaceEndpointLabel(
								mcpData.data?.mcp?.gateways,
								mcpData.data?.mcp?.port ?? 3000
							)}
							to="/mcp/servers"
						/>
						<DashboardServiceRow
							icon={<Network size={18} />}
							title="API 트래픽"
							enabled={hasTraffic}
							metric={`${totalRoutes}개 라우트`}
							detail={
								hasBinds
									? `${traffic.binds}개 바인드 · ${traffic.listeners}개 리스너`
									: `${traffic.gateways}개 게이트웨이`
							}
							to="/traffic/gateways"
						/>
					</div>
				</section>

				<aside
					className="admin-dashboard-panel admin-check-panel"
					aria-labelledby="admin-check-title"
				>
					<div className="admin-panel-heading">
						<div>
							<span>관리자 점검</span>
							<h3 id="admin-check-title">보안 및 준비 상태</h3>
						</div>
					</div>
					<div className="admin-check-list">
						<DashboardCheck
							ok={!uiGatewayNeedsAuthWarning}
							title="UI 접근 보호"
							detail={
								uiGatewayNeedsAuthWarning
									? '인증 정책 설정이 필요합니다.'
									: '접근 보호 정책이 적용됐습니다.'
							}
						/>
						<DashboardCheck
							ok={warnings.length === 0}
							title="설정 유효성"
							detail={
								warnings.length === 0
									? '감지된 설정 경고가 없습니다.'
									: `설정 경고 ${warnings.length}건`
							}
						/>
						<DashboardCheck
							ok={setupIssueCount === 0}
							title="서비스 준비"
							detail={
								setupIssueCount === 0
									? '활성 기능이 요청을 처리할 수 있습니다.'
									: `추가 설정 ${setupIssueCount}건`
							}
						/>
					</div>
					<Link className="admin-panel-link" to="/settings">
						관리자 설정 열기
						<ArrowUpRight className="admin-row-arrow" size={16} />
					</Link>
				</aside>
			</div>

			<section className="admin-quick-panel" aria-labelledby="quick-actions-title">
				<div className="admin-panel-heading">
					<div>
						<span>빠른 실행</span>
						<h3 id="quick-actions-title">자주 사용하는 관리 도구</h3>
					</div>
				</div>
				<div className="admin-quick-grid">
					<DashboardQuickLink
						icon={<MessageSquareText size={18} />}
						title="LLM 응답 테스트"
						detail="모델 연결 확인"
						to="/llm/playground"
					/>
					<DashboardQuickLink
						icon={<Wrench size={18} />}
						title="MCP 도구 테스트"
						detail="서버와 도구 호출"
						to="/mcp/playground"
					/>
					<DashboardQuickLink
						icon={<ScrollText size={18} />}
						title="요청 로그 확인"
						detail="호출 결과 추적"
						to="/llm/logs"
					/>
					<DashboardQuickLink
						icon={<ShieldCheck size={18} />}
						title="정책 관리"
						detail="접근 및 보안 정책"
						to="/llm/policies"
					/>
				</div>
			</section>

			<div className="admin-section-heading">
				<div>
					<span>세부 구성</span>
					<h3>기능별 설정</h3>
				</div>
				<p>기존 기능을 켜거나 연결 설정을 변경할 수 있습니다.</p>
			</div>

			<section className="surface-overview-list" aria-label="Gateway surfaces">
				<SurfaceRow
					title="LLM"
					icon={<Bot size={18} />}
					enabled={hasLlm}
					disabled={enable.isPending || update.isPending}
					onEnable={() => void enableSurface('llm')}
					setupNeeded={callableModels === 0}
					setupText="Add a model before LLM traffic can be served."
					setupTo="/llm/models"
					setupHash="add=model"
					setupLabel="Set up models"
					overview={[
						`${models.length} ${models.length === 1 ? 'model' : 'models'}`,
						`${virtualModels.length} virtual ${virtualModels.length === 1 ? 'model' : 'models'}`,
						`${providers.length} shared ${providers.length === 1 ? 'provider' : 'providers'}`,
						surfaceEndpointLabel(config.data?.llm?.gateways, config.data?.llm?.port ?? 4000)
					]}
					actions={
						<button
							className="button"
							type="button"
							disabled={enable.isPending || update.isPending}
							onClick={() => setLlmSettingsOpen(true)}
						>
							<Settings size={16} />
							Settings
						</button>
					}
				/>
				<SurfaceRow
					title="MCP"
					icon={<Server size={18} />}
					enabled={hasMcp}
					disabled={enable.isPending || update.isPending}
					onEnable={() => void enableSurface('mcp')}
					setupNeeded={mcpServers.length === 0}
					setupText="Add an MCP target before tools are available."
					setupTo="/mcp/servers"
					setupLabel="Set up servers"
					overview={[
						`${mcpServers.length} configured ${mcpServers.length === 1 ? 'server' : 'servers'}`,
						surfaceEndpointLabel(mcpData.data?.mcp?.gateways, mcpData.data?.mcp?.port ?? 3000)
					]}
					actions={
						<button
							className="button"
							type="button"
							disabled={enable.isPending || update.isPending}
							onClick={() => setMcpSettingsOpen(true)}
						>
							<Settings size={16} />
							Settings
						</button>
					}
				/>
				<SurfaceRow
					title="Traffic"
					icon={<Network size={18} />}
					enabled={hasTraffic}
					disabled={enable.isPending || update.isPending}
					onEnable={() => void enableSurface('apis')}
					setupNeeded={hasBinds ? traffic.listeners === 0 : traffic.gateways === 0}
					setupText={
						hasBinds
							? 'Add a listener before HTTP or TCP traffic can be served.'
							: 'Add a gateway before HTTP traffic can be served.'
					}
					setupTo={hasBinds ? '/traffic/listeners' : '/traffic/gateways'}
					setupLabel={hasBinds ? 'Set up listeners' : 'Set up gateways'}
					overview={
						hasBinds
							? [
									`${traffic.binds} ${traffic.binds === 1 ? 'bind' : 'binds'}`,
									`${traffic.listeners} ${traffic.listeners === 1 ? 'listener' : 'listeners'}`,
									`${traffic.httpRoutes + traffic.tcpRoutes} ${traffic.httpRoutes + traffic.tcpRoutes === 1 ? 'route' : 'routes'}`
								]
							: [
									`${traffic.gateways} ${traffic.gateways === 1 ? 'gateway' : 'gateways'}`,
									`${traffic.httpRoutes} ${traffic.httpRoutes === 1 ? 'route' : 'routes'}`
								]
					}
				/>
			</section>
			{llmSettingsOpen ? (
				<LlmSettingsDrawer
					config={config.data}
					llm={config.data?.llm}
					help={help}
					saving={update.isPending}
					saveError={update.isError ? update.error.message : null}
					onClose={() => setLlmSettingsOpen(false)}
					onSave={settings =>
						update.mutate(
							next => {
								Object.assign(ensureLlm(next), settings);
							},
							{
								onSuccess: () => setLlmSettingsOpen(false)
							}
						)
					}
				/>
			) : null}
			{mcpSettingsOpen ? (
				<McpSettingsDrawer
					config={mcpData.data}
					mcp={mcpData.data?.mcp}
					databaseBacked={hybrid}
					readOnlyFields={fileOwnedMcpSettings}
					help={help}
					saving={update.isPending || upsertResource.isPending}
					saveError={update.error?.message ?? upsertResource.error?.message ?? null}
					onClose={() => setMcpSettingsOpen(false)}
					onSave={settings => {
						const value = Object.fromEntries(
							Object.entries(settings).filter(([, field]) => field != null)
						) as McpSettingsResource;
						upsertResource.mutate(
							{ kind: 'mcp.settings', value },
							{ onSuccess: () => setMcpSettingsOpen(false) }
						);
					}}
				/>
			) : null}
		</div>
	);
}

function DashboardMetric(props: { detail: string; icon: ReactNode; label: string; value: string }) {
	return (
		<div className="admin-metric-card">
			<div className="admin-metric-icon">{props.icon}</div>
			<div>
				<span>{props.label}</span>
				<strong>{props.value}</strong>
				<small>{props.detail}</small>
			</div>
		</div>
	);
}

function compactNumber(value: number) {
	return new Intl.NumberFormat('ko-KR', {
		maximumFractionDigits: 1,
		notation: 'compact'
	}).format(value);
}

function formatDashboardCost(value: number) {
	if (value > 0 && value < 0.01) return `$${value.toFixed(4)}`;
	return `$${value.toFixed(2)}`;
}

function activateMapNode(event: ReactKeyboardEvent<SVGGElement>, activate: () => void) {
	if (event.key !== 'Enter' && event.key !== ' ') return;
	event.preventDefault();
	activate();
}

function GatewayFlowDiagram(props: {
	llm: { count: number; enabled: boolean };
	mcp: { count: number; enabled: boolean };
	onSelect: (node: GatewayMapNode) => void;
	policyCount: number;
	ports: string;
	recentRequests: number;
	selected: GatewayMapNode | null;
	traffic: { count: number; enabled: boolean };
}) {
	return (
		<div className="gateway-flow-wrap">
			<svg
				className="gateway-flow-diagram"
				viewBox="0 0 1040 350"
				role="img"
				aria-label="클라이언트 요청이 리스너, 정책 검사, 라우팅 엔진을 거쳐 LLM, MCP, API로 전달되고 응답되는 구성도"
			>
				<defs>
					<marker
						id="dashboard-flow-arrow"
						markerHeight="7"
						markerWidth="7"
						orient="auto-start-reverse"
						refX="6"
						refY="3.5"
					>
						<path className="flow-arrow-head" d="M0,0 L7,3.5 L0,7 Z" />
					</marker>
				</defs>

				<rect className="gateway-flow-shell" height="238" rx="28" width="610" x="180" y="48" />
				<text className="gateway-flow-shell-label" x="207" y="78">
					게이트웨이 내부 처리 경로
				</text>
				<text className="gateway-flow-direction-label" x="748" y="78" textAnchor="end">
					요청 → · ← 응답
				</text>

				<path className="gateway-flow-line active" d="M150 175 C180 175 195 175 225 175" />
				<path className="gateway-flow-line active" d="M355 175 C375 175 390 175 410 175" />
				<path className="gateway-flow-line active" d="M540 175 C560 175 575 175 595 175" />
				<path
					className={props.llm.enabled ? 'gateway-flow-line active' : 'gateway-flow-line'}
					d="M725 175 C775 175 790 65 850 65"
				/>
				<text className="flow-edge-metric" x="790" y="91" textAnchor="middle">
					{props.recentRequests.toLocaleString()}건
				</text>
				<path
					className={props.mcp.enabled ? 'gateway-flow-line active' : 'gateway-flow-line'}
					d="M725 175 C770 175 800 175 850 175"
				/>
				<path
					className={props.traffic.enabled ? 'gateway-flow-line active' : 'gateway-flow-line'}
					d="M725 175 C775 175 790 285 850 285"
				/>
				<FlowPacket
					duration="3.2s"
					path="M150 175 C180 175 195 175 225 175 C300 175 335 175 410 175 C470 175 535 175 595 175"
				/>
				<FlowPacket
					className="return"
					delay="-1.6s"
					duration="3.2s"
					path="M595 175 C535 175 470 175 410 175 C335 175 300 175 225 175 C195 175 180 175 150 175"
				/>
				{props.llm.enabled ? (
					<>
						<FlowPacket delay="-0.6s" duration="2.4s" path="M725 175 C775 175 790 65 850 65" />
						<FlowPacket
							className="return"
							delay="-1.8s"
							duration="2.4s"
							path="M850 65 C790 65 775 175 725 175"
						/>
					</>
				) : null}
				{props.mcp.enabled ? (
					<>
						<FlowPacket delay="-1.2s" duration="2.2s" path="M725 175 C770 175 800 175 850 175" />
						<FlowPacket
							className="return"
							delay="-0.1s"
							duration="2.2s"
							path="M850 175 C800 175 770 175 725 175"
						/>
					</>
				) : null}
				{props.traffic.enabled ? (
					<>
						<FlowPacket delay="-1.8s" duration="2.6s" path="M725 175 C775 175 790 285 850 285" />
						<FlowPacket
							className="return"
							delay="-0.5s"
							duration="2.6s"
							path="M850 285 C790 285 775 175 725 175"
						/>
					</>
				) : null}

				{/* biome-ignore lint/a11y/useSemanticElements: SVG groups are interactive service-map nodes. */}
				<g
					aria-label="요청 진입 상세 보기"
					className={`gateway-flow-node source-node ${props.selected === 'request' ? 'selected' : ''}`}
					role="button"
					tabIndex={0}
					onClick={() => props.onSelect('request')}
					onKeyDown={event => activateMapNode(event, () => props.onSelect('request'))}
				>
					<rect className="flow-node-surface" height="92" rx="18" width="135" x="15" y="129" />
					<circle className="flow-source-dot" cx="47" cy="158" r="8" />
					<circle className="flow-source-dot" cx="75" cy="158" r="8" />
					<circle className="flow-source-dot" cx="103" cy="158" r="8" />
					<text className="flow-node-title" x="82" y="194" textAnchor="middle">
						요청 진입
					</text>
					<text className="flow-node-meta" x="82" y="211" textAnchor="middle">
						SDK · 앱 · 에이전트
					</text>
				</g>

				{/* biome-ignore lint/a11y/useSemanticElements: SVG groups are interactive service-map nodes. */}
				<g
					aria-label="리스너 상세 보기"
					className={`gateway-flow-node ingress-node ${props.selected === 'listener' ? 'selected' : ''}`}
					role="button"
					tabIndex={0}
					onClick={() => props.onSelect('listener')}
					onKeyDown={event => activateMapNode(event, () => props.onSelect('listener'))}
				>
					<rect className="flow-stage-surface" height="118" rx="18" width="130" x="225" y="116" />
					<rect className="flow-port-bar" height="8" rx="4" width="44" x="247" y="143" />
					<rect className="flow-port-bar" height="8" rx="4" width="62" x="247" y="158" />
					<text className="flow-node-title" x="290" y="190" textAnchor="middle">
						리스너
					</text>
					<text className="flow-node-meta" x="290" y="210" textAnchor="middle">
						포트 {props.ports}
					</text>
				</g>

				{/* biome-ignore lint/a11y/useSemanticElements: SVG groups are interactive service-map nodes. */}
				<g
					aria-label="인증 및 정책 상세 보기"
					className={`gateway-flow-node policy-node ${props.selected === 'policy' ? 'selected' : ''}`}
					role="button"
					tabIndex={0}
					onClick={() => props.onSelect('policy')}
					onKeyDown={event => activateMapNode(event, () => props.onSelect('policy'))}
				>
					<path
						className="flow-policy-surface"
						d="M430 116 H500 L540 175 L500 234 H430 L390 175 Z"
					/>
					<text className="flow-stage-index" x="465" y="151" textAnchor="middle">
						02
					</text>
					<text className="flow-node-title" x="465" y="181" textAnchor="middle">
						인증 · 정책
					</text>
					<text className="flow-node-meta" x="465" y="202" textAnchor="middle">
						{props.policyCount}개 정책 적용
					</text>
				</g>

				{/* biome-ignore lint/a11y/useSemanticElements: SVG groups are interactive service-map nodes. */}
				<g
					aria-label="라우팅 엔진 상세 보기"
					className={`gateway-flow-node router-node ${props.selected === 'router' ? 'selected' : ''}`}
					role="button"
					tabIndex={0}
					onClick={() => props.onSelect('router')}
					onKeyDown={event => activateMapNode(event, () => props.onSelect('router'))}
				>
					<rect className="flow-stage-surface" height="118" rx="18" width="130" x="595" y="116" />
					<text className="flow-stage-index" x="660" y="151" textAnchor="middle">
						03
					</text>
					<text className="flow-node-title" x="660" y="181" textAnchor="middle">
						라우팅 엔진
					</text>
					<text className="flow-node-meta" x="660" y="202" textAnchor="middle">
						3개 서비스 분기
					</text>
				</g>

				<text className="flow-stage-index ingress-index" x="290" y="106" textAnchor="middle">
					01 · 수신
				</text>

				<FlowDestination
					count={`${props.llm.count}개 모델`}
					enabled={props.llm.enabled}
					id="llm"
					label="LLM"
					onSelect={props.onSelect}
					selected={props.selected === 'llm'}
					y={30}
				/>
				<FlowDestination
					count={`${props.mcp.count}개 서버`}
					enabled={props.mcp.enabled}
					id="mcp"
					label="MCP"
					onSelect={props.onSelect}
					selected={props.selected === 'mcp'}
					y={140}
				/>
				<FlowDestination
					count={`${props.traffic.count}개 라우트`}
					enabled={props.traffic.enabled}
					id="api"
					label="API"
					onSelect={props.onSelect}
					selected={props.selected === 'api'}
					y={250}
				/>
			</svg>
		</div>
	);
}

function FlowPacket(props: { className?: string; delay?: string; duration: string; path: string }) {
	return (
		<circle className={`gateway-flow-packet ${props.className ?? ''}`} r="4">
			<animateMotion
				begin={props.delay ?? '0s'}
				dur={props.duration}
				path={props.path}
				repeatCount="indefinite"
			/>
		</circle>
	);
}

function FlowDestination(props: {
	count: string;
	enabled: boolean;
	id: 'llm' | 'mcp' | 'api';
	label: string;
	onSelect: (node: GatewayMapNode) => void;
	selected: boolean;
	y: number;
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: SVG groups are interactive service-map nodes.
		<g
			aria-label={`${props.label} 상세 보기`}
			className={`gateway-flow-node destination-node ${props.enabled ? 'active' : ''} ${props.selected ? 'selected' : ''}`}
			role="button"
			tabIndex={0}
			onClick={() => props.onSelect(props.id)}
			onKeyDown={event => activateMapNode(event, () => props.onSelect(props.id))}
		>
			<rect className="flow-node-surface" height="70" rx="16" width="170" x="850" y={props.y} />
			<circle
				className={props.enabled ? 'flow-destination-dot active' : 'flow-destination-dot'}
				cx="874"
				cy={props.y + 25}
				r="7"
			/>
			<text className="flow-node-title" x="894" y={props.y + 29}>
				{props.label}
			</text>
			<text className="flow-node-meta" x="874" y={props.y + 52}>
				{props.count}
			</text>
		</g>
	);
}

function GatewayNodeInspector(props: {
	attentionCount: number;
	llm: { count: number; enabled: boolean; requests: number };
	mcp: { count: number; enabled: boolean };
	onClose: () => void;
	policyCount: number;
	ports: string;
	selected: GatewayMapNode;
	traffic: { count: number; enabled: boolean };
	uiNeedsAuth: boolean;
	warningCount: number;
}) {
	type DetailLink =
		| '/llm/analytics'
		| '/llm/models'
		| '/mcp/servers'
		| '/settings'
		| '/traffic/gateways';
	type Detail = {
		action: string;
		description: string;
		enabled: boolean;
		icon: ReactNode;
		metrics: Array<{ label: string; value: string }>;
		title: string;
		to: DetailLink;
	};
	const availableDestinations =
		Number(props.llm.enabled) + Number(props.mcp.enabled) + Number(props.traffic.enabled);
	const details: Record<GatewayMapNode, Detail> = {
		request: {
			action: '요청 로그 보기',
			description: 'SDK, 애플리케이션, 에이전트에서 들어온 요청을 게이트웨이가 수신합니다.',
			enabled: true,
			icon: <Activity size={19} />,
			metrics: [
				{ label: '최근 요청', value: `${props.llm.requests.toLocaleString()}건` },
				{ label: '진입 경로', value: '3종' }
			],
			title: '요청 진입',
			to: '/llm/analytics'
		},
		listener: {
			action: '연결 설정 보기',
			description: '외부 요청을 받을 LLM·MCP 리스너 포트와 연결 상태입니다.',
			enabled: availableDestinations > 0,
			icon: <Network size={19} />,
			metrics: [
				{ label: '리스너 포트', value: props.ports },
				{ label: '활성 서비스', value: `${availableDestinations}/3` }
			],
			title: '게이트웨이 리스너',
			to: '/settings'
		},
		policy: {
			action: '보안 설정 열기',
			description: '요청이 라우팅되기 전에 인증과 접근 정책을 검사합니다.',
			enabled: !props.uiNeedsAuth,
			icon: <ShieldCheck size={19} />,
			metrics: [
				{ label: '적용 정책', value: `${props.policyCount}개` },
				{ label: 'UI 인증', value: props.uiNeedsAuth ? '설정 필요' : '보호됨' }
			],
			title: '인증 및 정책 검사',
			to: '/settings'
		},
		router: {
			action: '게이트웨이 설정',
			description: '요청 목적과 구성에 따라 LLM, MCP, API 경로로 분기합니다.',
			enabled: availableDestinations > 0,
			icon: <Network size={19} />,
			metrics: [
				{ label: '활성 분기', value: `${availableDestinations}/3` },
				{
					label: '연결 리소스',
					value: `${props.llm.count + props.mcp.count + props.traffic.count}개`
				}
			],
			title: '라우팅 엔진',
			to: '/traffic/gateways'
		},
		llm: {
			action: '모델 관리',
			description: '연결된 모델과 프로바이더로 AI 요청을 전달합니다.',
			enabled: props.llm.enabled,
			icon: <Bot size={19} />,
			metrics: [
				{ label: '사용 가능 모델', value: `${props.llm.count}개` },
				{ label: '처리 요청', value: `${props.llm.requests.toLocaleString()}건` }
			],
			title: 'LLM 게이트웨이',
			to: '/llm/models'
		},
		mcp: {
			action: '서버 관리',
			description: '에이전트가 사용할 도구와 MCP 서버 연결을 관리합니다.',
			enabled: props.mcp.enabled,
			icon: <Server size={19} />,
			metrics: [
				{ label: '연결 서버', value: `${props.mcp.count}개` },
				{ label: '연결 상태', value: props.mcp.enabled ? '사용 중' : '중지됨' }
			],
			title: 'MCP 게이트웨이',
			to: '/mcp/servers'
		},
		api: {
			action: '라우트 관리',
			description: 'HTTP와 TCP 트래픽을 설정된 백엔드로 전달합니다.',
			enabled: props.traffic.enabled,
			icon: <Network size={19} />,
			metrics: [
				{ label: 'API 라우트', value: `${props.traffic.count}개` },
				{ label: '연결 상태', value: props.traffic.enabled ? '사용 중' : '중지됨' }
			],
			title: 'API 트래픽',
			to: '/traffic/gateways'
		}
	};
	const detail = details[props.selected];

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: The backdrop supports pointer dismissal; the dialog also has a close button and Escape-key handling.
		<div
			className="gateway-detail-backdrop"
			role="presentation"
			onMouseDown={event => {
				if (event.target === event.currentTarget) props.onClose();
			}}
		>
			<aside
				aria-labelledby="node-inspector-title"
				aria-modal="true"
				className="gateway-detail-drawer gateway-inspector-panel"
				role="dialog"
			>
				<div className="admin-panel-heading">
					<div>
						<span>선택 노드</span>
						<h3 id="node-inspector-title">실시간 상세</h3>
					</div>
					<div className="gateway-detail-actions">
						<span className={detail.enabled ? 'inspector-state ok' : 'inspector-state attention'}>
							{detail.enabled ? '정상' : '확인 필요'}
						</span>
						<button aria-label="상세 패널 닫기" type="button" onClick={props.onClose}>
							<X size={18} />
						</button>
					</div>
				</div>
				<div className="gateway-inspector-card">
					<div className="gateway-inspector-title">
						<div>{detail.icon}</div>
						<strong>{detail.title}</strong>
					</div>
					<p>{detail.description}</p>
					<div className="gateway-inspector-metrics">
						{detail.metrics.map(metric => (
							<div key={metric.label}>
								<span>{metric.label}</span>
								<strong>{metric.value}</strong>
							</div>
						))}
					</div>
					<Link to={detail.to}>
						{detail.action}
						<ArrowUpRight size={15} />
					</Link>
				</div>
				<div className="gateway-alert-summary">
					<div className="gateway-alert-heading">
						<span>관리자 알림</span>
						<strong>{props.attentionCount}건</strong>
					</div>
					{props.attentionCount === 0 ? (
						<div className="gateway-alert-item ok">
							<CheckCircle2 size={16} />
							<span>현재 확인이 필요한 항목이 없습니다.</span>
						</div>
					) : (
						<>
							{props.uiNeedsAuth ? (
								<div className="gateway-alert-item attention">
									<CircleAlert size={16} />
									<span>UI 접근 인증 정책을 설정하세요.</span>
								</div>
							) : null}
							{props.warningCount > 0 ? (
								<div className="gateway-alert-item warning">
									<CircleAlert size={16} />
									<span>구성 및 연결 점검 {props.warningCount}건이 있습니다.</span>
								</div>
							) : null}
						</>
					)}
				</div>
			</aside>
		</div>
	);
}

type DashboardRequestPoint = {
	label: string;
	requests: number;
	tooltip: string;
};

function dashboardRequestSeries(
	data: AnalyticsSummaryResponse | undefined,
	fallbackDurationMs: number,
	fallbackBucketSeconds: number
): DashboardRequestPoint[] {
	const now = Date.now();
	const fallbackStart = now - fallbackDurationMs;
	const parsedStart = data?.timeRange.from
		? new Date(data.timeRange.from).getTime()
		: fallbackStart;
	const start = Number.isFinite(parsedStart) ? parsedStart : fallbackStart;
	const bucketSeconds = data?.bucketSeconds || fallbackBucketSeconds;
	const bucketMs = bucketSeconds * 1000;
	const formatter = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' });
	const points = Array.from({ length: 12 }, (_, index) => {
		const label = formatter.format(new Date(start + index * bucketMs));
		return { label, requests: 0, tooltip: `${label} · 요청 0건` };
	});
	for (const bucket of data?.buckets ?? []) {
		const bucketStart = new Date(bucket.start).getTime();
		if (!Number.isFinite(bucketStart)) continue;
		const index = Math.min(11, Math.max(0, Math.floor((bucketStart - start) / bucketMs)));
		points[index].requests += bucket.requests;
		points[index].tooltip =
			`${points[index].label} · 요청 ${points[index].requests.toLocaleString()}건`;
	}
	return points;
}

function RequestTrendChart(props: { loading: boolean; series: DashboardRequestPoint[] }) {
	const maxRequests = Math.max(1, ...props.series.map(point => point.requests));
	const chartBottom = 138;
	return (
		<div className={props.loading ? 'admin-request-chart loading' : 'admin-request-chart'}>
			<svg
				className="request-trend-svg"
				viewBox="0 0 720 178"
				role="img"
				aria-label="최근 1시간 요청 건수 막대 차트"
			>
				<line className="request-chart-grid" x1="20" x2="700" y1="28" y2="28" />
				<line className="request-chart-grid" x1="20" x2="700" y1="82" y2="82" />
				<line className="request-chart-axis" x1="20" x2="700" y1={chartBottom} y2={chartBottom} />
				{props.series.map((point, index) => {
					const height =
						point.requests === 0 ? 3 : Math.max(10, (point.requests / maxRequests) * 104);
					const x = 28 + index * 58;
					return (
						<g className="request-chart-column" key={point.label}>
							<title>{point.tooltip}</title>
							<rect height={height} rx="6" width="34" x={x} y={chartBottom - height} />
							{index % 3 === 0 ? (
								<text x={x + 17} y="162" textAnchor="middle">
									{point.label}
								</text>
							) : null}
						</g>
					);
				})}
			</svg>
		</div>
	);
}

function DashboardServiceRow(props: {
	detail: string;
	enabled: boolean;
	icon: ReactNode;
	metric: string;
	title: string;
	to: '/llm/models' | '/mcp/servers' | '/traffic/gateways';
}) {
	return (
		<Link className="admin-service-row" to={props.to}>
			<div className="admin-service-icon">{props.icon}</div>
			<div className="admin-service-copy">
				<div>
					<strong>{props.title}</strong>
					<span className={props.enabled ? 'admin-status-pill ok' : 'admin-status-pill'}>
						{props.enabled ? '사용 중' : '사용 안 함'}
					</span>
				</div>
				<small>{props.detail}</small>
			</div>
			<span className="admin-service-metric">{props.metric}</span>
			<ArrowUpRight className="admin-row-arrow" size={16} />
		</Link>
	);
}

function DashboardCheck(props: { detail: string; ok: boolean; title: string }) {
	return (
		<div className={props.ok ? 'admin-check-item ok' : 'admin-check-item attention'}>
			{props.ok ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
			<div>
				<strong>{props.title}</strong>
				<span>{props.detail}</span>
			</div>
		</div>
	);
}

function DashboardQuickLink(props: {
	detail: string;
	icon: ReactNode;
	title: string;
	to: '/llm/playground' | '/mcp/playground' | '/llm/logs' | '/llm/policies';
}) {
	return (
		<Link className="admin-quick-link" to={props.to}>
			<span>{props.icon}</span>
			<div>
				<strong>{props.title}</strong>
				<small>{props.detail}</small>
			</div>
			<ArrowUpRight className="admin-row-arrow" size={16} />
		</Link>
	);
}

function surfaceEndpointLabel(gateways: string | string[] | undefined, port: number) {
	if (gateways == null || gateways.length === 0) return `Port ${port}`;
	return `Gateway ${Array.isArray(gateways) ? gateways.join(', ') : gateways}`;
}

function uiExposedWithoutAuth(config: GatewayConfig | null | undefined) {
	if (!uiGateway(config)) return false;
	const policies = config?.ui?.policies as Record<string, unknown> | undefined;
	return !uiAuthPolicyKeys.some(key => Boolean(policies?.[key]));
}

function uiGateway(config: GatewayConfig | null | undefined) {
	const gateways = config?.ui?.gateways;
	if (Array.isArray(gateways)) return gateways[0];
	if (gateways) return gateways;
	return config?.ui && config.gateways?.default ? 'default' : undefined;
}

type StartupSurface = 'llm' | 'mcp' | 'apis';

function SurfaceRow(props: {
	disabled: boolean;
	enabled: boolean;
	icon: ReactNode;
	actions?: ReactNode;
	links?: Array<{ label: string; to: string }>;
	onEnable: () => void;
	overview: string[];
	setupLabel: string;
	setupNeeded: boolean;
	setupText: string;
	setupHash?: string;
	setupTo: string;
	title: string;
}) {
	if (!props.enabled) {
		return (
			<div className="surface-row compact">
				<div className="surface-row-title">
					{props.icon}
					<strong>{props.title}</strong>
					<span>Not enabled</span>
				</div>
				<button className="button" type="button" disabled={props.disabled} onClick={props.onEnable}>
					{props.title} 사용
				</button>
			</div>
		);
	}

	return (
		<div className={props.setupNeeded ? 'surface-row needs-setup' : 'surface-row'}>
			<div className="surface-row-main">
				<div className="surface-row-title">
					{props.icon}
					<strong>{props.title}</strong>
					<span>Enabled</span>
				</div>
				{props.setupNeeded ? (
					<p>{props.setupText}</p>
				) : (
					<div className="surface-metrics">
						{props.overview.map(item => (
							<span key={item}>{item}</span>
						))}
					</div>
				)}
			</div>
			<div className="surface-row-actions">
				{!props.setupNeeded
					? (props.actions ??
						props.links?.map(link => (
							<Link key={link.to} className="button" to={link.to}>
								{link.label}
							</Link>
						)))
					: null}
				<Link className="button primary" to={props.setupTo} hash={props.setupHash}>
					{props.setupLabel}
				</Link>
			</div>
		</div>
	);
}
