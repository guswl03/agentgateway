const exactTranslations = new Map<string, string>([
	// Global navigation
	['Gateway', '게이트웨이'],
	['Gateway overview', '게이트웨이 현황'],
	['Gateway Overview', '게이트웨이 현황'],
	['Home', '홈'],
	['Traffic', 'API 트래픽'],
	['Tools', '도구'],
	['Models', '모델'],
	['Providers', '프로바이더'],
	['Policies', '정책'],
	['Guardrails', '가드레일'],
	['Virtual API Keys', '가상 API 키'],
	['Costs', '비용'],
	['Analytics', '분석'],
	['Logs', '로그'],
	['Client Setup', '클라이언트 설정'],
	['Chat Playground', '채팅 테스트'],
	['Servers', '서버'],
	['Tool Playground', '도구 테스트'],
	['Gateways', '게이트웨이'],
	['Listeners', '리스너'],
	['Routes', '라우트'],
	['CEL Playground', 'CEL 테스트'],
	['Raw Configuration', '원본 설정'],
	['Settings', '설정'],
	['Get started', '시작하기'],
	['LLM configuration', 'LLM 설정'],
	['MCP configuration', 'MCP 설정'],
	['Traffic configuration', 'API 트래픽 설정'],
	['Policy tools', '정책 도구'],
	['Primary', '주 메뉴'],
	['Toggle theme', '화면 테마 전환'],
	['Documentation', '문서'],
	['Feedback', '의견 보내기'],

	// Shared actions and states
	['Add', '추가'],
	['Edit', '수정'],
	['Delete', '삭제'],
	['Remove', '제거'],
	['Save', '저장'],
	['Save policy', '정책 저장'],
	['Cancel', '취소'],
	['Close', '닫기'],
	['Continue', '계속'],
	['Enable', '사용하기'],
	['Back', '뒤로'],
	['Back to home', '홈으로 돌아가기'],
	['Next', '다음'],
	['Apply', '적용'],
	['Confirm', '확인'],
	['Copy', '복사'],
	['Copied', '복사됨'],
	['Refresh', '새로고침'],
	['Reset', '초기화'],
	['Search', '검색'],
	['Actions', '작업'],
	['Details', '상세 정보'],
	['Advanced', '고급 설정'],
	['Enabled', '사용 중'],
	['Disabled', '사용 안 함'],
	['disabled', '사용 안 함'],
	['Not enabled', '사용 안 함'],
	['Optional', '선택 사항'],
	['Strict', '엄격'],
	['Permissive', '허용 모드'],
	['Deny', '차단'],
	['Allow', '허용'],
	['Deny with status', '상태 코드로 차단'],
	['Fail closed', '실패 시 차단'],
	['Fail open', '실패 시 허용'],
	['Full duplex streamed', '양방향 스트리밍'],
	['Remote URL', '원격 URL'],
	['Local file', '로컬 파일'],
	['Inline JSON', '직접 입력 JSON'],
	['Required', '필수'],
	['Default', '기본값'],
	['Unset', '설정 안 함'],
	['Env var', '환경 변수'],
	['API key', 'API 키'],
	['File', '파일'],
	['None', '없음'],
	['All', '전체'],
	['Status', '상태'],
	['Name', '이름'],
	['Type', '유형'],
	['Value', '값'],
	['Description', '설명'],
	['Storage', '저장 위치'],
	['Source', '출처'],
	['Target', '적용 대상'],
	['Inheritance', '상속 방식'],
	['State', '상태'],
	['Endpoint', '엔드포인트'],
	['Transport', '연결 방식'],
	['Command', '명령어'],
	['Arguments', '인자'],
	['Environment YAML', '환경 변수 YAML'],
	['Schema source', '스키마 출처'],
	['Schema', '스키마'],
	['Action', '동작'],
	['Help', '도움말'],
	['Weight', '가중치'],
	['Match', '일치 조건'],
	['Backends', '백엔드'],
	['Bind', '바인드'],
	['Listener', '리스너'],
	['TLS', 'TLS'],
	['Mode', '모드'],
	['Provider', '프로바이더'],
	['Model', '모델'],
	['Input', '입력'],
	['Output', '출력'],
	['Cache read', '캐시 읽기'],
	['Cache write', '캐시 쓰기'],
	['Expression', '표현식'],
	['Request context YAML', '요청 컨텍스트 YAML'],
	['Public UI gateway', '외부 공개 UI 게이트웨이'],
	['Tool', '도구'],
	['Input schema', '입력 형식'],
	['Tool output', '도구 실행 결과'],
	['Include MCP tools', 'MCP 도구 포함'],
	[
		'Let the model call tools exposed by the MCP gateway.',
		'모델이 MCP 게이트웨이에 연결된 도구를 사용할 수 있게 합니다.'
	],
	['Base URL', '기본 URL'],
	['Auth', '인증'],
	['Protocol', '프로토콜'],
	['Hostname', '호스트 이름'],
	['Port', '포트'],
	['Path', '경로'],
	['Method', '메서드'],
	['Headers', '헤더'],
	['Metadata', '메타데이터'],
	['Configuration', '설정'],
	['Loading...', '불러오는 중...'],
	['Saving...', '저장 중...'],
	['Save changes', '변경사항 저장'],
	['Configuration saved', '설정을 저장했습니다'],
	['Gateway saved', '게이트웨이를 저장했습니다'],
	['Save failed', '저장하지 못했습니다'],
	['Delete failed', '삭제하지 못했습니다'],
	['Request failed', '요청에 실패했습니다'],
	['No values configured.', '설정된 값이 없습니다.'],
	['Cost refresh failed', '비용 정보를 갱신하지 못했습니다'],
	['Invalid custom costs', '사용자 지정 가격이 올바르지 않습니다'],
	['Remove custom cost', '사용자 지정 가격 삭제'],
	['CEL error', 'CEL 실행 오류'],
	['Config dump unavailable', '실행 중인 설정을 불러올 수 없습니다'],
	['Gateway error', '게이트웨이 오류'],
	['Invalid YAML', 'YAML 형식이 올바르지 않습니다'],
	['Read-only mode', '읽기 전용 모드'],
	[
		'The UI is configured as read-only. Editing is disabled.',
		'현재 UI는 읽기 전용으로 설정되어 있어 수정할 수 없습니다.'
	],

	// Home and startup
	['Loading gateway configuration', '게이트웨이 설정을 불러오는 중입니다'],
	['Configuration API unavailable', '설정 API에 연결할 수 없습니다'],
	['Cost catalog refresh failed', '비용 카탈로그를 갱신하지 못했습니다'],
	['No gateway surfaces enabled yet', '아직 사용할 기능이 설정되지 않았습니다'],
	[
		'Enable the capabilities you want to operate from the setup path.',
		'필요한 기능을 설정한 뒤 사용해 주세요.'
	],
	['UI is exposed without authentication', 'UI가 인증 없이 공개되어 있습니다'],
	[
		'Unauthenticated users can access the UI; consider adding authentication or authorization policies to secure the UI.',
		'현재 누구나 UI에 접근할 수 있습니다. 인증 또는 접근 제어 정책을 설정해 UI를 보호하세요.'
	],
	['Configure UI policies', 'UI 보안 설정'],
	['Gateway surfaces', '게이트웨이 기능'],
	['Enable LLM', 'LLM 사용'],
	['Enable MCP', 'MCP 사용'],
	['Enable Traffic', 'API 트래픽 사용'],
	['Set up models', '모델 설정'],
	['Set up servers', '서버 설정'],
	['Set up gateways', '게이트웨이 설정'],
	[
		'Add a model before LLM traffic can be served.',
		'LLM 요청을 처리하려면 먼저 모델을 추가하세요.'
	],
	[
		'Add an MCP target before tools are available.',
		'도구를 사용하려면 먼저 MCP 서버를 추가하세요.'
	],
	[
		'Add a gateway before HTTP traffic can be served.',
		'HTTP 요청을 처리하려면 먼저 게이트웨이를 추가하세요.'
	],
	[
		'Add a listener before HTTP or TCP traffic can be served.',
		'HTTP 또는 TCP 요청을 처리하려면 먼저 리스너를 추가하세요.'
	],
	['UI is exposed without authentication', 'UI가 인증 없이 공개되어 있습니다'],
	[
		'Create the LLM configuration section so models, providers, keys, guardrails, logs, and playground tools can be configured.',
		'모델, 프로바이더, API 키, 가드레일, 로그, 테스트 도구를 설정할 수 있도록 LLM 기능을 활성화합니다.'
	],
	[
		'Create the MCP configuration section so servers and MCP playground tools can be configured.',
		'MCP 서버와 도구 테스트 기능을 설정할 수 있도록 MCP 기능을 활성화합니다.'
	],

	// Page titles
	['LLM Models', 'LLM 모델'],
	[
		'Onboard provider-backed models and configure model-specific behavior.',
		'프로바이더와 연결할 모델을 등록하고 모델별 동작을 설정합니다.'
	],
	[
		'Create the first model to make LLM traffic available through the gateway.',
		'게이트웨이에서 LLM 요청을 처리하려면 첫 모델을 추가하세요.'
	],
	['virtual model', '가상 모델'],
	['LLM Providers', 'LLM 프로바이더'],
	[
		'Define reusable provider credentials and connection settings for models.',
		'여러 모델에서 재사용할 프로바이더 인증 정보와 연결 설정을 관리합니다.'
	],
	[
		'a provider when multiple models should share the same credentials or upstream connection settings.',
		'여러 모델이 동일한 인증 정보나 업스트림 연결 설정을 공유한다면 프로바이더를 등록하세요.'
	],
	['LLM Policies', 'LLM 정책'],
	[
		'Configure top-level behavior that applies before model-specific routing.',
		'모델별 라우팅보다 먼저 적용할 공통 정책을 설정합니다.'
	],
	['LLM Guardrails', 'LLM 가드레일'],
	[
		'Apply prompt and response guardrails to all LLM models.',
		'모든 LLM 모델에 공통으로 적용할 입력·응답 가드레일을 관리합니다.'
	],
	['Request guards', '요청 가드레일'],
	[
		'Inspect prompts before they reach the upstream model.',
		'프롬프트가 업스트림 모델에 전달되기 전에 검사합니다.'
	],
	['Response guards', '응답 가드레일'],
	[
		'Inspect model output before it is returned to the caller.',
		'모델 응답이 호출자에게 전달되기 전에 검사합니다.'
	],
	['No guards configured.', '설정된 가드레일이 없습니다.'],
	['guard', '가드레일'],
	['LLM Costs', 'LLM 비용'],
	[
		'Manage model cost catalogs used for analytics and request cost attribution.',
		'분석과 요청별 비용 계산에 사용할 모델 가격 정보를 관리합니다.'
	],
	['Refresh base costs', '기본 가격 갱신'],
	['Catalog sources', '가격 정보 출처'],
	[
		'Sources are merged in order. Database sources load first, and later file sources override them.',
		'출처는 순서대로 합쳐집니다. 데이터베이스 값을 먼저 불러오고, 뒤에 있는 파일 값이 이를 덮어씁니다.'
	],
	[
		'Refresh the base catalog with the latest pricing data from agentgateway.',
		'agentgateway의 최신 가격 정보로 기본 카탈로그를 갱신합니다.'
	],
	['Custom costs', '사용자 지정 가격'],
	[
		'Inline overrides stored in this gateway configuration. Values are USD per 1M tokens.',
		'현재 게이트웨이 설정에 저장되는 가격 재정의 값입니다. 단위는 토큰 100만 개당 USD입니다.'
	],
	['No custom costs.', '사용자 지정 가격이 없습니다.'],
	['INPUT', '입력'],
	['OUTPUT', '출력'],
	['CACHE READ', '캐시 읽기'],
	['CACHE WRITE', '캐시 쓰기'],
	['LLM Playground', 'LLM 테스트'],
	[
		'Send a real chat completion request through the configured gateway for setup debugging.',
		'설정된 게이트웨이로 실제 채팅 요청을 보내 연결 상태를 확인합니다.'
	],
	['Apply CORS', 'CORS 적용'],
	['Create a model before testing chat traffic.', '채팅 요청을 시험하려면 먼저 모델을 추가하세요.'],
	['No messages yet.', '아직 메시지가 없습니다.'],
	['Send', '보내기'],
	['Clear', '지우기'],
	['Configure a model first', '먼저 모델을 설정하세요'],
	['Select a concrete model', '사용할 세부 모델을 선택하세요'],
	['MCP Servers', 'MCP 서버'],
	['MCP server', 'MCP 서버'],
	['Add MCP server', 'MCP 서버 추가'],
	['Edit MCP server', 'MCP 서버 수정'],
	['Delete MCP server?', 'MCP 서버를 삭제할까요?'],
	['Streamable HTTP', 'Streamable HTTP'],
	['Legacy SSE', '기존 SSE'],
	['Command Line', '명령줄'],
	[
		'Configure MCP targets served by the gateway.',
		'게이트웨이를 통해 제공할 MCP 대상을 설정합니다.'
	],
	['No MCP servers configured', '설정된 MCP 서버가 없습니다'],
	[
		'a target so the gateway can expose MCP traffic.',
		'게이트웨이가 MCP 요청을 처리할 수 있도록 대상을 추가하세요.'
	],
	['MCP Policies', 'MCP 정책'],
	[
		'Configure top-level behavior for MCP gateway traffic.',
		'MCP 게이트웨이 트래픽에 공통으로 적용할 정책을 설정합니다.'
	],
	['MCP Playground', 'MCP 도구 테스트'],
	[
		'Initialize a gateway MCP session, list tools, and call a tool through the MCP listener.',
		'게이트웨이 MCP 세션을 시작하고 도구 목록을 확인한 뒤 MCP 리스너를 통해 도구를 호출합니다.'
	],
	[
		'Create an MCP server before testing MCP traffic.',
		'MCP 요청을 시험하려면 먼저 MCP 서버를 추가하세요.'
	],
	['Session', '세션'],
	['not initialized', '시작되지 않음'],
	['Initialize', '세션 시작'],
	['Authorization header', '인증 헤더'],
	['TOOL', '도구'],
	['Initialize first', '먼저 세션을 시작하세요'],
	[
		'Initialize the session and select a tool to configure arguments.',
		'세션을 시작하고 도구를 선택해 호출 인자를 설정하세요.'
	],
	['Call tool', '도구 호출'],
	['No response yet', '아직 응답이 없습니다'],
	['This tool does not declare arguments.', '이 도구에는 입력 인자가 없습니다.'],
	['Error', '오류'],
	['Structured content', '구조화된 내용'],
	['Response', '응답'],
	['Raw JSON', '원본 JSON'],
	['Resource', '리소스'],
	['ready', '준비됨'],
	['Loading MCP servers', 'MCP 서버를 불러오는 중입니다'],
	['Some settings are file-owned', '일부 설정은 파일에서 관리됩니다'],
	['Gateway binding', '게이트웨이 연결'],
	['Choose how MCP is exposed.', 'MCP를 어떤 방식으로 공개할지 선택합니다.'],
	['MCP behavior', 'MCP 동작 설정'],
	[
		'Choose session, tool-prefix, and failure behavior.',
		'세션, 도구 이름 접두사, 실패 시 동작을 설정합니다.'
	],
	['State mode', '세션 상태 관리'],
	['Prefix mode', '도구 이름 접두사'],
	['MCP settings config diff', 'MCP 설정 변경 내용'],
	['Save settings', '설정 저장'],
	['MCP server config diff', 'MCP 서버 설정 변경 내용'],
	['Save server', '서버 저장'],
	['Server name', '서버 이름'],
	[
		'How the gateway connects to this MCP target.',
		'게이트웨이가 이 MCP 대상에 연결하는 방식입니다.'
	],
	['Invalid server', '서버 설정이 올바르지 않습니다'],
	[
		'Initialize or send a tool request to inspect MCP behavior.',
		'세션을 시작하거나 도구 요청을 보내 MCP 동작을 확인하세요.'
	],
	['Traffic Gateways', '트래픽 게이트웨이'],
	['Traffic Listeners', '트래픽 리스너'],
	['Traffic Routes', '트래픽 라우트'],
	[
		'Configure bind ports and listeners for generic HTTP and TCP traffic.',
		'일반 HTTP·TCP 트래픽에 사용할 포트와 리스너를 설정합니다.'
	],
	[
		'Read-only listener inventory from the active gateway dump.',
		'현재 실행 중인 게이트웨이의 리스너를 읽기 전용으로 확인합니다.'
	],
	[
		'Use traffic gateways for new HTTP routing configuration.',
		'새 HTTP 라우팅은 트래픽 게이트웨이에서 설정하세요.'
	],
	[
		'Add a listener to start matching traffic on this port.',
		'이 포트에서 트래픽을 처리하려면 리스너를 추가하세요.'
	],
	['Bind port', '바인드 포트'],
	['Bind config diff', '바인드 설정 변경 내용'],
	['Save bind', '바인드 저장'],
	['Listener config diff', '리스너 설정 변경 내용'],
	['Save listener', '리스너 저장'],
	['Bind port this listener is attached to.', '이 리스너가 연결될 바인드 포트입니다.'],
	['Detected legacy binds config', '기존 바인드 설정이 감지되었습니다'],
	[
		'Add a named gateway before attaching LLM, MCP, UI, or routes.',
		'LLM, MCP, UI 또는 라우트를 연결하려면 먼저 게이트웨이를 추가하세요.'
	],
	['Loading gateways', '게이트웨이를 불러오는 중입니다'],
	['Migrate binds to gateways', '바인드를 게이트웨이로 이전'],
	['Gateway config diff', '게이트웨이 설정 변경 내용'],
	['Save gateway', '게이트웨이 저장'],
	[
		'Features and routes reference this gateway by name.',
		'기능과 라우트에서 이 이름으로 게이트웨이를 참조합니다.'
	],
	['Default gateway', '기본 게이트웨이'],
	[
		'Another gateway is already the default gateway.',
		'다른 게이트웨이가 이미 기본 게이트웨이로 지정되어 있습니다.'
	],
	[
		'Use this gateway for enabled traffic without an explicit gateway selection.',
		'게이트웨이를 따로 선택하지 않은 트래픽에 이 게이트웨이를 사용합니다.'
	],
	[
		'Unavailable while gateway TLS or policies are configured.',
		'게이트웨이에 TLS 또는 정책이 설정되어 있어 사용할 수 없습니다.'
	],
	[
		'Use named listeners for per-hostname TLS and policies.',
		'호스트 이름별 TLS와 정책이 필요하면 이름 지정 리스너를 사용하세요.'
	],
	['Default name is reserved', 'default 이름은 예약되어 있습니다'],
	['Gateway name already exists', '같은 이름의 게이트웨이가 이미 있습니다'],
	['Multiple listeners', '여러 리스너 사용'],
	['Gateway policies', '게이트웨이 정책'],
	['Resulting YAML', '적용될 YAML'],
	['Gateway listener config diff', '게이트웨이 리스너 설정 변경 내용'],
	[
		'Match incoming HTTP and TCP traffic and attach inline backends.',
		'들어오는 HTTP·TCP 트래픽의 조건을 지정하고 백엔드에 연결합니다.'
	],
	[
		'Read-only route inventory from the active gateway dump.',
		'현재 실행 중인 게이트웨이의 라우트를 읽기 전용으로 확인합니다.'
	],
	[
		'Some listeners mix HTTP and TCP routes',
		'일부 리스너에 HTTP와 TCP 라우트가 함께 연결되어 있습니다'
	],
	['Loading traffic routes', '트래픽 라우트를 불러오는 중입니다'],
	['No traffic gateways configured', '설정된 트래픽 게이트웨이가 없습니다'],
	['Add a gateway before attaching routes.', '라우트를 연결하려면 먼저 게이트웨이를 추가하세요.'],
	['Kind', '종류'],
	['Route config diff', '라우트 설정 변경 내용'],
	['Save route', '라우트 저장'],
	['Route protocol family.', '라우트에서 사용할 프로토콜 종류입니다.'],
	[
		'Gateway or gateway listener that owns this route.',
		'이 라우트를 소유할 게이트웨이 또는 게이트웨이 리스너입니다.'
	],
	['Hostnames', '호스트 이름'],
	['Route policies', '라우트 정책'],
	['Listener that owns this route.', '이 라우트를 소유할 리스너입니다.'],
	['Path match', '경로 일치 방식'],
	['Every listed header condition must match.', '나열된 모든 헤더 조건을 충족해야 합니다.'],
	['No header conditions.', '헤더 조건이 없습니다.'],
	['Header value', '헤더 값'],
	['Remove header condition', '헤더 조건 삭제'],
	['Query', '쿼리'],
	['Every listed query condition must match.', '나열된 모든 쿼리 조건을 충족해야 합니다.'],
	['No query conditions.', '쿼리 조건이 없습니다.'],
	['Query name', '쿼리 이름'],
	['Query value', '쿼리 값'],
	['Remove query condition', '쿼리 조건 삭제'],
	[
		'Traffic that matches this route is forwarded to these targets.',
		'이 라우트 조건과 일치하는 트래픽을 다음 대상으로 전달합니다.'
	],
	['No backends configured.', '설정된 백엔드가 없습니다.'],
	['Unsupported backend shape in this form', '이 화면에서 지원하지 않는 백엔드 형식입니다'],
	['Remove backend', '백엔드 삭제'],
	['Target type', '대상 유형'],
	['Backend policies', '백엔드 정책'],
	['Host', '호스트'],
	['Backend reference', '백엔드 참조'],
	['Namespace', '네임스페이스'],
	['Route group', '라우트 그룹'],
	[
		'Dynamic backend selection is enabled for this backend.',
		'이 백엔드는 동적 대상 선택을 사용합니다.'
	],
	[
		'Configure named gateway listeners that LLM, MCP, UI, and routes can attach to.',
		'LLM, MCP, UI와 라우트를 연결할 게이트웨이 리스너를 관리합니다.'
	],
	[
		'Attach HTTP and TCP routes to traffic gateways.',
		'HTTP 및 TCP 라우트를 트래픽 게이트웨이에 연결합니다.'
	],
	['No traffic routes configured', '설정된 트래픽 라우트가 없습니다'],
	['Attach a route to a gateway.', '게이트웨이에 연결할 라우트를 추가하세요.'],
	['Plain', '일반'],
	['Prefix', '접두 경로'],
	['Exact', '정확히 일치'],
	['Regex', '정규식'],
	['Weighted', '가중치 분산'],
	['Failover', '장애 전환'],
	['Conditional', '조건부 라우팅'],
	['UI Settings', 'UI 설정'],
	[
		'Provision incoming credentials and metadata for callers.',
		'호출자가 사용할 인증 정보와 메타데이터를 관리합니다.'
	],
	['API key auth', 'API 키 인증'],
	['API key authentication is disabled', 'API 키 인증이 꺼져 있습니다'],
	[
		'API key authentication before provisioning virtual keys.',
		'가상 API 키를 발급하려면 먼저 API 키 인증을 활성화하세요.'
	],
	[
		'Analyze LLM traffic by model, user, and provider.',
		'모델·사용자·프로바이더별 LLM 트래픽을 분석합니다.'
	],
	[
		'Inspect recent LLM calls and request/response payloads.',
		'최근 LLM 호출과 요청·응답 내용을 확인합니다.'
	],
	[
		'Generate connection settings and snippets for LLM clients.',
		'LLM 클라이언트 연결 설정과 예제 코드를 생성합니다.'
	],
	[
		'Create an LLM model before wiring clients to the gateway.',
		'클라이언트를 게이트웨이에 연결하려면 먼저 LLM 모델을 추가하세요.'
	],
	['Connection', '연결 정보'],
	[
		'SDK snippets use this URL with /v1 appended.',
		'SDK 예제에서는 이 URL 뒤에 /v1을 붙여 사용합니다.'
	],
	['No models', '모델 없음'],
	['Raw value', '직접 입력'],
	['BASE URL', '기본 URL'],
	['No model selected', '선택된 모델 없음'],
	['AUTH', '인증'],
	[
		'Minimal raw HTTP request for debugging client connectivity.',
		'클라이언트 연결을 점검할 수 있는 최소 HTTP 요청 예제입니다.'
	],
	['Loading raw configuration...', '원본 설정을 불러오는 중입니다...'],
	['Raw configuration diff', '원본 설정 변경 내용'],
	['Loading editor...', '편집기를 불러오는 중입니다...'],
	['Loading database resources', '데이터베이스 리소스를 불러오는 중입니다'],
	['Configuration database unavailable', '설정 데이터베이스에 연결할 수 없습니다'],
	['ID', 'ID'],
	['Revision', '리비전'],
	['Updated', '수정 시각'],
	[
		'Read-only top-level policies from the active gateway dump.',
		'현재 실행 중인 게이트웨이의 최상위 정책을 읽기 전용으로 확인합니다.'
	],
	[
		'Configuration is managed by XDS. This view reflects the active runtime dump; editing is disabled.',
		'설정은 XDS에서 관리됩니다. 이 화면은 현재 실행 중인 설정을 보여주며 수정할 수 없습니다.'
	],
	[
		'Top-level runtime policies are only available when the gateway is running from XDS config.',
		'최상위 실행 정책은 게이트웨이가 XDS 설정으로 실행 중일 때만 확인할 수 있습니다.'
	],
	['Loading runtime policies', '실행 중인 정책을 불러오는 중입니다'],
	['Readonly policies unavailable', '읽기 전용 정책을 확인할 수 없습니다'],
	['No top-level policies', '최상위 정책이 없습니다'],
	[
		'No top-level policies are present in the active gateway dump.',
		'현재 실행 중인 게이트웨이에 최상위 정책이 없습니다.'
	],

	// Empty, loading and error states
	['Loading models', '모델을 불러오는 중입니다'],
	['Loading providers', '프로바이더를 불러오는 중입니다'],
	['Loading policies', '정책을 불러오는 중입니다'],
	['Loading guardrails', '가드레일을 불러오는 중입니다'],
	['Loading keys', 'API 키를 불러오는 중입니다'],
	['Loading cost configuration', '비용 설정을 불러오는 중입니다'],
	['Loading LLM configuration', 'LLM 설정을 불러오는 중입니다'],
	['Loading gateway configuration', '게이트웨이 설정을 불러오는 중입니다'],
	['Loading traffic listeners', '트래픽 리스너를 불러오는 중입니다'],
	['Detecting configuration mode', '설정 방식을 확인하는 중입니다'],
	['Detecting traffic configuration mode', '트래픽 설정 방식을 확인하는 중입니다'],
	['No models configured', '설정된 모델이 없습니다'],
	['No configured models', '설정된 모델이 없습니다'],
	['No shared providers configured', '공용 프로바이더가 없습니다'],
	['No MCP servers', '설정된 MCP 서버가 없습니다'],
	['No virtual API keys', '가상 API 키가 없습니다'],
	['No gateways configured', '설정된 게이트웨이가 없습니다'],
	['No database resources', '데이터베이스 리소스가 없습니다'],
	['No cost catalogs configured', '비용 카탈로그가 설정되지 않았습니다'],
	['No listeners on this bind', '이 바인드에 연결된 리스너가 없습니다'],
	['No legacy binds configured', '기존 방식의 바인드가 없습니다'],
	['Delete route?', '라우트를 삭제할까요?'],
	['No matches', '검색 결과가 없습니다'],
	['No results', '결과가 없습니다'],
	['No values found.', '일치하는 값이 없습니다.'],
	['Browser access is not allowed', '브라우저 접근이 허용되지 않았습니다'],
	['MCP browser access is not allowed', 'MCP 브라우저 접근이 허용되지 않았습니다'],
	['Playground request failed', '테스트 요청에 실패했습니다'],
	['MCP request failed', 'MCP 요청에 실패했습니다'],
	['CORS update failed', 'CORS 설정을 변경하지 못했습니다'],

	// Policy catalog
	['Access', '접근 제어'],
	['Safety', '안전'],
	['Traffic Shaping', '트래픽 제어'],
	['Mutation', '요청·응답 변경'],
	['Other', '기타'],
	['Managed on Virtual API Keys', '가상 API 키 화면에서 관리'],
	['Managed on Guardrails', '가드레일 화면에서 관리'],
	['Guardrails to apply to every configured model.', '설정된 모든 모델에 적용할 가드레일입니다.'],
	['Local rate limit', '로컬 요청 제한'],
	['Local rate limits for incoming requests.', '들어오는 요청 수를 게이트웨이에서 제한합니다.'],
	['Remote rate limit', '외부 요청 제한'],
	[
		'Remote rate limit checks for incoming requests.',
		'외부 서비스를 통해 들어오는 요청의 한도를 확인합니다.'
	],
	['Transformations', '요청·응답 변환'],
	[
		'Modify request and response headers, bodies, or metadata.',
		'요청과 응답의 헤더, 본문 또는 메타데이터를 변경합니다.'
	],
	['External processor', '외부 처리기'],
	[
		'Send request and response data to an external processing service.',
		'요청과 응답 데이터를 외부 처리 서비스로 전송합니다.'
	],
	['Timeout', '시간 제한'],
	['Set request timeout limits.', '요청 처리 제한 시간을 설정합니다.'],
	['MCP authentication', 'MCP 인증'],
	['Authenticate MCP clients.', 'MCP 클라이언트를 인증합니다.'],
	['MCP authorization', 'MCP 접근 제어'],
	['Authorization rules for MCP requests.', 'MCP 요청에 적용할 접근 제어 규칙입니다.'],
	['MCP guardrails', 'MCP 가드레일'],
	['External MCP policy processors.', '외부 MCP 정책 처리기를 설정합니다.'],

	// Logs and analytics
	['Export', '내보내기'],
	['Last 24 hours', '최근 24시간'],
	['GROUP BY', '그룹 기준'],
	['Total', '전체'],
	['All models', '모든 모델'],
	['Group by', '그룹 기준'],
	['USERS', '사용자'],
	['Users', '사용자'],
	['All users', '모든 사용자'],
	['GROUPS', '그룹'],
	['Groups', '그룹'],
	['All groups', '모든 그룹'],
	['All providers', '모든 프로바이더'],
	['USER AGENTS', '사용자 에이전트'],
	['User agents', '사용자 에이전트'],
	['All user agents', '모든 사용자 에이전트'],
	['MEASURE', '측정 항목'],
	['Measure', '측정 항목'],
	['Tokens', '토큰'],
	['Traffic over time', '시간대별 트래픽'],
	['Breakdown', '상세 분석'],
	['Tokens total', '전체 토큰'],
	['No analytics in the selected window.', '선택한 기간에 분석 데이터가 없습니다.'],
	['HTTP STATUS', 'HTTP 상태'],
	['HTTP status', 'HTTP 상태'],
	['Any status', '모든 상태'],
	['Stream', '실시간 보기'],
	['No log entries', '로그가 없습니다'],
	['Loading logs', '로그를 불러오는 중입니다'],
	['Fetching recent LLM calls.', '최근 LLM 호출을 불러오고 있습니다.'],
	['No LLM calls match the current filters.', '현재 필터와 일치하는 LLM 호출이 없습니다.'],
	['Logs API error', '로그 API 오류'],
	['Analytics API error', '분석 API 오류'],
	['Time', '시간'],
	['Prompt', '프롬프트'],
	['Turn', '대화 순서'],
	['Duration', '소요 시간'],
	['In', '입력'],
	['Out', '출력'],
	['Cache', '캐시'],
	['Cost', '비용'],
	['Expand', '펼치기'],
	['Log settings', '로그 설정'],
	[
		'Stores prompt and completion content in the database payload. Metadata, usage, timing, and cost are always logged.',
		'프롬프트와 응답 내용을 데이터베이스에 저장합니다. 메타데이터, 사용량, 처리 시간, 비용은 항상 기록됩니다.'
	],
	[
		'Optional CEL expressions for populating user and group attributes in database logs. If not set a default will be used.',
		'데이터베이스 로그의 사용자·그룹 속성을 채울 CEL 표현식입니다. 설정하지 않으면 기본값을 사용합니다.'
	],
	['Log settings config diff', '로그 설정 변경 내용'],
	['Include prompts and completions in logs', '로그에 프롬프트와 응답 내용 포함'],
	['Request log identity', '요청 로그 사용자 식별'],
	['User attribute', '사용자 속성'],
	['Group attribute', '그룹 속성'],
	['Loading log payload', '로그 상세 내용을 불러오는 중입니다'],
	['First token', '첫 토큰 응답'],
	['Speed', '처리 속도'],
	['Cache hit', '캐시 적중'],
	['Request', '요청'],
	['Client requested', '클라이언트 요청'],
	['Gateway sent', '게이트웨이 전달'],
	['Provider returned', '프로바이더 응답'],
	['Operation', '작업'],
	['Client', '클라이언트'],
	['User', '사용자'],
	['Group', '그룹'],
	['Completed', '완료 시각'],
	['Usage', '사용량'],
	['Conversation', '대화'],
	['Prompt logging is off', '프롬프트 로그가 꺼져 있습니다'],
	['Raw log JSON', '원본 로그 JSON'],
	['Trajectory', '처리 경로'],
	['empty message', '빈 메시지'],
	['Copy to clipboard', '클립보드에 복사'],

	// Resource actions
	['Add model', '모델 추가'],
	['Edit model', '모델 수정'],
	['Delete model', '모델 삭제'],
	['Open in playground', '테스트 화면에서 열기'],
	['Add provider', '프로바이더 추가'],
	['Edit provider', '프로바이더 수정'],
	['Delete provider', '프로바이더 삭제'],
	['Add model using provider', '이 프로바이더로 모델 추가'],
	['Add gateway', '게이트웨이 추가'],
	['Edit gateway', '게이트웨이 수정'],
	['Delete gateway', '게이트웨이 삭제'],
	['Add listener', '리스너 추가'],
	['Edit listener', '리스너 수정'],
	['Delete listener', '리스너 삭제'],
	['Add route', '라우트 추가'],
	['Add bind', '바인드 추가'],
	['Manage gateways', '게이트웨이 관리'],
	['Edit route', '라우트 수정'],
	['Delete route', '라우트 삭제'],
	['Add server', '서버 추가'],
	['Edit server', '서버 수정'],
	['Delete server', '서버 삭제'],
	['Edit key', '키 수정'],
	['Delete key', '키 삭제'],
	['Copy key', '키 복사'],
	['Delete policy', '정책 삭제'],
	['Delete policy?', '정책을 삭제할까요?'],
	['Delete provider?', '프로바이더를 삭제할까요?'],
	['Delete virtual API key?', '가상 API 키를 삭제할까요?'],
	['Delete database resource?', '데이터베이스 리소스를 삭제할까요?'],
	['Delete database resource', '데이터베이스 리소스 삭제'],
	['Discard unsaved changes?', '저장하지 않은 변경사항을 버릴까요?'],
	['Your changes have not been saved and will be lost.', '저장하지 않은 변경사항은 사라집니다.'],
	['Remove all LLM guardrails?', '모든 LLM 가드레일을 제거할까요?'],
	['Invalid guardrails', '가드레일 설정이 올바르지 않습니다'],
	['Guardrails config diff', '가드레일 설정 변경 내용'],
	['Save guardrails', '가드레일 저장'],
	['Remove guardrail?', '가드레일을 제거할까요?'],

	// Common form labels
	['Gateway base URL', '게이트웨이 기본 URL'],
	[
		'Model uses a wildcard; specify the specific model.',
		'모델 이름에 와일드카드가 있으므로 실제 사용할 모델을 지정하세요.'
	],
	['Select or type a model', '모델을 선택하거나 입력하세요'],
	['Gateway', '게이트웨이'],
	['Gateway name', '게이트웨이 이름'],
	['Provider name', '프로바이더 이름'],
	['Model name', '모델 이름'],
	['Virtual model name', '가상 모델 이름'],
	['Incoming model match', '요청 모델 조건'],
	['Outgoing model', '전달할 모델'],
	['Explicit outgoing model', '직접 지정할 모델'],
	['Routing strategy', '라우팅 방식'],
	['Weighted targets', '가중치 대상'],
	['Failover targets', '장애 전환 대상'],
	['Conditional targets', '조건부 대상'],
	['Target model', '대상 모델'],
	['Condition', '조건'],
	['System prompt', '시스템 프롬프트'],
	['User message', '사용자 메시지'],
	['Specific model', '세부 모델'],
	['Virtual API key', '가상 API 키'],
	['Raw API key', '직접 입력할 API 키'],
	['Bearer token', 'Bearer 토큰'],
	['Optional token', '선택 토큰'],
	['Optional Bearer token', '선택 Bearer 토큰'],
	['Arguments JSON', '인자 JSON'],
	[
		'Let the model call tools exposed by the MCP gateway.',
		'모델이 MCP 게이트웨이에 공개된 도구를 호출하도록 허용합니다.'
	],
	['Ask a test question...', '테스트할 질문을 입력하세요...'],
	['Inspect', '상세 보기'],
	['Tool call', '도구 호출'],
	['Tool result', '도구 실행 결과'],
	['Integration', '연동 방식'],
	['Validation mode', '검증 모드'],
	[
		'Where to read the API key from in incoming requests.',
		'들어오는 요청에서 API 키를 읽을 위치를 설정합니다.'
	],
	['Key value', '키 값'],
	['Budgets', '사용 한도'],
	['Model access', '모델 접근 권한'],
	['Policy state', '정책 상태'],
	['Save model', '모델 저장'],
	['Match conditions and model-specific policies', '일치 조건과 모델별 정책을 설정합니다'],
	['Model warnings', '모델 설정 경고'],
	['Invalid model policies', '모델 정책이 올바르지 않습니다'],
	['Generated model config', '생성된 모델 설정'],
	['Model CEL expression', '모델 CEL 표현식'],
	['Model policies', '모델 정책'],
	['Transformation', '변환'],
	['LLM request fields', 'LLM 요청 필드'],
	['Final transformation', '최종 변환'],
	['Provider request fields', '프로바이더 요청 필드'],
	['Default request values', '기본 요청값'],
	['Defaults YAML', '기본값 YAML'],
	['Override request values', '요청값 덮어쓰기'],
	['Overrides YAML', '재정의 값 YAML'],
	['Health', '상태 확인'],
	['Prompt caching', '프롬프트 캐싱'],
	['Save virtual model', '가상 모델 저장'],
	['Remove target', '대상 삭제'],
	['Remove conditional target', '조건부 대상 삭제'],
	[
		'Only the final conditional target can omit a condition.',
		'조건은 마지막 조건부 대상에서만 생략할 수 있습니다.'
	],
	['Generated virtual model config', '생성된 가상 모델 설정'],
	['reference', '참조'],
	['Custom auth detected', '사용자 지정 인증 사용 중'],
	['none', '없음'],
	['Matches', '일치 조건'],
	[
		'At least one match group must match. Within a group, every header condition must match.',
		'하나 이상의 조건 그룹이 일치해야 하며, 그룹 안에서는 모든 헤더 조건을 충족해야 합니다.'
	],
	['No additional match conditions.', '추가 일치 조건이 없습니다.'],
	['Unhealthy expression', '비정상 상태 조건식'],
	['Eviction duration', '제외 시간'],
	['Consecutive failures', '연속 실패 횟수'],
	['Health threshold', '상태 확인 기준'],
	['Restore health', '정상 상태 복구'],
	['Add headers', '헤더 추가'],
	['Set headers', '헤더 설정'],
	['Remove headers', '헤더 제거'],
	['Messages', '메시지'],
	['Minimum tokens', '최소 토큰 수'],
	['Message offset', '메시지 제외 수'],
	['Choose how LLM traffic is exposed.', 'LLM 트래픽을 어떤 방식으로 공개할지 선택합니다.'],
	['LLM settings config diff', 'LLM 설정 변경 내용'],
	['configured', '설정됨'],
	['Select provider', '프로바이더 선택'],
	['Provider API key', '프로바이더 API 키'],
	['Vertex project', 'Vertex 프로젝트'],
	['Vertex region', 'Vertex 리전'],
	['Bedrock endpoint', 'Bedrock 엔드포인트'],
	['Azure resource name', 'Azure 리소스 이름'],
	['Azure API version', 'Azure API 버전'],
	['Azure resource type', 'Azure 리소스 유형'],
	['Azure project name', 'Azure 프로젝트 이름'],
	['Custom provider', '사용자 지정 프로바이더'],
	['Route formats', '라우트 형식'],
	['AWS credentials', 'AWS 인증 정보'],
	['Google credentials', 'Google 인증 정보'],
	['Azure credentials', 'Azure 인증 정보'],
	['No provider credential configured.', '설정된 프로바이더 인증 정보가 없습니다.'],
	['No policy fields', '설정할 정책 항목이 없습니다'],
	['No policies configured', '설정된 정책이 없습니다'],
	[
		'No schema properties are available for this policy object.',
		'이 정책에서 설정할 수 있는 항목이 없습니다.'
	],
	['Current policy YAML', '현재 정책 YAML'],
	['Readonly mode', '읽기 전용 모드'],
	['Runtime traffic', '실행 중인 트래픽 설정'],
	[
		'Active runtime resources from the gateway dump.',
		'현재 실행 중인 게이트웨이의 트래픽 리소스입니다.'
	],
	['Loading runtime traffic configuration', '실행 중인 트래픽 설정을 불러오는 중입니다'],
	['No runtime traffic configuration', '실행 중인 트래픽 설정이 없습니다'],
	['No runtime listeners', '실행 중인 리스너가 없습니다'],
	[
		'No listeners are present in the active gateway dump.',
		'현재 실행 중인 게이트웨이에 리스너가 없습니다.'
	],
	[
		'No listeners are attached to this bind in the runtime dump.',
		'현재 실행 설정에서 이 바인드에 연결된 리스너가 없습니다.'
	],
	['No runtime routes', '실행 중인 라우트가 없습니다'],
	[
		'No routes are present in the active gateway dump.',
		'현재 실행 중인 게이트웨이에 라우트가 없습니다.'
	],
	['Port conflict', '포트 충돌'],
	['Conflict', '충돌'],
	['Listener YAML', '리스너 YAML'],
	['Route YAML', '라우트 YAML'],
	['Backend YAML', '백엔드 YAML'],
	['Access mode', '접근 방식'],
	['Allowed model patterns', '허용할 모델 패턴'],
	['Rolling window', '집계 기간'],
	['Limit amount', '한도'],
	['Limit unit', '한도 단위'],
	['When limit is reached', '한도 초과 시 동작'],
	['Database required', '데이터베이스가 필요합니다'],
	['Authentication', '인증'],
	['Authorization', '접근 제어'],
	['Auth method', '인증 방식'],
	['Credential location', '인증 정보 위치'],
	[
		'By default, callers send Authorization: Bearer token.',
		'기본적으로 호출자는 Authorization: Bearer 토큰을 전송합니다.'
	],
	[
		'Override where this policy reads the credential.',
		'이 정책이 인증 정보를 읽을 위치를 직접 지정합니다.'
	],
	['Use default', '기본값 사용'],
	[
		'Choose where the credential is read from or written to.',
		'인증 정보를 읽거나 기록할 위치를 선택합니다.'
	],
	['Location type', '위치 유형'],
	['Header', '헤더'],
	['Query parameter', '쿼리 매개변수'],
	['Cookie', '쿠키'],
	['Header name', '헤더 이름'],
	['Header prefix', '헤더 접두사'],
	['Query parameter name', '쿼리 매개변수 이름'],
	['Cookie name', '쿠키 이름'],
	['CEL expression', 'CEL 표현식'],
	[
		'CEL expressions can extract credentials but cannot insert them. Choose Header, Query parameter, or Cookie for backend auth.',
		'CEL 표현식은 인증 정보를 추출할 수 있지만 삽입할 수는 없습니다. 백엔드 인증에는 헤더, 쿼리 매개변수 또는 쿠키를 선택하세요.'
	],
	['Allowed origins', '허용할 출처'],
	['Allowed methods', '허용할 메서드'],
	['Allowed headers', '허용할 헤더'],
	['Expose headers', '노출할 헤더'],
	['Credentials', '인증 정보'],
	['Max age', '캐시 유지 시간'],
	['Issuer', '발급자'],
	['Audiences', '대상 서비스'],
	['Client ID', '클라이언트 ID'],
	['Client secret', '클라이언트 보안 키'],
	['OAuth2 client secret', 'OAuth2 클라이언트 보안 키'],
	['Redirect URI', '리디렉션 URI'],
	['Scopes', '권한 범위'],
	['Additional scopes', '추가 권한 범위'],
	['Signing keys', '서명 키'],
	['Token validation', '토큰 검증'],
	['Request headers', '요청 헤더'],
	['Response headers', '응답 헤더'],
	['Request body', '요청 본문'],
	['Response body', '응답 본문'],
	['Failure mode', '실패 시 동작'],
	['Guard type', '가드레일 유형'],
	['Select guard type', '가드레일 유형 선택'],
	['Raw guard YAML', '가드레일 원본 YAML'],
	['Backend policies preserved', '유지되는 백엔드 정책'],
	['Unsupported guard shape', '지원하지 않는 가드레일 형식'],
	[
		'This guard uses a shape the visual editor does not support yet. It will be preserved as raw YAML.',
		'시각 편집기에서 아직 지원하지 않는 형식입니다. 원본 YAML은 그대로 유지됩니다.'
	],
	['Unsupported target type', '지원하지 않는 대상 유형'],
	['Unsupported rate limit shape', '지원하지 않는 요청 제한 형식'],
	['Unsupported remote rate limit shape', '지원하지 않는 외부 요청 제한 형식'],
	['Built-in detectors', '기본 제공 탐지 항목'],
	['Email', '이메일'],
	['Phone', '전화번호'],
	['Credit card', '신용카드'],
	['SSN', '미국 사회보장번호(SSN)'],
	['CA SIN', '캐나다 사회보험번호(SIN)'],
	[
		'Detect common sensitive data types with built-in regex rules.',
		'기본 정규식 규칙으로 일반적인 민감정보 유형을 탐지합니다.'
	],
	['Reject request', '요청 차단'],
	['Reject the request when a detector matches.', '탐지 항목과 일치하면 요청을 차단합니다.'],
	['Reject the request when a regex matches.', '정규식과 일치하면 요청을 차단합니다.'],
	['Mask matched text', '일치한 내용 마스킹'],
	['Replace matched content and continue.', '일치한 내용을 대체한 뒤 요청을 계속 처리합니다.'],
	['Custom regex', '사용자 지정 정규식'],
	[
		'Match and optionally mask custom regular expressions.',
		'사용자 지정 정규식과 일치하는 내용을 탐지하고 필요하면 마스킹합니다.'
	],
	['Webhook', '웹훅'],
	['Send content to an external guardrail service.', '콘텐츠를 외부 가드레일 서비스로 전송합니다.'],
	['OpenAI Moderation', 'OpenAI 모더레이션'],
	[
		'Use OpenAI moderation checks for incoming prompts.',
		'들어오는 프롬프트에 OpenAI 모더레이션 검사를 적용합니다.'
	],
	['Bedrock Guardrails', 'Bedrock 가드레일'],
	['Use AWS Bedrock Guardrails.', 'AWS Bedrock 가드레일을 사용합니다.'],
	['Google Model Armor', 'Google Model Armor'],
	['Use Google Model Armor for safety checks.', 'Google Model Armor로 안전 검사를 수행합니다.'],
	['Azure Content Safety', 'Azure Content Safety'],
	['Use Azure AI Content Safety.', 'Azure AI Content Safety를 사용합니다.'],
	['Webhook target', '웹훅 대상'],
	['Backend host URL for guardrail checks.', '가드레일 검사에 사용할 백엔드 호스트 URL입니다.'],
	[
		'Reject when the webhook is unavailable or errors.',
		'웹훅을 사용할 수 없거나 오류가 발생하면 요청을 차단합니다.'
	],
	[
		'Continue when the webhook is unavailable or errors.',
		'웹훅을 사용할 수 없거나 오류가 발생해도 요청을 계속 처리합니다.'
	],
	['Moderation model', '검토 모델'],
	[
		'Optional. Defaults to omni-moderation-latest.',
		'선택 항목입니다. 기본값은 omni-moderation-latest입니다.'
	],
	['Guardrail identifier', '가드레일 식별자'],
	['Guardrail version', '가드레일 버전'],
	['AWS region', 'AWS 리전'],
	['Template ID', '템플릿 ID'],
	['Project ID', '프로젝트 ID'],
	['Location', '리전 위치'],
	['Optional. Defaults to us-central1.', '선택 항목입니다. 기본값은 us-central1입니다.'],
	['Severity threshold', '심각도 기준'],
	['Optional. 0-6; default is 2.', '선택 항목입니다. 0~6 사이의 값이며 기본값은 2입니다.'],
	['Analyze API version', '분석 API 버전'],
	['Blocklists', '차단 목록'],
	['Comma-separated names.', '여러 이름은 쉼표로 구분합니다.'],
	['Halt on blocklist hit', '차단 목록에 해당하면 요청 중단'],
	['Detect jailbreak attempts', '탈옥 시도 탐지'],
	['Jailbreak API version', '탈옥 탐지 API 버전'],
	['Rejection status', '차단 응답 상태'],
	['Rejection body', '차단 응답 본문'],
	[
		'Response body returned when content is rejected.',
		'콘텐츠가 차단될 때 반환할 응답 본문입니다.'
	],
	[
		'The request was rejected due to inappropriate content',
		'부적절한 콘텐츠가 감지되어 요청이 차단되었습니다.'
	],
	['Custom regex patterns', '사용자 지정 정규식 패턴'],
	['Remove pattern', '패턴 삭제'],
	['Add pattern', '패턴 추가'],
	[
		'Each built-in detector guard needs at least one detector.',
		'기본 제공 탐지 가드레일마다 탐지 항목을 하나 이상 선택해야 합니다.'
	],
	[
		'Each custom regex guard needs at least one pattern.',
		'사용자 지정 정규식 가드레일마다 패턴을 하나 이상 입력해야 합니다.'
	],
	['Webhook guards require a target.', '웹훅 가드레일에는 대상 주소가 필요합니다.'],
	[
		'Bedrock guardrails require identifier, version, and region.',
		'Bedrock 가드레일에는 식별자, 버전, 리전이 필요합니다.'
	],
	[
		'Google Model Armor requires template ID and project ID.',
		'Google Model Armor에는 템플릿 ID와 프로젝트 ID가 필요합니다.'
	],
	[
		'Azure Content Safety requires an endpoint.',
		'Azure Content Safety에는 엔드포인트가 필요합니다.'
	],
	[
		'Select the guardrail integration or rule type to apply.',
		'적용할 가드레일 연동 방식 또는 규칙 유형을 선택합니다.'
	],
	['Upstream model', '업스트림 모델'],
	['Used by', '사용 중인 모델'],
	['unused', '사용 안 함'],
	['Save provider', '프로바이더 저장'],
	['Generated provider config', '생성된 프로바이더 설정'],
	[
		'Create a key so callers can authenticate without exposing provider credentials.',
		'프로바이더 인증 정보를 노출하지 않고 호출자가 인증할 수 있도록 키를 만드세요.'
	],
	['Unnamed key', '이름 없는 키'],
	['Disable API key policy?', 'API 키 정책을 끌까요?'],
	['Disable API key policy', 'API 키 정책 끄기'],
	[
		'Remove the API key policy entirely. Requests will not be validated against virtual API keys.',
		'API 키 정책을 완전히 제거합니다. 이후 요청은 가상 API 키로 검증되지 않습니다.'
	],
	['Save key', '키 저장'],
	['Name is required', '이름을 입력해 주세요'],
	['Name already exists', '같은 이름이 이미 있습니다'],
	[
		'Cap how much this key can spend or consume during each rolling window.',
		'집계 기간마다 이 키가 사용할 수 있는 비용이나 사용량을 제한합니다.'
	],
	['Invalid', '올바르지 않음'],
	['API key budgets require', 'API 키 사용 한도를 설정하려면'],
	['to be configured.', '설정이 필요합니다.'],
	['Invalid budgets', '사용 한도 설정이 올바르지 않습니다'],
	[
		'Limit which requested model names this key can use.',
		'이 키로 요청할 수 있는 모델 이름을 제한합니다.'
	],
	['Deny all', '모두 차단'],
	['Invalid model access', '모델 접근 설정이 올바르지 않습니다'],
	[
		'Attach custom metadata to requests authenticated with this key.',
		'이 키로 인증된 요청에 사용자 지정 메타데이터를 추가합니다.'
	],
	[
		'No budgets configured. Usage is unlimited.',
		'설정된 사용 한도가 없어 제한 없이 사용할 수 있습니다.'
	],
	['Exceeded', '한도 초과'],
	['Stable identifier used for accounting.', '사용량 집계에 사용하는 고정 식별자입니다.'],
	['Examples: 24h, 7d, or 30d.', '예: 24h, 7d, 30d'],
	['Live usage is unavailable.', '실시간 사용량을 확인할 수 없습니다.'],
	['unrestricted', '제한 없음'],
	['deny all', '모두 차단'],
	['agentgateway home', 'agentgateway 홈'],
	['Certificate', '인증서'],
	['Key', '키'],
	['Listener policies', '리스너 정책'],
	['Policy YAML', '정책 YAML'],
	['Backend auth YAML', '백엔드 인증 YAML'],
	['From', '시작'],
	['To', '종료'],
	['Interval', '간격'],

	// CEL and policy tools
	[
		'Evaluate policy expressions against sample or custom request context using the gateway CEL endpoint.',
		'게이트웨이 CEL 엔드포인트에서 예제 또는 직접 작성한 요청 컨텍스트로 정책 표현식을 실행합니다.'
	],
	['CEL reference', 'CEL 참고 문서'],
	['Evaluate', '실행'],
	['EXPRESSION', '표현식'],
	['REQUEST CONTEXT YAML', '요청 컨텍스트 YAML'],
	['Result', '결과'],
	['YAML value returned by CEL evaluation.', 'CEL 실행 결과를 YAML 값으로 표시합니다.'],

	// UI settings and access policies
	[
		'Expose the UI on a traffic gateway and configure policies that protect the UI.',
		'트래픽 게이트웨이에 UI를 연결하고 접근 보호 정책을 설정합니다.'
	],
	['PUBLIC UI GATEWAY', '외부 공개 UI 게이트웨이'],
	['View diff', '변경 내용 보기'],
	['Save UI gateway', 'UI 게이트웨이 저장'],
	['UI access policies', 'UI 접근 정책'],
	[
		'UI policies require the UI to be exposed on a gateway.',
		'UI 접근 정책을 사용하려면 먼저 게이트웨이에 UI를 공개해야 합니다.'
	],
	[
		'Authenticate browser requests with OIDC authorization code flow.',
		'OIDC 인증 코드 방식으로 브라우저 요청을 인증합니다.'
	],
	['JWT auth', 'JWT 인증'],
	[
		'Authenticate incoming requests with JWT bearer tokens.',
		'JWT Bearer 토큰으로 들어오는 요청을 인증합니다.'
	],
	[
		'Authorization rules for incoming HTTP requests.',
		'들어오는 HTTP 요청에 적용할 접근 제어 규칙입니다.'
	],
	['External authz', '외부 인가'],
	[
		'Authorize incoming requests by calling an external authorization service.',
		'외부 인가 서비스를 호출해 들어오는 요청의 접근 권한을 확인합니다.'
	],
	['Basic auth', '기본 인증'],
	[
		'Authenticate incoming requests with Basic Auth credentials from an htpasswd user database.',
		'htpasswd 사용자 데이터베이스의 기본 인증 정보로 들어오는 요청을 인증합니다.'
	],
	['API keys', 'API 키'],
	['Authenticate incoming requests with API keys.', 'API 키로 들어오는 요청을 인증합니다.'],
	[
		'Handle CSRF protection by validating request origins against configured allowed origins.',
		'요청 출처가 허용 목록에 있는지 확인해 CSRF 공격을 방지합니다.'
	],
	[
		'Handle CORS preflight requests and append configured CORS headers to applicable requests.',
		'CORS 사전 요청을 처리하고 필요한 CORS 헤더를 응답에 추가합니다.'
	],
	['Current top-level policy YAML', '현재 최상위 정책 YAML'],
	['Which traffic gateway exposes the UI.', 'UI를 외부에 공개할 트래픽 게이트웨이를 선택합니다.'],
	['UI gateway config diff', 'UI 게이트웨이 설정 변경 내용'],
	['None (admin interface only)', '없음 (관리자 화면에서만 사용)'],
	['Do not expose the UI on a traffic gateway.', '트래픽 게이트웨이에 UI를 공개하지 않습니다.'],

	// Policy editors and generated schema help
	['Enforcement', '적용 방식'],
	[
		'Choose how the gateway behaves when a request has no token or a token cannot be verified.',
		'토큰이 없거나 검증할 수 없을 때 게이트웨이가 처리할 방식을 선택합니다.'
	],
	['Reject requests that do not carry a valid token.', '유효한 토큰이 없는 요청을 차단합니다.'],
	['Validate a token when one is present.', '토큰이 있을 때만 검증합니다.'],
	[
		'Keep serving traffic while surfacing JWT data when possible.',
		'요청은 허용하되 가능한 경우 JWT 정보를 제공합니다.'
	],
	[
		'Configure the JWKS source used to verify token signatures.',
		'토큰 서명을 검증할 JWKS 출처를 설정합니다.'
	],
	['JWKS source', 'JWKS 출처'],
	['JWKS SOURCE', 'JWKS 출처'],
	[
		'Fetch signing keys from the issuer JWKS endpoint.',
		'발급자의 JWKS 엔드포인트에서 서명 키를 가져옵니다.'
	],
	[
		'Read signing keys from a file on the gateway host.',
		'게이트웨이 호스트의 파일에서 서명 키를 읽습니다.'
	],
	['Paste a JWKS document directly into the policy.', 'JWKS 문서를 정책에 직접 입력합니다.'],
	['JWKS file', 'JWKS 파일'],
	['JWKS URL', 'JWKS URL'],
	['Inline JWKS', '직접 입력 JWKS'],
	['INLINE JWKS', '직접 입력 JWKS'],
	[
		'Restrict accepted tokens by issuer, audience, and required claims.',
		'발급자, 대상 서비스, 필수 클레임을 기준으로 허용할 토큰을 제한합니다.'
	],
	['Required claims', '필수 클레임'],
	['REQUIRED CLAIMS', '필수 클레임'],
	['No audience restriction configured.', '대상 서비스 제한이 설정되지 않았습니다.'],
	[
		'Override where this policy reads the JWT from.',
		'이 정책이 JWT를 읽을 위치를 직접 지정합니다.'
	],
	['Default: Authorization: Bearer token', '기본값: Authorization: Bearer 토큰'],
	['Customize', '직접 설정'],
	['Provider metadata', '프로바이더 메타데이터'],
	['PROVIDER METADATA', '프로바이더 메타데이터'],
	[
		'Configure where browser login starts and how returned ID tokens are validated.',
		'브라우저 로그인을 시작할 위치와 반환된 ID 토큰의 검증 방식을 설정합니다.'
	],
	['Discovery', '자동 검색'],
	[
		'Use the issuer metadata endpoint unless an override is provided.',
		'별도 설정이 없으면 발급자 메타데이터 엔드포인트를 사용합니다.'
	],
	['Explicit endpoints', '엔드포인트 직접 지정'],
	[
		'Manually provide authorization, token, and signing-key metadata.',
		'인증, 토큰, 서명 키 메타데이터를 직접 입력합니다.'
	],
	['Discovery override', '검색 설정 재정의'],
	['DISCOVERY OVERRIDE', '검색 설정 재정의'],
	[
		'Default: issuer + /.well-known/openid-configuration',
		'기본값: 발급자 주소 + /.well-known/openid-configuration'
	],
	[
		'Identify the OAuth2 client used by the gateway during the authorization code flow.',
		'인증 코드 흐름에서 게이트웨이가 사용할 OAuth2 클라이언트를 설정합니다.'
	],
	[
		'Request extra OAuth2 scopes. The gateway always includes openid.',
		'추가 OAuth2 권한 범위를 요청합니다. openid는 항상 포함됩니다.'
	],
	['No additional scopes configured.', '추가 권한 범위가 설정되지 않았습니다.'],
	['Authorization endpoint', '인증 엔드포인트'],
	['Token endpoint', '토큰 엔드포인트'],
	['Token endpoint auth', '토큰 엔드포인트 인증'],
	['Authorization behavior', '인가 처리 방식'],
	[
		'Choose protocol and fail-open/fail-closed behavior.',
		'인가 서비스 호출 방식과 오류 발생 시 요청 처리 방식을 선택합니다.'
	],
	['Use Envoy external authorization over gRPC.', 'Envoy 외부 인가를 gRPC로 호출합니다.'],
	['Call an HTTP authorization service.', 'HTTP 인가 서비스를 호출합니다.'],
	['Deny status', '차단 상태 코드'],
	['Include request headers', '전달할 요청 헤더'],
	['INCLUDE REQUEST HEADERS', '전달할 요청 헤더'],
	['Include request body', '요청 본문 전달'],
	['Max request bytes', '최대 요청 크기'],
	['Body options', '본문 전송 옵션'],
	['Allow partial message', '부분 메시지 허용'],
	['Pack as bytes', '바이트 형식으로 전송'],
	['gRPC details', 'gRPC 상세 설정'],
	[
		'Context extensions are static values; metadata values are CEL expressions.',
		'컨텍스트 확장은 고정값이며 메타데이터 값은 CEL 표현식입니다.'
	],
	['Context', '컨텍스트'],
	['CONTEXT', '컨텍스트'],
	['HTTP details', 'HTTP 상세 설정'],
	[
		'Configure the authorization request and response metadata extraction.',
		'인가 요청과 응답에서 메타데이터를 추출하는 방식을 설정합니다.'
	],
	['Path expression', '경로 표현식'],
	['Redirect expression', '리디렉션 표현식'],
	['Include response headers', '가져올 응답 헤더'],
	[
		'External service the gateway calls for this policy.',
		'이 정책에서 게이트웨이가 호출할 외부 서비스를 설정합니다.'
	],
	['Hostname or IP address', '호스트 이름 또는 IP 주소'],
	[
		'Protocol used to call the authorization service. Use gRPC unless the service only supports HTTP.',
		'인가 서비스 호출에 사용할 프로토콜입니다. HTTP만 지원하는 경우가 아니라면 gRPC를 사용하세요.'
	],
	[
		'Behavior when the authorization service is unavailable or returns an error.',
		'인가 서비스에 연결할 수 없거나 오류를 반환할 때의 처리 방식입니다.'
	],
	[
		'Request headers to send to the authorization service. If unset, gRPC sends all request headers and HTTP sends only `Authorization`.',
		'인가 서비스에 전달할 요청 헤더입니다. 미설정 시 gRPC는 모든 헤더를, HTTP는 Authorization 헤더만 전달합니다.'
	],
	[
		'Static context values to send to the authorization service. Maps to the `context_extensions` field in the request.',
		'인가 서비스에 전달할 고정 컨텍스트 값입니다. 요청의 context_extensions 필드에 반영됩니다.'
	],
	[
		'Metadata values to send to the authorization service, computed from CEL expressions. Maps to the `metadata_context.filter_metadata` field in the request. If unset, `envoy.filters.http.jwt_authn` is set when JWT auth is also used, for compatibility.',
		'CEL 표현식으로 계산해 인가 서비스에 전달할 메타데이터입니다. 요청의 metadata_context.filter_metadata 필드에 반영되며, JWT 인증을 함께 사용하면 호환성을 위해 기본 JWT 메타데이터가 설정됩니다.'
	],
	[
		'Issuer used for discovery and ID token validation.',
		'공급자 정보 조회와 ID 토큰 검증에 사용할 발급자입니다.'
	],
	[
		'Authorization endpoint used to start the browser login flow.',
		'브라우저 로그인 흐름을 시작할 인증 엔드포인트입니다.'
	],
	[
		`Optional discovery document override. If omitted, discovery uses \`\${issuer}/.well-known/openid-configuration\`.`,
		'선택 항목입니다. 공급자 정보 문서 주소를 직접 지정하지 않으면 발급자 주소의 /.well-known/openid-configuration을 사용합니다.'
	],
	[
		'OAuth2 client identifier used for authorization and token exchange.',
		'인증과 토큰 교환에 사용할 OAuth2 클라이언트 ID입니다.'
	],
	[
		'OAuth2 client secret used for token exchange.',
		'토큰 교환에 사용할 OAuth2 클라이언트 보안 키입니다.'
	],
	[
		'Absolute callback URI handled by the gateway. Unauthenticated document navigations are redirected back through this login flow.',
		'게이트웨이가 처리할 전체 콜백 URI입니다. 인증되지 않은 페이지 요청은 이 로그인 흐름으로 리디렉션됩니다.'
	],
	[
		'Additional OAuth2 scopes to request. `openid` is always included.',
		'추가로 요청할 OAuth2 권한 범위입니다. openid는 항상 포함됩니다.'
	],
	[
		'Controls whether requests must include a JWT and how validation failures are handled.',
		'요청에 JWT를 필수로 요구할지와 검증 실패 시 처리 방식을 설정합니다.'
	],
	[
		'JSON Web Key Set used to verify token signatures. Can be inline, from a file, or fetched remotely.',
		'토큰 서명을 검증할 JSON 웹 키 집합입니다. 직접 입력하거나 파일 또는 원격 주소에서 불러올 수 있습니다.'
	],
	[
		'Expected token issuer. The JWT `iss` claim is required and must match.',
		'허용할 토큰 발급자입니다. JWT의 iss 클레임이 반드시 존재하고 이 값과 일치해야 합니다.'
	],
	[
		'Accepted token audiences. A non-empty list requires a matching JWT `aud` claim.',
		'허용할 토큰 대상 서비스입니다. 값을 입력하면 JWT의 aud 클레임 중 하나와 일치해야 합니다.'
	],
	[
		'Claims that must be present in the token before validation. Only "exp", "nbf", "aud", "iss", "sub" are enforced; others (including "iat" and "jti") are ignored. Defaults to ["exp"]. Use an empty list to add no claim requirements beyond those implied by the configured issuer and audiences.',
		'검증 전에 토큰에 반드시 있어야 할 클레임입니다. exp, nbf, aud, iss, sub만 검사하며 iat와 jti를 포함한 나머지는 무시합니다. 기본값은 exp이며, 비워 두면 발급자와 대상 서비스 설정에서 요구되는 항목 외에는 추가로 검사하지 않습니다.'
	],
	[
		'Request origins that receive CORS response headers. Use `*` to match any origin.',
		'CORS 응답 헤더를 받을 요청 출처입니다. 모든 출처를 허용하려면 *를 사용합니다.'
	],
	[
		'Values to return in `Access-Control-Allow-Methods` for allowed preflight requests.',
		'허용된 사전 요청의 Access-Control-Allow-Methods 헤더에 반환할 값입니다.'
	],
	[
		'Values to return in `Access-Control-Allow-Headers` for allowed preflight requests.',
		'허용된 사전 요청의 Access-Control-Allow-Headers 헤더에 반환할 값입니다.'
	],
	[
		'Values to return in `Access-Control-Expose-Headers` for allowed CORS responses.',
		'허용된 CORS 응답에서 브라우저에 공개할 헤더입니다.'
	],
	[
		'`Access-Control-Allow-Credentials: true` on allowed CORS responses.',
		'허용된 CORS 응답에 Access-Control-Allow-Credentials: true를 추가합니다.'
	],
	[
		'Value to return in `Access-Control-Max-Age` for allowed preflight requests.',
		'허용된 사전 요청의 Access-Control-Max-Age 헤더에 반환할 값입니다.'
	],
	['Editor content', '편집기 내용'],
	['key', '키'],
	['value', '값'],
	['current origin', '현재 출처'],
	[
		'Options for sending the request body to the authorization service.',
		'인가 서비스에 요청 본문을 전달하는 옵션입니다.'
	],
	[
		'Static context values to send to the authorization service. Maps to the `context_extensions` field in the request.',
		'인가 서비스에 전달할 고정 컨텍스트 값입니다. 요청의 context_extensions 필드에 대응합니다.'
	],
	[
		'Metadata values to send to the authorization service, computed from CEL expressions. Maps to the `metadata_context.filter_metadata` field in the request. If unset, `envoy.filters.http.jwt_authn` is set when JWT auth is also used, for compatibility.',
		'CEL 표현식으로 계산해 인가 서비스에 전달할 메타데이터입니다. 요청의 metadata_context.filter_metadata 필드에 대응합니다.'
	],
	[
		'Each CEL expression is saved under allow, deny, or require.',
		'각 CEL 표현식은 허용, 차단 또는 필수 규칙으로 저장됩니다.'
	],
	['No authorization rules', '설정된 접근 제어 규칙이 없습니다'],
	[
		'Add a CEL expression to start authorizing requests.',
		'요청 접근을 제어할 CEL 표현식을 추가하세요.'
	],
	['Allow all request headers', '모든 요청 헤더 허용'],
	[
		'Accept any request header in browser preflight checks',
		'브라우저 사전 요청에서 모든 요청 헤더를 허용합니다'
	],
	['Header allowlist', '허용할 헤더 목록'],
	['Allow credentials', '인증 정보 허용'],
	[
		'Permit browser credentials on CORS requests',
		'CORS 요청에 브라우저 인증 정보를 포함하도록 허용합니다'
	],
	['Limit type', '제한 기준'],
	['LIMIT TYPE', '제한 기준'],
	[
		'Whether this limit counts requests or LLM tokens.',
		'요청 횟수와 LLM 토큰 수 중 어떤 값을 기준으로 제한할지 선택합니다.'
	],
	['Requests', '요청 수'],
	['Limit by request count.', '요청 횟수를 기준으로 제한합니다.'],
	['Limit by token count.', '토큰 수를 기준으로 제한합니다.'],
	['Fill interval', '충전 주기'],
	['FILL INTERVAL', '충전 주기'],
	['How often the local bucket is refilled.', '로컬 한도 버킷을 다시 채우는 주기입니다.'],
	['Max tokens', '최대 토큰 수'],
	['MAX TOKENS', '최대 토큰 수'],
	[
		'Maximum number of tokens that can accumulate in the local bucket.',
		'로컬 버킷에 누적할 수 있는 최대 토큰 수입니다.'
	],
	['Tokens per fill', '주기당 충전 토큰'],
	['TOKENS PER FILL', '주기당 충전 토큰'],
	[
		'Number of tokens added to the local bucket each fill interval.',
		'충전 주기마다 로컬 버킷에 추가할 토큰 수입니다.'
	],
	['Service', '서비스'],
	[
		'Remote rate limit service and domain used when building descriptor checks.',
		'요청 한도 조건을 검사할 외부 서비스와 도메인을 설정합니다.'
	],
	['Domain', '도메인'],
	['DOMAIN', '도메인'],
	[
		'Rate limit domain sent to the remote rate limit service.',
		'외부 요청 제한 서비스에 전달할 도메인입니다.'
	],
	[
		'Behavior when the remote rate limit service is unavailable or returns an error. Defaults to failClosed, denying requests with a 500 status on service failure.',
		'외부 요청 제한 서비스를 사용할 수 없거나 오류가 발생할 때의 처리 방식입니다. 기본값은 차단이며 서비스 오류 시 500 상태로 요청을 거부합니다.'
	],
	[
		'Deny requests when the rate limit service is unavailable.',
		'요청 제한 서비스를 사용할 수 없으면 요청을 차단합니다.'
	],
	[
		'Allow requests when the rate limit service is unavailable.',
		'요청 제한 서비스를 사용할 수 없어도 요청을 허용합니다.'
	],
	['Descriptors', '한도 조건'],
	[
		'Descriptor entries sent to the remote service. Values are CEL expressions evaluated from the request.',
		'외부 서비스에 전달할 한도 조건입니다. 값은 요청을 기준으로 계산하는 CEL 표현식입니다.'
	],
	[
		'Whether this descriptor limits requests or LLM tokens.',
		'이 한도 조건이 요청 횟수와 LLM 토큰 수 중 무엇을 제한할지 선택합니다.'
	],
	[
		'Descriptor key/value entries. Values are CEL expressions evaluated from the request.',
		'한도 조건의 키와 값입니다. 값은 요청을 기준으로 계산하는 CEL 표현식입니다.'
	],
	[
		'cost determines the optional expression to determine the cost of the request. If unset, type `requests` defaults to `1`, and type `tokens` defaults to `llm.totalTokens`. If the expression fails to evaluate, the descriptor is skipped. Costs for type `requests` are evaluated during request processing. Costs for type `tokens` are evaluated upon request completion.',
		'요청 비용을 계산할 선택 CEL 표현식입니다. 비워 두면 요청 횟수는 1, 토큰 수는 llm.totalTokens를 사용합니다. 표현식을 계산할 수 없으면 해당 조건을 건너뜁니다. 요청 비용은 처리 중에, 토큰 비용은 요청 완료 시 계산합니다.'
	],
	[
		'limitOverride determines the optional expression to determine the limit of the request. This tells the remote server what limit to apply to the request. Note: this does not specify the *cost* of the request, which is done by the `cost` field. The expression must evaluate to a map with `unit` and `requestsPerUnit` keys. For example: `{"unit":"second","requestsPerUnit":100}`. Valid units: second, minute, hour, day, month, year If the expression fails to evaluate, the descriptor is skipped.',
		'요청에 적용할 한도를 계산하는 선택 CEL 표현식입니다. 요청 비용은 별도의 비용 필드에서 설정합니다. 결과는 unit과 requestsPerUnit 키가 있는 맵이어야 하며 사용 가능한 단위는 초, 분, 시간, 일, 월, 년입니다. 표현식을 계산할 수 없으면 해당 조건을 건너뜁니다.'
	],
	['Entries', '조건 항목'],
	['ENTRIES', '조건 항목'],
	['Cost expression', '비용 표현식'],
	['COST EXPRESSION', '비용 표현식'],
	['Limit override', '한도 재정의'],
	['LIMIT OVERRIDE', '한도 재정의'],
	['Request transformations', '요청 변환'],
	['No request transformations configured.', '설정된 요청 변환이 없습니다.'],
	['Response transformations', '응답 변환'],
	['No response transformations configured.', '설정된 응답 변환이 없습니다.'],
	['Processing behavior', '처리 방식'],
	[
		'Choose failure behavior and which request/response phases are sent.',
		'오류 발생 시 동작과 외부 처리기로 전달할 요청·응답 단계를 선택합니다.'
	],
	[
		'Behavior when the external processing service is unavailable or returns an error.',
		'외부 처리 서비스를 사용할 수 없거나 오류가 발생할 때의 처리 방식입니다.'
	],
	[
		'How request bodies are sent to the external processing service.',
		'요청 본문을 외부 처리 서비스에 전달하는 방식을 선택합니다.'
	],
	[
		'How response bodies are sent to the external processing service.',
		'응답 본문을 외부 처리 서비스에 전달하는 방식을 선택합니다.'
	],
	[
		'Whether request headers are sent to the external processing service.',
		'요청 헤더를 외부 처리 서비스에 전달할지 설정합니다.'
	],
	[
		'Whether response headers are sent to the external processing service.',
		'응답 헤더를 외부 처리 서비스에 전달할지 설정합니다.'
	],
	[
		'Whether request trailers are sent to the external processing service.',
		'요청 트레일러를 외부 처리 서비스에 전달할지 설정합니다.'
	],
	[
		'Whether response trailers are sent to the external processing service.',
		'응답 트레일러를 외부 처리 서비스에 전달할지 설정합니다.'
	],
	['Request trailers', '요청 트레일러'],
	['REQUEST TRAILERS', '요청 트레일러'],
	['Response trailers', '응답 트레일러'],
	['RESPONSE TRAILERS', '응답 트레일러'],
	['Allow mode override', '처리 모드 변경 허용'],
	[
		'Whether the external processing service can change processing modes during a request.',
		'외부 처리 서비스가 요청 처리 중 처리 모드를 변경하도록 허용합니다.'
	],
	['Attributes', '속성'],
	[
		'CEL expressions sent as attributes to the processor.',
		'처리기에 속성으로 전달할 CEL 표현식입니다.'
	],
	['Request attributes', '요청 속성'],
	['REQUEST ATTRIBUTES', '요청 속성'],
	[
		'Maps to the request `attributes` field in ProcessingRequest, and allows dynamic CEL expressions.',
		'ProcessingRequest의 요청 속성 필드에 반영되며 동적 CEL 표현식을 사용할 수 있습니다.'
	],
	['Response attributes', '응답 속성'],
	['RESPONSE ATTRIBUTES', '응답 속성'],
	[
		'Maps to the response `attributes` field in ProcessingRequest, and allows dynamic CEL expressions.',
		'ProcessingRequest의 응답 속성 필드에 반영되며 동적 CEL 표현식을 사용할 수 있습니다.'
	],
	['Metadata context YAML', '메타데이터 컨텍스트 YAML'],
	['METADATA CONTEXT YAML', '메타데이터 컨텍스트 YAML'],
	[
		'Additional metadata to send to the external processing service. Maps to the `metadata_context.filter_metadata` field in ProcessingRequest, and allows dynamic CEL expressions.',
		'외부 처리 서비스에 추가로 전달할 메타데이터입니다. ProcessingRequest의 metadata_context.filter_metadata 필드에 반영되며 동적 CEL 표현식을 사용할 수 있습니다.'
	],
	[
		'Control whether MCP requests must present a valid JWT.',
		'MCP 요청에 유효한 JWT가 반드시 필요한지 설정합니다.'
	],
	[
		'Controls whether MCP requests must include a valid JWT.',
		'MCP 요청에 유효한 JWT가 반드시 필요한지 설정합니다.'
	],
	[
		'JSON Web Key Set used to verify token signatures. Can be inline, from a file, or fetched remotely. If omitted, the JWKS URL is derived from the issuer and provider.',
		'토큰 서명을 검증할 JSON 웹 키 집합입니다. 직접 입력하거나 파일 또는 원격 주소에서 불러올 수 있습니다. 비워 두면 발급자와 공급자 정보에서 JWKS URL을 가져옵니다.'
	],
	[
		'Expected token issuer, matched against the JWT `iss` claim.',
		'JWT의 iss 클레임과 비교할 토큰 발급자입니다.'
	],
	[
		'Accepted token audiences, matched against the JWT `aud` claim. If unset, audience validation is disabled.',
		'JWT의 aud 클레임과 비교할 허용 대상 서비스입니다. 비워 두면 대상 서비스 검증을 사용하지 않습니다.'
	],
	[
		'OAuth client ID advertised to MCP clients when needed.',
		'필요할 때 MCP 클라이언트에 안내할 OAuth 클라이언트 ID입니다.'
	],
	['optional OAuth client ID', '선택 OAuth 클라이언트 ID'],
	[
		'Protected resource metadata returned to MCP clients.',
		'MCP 클라이언트에 반환할 보호 리소스 메타데이터입니다.'
	],
	[
		'A valid token, issued by a configured issuer, must be present. This is the default option.',
		'설정된 발급자가 발행한 유효한 토큰이 반드시 필요합니다. 기본 설정입니다.'
	],
	[
		'If a token exists, validate it. Warning: this allows requests without a JWT token! Additionally, 401 errors will not be returned, which will not trigger clients to initiate an oauth flow.',
		'토큰이 있으면 검증합니다. JWT가 없는 요청도 허용되며 401 오류를 반환하지 않습니다.'
	],
	[
		'Requests are never rejected. This is useful for usage of claims in later steps (authorization, logging, etc). Warning: this allows requests without a JWT token! Additionally, 401 errors will not be returned, which will not trigger clients to initiate an oauth flow.',
		'요청을 차단하지 않고 클레임을 접근 제어·로그 등에 활용합니다. JWT가 없는 요청도 허용되며 401 오류를 반환하지 않습니다.'
	],
	[
		'Restrict accepted MCP tokens by issuer and audience.',
		'발급자와 대상 서비스를 기준으로 허용할 MCP 토큰을 제한합니다.'
	],
	['Protected resource metadata', '보호 리소스 메타데이터'],
	[
		'Metadata advertised to MCP clients for OAuth protected resources.',
		'OAuth 보호 리소스 정보를 MCP 클라이언트에 제공합니다.'
	],
	['Resource metadata YAML', '리소스 메타데이터 YAML'],
	['RESOURCE METADATA YAML', '리소스 메타데이터 YAML'],
	[
		'Processors run in order; the first rejection stops the request.',
		'처리기는 순서대로 실행되며 하나라도 차단하면 요청 처리가 중단됩니다.'
	],
	['No MCP guardrail processors', '설정된 MCP 가드레일 처리기가 없습니다'],
	[
		'Add a remote policy processor to inspect MCP requests and responses.',
		'MCP 요청과 응답을 검사할 외부 정책 처리기를 추가하세요.'
	],
	['Method phases', '메서드 처리 단계'],
	['No MCP methods configured.', '설정된 MCP 메서드가 없습니다.'],
	['Phase', '처리 단계'],
	['No host configured', '설정된 호스트 없음'],
	['header', '헤더'],
	['query', '쿼리'],
	['backend', '백엔드'],
	['target', '대상'],
	['rule', '규칙'],
	['processor', '처리기'],
	['entry', '항목'],
	['descriptor', '한도 조건'],
	['descriptor entry', '조건 항목'],
	['response guard', '응답 가드레일'],
	['request guard', '요청 가드레일'],
	['pattern', '패턴'],

	// Nested editors, selectors, and assistive labels
	['Add request headers', '요청 헤더 추가'],
	['Backend target type', '백엔드 대상 유형'],
	['Body expression', '본문 표현식'],
	[
		'CEL expression used to populate the agentgateway.user request log attribute.',
		'agentgateway.user 요청 로그 속성에 값을 채울 CEL 표현식입니다.'
	],
	[
		'CEL expression used to populate the agentgateway.group request log attribute.',
		'agentgateway.group 요청 로그 속성에 값을 채울 CEL 표현식입니다.'
	],
	['Invalid authorization policy', '접근 제어 정책이 올바르지 않습니다'],
	['Invalid JWT policy', 'JWT 정책이 올바르지 않습니다'],
	['Invalid MCP authentication policy', 'MCP 인증 정책이 올바르지 않습니다'],
	['Invalid MCP guardrails policy', 'MCP 가드레일 정책이 올바르지 않습니다'],
	['Invalid OIDC policy', 'OIDC 정책이 올바르지 않습니다'],
	[
		'Leave empty to use default 5xx and connection failure handling.',
		'비워 두면 기본 5xx 및 연결 실패 처리 방식을 사용합니다.'
	],
	[
		'Optional. Defaults to http://localhost:11434/v1.',
		'선택 항목입니다. 기본값은 http://localhost:11434/v1입니다.'
	],
	[
		'Optional. If unset, Vertex uses global.',
		'선택 항목입니다. 비워 두면 Vertex가 global 리전을 사용합니다.'
	],
	[
		'Optional. Leave unset to use the gateway default.',
		'선택 항목입니다. 비워 두면 게이트웨이 기본값을 사용합니다.'
	],
	[
		'Override where the validated credential is sent.',
		'검증된 인증 정보를 전달할 위치를 직접 지정합니다.'
	],
	['Platform team', '플랫폼 팀'],
	['AWS access key ID', 'AWS 액세스 키 ID'],
	['AWS secret access key', 'AWS 보안 액세스 키'],
	['Session token (optional)', '세션 토큰(선택)'],
	['Client ID (optional)', '클라이언트 ID(선택)'],
	[
		'Use ambient AWS credentials or static access keys for Bedrock signing.',
		'Bedrock 서명에 실행 환경의 AWS 인증 정보 또는 고정 액세스 키를 사용합니다.'
	],
	[
		'Use Application Default Credentials or a service account JSON file for Vertex.',
		'Vertex에 애플리케이션 기본 인증 정보 또는 서비스 계정 JSON 파일을 사용합니다.'
	],
	[
		'Use Azure default credentials, managed identity, or an Azure API key.',
		'Azure 기본 인증 정보, 관리 ID 또는 Azure API 키를 사용합니다.'
	],
	[
		'Mantle supports native Anthropic and OpenAI APIs, including supported server-side tools and background requests. It requires Mantle-specific AWS permissions. Choose Runtime for existing Bedrock deployments, Bedrock Guardrails, cross-region inference, or Claude structured outputs. Prefer modes automatically select the other endpoint for models the catalog lists as available only there; unknown models use your preference. Only modes force the selected endpoint for chat, so unsupported models fail. Neither mode retries failed requests on the other endpoint. Embeddings and reranking are unaffected.',
		'Mantle은 지원되는 서버 도구와 백그라운드 요청을 포함한 Anthropic 및 OpenAI 네이티브 API를 지원하며 전용 AWS 권한이 필요합니다. 기존 Bedrock 배포, Bedrock 가드레일, 교차 리전 추론 또는 Claude 구조화 출력에는 Runtime을 사용하세요. 선호 모드는 카탈로그 기준으로 필요한 엔드포인트를 자동 선택하고, 전용 모드는 선택한 엔드포인트만 사용합니다. 임베딩과 재정렬에는 영향을 주지 않습니다.'
	],
	['Edit bind', '바인드 수정'],
	['Delete bind', '바인드 삭제'],
	['Remove descriptor', '한도 조건 삭제'],
	['Remove descriptor entry', '조건 항목 삭제'],
	['Claude subscription key detected', 'Claude 구독 키가 감지되었습니다'],
	['200 OK', '200 정상'],
	['400 Bad request', '400 잘못된 요청'],
	['401 Unauthorized', '401 인증 필요'],
	['403 Forbidden', '403 접근 거부'],
	['404 Not found', '404 찾을 수 없음'],
	['429 Rate limited', '429 요청 한도 초과'],
	['500 Server error', '500 서버 오류'],
	['Always', '항상'],
	['Never', '사용 안 함'],
	['Off', '끔'],
	['Audit only', '기록만 남김'],
	['Dynamic', '자동 결정'],
	['Block requests', '요청 차단'],
	['Continue serving', '계속 제공'],
	['Return 429', '429 응답 반환'],
	['Raw YAML', '원본 YAML'],
	['Generated', '자동 생성'],
	['Base catalog', '기본 카탈로그'],
	['Custom overrides', '사용자 지정 재정의'],
	['Selected models', '선택한 모델'],
	['Reported total', '보고된 합계'],
	['Use custom key', '사용자 지정 키 사용'],
	['User agent', '사용자 에이전트'],
	['Backend auth', '백엔드 인증'],
	['Audio', '오디오'],
	['Routing', '라우팅'],
	['Reasoning', '추론'],
	['Security', '보안'],
	['Shaping', '형식 조정'],
	['Buffered', '전체 버퍼링'],
	['Buffered partial', '부분 버퍼링'],
	['Passthrough', '그대로 전달'],
	['Full', '전체'],
	['Inline', '직접 입력'],
	['Dedicated port', '전용 포트'],
	['Bind this surface on its own listener port.', '이 기능을 별도의 리스너 포트에 연결합니다.'],
	[
		'Create the traffic configuration section so HTTP gateways, routes, backends, and policies can be configured.',
		'HTTP 게이트웨이, 라우트, 백엔드와 정책을 설정할 수 있도록 트래픽 설정을 생성합니다.'
	],
	['Client secret basic', '클라이언트 보안 키(Basic)'],
	['Client secret post', '클라이언트 보안 키(POST)'],
	[
		'Allow traffic when the processor is unavailable.',
		'처리기를 사용할 수 없어도 트래픽을 허용합니다.'
	],
	['Reject when the processor is unavailable.', '처리기를 사용할 수 없으면 요청을 차단합니다.'],
	[
		'Buffer the full body before sending it to the processor.',
		'전체 본문을 버퍼링한 뒤 처리기로 전송합니다.'
	],
	[
		'Send a bounded body buffer and allow truncation.',
		'제한된 크기의 본문 버퍼를 전송하며 일부가 잘릴 수 있습니다.'
	],
	[
		'Stream the full body through the external processor.',
		'전체 본문을 외부 처리기로 스트리밍합니다.'
	],
	['Do not send the body to the processor.', '본문을 처리기로 보내지 않습니다.'],
	['Send this phase to the external processor.', '이 처리 단계를 외부 처리기로 전송합니다.'],
	[
		'Do not send this phase to the external processor.',
		'이 처리 단계는 외부 처리기로 보내지 않습니다.'
	],
	[
		'Evaluate request-count descriptors while processing the request.',
		'요청 처리 중 요청 횟수 기준의 한도 조건을 계산합니다.'
	],
	[
		'Evaluate token descriptors after the LLM response completes.',
		'LLM 응답이 끝난 뒤 토큰 기준의 한도 조건을 계산합니다.'
	],
	[
		'Always prefix exposed tool names with the target name.',
		'공개되는 도구 이름 앞에 항상 대상 이름을 붙입니다.'
	],
	[
		'Never prefix; calls are routed by tool name, which must be unique across targets.',
		'접두사를 붙이지 않습니다. 대상 전체에서 도구 이름이 고유해야 합니다.'
	],
	[
		'Prefix only when needed to avoid tool-name conflicts.',
		'도구 이름 충돌을 피해야 할 때만 접두사를 붙입니다.'
	],
	[
		'Preserve MCP sessions so targets can keep per-session context.',
		'대상이 세션별 컨텍스트를 유지할 수 있도록 MCP 세션을 보존합니다.'
	],
	[
		'Do not preserve MCP session state between requests.',
		'요청 사이에 MCP 세션 상태를 유지하지 않습니다.'
	],
	['Run before forwarding the MCP request.', 'MCP 요청을 전달하기 전에 실행합니다.'],
	['Run after the MCP response is available.', 'MCP 응답을 받은 뒤 실행합니다.'],
	['Run with request and response context.', '요청과 응답 컨텍스트를 모두 사용해 실행합니다.'],
	[
		'Do not run this processor for matching methods.',
		'일치하는 메서드에는 이 처리기를 실행하지 않습니다.'
	],
	['Permit matching requests.', '조건에 일치하는 요청을 허용합니다.'],
	['Reject matching requests.', '조건에 일치하는 요청을 차단합니다.'],
	['Require this expression to be true.', '이 표현식이 참이어야 요청을 허용합니다.'],
	['Forward the validated incoming JWT to the backend.', '검증된 JWT를 백엔드로 전달합니다.'],
	['Last 1 hour', '최근 1시간'],
	['Last 12 hours', '최근 12시간'],
	['Last 7 days', '최근 7일'],
	['Last 14 days', '최근 14일'],
	['Last 30 days', '최근 30일'],
	['Initializing MCP tools', 'MCP 도구 초기화 중'],
	['Preparing request', '요청 준비 중'],
	['Sending chat completion', '채팅 요청 전송 중'],
	['Sending tool results', '도구 결과 전송 중'],
	['Waiting for model response', '모델 응답 대기 중'],
	['Waiting for final response', '최종 응답 대기 중'],
	['agw_sk_***** (auto generate)', 'agw_sk_***** (자동 생성)'],
	['Evaluation failed', '표현식 실행에 실패했습니다'],
	['Invalid YAML', 'YAML 형식이 올바르지 않습니다'],
	['Failed to refresh base cost catalog', '기본 가격 카탈로그를 갱신하지 못했습니다'],
	['Failed to load logs', '로그를 불러오지 못했습니다'],
	['Log stream failed', '로그 스트림 연결에 실패했습니다'],
	['Failed to load log detail', '로그 상세 내용을 불러오지 못했습니다'],
	['Failed to load analytics', '분석 데이터를 불러오지 못했습니다'],
	['MCP initialize failed', 'MCP 초기화에 실패했습니다'],
	['MCP tools/call failed', 'MCP 도구 호출에 실패했습니다'],
	['Fix the highlighted fields before saving.', '강조 표시된 항목을 수정한 뒤 저장해 주세요.'],
	['Invalid server configuration', '서버 설정이 올바르지 않습니다'],
	['Request failed', '요청에 실패했습니다'],
	['Backend auth cannot be empty.', '백엔드 인증 설정을 입력해 주세요.'],
	['Invalid configuration YAML.', '설정 YAML 형식이 올바르지 않습니다.'],
	['Port must be between 1 and 65535.', '포트는 1에서 65535 사이여야 합니다.'],
	['Enter a route name.', '라우트 이름을 입력해 주세요.'],
	['Select a gateway.', '게이트웨이를 선택해 주세요.'],
	['Select a listener.', '리스너를 선택해 주세요.'],
	[
		'Edit the policy YAML directly, with schema autocompletion — for methods without a structured editor yet: key, AWS, GCP, Azure, Copilot, OAuth, cross-app access.',
		'아직 구조화 편집기를 지원하지 않는 인증 방식은 스키마 자동 완성이 제공되는 YAML에서 직접 편집합니다: 키, AWS, GCP, Azure, Copilot, OAuth, 앱 간 접근.'
	],
	[
		'Expose tool names without adding the target name.',
		'대상 이름을 붙이지 않고 도구 이름을 공개합니다.'
	],
	['Mantle only (advanced)', 'Mantle만 사용(고급)'],
	['Runtime only (advanced)', 'Runtime만 사용(고급)'],
	['Prefer Mantle', 'Mantle 우선'],
	['Prefer Runtime', 'Runtime 우선'],
	['masked', '마스킹됨'],
	['redacted', '숨김 처리됨'],
	['raw', '원본'],
	['Uncached', '캐시 미사용'],
	['Require', '필수'],
	['Skip', '건너뛰기'],
	[
		'name is the name of the model we are matching from a users request. If params.model is set, that will be used in the request to the LLM provider. If not, the incoming model is used.',
		'사용자 요청에서 일치시킬 모델 이름입니다. params.model을 설정하면 프로바이더 요청에 해당 모델을 사용하고, 비워 두면 들어온 모델 이름을 그대로 사용합니다.'
	],
	['provider of the LLM we are connecting too', '연결할 LLM 프로바이더입니다.'],
	['name is the public model name clients request.', '클라이언트가 요청할 공개 모델 이름입니다.'],
	[
		'routing selects an existing LLM model backend for each request.',
		'요청마다 사용할 기존 LLM 모델 백엔드를 선택하는 라우팅 방식입니다.'
	],
	[
		'targets are existing model names or names matched by wildcard model entries.',
		'대상에는 기존 모델 이름이나 와일드카드 모델 조건에 일치하는 이름을 사용할 수 있습니다.'
	],
	[
		'name is referenced from llm.models[].provider.reference.',
		'llm.models[].provider.reference에서 참조할 프로바이더 이름입니다.'
	],
	[
		'An API key to attach to the request. If unset this will be automatically detected from the environment.',
		'요청에 첨부할 API 키입니다. 비워 두면 실행 환경에서 자동으로 감지합니다.'
	],
	[
		'Name identifying this MCP target, used to prefix tool and resource names when multiplexing.',
		'MCP 대상을 식별하는 이름입니다. 여러 대상을 함께 제공할 때 도구와 리소스 이름의 접두사로 사용됩니다.'
	],
	['URL of the MCP server endpoint.', 'MCP 서버 엔드포인트 URL입니다.'],
	[
		'Whether to keep a persistent session across requests (Stateful) or create one per request (Stateless).',
		'요청 사이에 세션을 유지할지, 요청마다 새 세션을 만들지 선택합니다.'
	],
	[
		'How to namespace tool names when multiplexing: `always` prefix with the target name, or only prefix when needed (`conditional`).',
		'여러 MCP 대상을 함께 제공할 때 도구 이름에 대상 접두사를 항상 붙일지, 충돌할 때만 붙일지 선택합니다.'
	],
	[
		'Behavior when one or more MCP targets fail to initialize or fail during fanout. Defaults to `failClosed`.',
		'하나 이상의 MCP 대상 초기화나 동시 호출이 실패했을 때의 처리 방식입니다. 기본값은 실패 시 차단입니다.'
	],
	['Stateful', '상태 유지'],
	['Stateless', '상태 비유지'],
	['port is the port to listen on for this gateway.', '게이트웨이가 요청을 수신할 포트입니다.'],
	[
		'protocol controls whether this gateway accepts HTTP/HTTPS routes or TCP/TLS routes. When omitted, gateways default to HTTP, or HTTPS when tls is set.',
		'게이트웨이가 HTTP/HTTPS 라우트와 TCP/TLS 라우트 중 무엇을 받을지 설정합니다. 비워 두면 기본값은 HTTP이며 TLS를 설정한 경우 HTTPS를 사용합니다.'
	],
	['Route kind', '라우트 유형'],
	['Name identifying this route.', '라우트를 식별하는 이름입니다.'],
	['Can be a wildcard', '와일드카드를 사용할 수 있습니다.'],
	[
		'Path match rule (exact, prefix, or regex). Defaults to a "/" prefix match.',
		'경로 일치 방식입니다. 정확히 일치, 접두사 또는 정규식을 사용할 수 있으며 기본값은 / 접두사 일치입니다.'
	],
	['HTTP method that must match for this route to apply.', '이 라우트를 적용할 HTTP 메서드입니다.'],
	[
		'Port to bind on. Omit it for an internal wildcard bind (which serves any destination port via in-process routing). A numeric port is required unless `mode` is `internal`.',
		'바인드할 포트입니다. 프로세스 내부 라우팅으로 모든 목적지 포트를 처리하는 내부 와일드카드 바인드에는 생략할 수 있습니다. internal 모드가 아니면 숫자 포트가 필요합니다.'
	],

	// Account and authentication
	['Signed in', '로그인됨'],
	['Signed in as', '현재 로그인'],
	['Sign out', '로그아웃'],
	['Your account', '내 계정'],
	['Account', '계정'],
	['Login', '로그인'],
	['Sign in', '로그인']
]);

