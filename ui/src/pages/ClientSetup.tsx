import { Check, Clipboard, Code2, GitBranch, KeyRound, Terminal } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

import claudeIcon from '@/assets/claude-color.svg';
import codexIcon from '@/assets/codex-color.svg';
import curlIcon from '@/assets/curl.svg';
import cursorIcon from '@/assets/cursor.svg';
import gooseIcon from '@/assets/goose.svg';
import opencodeIcon from '@/assets/opencode.svg';
import githubCopilotIcon from '@/assets/providers/copilot.svg';
import windsurfIcon from '@/assets/windsurf.svg';
import { claudeSubscriptionWarning } from '@/claudeSubscription';
import { CatalogModelSelector } from '@/components/CatalogModelSelector';
import {
	Dropdown,
	Field,
	FieldGroup,
	PageHeader,
	Panel,
	StatusBanner
} from '@/components/Primitives';
import { ProviderIcon } from '@/components/ProviderIcon';
import { providerLabel } from '@/config';
import { hasKeyValue, keyLabel, maskKey } from '@/credentialDisplay';
import { llmGatewayOrigin } from '@/gatewayUrls';
import { useLlmConfigData } from '@/hooks';
import {
	isWildcardModelName,
	modelProviderLabel,
	resolveModelName,
	wildcardModelPrefix,
	wildcardResolvedSuffix
} from '@/modelResolution';
import type { LlmModel, LlmProvider, ProviderName } from '@/types';

type ClientRecipe = {
	id: string;
	title: string;
	description: string;
	icon: 'claude' | 'codex' | 'curl' | 'cursor' | 'copilot' | 'goose' | 'opencode' | 'windsurf';
	provider?: ProviderName;
	steps?: ReactNode[];
	language: string;
	code: string;
};

type RequestModelOption =
	| {
			kind: 'model';
			name: string;
			config: LlmModel;
			icon: ReactNode;
			searchText: string;
	  }
	| { kind: 'virtual'; name: string; icon: ReactNode; searchText: string };

