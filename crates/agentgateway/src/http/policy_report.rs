//! Reports configured policy origins only after a control actually intervenes.
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::http::{Response, ResponseBodyExt};

pub const HEADER: &str = "x-agentgateway-policy-decisions";
const MAX_SOURCES: usize = 64;
const MAX_DECISIONS: usize = 64;
const MAX_HEADER_BYTES: usize = 16 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct LegalSource {
	pub law_name: String,
	pub provision: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub level: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub source_url: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub revision_no: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub promulgation_date: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub effective_date: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct PolicySource {
	pub pack_id: String,
	pub pack_version: String,
	pub law_id: String,
	pub policy_id: String,
	pub function_id: String,
	pub function_index: usize,
	pub action: String,
	pub legal_sources: Vec<LegalSource>,
}

pub fn de_sources<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<PolicySource>, D::Error> {
	let sources = Vec::<PolicySource>::deserialize(d)?;
	if sources.len() > MAX_SOURCES {
		return Err(serde::de::Error::custom(
			"policySources accepts at most 64 sources",
		));
	}
	for source in &sources {
		let strings = [
			&source.pack_id,
			&source.pack_version,
			&source.law_id,
			&source.policy_id,
			&source.function_id,
			&source.action,
		];
		if strings
			.iter()
			.any(|s| s.trim().is_empty() || s.len() > 256 || s.chars().any(char::is_control))
			|| source.legal_sources.is_empty()
			|| source.legal_sources.len() > 16
		{
			return Err(serde::de::Error::custom(
				"policySources requires bounded identifiers and 1 to 16 legal sources",
			));
		}
		for legal in &source.legal_sources {
			if [&legal.law_name, &legal.provision]
				.iter()
				.any(|s| s.trim().is_empty() || s.len() > 1024 || s.chars().any(char::is_control))
				|| [
					&legal.level,
					&legal.source_url,
					&legal.revision_no,
					&legal.promulgation_date,
					&legal.effective_date,
				]
				.into_iter()
				.flatten()
				.any(|s| s.len() > 2048 || s.chars().any(char::is_control))
			{
				return Err(serde::de::Error::custom(
					"policySources contains invalid legal source text",
				));
			}
		}
	}
	Ok(sources)
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Decision {
	pub action: String,
	pub direction: String,
	pub sources: Vec<PolicySource>,
}

#[derive(Default, Debug)]
struct State {
	decisions: Vec<Decision>,
	omitted: usize,
	rejected: bool,
}

#[derive(Default, Debug, Clone)]
pub struct PolicyDecisionLog(Arc<Mutex<State>>);

impl PolicyDecisionLog {
	pub fn rejected(&self) -> bool {
		self.0.lock().unwrap_or_else(|e| e.into_inner()).rejected
	}
	pub fn record(&self, action: &str, direction: &str, sources: &[PolicySource]) {
		if sources.is_empty() || !matches!(action, "reject" | "mask" | "remove_field") {
			return;
		}
		let decision = Decision {
			action: action.into(),
			direction: direction.into(),
			sources: sources.to_vec(),
		};
		let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());
		state.rejected |= action == "reject";
		if state.decisions.contains(&decision) {
			return;
		}
		if state.decisions.len() == MAX_DECISIONS {
			state.omitted += 1;
			// A denial must survive even when earlier successful changes filled the event budget.
			if action == "reject" {
				if let Some(index) = state.decisions.iter().rposition(|d| d.action != "reject") {
					state.decisions.remove(index);
					state.decisions.push(decision);
				}
			}
		} else {
			state.decisions.push(decision);
		}
	}

	pub fn report(&self) -> Option<Value> {
		let state = self.0.lock().unwrap_or_else(|e| e.into_inner());
		if state.decisions.is_empty() {
			return None;
		}
		let mut decisions = state.decisions.clone();
		let mut omitted = state.omitted;
		let mut omitted_sources = 0;
		let mut omitted_legal_sources = 0;
		let mut omitted_metadata = 0;
		let mut prioritized = false;
		loop {
			let mut report = json!({"version": 1, "decisions": decisions});
			if omitted + omitted_sources + omitted_legal_sources + omitted_metadata > 0 {
				report["truncated_count"] =
					json!(omitted + omitted_sources + omitted_legal_sources + omitted_metadata);
				report["truncated_decisions"] = json!(omitted);
				report["truncated_sources"] = json!(omitted_sources);
				report["truncated_legal_sources"] = json!(omitted_legal_sources);
				report["truncated_metadata_fields"] = json!(omitted_metadata);
			}
			if ascii_json(&report).len() <= MAX_HEADER_BYTES || decisions.is_empty() {
				return Some(report);
			}
			if !prioritized {
				// Preserve ordinary execution order unless the wire budget requires truncation.
				// Keep denial origins ahead of prior masks/removals, so their law stays readable.
				decisions.sort_by_key(|d| d.action != "reject");
				prioritized = true;
				continue;
			}
			// Retain at least one law/provision even when one control has many origins.
			let decision = decisions.last_mut().expect("nonempty checked");
			if decision.sources.len() > 1 {
				decision.sources.pop();
				omitted_sources += 1;
				continue;
			}
			if let Some(source) = decision.sources.last_mut() {
				if source.legal_sources.len() > 1 {
					source.legal_sources.pop();
					omitted_legal_sources += 1;
					continue;
				}
				if let Some(legal) = source.legal_sources.last_mut() {
					let mut reduced = false;
					for field in [
						&mut legal.source_url,
						&mut legal.revision_no,
						&mut legal.promulgation_date,
						&mut legal.effective_date,
						&mut legal.level,
					] {
						if field.take().is_some() {
							omitted_metadata += 1;
							reduced = true;
							break;
						}
					}
					if reduced {
						continue;
					}
				}
			}
			decisions.pop();
			omitted += 1;
		}
	}
}

pub fn ascii_json(value: &Value) -> String {
	let raw = serde_json::to_string(value).expect("JSON values serialize");
	let mut encoded = String::with_capacity(raw.len());
	for c in raw.chars() {
		if c.is_ascii() {
			encoded.push(c);
		} else {
			for word in c.encode_utf16(&mut [0; 2]) {
				use std::fmt::Write;
				write!(&mut encoded, "\\u{word:04x}").expect("writing String succeeds");
			}
		}
	}
	encoded
}

fn message(report: &Value) -> String {
	let mut laws = Vec::<String>::new();
	for decision in report["decisions"].as_array().into_iter().flatten() {
		if decision["action"] != "reject" {
			continue;
		}
		for source in decision["sources"].as_array().into_iter().flatten() {
			for legal in source["legal_sources"].as_array().into_iter().flatten() {
				let text = format!(
					"{} {}",
					legal["law_name"].as_str().unwrap_or_default(),
					legal["provision"].as_str().unwrap_or_default()
				);
				if !laws.contains(&text) {
					laws.push(text);
				}
			}
		}
	}
	if laws.is_empty() {
		"요청이 적용된 정책에 따라 거절되었습니다.".into()
	} else {
		format!(
			"요청이 다음 조항을 근거로 구성된 게이트웨이 정책에 따라 거절되었습니다: {}",
			laws.join("; ")
		)
	}
}

/// Always remove an upstream's forged notice. Only locally recorded effects can replace it.
pub fn decorate_response(resp: &mut Response, log: &PolicyDecisionLog, rejected: bool) {
	let is_llm = resp.extensions().get::<crate::cel::LLMContext>().is_some();
	decorate_response_with_llm(resp, log, rejected, is_llm);
}

/// The parsed request identifies LLM errors that did not produce response context.
pub fn decorate_response_with_llm(
	resp: &mut Response,
	log: &PolicyDecisionLog,
	rejected: bool,
	is_llm: bool,
) {
	resp.headers_mut().remove(HEADER);
	let report = log.report();
	if !rejected && (is_llm || resp.extensions().get::<crate::cel::LLMContext>().is_some()) {
		if let Some(bytes) = resp.body().known_bytes() {
			if let Ok(Value::Object(mut body)) = serde_json::from_slice::<Value>(bytes) {
				let removed = body.remove("gateway_policy").is_some();
				let compatible = resp.status().is_success()
					&& (body.contains_key("choices")
						|| body.get("object").and_then(Value::as_str) == Some("response"));
				if compatible {
					if let Some(report) = &report {
						body.insert("gateway_policy".into(), report.clone());
					}
				}
				if removed || (compatible && report.is_some()) {
					resp.replace_body_bytes(
						serde_json::to_vec(&body)
							.expect("policy response serializes")
							.into(),
					);
				}
			}
		}
	}
	let Some(report) = report else {
		return;
	};
	if let Ok(header) = ::http::HeaderValue::from_str(&ascii_json(&report)) {
		resp.headers_mut().insert(HEADER, header);
	}
	let grpc = resp
		.headers()
		.get(::http::header::CONTENT_TYPE)
		.and_then(|h| h.to_str().ok())
		.is_some_and(|h| h.starts_with("application/grpc"));
	if rejected && !grpc {
		let body = json!({"error": {"type": "gateway_policy_rejection", "code": "policy_rejected", "message": message(&report)}, "gateway_policy": report});
		resp.headers_mut().remove(::http::header::CONTENT_ENCODING);
		resp.headers_mut().insert(
			::http::header::CONTENT_TYPE,
			::http::HeaderValue::from_static("application/json"),
		);
		resp.replace_body_bytes(
			serde_json::to_vec(&body)
				.expect("policy response serializes")
				.into(),
		);
	}
}

pub fn rejection_response(
	mut resp: Response,
	sources: &[PolicySource],
	direction: &str,
) -> Response {
	let log = PolicyDecisionLog::default();
	log.record("reject", direction, sources);
	decorate_response(&mut resp, &log, !sources.is_empty());
	resp
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::http::Body;
	fn source() -> PolicySource {
		serde_json::from_value(json!({"pack_id":"test", "pack_version":"1", "law_id":"LAW", "policy_id":"one", "function_id":"guard", "function_index":0, "action":"reject", "legal_sources":[{"law_name":"개인정보 보호법", "provision":"제16조제1항"}]})).unwrap()
	}
	fn llm_context() -> crate::cel::LLMContext {
		crate::cel::LLMContext::from_llm_info(
			crate::llm::LLMInfo::new(
				crate::llm::LLMRequest {
					input_tokens: None,
					input_format: crate::llm::InputFormat::Completions,
					cache_convention: Default::default(),
					request_model: "test-model".into(),
					provider: "openai".into(),
					streaming: false,
					params: Default::default(),
					prompt: None,
					provider_state: None,
				},
				Default::default(),
			),
			None,
		)
	}
	#[test]
	fn bounded_ascii_report_keeps_only_actual_effects() {
		let log = PolicyDecisionLog::default();
		log.record("allow", "request", &[source()]);
		assert!(log.report().is_none());
		log.record("mask", "request", &[source()]);
		log.record("mask", "request", &[source()]);
		let report = log.report().unwrap();
		assert_eq!(report["decisions"].as_array().unwrap().len(), 1);
		let header = ascii_json(&report);
		assert!(header.is_ascii());
		assert_eq!(serde_json::from_str::<Value>(&header).unwrap(), report);
	}
	#[test]
	fn forged_header_is_removed_when_no_policy_intervened() {
		let mut response = ::http::Response::builder()
			.header(HEADER, "forged")
			.body(Body::empty())
			.unwrap();
		decorate_response(&mut response, &PolicyDecisionLog::default(), false);
		assert!(!response.headers().contains_key(HEADER));
	}
	#[test]
	fn oversized_report_states_how_many_decisions_were_omitted() {
		let log = PolicyDecisionLog::default();
		for index in 0..70 {
			let mut origin = source();
			origin.policy_id = index.to_string();
			origin.legal_sources[0].law_name = "법".repeat(300);
			log.record("mask", "request", &[origin]);
		}
		let report = log.report().unwrap();
		assert!(report["truncated_count"].as_u64().unwrap() > 0);
		assert!(ascii_json(&report).len() <= MAX_HEADER_BYTES);
	}
	#[test]
	fn a_single_oversized_decision_keeps_a_law_and_provision() {
		let log = PolicyDecisionLog::default();
		let mut sources = Vec::new();
		for index in 0..64 {
			let mut source = source();
			source.policy_id = index.to_string();
			source.legal_sources[0].law_name = "법".repeat(300);
			source.legal_sources[0].source_url = Some("x".repeat(2048));
			sources.push(source);
		}
		log.record("reject", "request", &sources);
		let report = log.report().unwrap();
		assert_eq!(report["decisions"].as_array().unwrap().len(), 1);
		assert!(
			!report["decisions"][0]["sources"][0]["legal_sources"][0]["law_name"]
				.as_str()
				.unwrap()
				.is_empty()
		);
		assert!(report["truncated_sources"].as_u64().unwrap() > 0);
		assert!(ascii_json(&report).len() <= MAX_HEADER_BYTES);
	}
	#[test]
	fn a_single_oversized_origin_keeps_its_first_legal_source() {
		let log = PolicyDecisionLog::default();
		let mut source = source();
		let mut legal = source.legal_sources[0].clone();
		legal.law_name = "법".repeat(300);
		for field in [
			&mut legal.source_url,
			&mut legal.level,
			&mut legal.revision_no,
			&mut legal.promulgation_date,
			&mut legal.effective_date,
		] {
			*field = Some("법".repeat(680));
		}
		source.legal_sources = vec![legal; 16];
		log.record("reject", "request", &[source]);
		let report = log.report().unwrap();
		assert_eq!(report["decisions"].as_array().unwrap().len(), 1);
		assert_eq!(
			report["decisions"][0]["sources"][0]["legal_sources"][0]["provision"],
			"제16조제1항"
		);
		assert!(report["truncated_legal_sources"].as_u64().unwrap() > 0);
		assert!(report["truncated_metadata_fields"].as_u64().unwrap() > 0);
		assert!(ascii_json(&report).len() <= MAX_HEADER_BYTES);
	}
	#[test]
	fn later_reject_survives_large_prior_change_origins() {
		let log = PolicyDecisionLog::default();
		let mut large = source();
		large.legal_sources[0].law_name = "법".repeat(300);
		large.legal_sources[0].source_url = Some("x".repeat(2048));
		for index in 0..5 {
			large.policy_id = format!("change-{index}");
			log.record("remove_field", "request", &[large.clone()]);
		}
		let mut reject = source();
		reject.legal_sources[0].law_name = "거절 근거법".into();
		reject.legal_sources[0].provision = "제1조".into();
		log.record("reject", "response", &[reject]);
		assert!(log.rejected());
		let report = log.report().unwrap();
		assert_eq!(report["decisions"][0]["action"], "reject");
		assert!(message(&report).contains("거절 근거법 제1조"));
		assert!(!message(&report).contains(&"법".repeat(300)));
		assert!(report["truncated_count"].as_u64().unwrap() > 0);
		assert!(ascii_json(&report).len() <= MAX_HEADER_BYTES);
	}
	#[test]
	fn reject_survives_a_full_decision_budget() {
		let log = PolicyDecisionLog::default();
		for index in 0..MAX_DECISIONS {
			let mut origin = source();
			origin.policy_id = format!("mask-{index}");
			log.record("mask", "request", &[origin]);
		}
		let mut reject = source();
		reject.policy_id = "late-reject".into();
		reject.legal_sources[0].law_name = "거절 근거법".into();
		log.record("reject", "response", &[reject]);
		assert!(log.rejected());
		let report = log.report().unwrap();
		assert!(
			report["decisions"]
				.as_array()
				.unwrap()
				.iter()
				.any(|d| d["action"] == "reject")
		);
		assert!(message(&report).contains("거절 근거법"));
		assert!(report["truncated_decisions"].as_u64().unwrap() > 0);
		assert!(ascii_json(&report).len() <= MAX_HEADER_BYTES);
	}
	#[test]
	fn an_unannotated_reject_does_not_turn_earlier_mask_into_a_denial() {
		let log = PolicyDecisionLog::default();
		log.record("mask", "request", &[source()]);
		log.record("reject", "request", &[]);
		assert!(!log.rejected());
		assert_eq!(log.report().unwrap()["decisions"][0]["action"], "mask");
	}

	#[test]
	fn reject_body_contains_legal_reason_without_original_content() {
		let log = PolicyDecisionLog::default();
		log.record("reject", "request", &[source()]);
		let mut response = ::http::Response::builder()
			.status(403)
			.header(::http::header::CONTENT_ENCODING, "gzip")
			.body(Body::from("private original error"))
			.unwrap();
		decorate_response(&mut response, &log, true);
		assert_eq!(response.status(), 403);
		assert!(
			!response
				.headers()
				.contains_key(::http::header::CONTENT_ENCODING)
		);
		let body: Value = serde_json::from_slice(response.body().known_bytes().unwrap()).unwrap();
		assert!(
			body["error"]["message"]
				.as_str()
				.unwrap()
				.contains("개인정보 보호법 제16조제1항")
		);
		assert!(!body.to_string().contains("private original"));
		assert_eq!(body["gateway_policy"], log.report().unwrap());
	}

	#[test]
	fn raw_fhir_response_keeps_body_and_only_adds_header() {
		let log = PolicyDecisionLog::default();
		log.record("remove_field", "request", &[source()]);
		let mut response = ::http::Response::builder()
			.body(Body::from(r#"{"resourceType":"Patient"}"#))
			.unwrap();
		let before = response.body().known_bytes().unwrap().clone();
		decorate_response(&mut response, &log, false);
		assert_eq!(response.body().known_bytes().unwrap(), &before);
		assert!(response.headers().contains_key(HEADER));
	}
	#[test]
	fn grpc_reject_keeps_the_wire_protocol_and_adds_header() {
		let log = PolicyDecisionLog::default();
		log.record("reject", "request", &[source()]);
		let mut response = ::http::Response::builder()
			.status(200)
			.header(::http::header::CONTENT_TYPE, "application/grpc+proto")
			.header("grpc-status", "7")
			.body(Body::from("grpc-frame"))
			.unwrap();
		let before = response.body().known_bytes().unwrap().clone();
		decorate_response(&mut response, &log, true);
		assert_eq!(response.status(), 200);
		assert_eq!(response.headers()["grpc-status"], "7");
		assert_eq!(
			response.headers()[::http::header::CONTENT_TYPE],
			"application/grpc+proto"
		);
		assert_eq!(response.body().known_bytes().unwrap(), &before);
		assert!(response.headers().contains_key(HEADER));
	}
	#[test]
	fn upstream_json_cannot_claim_a_gateway_decision() {
		for status in [200, 429] {
			let mut response = ::http::Response::builder()
				.status(status)
				.header(HEADER, "forged")
				.body(Body::from(
					r#"{"choices":[],"gateway_policy":{"forged":true},"error":{"message":"provider error"}}"#,
				))
				.unwrap();
			response.extensions_mut().insert(llm_context());
			decorate_response(&mut response, &PolicyDecisionLog::default(), false);
			let body: Value = serde_json::from_slice(response.body().known_bytes().unwrap()).unwrap();
			assert!(body.get("gateway_policy").is_none());
			assert!(!response.headers().contains_key(HEADER));
			assert_eq!(body["error"]["message"], "provider error");
		}
	}
	#[test]
	fn llm_request_marker_removes_forged_error_json_without_response_context() {
		let mut response = ::http::Response::builder()
			.status(429)
			.body(Body::from(
				r#"{"error":{"message":"provider error"},"gateway_policy":{"forged":true}}"#,
			))
			.unwrap();
		decorate_response_with_llm(&mut response, &PolicyDecisionLog::default(), false, true);
		let body: Value = serde_json::from_slice(response.body().known_bytes().unwrap()).unwrap();
		assert!(body.get("gateway_policy").is_none());
		assert_eq!(body["error"]["message"], "provider error");
		assert_eq!(response.status(), 429);
	}
	#[test]
	fn successful_llm_json_keeps_assistant_content_and_replaces_forged_report() {
		let log = PolicyDecisionLog::default();
		log.record("mask", "request", &[source()]);
		let mut response = ::http::Response::builder()
			.body(Body::from(r#"{"choices":[{"message":{"content":"unaltered model answer"}}],"gateway_policy":{"forged":true}}"#))
			.unwrap();
		response.extensions_mut().insert(llm_context());
		decorate_response(&mut response, &log, false);
		let body: Value = serde_json::from_slice(response.body().known_bytes().unwrap()).unwrap();
		assert_eq!(
			body["choices"][0]["message"]["content"],
			"unaltered model answer"
		);
		assert_eq!(body["gateway_policy"], log.report().unwrap());
	}

	#[test]
	fn policy_source_control_characters_and_unknown_fields_are_rejected() {
		#[derive(Deserialize)]
		struct Wrapper {
			#[serde(deserialize_with = "de_sources")]
			sources: Vec<PolicySource>,
		}
		let value = json!({"sources":[source()]});
		let valid: Wrapper = serde_json::from_value(value.clone()).unwrap();
		assert_eq!(valid.sources.len(), 1);
		let mut invalid = value.clone();
		invalid["sources"][0]["legal_sources"][0]["law_name"] = json!("law\r\nforged");
		assert!(serde_json::from_value::<Wrapper>(invalid).is_err());
		let mut invalid = value;
		invalid["sources"][0]["request_body"] = json!("private input");
		assert!(serde_json::from_value::<Wrapper>(invalid).is_err());
	}
}
