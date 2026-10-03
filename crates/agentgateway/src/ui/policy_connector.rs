use axum::{Json, http::StatusCode};
use serde_json::{Value, json};
use std::process::Stdio;
use tokio::io::AsyncWriteExt;

type ApiError = (StatusCode, Json<Value>);
fn error(status: StatusCode, message: impl ToString) -> ApiError {
	(status, Json(json!({"error": message.to_string()})))
}
fn bundle() -> Value {
	serde_json::from_str(include_str!("policy_assets/bundle.json")).expect("bundled policy catalog")
}

pub(super) async fn list_packs() -> Json<Value> {
	let data = bundle();
	let packs: Vec<Value> = data["catalog"]
		.as_array()
		.unwrap()
		.iter()
		.map(|entry| {
			json!({
					"id":entry["id"],"label":entry["label"],"description":entry["description"],
					"card_count":entry["document"]["cards"].as_array().unwrap().len()
			})
		})
		.collect();
	Json(
		json!({"packs":packs,"dictionary_versions":{"mapping":data["mapping"]["version"],"functions":data["functions"]["version"]}}),
	)
}

pub(super) async fn compile(Json(request): Json<Value>) -> Result<Json<Value>, ApiError> {
	let data = bundle();
	let ids = request
		.get("pack_ids")
		.and_then(Value::as_array)
		.ok_or_else(|| error(StatusCode::BAD_REQUEST, "pack_ids 목록이 필요합니다."))?;
	let mut documents = Vec::<Value>::new();
	let mut contexts = Vec::<Value>::new();
	let mut seen = std::collections::HashSet::new();
	for id in ids {
		let id = id
			.as_str()
			.ok_or_else(|| error(StatusCode::BAD_REQUEST, "팩 ID는 문자열이어야 합니다."))?;
		if !seen.insert(id) {
			return Err(error(StatusCode::BAD_REQUEST, "중복 팩 선택입니다."));
		}
		let entry = data["catalog"]
			.as_array()
			.unwrap()
			.iter()
			.find(|p| p["id"] == id)
			.ok_or_else(|| error(StatusCode::BAD_REQUEST, "등록되지 않은 팩입니다."))?;
		documents.push(entry["document"].clone());
		contexts.extend(
			entry["context"]["policies"]
				.as_array()
				.unwrap()
				.iter()
				.cloned(),
		);
	}
	if let Some(extra) = request.get("documents") {
		documents.extend(
			extra
				.as_array()
				.ok_or_else(|| {
					error(
						StatusCode::BAD_REQUEST,
						"documents 목록 형식이 잘못되었습니다.",
					)
				})?
				.iter()
				.cloned(),
		);
	}
	if documents.is_empty() || documents.len() > 32 {
		return Err(error(
			StatusCode::BAD_REQUEST,
			"1~32개 팩 파일을 선택해 주세요.",
		));
	}
	let payload = json!({"connector_source":include_str!("policy_assets/connector.py"),"documents":documents,"context":{"policies":contexts},"common_codes":data["common_codes"],"mapping":data["mapping"],"functions":data["functions"]});
	let python = std::env::var("AGENTGATEWAY_POLICY_PYTHON").unwrap_or_else(|_| {
		if cfg!(windows) {
			"python".into()
		} else {
			"python3".into()
		}
	});
	let mut command = tokio::process::Command::new(python);
	#[cfg(windows)]
	command.creation_flags(0x08000000);
	let mut child = command
		.args(["-I", "-c", include_str!("policy_assets/worker.py")])
		.stdin(Stdio::piped())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.kill_on_drop(true)
		.spawn()
		.map_err(|_| {
			error(
				StatusCode::SERVICE_UNAVAILABLE,
				"커넥터 Python 실행 환경이 없습니다. AGENTGATEWAY_POLICY_PYTHON을 설정해 주세요.",
			)
		})?;
	child
		.stdin
		.take()
		.unwrap()
		.write_all(payload.to_string().as_bytes())
		.await
		.map_err(|_| {
			error(
				StatusCode::INTERNAL_SERVER_ERROR,
				"커넥터 입력 전달에 실패했습니다.",
			)
		})?;
	let output = tokio::time::timeout(std::time::Duration::from_secs(15), child.wait_with_output())
		.await
		.map_err(|_| {
			error(
				StatusCode::GATEWAY_TIMEOUT,
				"커넥터 생성 시간이 초과되었습니다.",
			)
		})?
		.map_err(|_| error(StatusCode::INTERNAL_SERVER_ERROR, "커넥터 실행 실패"))?;
	if !output.status.success() {
		return Err(error(
			StatusCode::UNPROCESSABLE_ENTITY,
			String::from_utf8_lossy(&output.stderr).trim(),
		));
	}
	let plan: Value = serde_json::from_slice(&output.stdout).map_err(|_| {
		error(
			StatusCode::INTERNAL_SERVER_ERROR,
			"커넥터 출력 형식이 잘못되었습니다.",
		)
	})?;
	Ok(Json(plan))
}