export function ClientSetupPage() {
	const {
		config,
		models,
		virtualModels,
		providers,
		apiKeys,
		isLoading: modelsLoading,
		error: configDataError
	} = useLlmConfigData();
	const modelOptions = useMemo(
		() => [
			...models.map(item => ({
				kind: 'model' as const,
				name: item.name,
				icon: <ProviderIcon provider={modelProviderLabel(item, providers) as ProviderName} />,
				searchText: `${item.name} ${modelProviderLabel(item, providers)} ${providerLabel(item.provider)}`,
				config: item
			})),
			...virtualModels.map(item => ({
				kind: 'virtual' as const,
				name: item.name,
				icon: <GitBranch size={16} />,
				searchText: `${item.name} virtual`
			}))
		],
		[models, providers, virtualModels]
	);
	const rawVirtualKeys = useMemo(() => apiKeys.filter(hasKeyValue), [apiKeys]);
	const derivedBaseUrl = llmGatewayOrigin(config.data);
	const [baseUrl, setBaseUrl] = useState(derivedBaseUrl);
	const [baseUrlTouched, setBaseUrlTouched] = useState(false);
	const [model, setModel] = useState('');
	const [specificModel, setSpecificModel] = useState('');
	const [apiKeyMode, setApiKeyMode] = useState<'saved' | 'raw'>('saved');
	const [selectedKey, setSelectedKey] = useState('');
	const [rawKey, setRawKey] = useState('');
	const [selectedIntegration, setSelectedIntegration] = useState('curl');

	const selectedModel = modelOptions.some(item => item.name === model)
		? model
		: (modelOptions[0]?.name ?? '');
	const selectedModelOption = modelOptions.find(item => item.name === selectedModel);
	const selectedModelConfig =
		selectedModelOption?.kind === 'model' ? selectedModelOption.config : undefined;
	const wildcardPrefix =
		selectedModelConfig && isWildcardModelName(selectedModelConfig.name)
			? wildcardModelPrefix(selectedModelConfig.name)
			: '';
	const specificModelSuffix = selectedModelConfig
		? wildcardResolvedSuffix(specificModel, selectedModelConfig.name, wildcardPrefix)
		: '';
	const selectedCatalogProvider = selectedModelConfig
		? modelProviderLabel(selectedModelConfig, providers)
		: null;
	const selectedVirtualKey =
		apiKeyMode === 'saved'
			? (rawVirtualKeys.find(item => item.key === selectedKey) ?? rawVirtualKeys[0])
			: undefined;
	const apiKey = selectedVirtualKey?.key ?? rawKey;
	const effectiveBaseUrl = baseUrlTouched ? baseUrl : derivedBaseUrl;
	const requestModel = clientSetupRequestModel(
		selectedModelOption,
		selectedModel,
		specificModel,
		providers
	);
	const recipes = clientRecipes({
		baseUrl: effectiveBaseUrl,
		model: requestModel || 'model',
		apiKey
	});
	const activeRecipe = recipes.find(recipe => recipe.id === selectedIntegration) ?? recipes[0];

	return (
		<div className="page-stack">
			<PageHeader
				title="Client Setup"
				description="Generate connection settings and snippets for LLM clients."
			/>
			{configDataError ? (
				<StatusBanner state="bad" title="Configuration API unavailable">
					{configDataError.message}
				</StatusBanner>
			) : null}
			{modelOptions.length === 0 && !modelsLoading ? (
				<StatusBanner state="warn" title="No models configured">
					Create an LLM model before wiring clients to the gateway.
				</StatusBanner>
			) : null}
			{claudeSubscriptionWarning(selectedModelConfig, providers) ? (
				<StatusBanner state="warn" title="Claude subscription key detected">
					{claudeSubscriptionWarning(selectedModelConfig, providers)}
				</StatusBanner>
			) : null}

			<section className="client-setup-layout">
				<Panel className="client-setup-controls">
					<div className="section-heading">
						<h3>Connection</h3>
					</div>
					<Field label="Gateway base URL" hint="SDK snippets use this URL with /v1 appended.">
						<input
							value={effectiveBaseUrl}
							onChange={event => {
								setBaseUrlTouched(true);
								setBaseUrl(event.target.value);
							}}
							placeholder={derivedBaseUrl}
						/>
					</Field>
					<FieldGroup label="Model">
						<Dropdown
							ariaLabel="Model"
							value={selectedModel}
							placeholder="No models"
							searchable
							options={modelOptions.map(item => ({
								value: item.name,
								label: item.name,
								description: item.kind === 'virtual' ? 'Virtual model' : undefined,
								icon: item.icon,
								searchText: item.searchText
							}))}
							onChange={setModel}
						/>
					</FieldGroup>
					{selectedModelConfig && isWildcardModelName(selectedModelConfig.name) ? (
						<Field label="Specific model" hint="Model uses a wildcard; specify the specific model.">
							<div className="target-resolved-composite">
								{wildcardPrefix ? <span className="target-prefix">{wildcardPrefix}</span> : null}
								<CatalogModelSelector
									ariaLabel="Specific model"
									value={specificModelSuffix}
									provider={selectedCatalogProvider}
									onChange={value => setSpecificModel(`${wildcardPrefix}${value}`)}
									placeholder="Select or type a model"
								/>
							</div>
						</Field>
					) : null}
					<FieldGroup label="Virtual API key">
						<Dropdown
							ariaLabel="Virtual API key"
							value={
								apiKeyMode === 'saved' && selectedVirtualKey ? selectedVirtualKey.key : '__raw__'
							}
							options={[
								...rawVirtualKeys.map(item => ({
									value: item.key,
									label: keyLabel(item),
									icon: <KeyRound size={16} />
								})),
								{
									value: '__raw__',
									label: 'Raw value',
									icon: <Code2 size={16} />
								}
							]}
							onChange={value => {
								if (value === '__raw__') {
									setApiKeyMode('raw');
									return;
								}
								setApiKeyMode('saved');
								setSelectedKey(value);
							}}
						/>
					</FieldGroup>
					{apiKeyMode === 'raw' || rawVirtualKeys.length === 0 ? (
						<Field label="Raw API key">
							<input
								value={rawKey}
								onChange={event => setRawKey(event.target.value)}
								placeholder="agw_sk_..."
							/>
						</Field>
					) : null}
					<div className="client-setup-summary">
						<div>
							<span>기본 URL</span>
							<code>{effectiveBaseUrl.replace(/\/$/, '')}/v1</code>
						</div>
						<div>
							<span>Model</span>
							<code>{requestModel || '선택된 모델 없음'}</code>
						</div>
						<div>
							<span>인증</span>
							<code>{apiKey ? `Bearer ${maskKey(apiKey)}` : '없음'}</code>
						</div>
					</div>
				</Panel>

				<ClientRecipeCard
					recipe={activeRecipe}
					recipes={recipes}
					selectedIntegration={activeRecipe.id}
					onSelectIntegration={setSelectedIntegration}
				/>
			</section>
		</div>
	);
}