const dynamicTranslations: Array<[RegExp, (...matches: string[]) => string]> = [
	[/^(\d+) gateways?$/, count => `게이트웨이 ${count}개`],
	[/^(\d+) routes?$/, count => `라우트 ${count}개`],
	[/^(\d+) listeners?$/, count => `리스너 ${count}개`],
	[/^(\d+) binds?$/, count => `바인드 ${count}개`],
	[/^(\d+) models?$/, count => `모델 ${count}개`],
	[/^(\d+) virtual models?$/, count => `가상 모델 ${count}개`],
	[/^(\d+) shared providers?$/, count => `공용 프로바이더 ${count}개`],
	[/^(\d+) configured servers?$/, count => `설정된 서버 ${count}개`],
	[/^Include MCP tools \((\d+) servers?\)$/, count => `MCP 도구 포함 (서버 ${count}개)`],
	[/^(\d+) warnings?$/, count => `경고 ${count}건`],
	[/^(\d+) policies?$/, count => `정책 ${count}개`],
	[/^(\d+) rules?$/, count => `규칙 ${count}개`],
	[/^(\d+) processors?$/, count => `처리기 ${count}개`],
	[/^(\d+) entries?$/, count => `항목 ${count}개`],
	[/^Descriptor (\d+)$/, count => `한도 조건 ${count}`],
	[/^Descriptor (\d+) type$/, count => `한도 조건 ${count} 유형`],
	[/^Processor (\d+)$/, count => `처리기 ${count}`],
	[/^, (\d+) policies$/, count => `, 정책 ${count}개`],
	[/^(.+), (\d+) policies$/, (summary, count) => `${translateUiText(summary)}, 정책 ${count}개`],
	[
		/^(.+) \/ (\d+) tokens \/ (\d+) calls$/,
		(cost, tokens, calls) => `${cost} / 토큰 ${tokens}개 / 호출 ${calls}회`
	],
	[/^Port (\d+)$/, port => `포트 ${port}`],
	[/^Gateway (.+)$/, name => `게이트웨이 ${name}`],
	[/^Account: (.+)$/, name => `계정: ${name}`],
	[/^Enable (.+)$/, name => `${translateUiText(name)} 사용`],
	[/^Add (.+)$/, name => `${translateUiText(name)} 추가`],
	[/^Edit (.+)$/, name => `${translateUiText(name)} 수정`],
	[/^Delete (.+)$/, name => `${translateUiText(name)} 삭제`],
	[/^Remove (.+)$/, name => `${translateUiText(name)} 제거`],
	[/^Loading (.+)$/, name => `${translateUiText(name)} 불러오는 중`]
];