function clientSetupRequestModel(
	option: RequestModelOption | undefined,
	selectedModel: string,
	specificModel: string,
	providers: LlmProvider[]
) {
	if (!option) return '';
	if (option.kind === 'virtual') return selectedModel;
	if (!isWildcardModelName(option.config.name))
		return resolveModelName(option.config, specificModel, providers);
	const normalized = normalizedClientSpecificModel(option.config, specificModel);
	if (normalized) return resolveModelName(option.config, normalized, providers);
	const prefix = wildcardModelPrefix(option.config.name);
	return prefix ? `${prefix}<model>` : '<model>';
}

function normalizedClientSpecificModel(model: LlmModel, specificModel: string) {
	const trimmed = specificModel.trim();
	const prefix = wildcardModelPrefix(model.name);
	if (!trimmed || trimmed === prefix) return '';
	if (prefix && !trimmed.startsWith(prefix)) return '';
	return trimmed;
}

function ClientRecipeCard(props: {
	recipe: ClientRecipe;
	recipes: ClientRecipe[];
	selectedIntegration: string;
	onSelectIntegration: (value: string) => void;
}) {
	return (
		<Panel className="client-recipe-card">
			<div className="client-recipe-toolbar">
				<FieldGroup label="Integration">
					<Dropdown
						ariaLabel="Integration"
						className="client-recipe-select"
						value={props.selectedIntegration}
						options={props.recipes.map(recipe => ({
							value: recipe.id,
							label: recipe.title,
							icon: <ClientSetupIcon recipe={recipe} compact />,
							searchText: `${recipe.title} ${recipe.description}`
						}))}
						onChange={props.onSelectIntegration}
						searchable
					/>
				</FieldGroup>
				<CopyButton value={props.recipe.code} />
			</div>
			<div className="client-recipe-header">
				<ClientSetupIcon recipe={props.recipe} />
				<div>
					<h3>{props.recipe.title}</h3>
					<p>{props.recipe.description}</p>
				</div>
			</div>
			{props.recipe.steps?.length ? (
				<ol className="client-recipe-steps">
					{props.recipe.steps.map((step, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: Existing lint violation; remove this suppression when the underlying issue is fixed.
						<li key={index}>{step}</li>
					))}
				</ol>
			) : null}
			<HighlightedCode code={props.recipe.code} language={props.recipe.language} />
		</Panel>
	);
}

function CopyButton(props: { value: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			className="button"
			type="button"
			onClick={async () => {
				await navigator.clipboard.writeText(props.value);
				setCopied(true);
				window.setTimeout(() => setCopied(false), 1200);
			}}
		>
			{copied ? <Check size={16} /> : <Clipboard size={16} />}
			{copied ? 'Copied' : 'Copy'}
		</button>
	);
}

function clientRecipes(args: { baseUrl: string; model: string; apiKey: string }): ClientRecipe[] {
	const base = args.baseUrl.replace(/\/$/, '');
	const v1 = `${base}/v1`;
	const completions = `${v1}/chat/completions`;
	const requiredApiKey = args.apiKey || 'dummy_key';
	const continuation = '\\';
	const curlAuthorization = args.apiKey
		? `  -H ${JSON.stringify(`Authorization: Bearer ${args.apiKey}`)} ${continuation}\n`
		: '';
	const openCodeApiKey = args.apiKey
		? `,
        "apiKey": "{env:AGENTGATEWAY_API_KEY}"`
		: '';
	const openCodeApiKeyExport = args.apiKey
		? `

export AGENTGATEWAY_API_KEY=${JSON.stringify(args.apiKey)}  # Alternatively, type /connect to enter your API key.`
		: '';
	return [
		{
			id: 'curl',
			title: 'curl',
			description: 'Minimal raw HTTP request for debugging client connectivity.',
			icon: 'curl',
			language: 'bash',
			code: `curl ${JSON.stringify(completions)} ${continuation}
${curlAuthorization}  -H "Content-Type: application/json" ${continuation}
  -d '{
    "model": "${args.model}",
    "messages": [
      { "role": "user", "content": "Hello from agentgateway" }
    ]
  }'`
		},
		{
			id: 'claude-code',
			title: 'Claude Code',
			description: 'Claude 호환 모델 라우트에서 게이트웨이 URL과 키를 사용합니다.',
			icon: 'claude',
			language: 'bash',
			code: `export ANTHROPIC_AUTH_TOKEN=${JSON.stringify(requiredApiKey)}
export ANTHROPIC_BASE_URL=${JSON.stringify(base)}

claude --model ${JSON.stringify(args.model)}`
		},
		{
			id: 'claude-desktop',
			title: 'Claude Desktop',
			description: 'Claude Desktop의 서드파티 추론 요청을 게이트웨이로 연결합니다.',
			icon: 'claude',
			steps: [
				<>
					Claude Desktop에서 <strong>Help</strong> &gt; <strong>Troubleshooting</strong> &gt;{' '}
					<strong>Enable Developer Mode</strong>를 차례로 선택해 개발자 모드를 켭니다.
				</>,
				<>
					Claude Desktop을 완전히 종료한 뒤 다시 실행합니다. 메뉴 막대에 <strong>Developer</strong>{' '}
					메뉴가 나타납니다.
				</>,
				<>
					<strong>Developer</strong> &gt; <strong>Configure Third-Party Inference</strong> &gt;{' '}
					<strong>Gateway</strong>를 차례로 엽니다.
				</>,
				<>게이트웨이 URL과 가상 API 키를 입력해 저장한 뒤 Claude Desktop을 다시 시작합니다.</>
			],
			language: 'text',
			code: `Gateway URL: ${base}
API Key: ${requiredApiKey}`
		},
		{
			id: 'codex',
			title: 'Codex CLI',
			description: 'Codex가 게이트웨이를 사용하도록 OpenAI 호환 환경 변수를 설정합니다.',
			icon: 'codex',
			language: 'bash',
			code: `export OPENAI_API_KEY=${JSON.stringify(requiredApiKey)}
# If Codex has an existing login it can impact functionality. Better if it's logged out.
# If you don't want to override your Codex configuration, you can set up a new dedicated configuration file.
export CODEX_HOME=/tmp/codex-gateway-home && mkdir -p $CODEX_HOME # optional
codex login --with-api-key <<<"$OPENAI_API_KEY"

codex --model "${args.model}" \\
  -c 'model_provider="gateway"' \\
  -c 'model_providers.gateway.name="Local gateway"' \\
  -c 'model_providers.gateway.base_url="${v1}"'`
		},
		{
			id: 'opencode',
			title: 'OpenCode',
			description: 'OpenCode에 OpenAI 호환 게이트웨이 프로바이더를 설정합니다.',
			icon: 'opencode',
			steps: [
				<>
					프로젝트 최상위 폴더에 다음 <code>opencode.json</code> 파일을 만듭니다.
				</>,
				<>
					같은 폴더에서 <code>opencode</code>를 실행합니다.
				</>
			],
			language: 'bash',
			code: `
cat > opencode.json <<'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "model": "agentgateway/${args.model}",
  "provider": {
    "agentgateway": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Agentgateway",
      "options": {
        "baseURL": "${v1}"${openCodeApiKey}
      },
      "models": {
        "${args.model}": {
          "name": "${args.model}"
        }
      }
    }
  }
}
EOF
${openCodeApiKeyExport}
opencode`
		},
		{
			id: 'goose',
			title: 'Goose',
			description: 'Goose의 OpenAI 프로바이더가 게이트웨이와 채팅 엔드포인트를 사용하도록 설정합니다.',
			icon: 'goose',
			steps: [
				<>
					<code>goose configure</code> &gt; <strong>Configure Providers</strong> &gt;{' '}
					<strong>OpenAI</strong>를 차례로 선택하거나, 세션 시작 전에 아래 환경 변수를 설정합니다.
				</>,
				<>
					설정을 유지하려면 <code>~/.config/goose/config.yaml</code>에 추가합니다.
				</>,
				<>
					<code>goose configure</code>에서는 사용자 지정 모델 이름을 입력할 수 없습니다. 프로바이더
					목록에 없는 모델은 <code>config.yaml</code>에서 <code>GOOSE_MODEL</code>을 설정하세요.
				</>
			],
			language: 'bash',
			code: `export GOOSE_PROVIDER=openai
export GOOSE_MODEL=${JSON.stringify(args.model)}
export OPENAI_HOST=${JSON.stringify(base)}
export OPENAI_BASE_PATH=v1/chat/completions
# Goose requires a non-empty key; the gateway holds the real provider credentials.
export OPENAI_API_KEY=${JSON.stringify(requiredApiKey)}

goose session`
		},
		{
			id: 'cursor',
			title: 'Cursor',
			description: 'Cursor의 OpenAI 기본 URL을 게이트웨이 모델 주소로 변경합니다.',
			icon: 'cursor',
			steps: [
				<>
					<strong>Cursor Settings</strong> &gt; <strong>Models</strong>를 엽니다.
				</>,
				<>
					<strong>Override OpenAI Base URL</strong>을 켜고 <code>{base}</code>로 설정합니다.
				</>,
				<>
					<code>{args.model}</code>을 사용자 지정 모델로 추가한 뒤 <strong>Ask</strong> 또는{' '}
					<strong>Plan</strong> 모드에서 테스트합니다.
				</>
			],
			language: 'text',
			code: `Override OpenAI Base URL: ${base}
OpenAI API Key: ${requiredApiKey}
Custom model: ${args.model}`
		},
		{
			id: 'github-copilot',
			title: 'GitHub Copilot',
			description: 'VS Code Copilot Business 또는 Enterprise가 게이트웨이 프록시를 사용하도록 설정합니다.',
			icon: 'copilot',
			steps: [
				<>
					<strong>VS Code Settings</strong>를 열고 <code>github.copilot</code>을 검색합니다.
				</>,
				<>
					<code>settings.json</code>을 열어 고급 프록시 URL을 설정합니다.
				</>,
				<>VS Code를 다시 불러온 뒤 Copilot 코드 제안이나 채팅을 테스트합니다.</>
			],
			language: 'json',
			code: `{
  "github.copilot.advanced": {
    "debug.overrideProxyUrl": "${v1}"
  }
}`
		},
		{
			id: 'windsurf',
			title: 'Windsurf',
			description: 'Windsurf 트래픽이 게이트웨이 HTTP 프록시를 사용하도록 설정합니다.',
			icon: 'windsurf',
			steps: [
				<>
					<strong>Windsurf Settings</strong>를 엽니다.
				</>,
				<>
					<strong>Http: Proxy</strong>를 검색합니다.
				</>,
				<>
					프록시 URL을 <code>{base}</code>로 설정하고 저장합니다.
				</>
			],
			language: 'text',
			code: `Http: Proxy: ${base}`
		},
		{
			id: 'openai-js',
			title: 'OpenAI JavaScript SDK',
			description: '게이트웨이를 OpenAI 호환 채팅 엔드포인트로 사용합니다.',
			icon: 'codex',
			provider: 'openai',
			language: 'ts',
			code: `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "${requiredApiKey}",
  baseURL: "${v1}",
});

const response = await client.chat.completions.create({
  model: "${args.model}",
  messages: [{ role: "user", content: "Hello from agentgateway" }],
});

console.log(response.choices[0]?.message?.content);`
		},
		{
			id: 'openai-python',
			title: 'OpenAI Python SDK',
			description: 'Python SDK가 게이트웨이 리스너를 사용하도록 설정합니다.',
			icon: 'codex',
			provider: 'openai',
			language: 'python',
			code: `from openai import OpenAI

client = OpenAI(
    api_key="${requiredApiKey}",
    base_url="${v1}",
)

response = client.chat.completions.create(
    model="${args.model}",
    messages=[{"role": "user", "content": "Hello from agentgateway"}],
)

print(response.choices[0].message.content)`
		}
	];
}