const translatableAttributes = ['aria-label', 'aria-description', 'placeholder', 'title', 'alt'];
const ignoredTextParents = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA']);

export function translateUiText(value: string): string {
	const match = value.match(/^(\s*)(.*?)(\s*)$/s);
	if (!match) return value;
	const [, before, text, after] = match;
	if (!text || !/[A-Za-z]/.test(text)) return value;
	const exact = exactTranslations.get(text) ?? exactTranslations.get(text.replace(/\s+/g, ' '));
	if (exact) return `${before}${exact}${after}`;
	for (const [pattern, replacement] of dynamicTranslations) {
		const result = text.match(pattern);
		if (result) return `${before}${replacement(...result.slice(1))}${after}`;
	}
	return value;
}

function translateTextNode(node: Text) {
	if (node.parentElement && ignoredTextParents.has(node.parentElement.tagName)) return;
	const translated = translateUiText(node.data);
	if (translated !== node.data) node.data = translated;
}

function translateElement(element: Element) {
	for (const attribute of translatableAttributes) {
		const value = element.getAttribute(attribute);
		if (!value) continue;
		const translated = translateUiText(value);
		if (translated !== value) element.setAttribute(attribute, translated);
	}
	for (const child of element.childNodes) {
		if (child.nodeType === Node.TEXT_NODE) translateTextNode(child as Text);
		else if (child.nodeType === Node.ELEMENT_NODE) translateElement(child as Element);
	}
}

export function installKoreanUi() {
	if (import.meta.env.MODE === 'e2e') return;
	document.documentElement.lang = 'ko';
	const root = document.getElementById('root');
	if (!root) return;
	translateElement(root);
	const observer = new MutationObserver(records => {
		for (const record of records) {
			if (record.type === 'characterData') {
				translateTextNode(record.target as Text);
				continue;
			}
			if (record.type === 'attributes') {
				translateElement(record.target as Element);
				continue;
			}
			for (const node of record.addedNodes) {
				if (node.nodeType === Node.TEXT_NODE) translateTextNode(node as Text);
				else if (node.nodeType === Node.ELEMENT_NODE) translateElement(node as Element);
			}
		}
	});
	observer.observe(root, {
		subtree: true,
		childList: true,
		characterData: true,
		attributes: true,
		attributeFilter: translatableAttributes
	});
}