function ClientSetupIcon(props: { recipe: ClientRecipe; compact?: boolean }) {
	const className = props.compact ? 'client-svg-icon compact' : 'client-svg-icon';
	if (props.recipe.provider) {
		return (
			<span className={className}>
				<ProviderIcon provider={props.recipe.provider} />
			</span>
		);
	}
	if (props.recipe.icon === 'codex') {
		return (
			<span className={className}>
				<img src={codexIcon} alt="" aria-hidden="true" />
			</span>
		);
	}
	if (props.recipe.icon === 'claude') {
		return (
			<span className={className}>
				<img src={claudeIcon} alt="" aria-hidden="true" />
			</span>
		);
	}
	if (props.recipe.icon === 'curl') {
		return (
			<span className={className}>
				<img src={curlIcon} alt="" aria-hidden="true" />
			</span>
		);
	}
	if (props.recipe.icon === 'cursor') {
		return (
			<span className={className}>
				<img src={cursorIcon} alt="" aria-hidden="true" />
			</span>
		);
	}
	if (props.recipe.icon === 'copilot') {
		return (
			<span className={className}>
				<img src={githubCopilotIcon} alt="" aria-hidden="true" />
			</span>
		);
	}
	if (props.recipe.icon === 'goose') {
		return (
			<span className={className}>
				<img src={gooseIcon} alt="" aria-hidden="true" />
			</span>
		);
	}
	if (props.recipe.icon === 'opencode') {
		return (
			<span className={className}>
				<img src={opencodeIcon} alt="" aria-hidden="true" />
			</span>
		);
	}
	if (props.recipe.icon === 'windsurf') {
		return (
			<span className={className}>
				<img src={windsurfIcon} alt="" aria-hidden="true" />
			</span>
		);
	}
	return (
		<span className={className}>
			<Terminal size={20} />
		</span>
	);
}

function HighlightedCode(props: { code: string; language: string }) {
	return (
		<pre className={`client-code-block code-lang-${props.language}`}>
			<code>{highlightCode(props.code, props.language)}</code>
		</pre>
	);
}

function highlightCode(code: string, language: string) {
	return code.split('\n').flatMap((line, lineIndex, lines) => [
		<span
			className="code-line"
			key={`line-${
				// biome-ignore lint/suspicious/noArrayIndexKey: Existing lint violation; remove this suppression when the underlying issue is fixed.
				lineIndex
			}`}
		>
			{highlightLine(line, language, lineIndex)}
		</span>,
		lineIndex < lines.length - 1 ? '\n' : null
	]);
}

function highlightLine(line: string, language: string, lineIndex: number): ReactNode {
	if (language === 'bash') return highlightWithRules(line, lineIndex, bashRules);
	if (language === 'json') return highlightWithRules(line, lineIndex, jsonRules);
	if (language === 'python') return highlightWithRules(line, lineIndex, pythonRules);
	if (language === 'text') return highlightWithRules(line, lineIndex, textRules);
	return highlightWithRules(line, lineIndex, tsRules);
}

type CodeRule = {
	className: string;
	pattern: RegExp;
};

const tsRules: CodeRule[] = [
	{ className: 'code-comment', pattern: /\/\/.*/y },
	{
		className: 'code-string',
		pattern: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/y
	},
	{
		className: 'code-keyword',
		pattern: /\b(?:await|const|from|import|new)\b/y
	},
	{ className: 'code-number', pattern: /\b\d+(?:\.\d+)?\b/y },
	{
		className: 'code-property',
		pattern: /\b(?:apiKey|baseURL|client|content|messages|model|response|role)\b(?=\s*:|\.)/y
	},
	{ className: 'code-function', pattern: /\b[A-Za-z_][\w]*(?=\()/y }
];

const pythonRules: CodeRule[] = [
	{ className: 'code-comment', pattern: /#.*/y },
	{ className: 'code-string', pattern: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y },
	{
		className: 'code-keyword',
		pattern: /\b(?:from|import|client|response)\b/y
	},
	{ className: 'code-number', pattern: /\b\d+(?:\.\d+)?\b/y },
	{
		className: 'code-property',
		pattern: /\b(?:api_key|base_url|messages|model)\b(?=\s*=)/y
	},
	{ className: 'code-function', pattern: /\b[A-Za-z_][\w]*(?=\()/y }
];

const bashRules: CodeRule[] = [
	{ className: 'code-comment', pattern: /#.*/y },
	{ className: 'code-string', pattern: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y },
	{
		className: 'code-keyword',
		pattern: /\b(?:curl|export|claude|codex|goose)\b/y
	},
	{ className: 'code-flag', pattern: /--?[A-Za-z][\w-]*/y },
	{ className: 'code-number', pattern: /\b\d+(?:\.\d+)?\b/y }
];

const jsonRules: CodeRule[] = [
	{ className: 'code-string', pattern: /"(?:\\.|[^"\\])*"/y },
	{ className: 'code-keyword', pattern: /\b(?:true|false|null)\b/y },
	{ className: 'code-number', pattern: /-?\b\d+(?:\.\d+)?\b/y }
];

const textRules: CodeRule[] = [
	{ className: 'code-property', pattern: /^[^:]+(?=:)/y },
	{ className: 'code-string', pattern: /https?:\/\/\S+/y },
	{ className: 'code-string', pattern: /\bagw_sk_[A-Za-z0-9_.-]*/y }
];

function highlightWithRules(line: string, lineIndex: number, rules: CodeRule[]) {
	const nodes: ReactNode[] = [];
	let position = 0;
	while (position < line.length) {
		const match = matchRule(line, position, rules);
		if (!match) {
			nodes.push(line[position]);
			position += 1;
			continue;
		}
		nodes.push(
			<span className={match.rule.className} key={`${lineIndex}-${position}`}>
				{match.text}
			</span>
		);
		position += match.text.length;
	}
	return nodes;
}

function matchRule(line: string, position: number, rules: CodeRule[]) {
	for (const rule of rules) {
		rule.pattern.lastIndex = position;
		const match = rule.pattern.exec(line);
		if (match?.index === position && match[0]) {
			return { rule, text: match[0] };
		}
	}
	return null;
}
