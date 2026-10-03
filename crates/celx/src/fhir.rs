use std::collections::{HashMap, HashSet};
use std::fmt;
use std::sync::OnceLock;

use cel::extractors::Argument;
use cel::{Context, FunctionContext, ResolveResult, Value};
use serde::Deserialize;
use serde::de::{Error as _, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Value as JsonValue};

const MAX_INPUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_DEPTH: usize = 64;
const MAX_NODES: usize = 100_000;
const MAX_TEXT_PARSES: usize = 256;
const MAX_PARSED_TEXT_BYTES: usize = 4 * 1024 * 1024;
const MAX_STRING_LAYERS: usize = 8;
const PROFILE_KEYS: &[&str] = &["version", "allow_fields"];
const OBSERVATION_CHOICES: &[&str] = &[
	"Quantity",
	"CodeableConcept",
	"String",
	"Boolean",
	"Integer",
	"Range",
	"Ratio",
	"SampledData",
	"Time",
	"DateTime",
	"Period",
];

pub fn insert_all(ctx: &mut Context) {
	ctx.add_function("filterFhir", filter_fhir);
}

fn filter_fhir<'a>(
	ftx: &mut FunctionContext<'a, '_>,
	input: Argument,
	profile: Argument,
) -> ResolveResult<'a> {
	let input: Value = input.load_value(ftx)?;
	let profile: Value = profile.load_value(ftx)?;
	let input = input.json().map_err(|e| ftx.error(e))?;
	let profile = profile.json().map_err(|e| ftx.error(e))?;
	let profile = Profile::parse(&profile).map_err(|e| ftx.error(e))?;
	let encoded = serde_json::to_vec(&input).map_err(|e| ftx.error(e))?;
	if encoded.len() > MAX_INPUT_BYTES {
		return Err(ftx.error("FHIR request exceeds the 4 MiB inspection limit"));
	}
	let mut budget = Budget::default();
	budget.inspect(&input, 0).map_err(|e| ftx.error(e))?;
	let (result, _) = filter_request(input, &profile, &mut budget, 0, 0).map_err(|e| ftx.error(e))?;
	cel::to_value(result).map_err(|e| ftx.error(e))
}

struct Profile {
	allow_fields: HashMap<String, Vec<String>>,
}

impl Profile {
	fn parse(value: &JsonValue) -> Result<Self, String> {
		let object = value.as_object().ok_or("FHIR profile must be an object")?;
		if object.len() != 2
			|| object
				.keys()
				.any(|key| !PROFILE_KEYS.contains(&key.as_str()))
		{
			return Err("FHIR profile accepts only version and allow_fields".into());
		}
		if object["version"].as_u64() != Some(1) {
			return Err("FHIR profile version must be 1".into());
		}
		let allow = object["allow_fields"]
			.as_object()
			.ok_or("FHIR allow_fields must be an object")?;
		let mut allow_fields = HashMap::new();
		for (resource, paths) in allow {
			let reviewed: &[&str] = match resource.as_str() {
				"Patient" => &[
					"name[]",
					"telecom[].value",
					"address[]",
					"birthDate",
					"identifier[].value",
				],
				"Condition" => &["code", "bodySite[]", "note[].text"],
				"Observation" => &[
					"code",
					"value[x]",
					"component[].code",
					"component[].value[x]",
					"note[].text",
				],
				_ => return Err("FHIR profile has an unreviewed resource type".into()),
			};
			let paths = paths
				.as_array()
				.ok_or("FHIR retained fields must be a list")?;
			let mut seen = HashSet::new();
			let mut selected = Vec::new();
			for path in paths {
				let path = path
					.as_str()
					.ok_or("FHIR retained field paths must be strings")?;
				if !reviewed.contains(&path) || !seen.insert(path) {
					return Err("FHIR retained field path is unreviewed or duplicated".into());
				}
				selected.push(path.to_owned());
			}
			allow_fields.insert(resource.clone(), selected);
		}
		Ok(Self { allow_fields })
	}
}

#[derive(Default)]
struct Budget {
	nodes: usize,
	text_parses: usize,
	parsed_text_bytes: usize,
}

// Duplicate JSON object keys must not hide an earlier private value and cause the
// original JSON text to be returned unchanged after a last-key-wins parse.
struct StrictJson(JsonValue);

impl<'de> Deserialize<'de> for StrictJson {
	fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
		struct StrictVisitor;
		impl<'de> Visitor<'de> for StrictVisitor {
			type Value = StrictJson;
			fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
				formatter.write_str("JSON without duplicate object keys")
			}
			fn visit_bool<E: serde::de::Error>(self, value: bool) -> Result<Self::Value, E> {
				Ok(StrictJson(JsonValue::Bool(value)))
			}
			fn visit_i64<E: serde::de::Error>(self, value: i64) -> Result<Self::Value, E> {
				Ok(StrictJson(value.into()))
			}
			fn visit_u64<E: serde::de::Error>(self, value: u64) -> Result<Self::Value, E> {
				Ok(StrictJson(value.into()))
			}
			fn visit_f64<E: serde::de::Error>(self, value: f64) -> Result<Self::Value, E> {
				serde_json::Number::from_f64(value)
					.map(|value| StrictJson(JsonValue::Number(value)))
					.ok_or_else(|| E::custom("non-finite JSON number"))
			}
			fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Self::Value, E> {
				Ok(StrictJson(value.into()))
			}
			fn visit_string<E: serde::de::Error>(self, value: String) -> Result<Self::Value, E> {
				Ok(StrictJson(value.into()))
			}
			fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
				Ok(StrictJson(JsonValue::Null))
			}
			fn visit_seq<A: SeqAccess<'de>>(self, mut access: A) -> Result<Self::Value, A::Error> {
				let mut values = Vec::new();
				while let Some(StrictJson(value)) = access.next_element()? {
					values.push(value);
				}
				Ok(StrictJson(JsonValue::Array(values)))
			}
			fn visit_map<A: MapAccess<'de>>(self, mut access: A) -> Result<Self::Value, A::Error> {
				let mut values = Map::new();
				while let Some(key) = access.next_key::<String>()? {
					if values.contains_key(&key) {
						return Err(A::Error::custom("duplicate JSON object key"));
					}
					let StrictJson(value) = access.next_value()?;
					values.insert(key, value);
				}
				Ok(StrictJson(JsonValue::Object(values)))
			}
		}
		deserializer.deserialize_any(StrictVisitor)
	}
}

fn resource_marker(
	text: &str,
	budget: &mut Budget,
	depth: usize,
	layers: usize,
) -> Result<bool, String> {
	if text.contains("\"resourceType\"") {
		return Ok(true);
	}
	if !text.contains('\\') {
		return Ok(false);
	}
	static QUOTED: OnceLock<regex::Regex> = OnceLock::new();
	let quoted = QUOTED
		.get_or_init(|| regex::Regex::new(r#""(?:[^"\\]|\\.)*""#).expect("valid JSON string scanner"));
	for token in quoted.find_iter(text) {
		if !token.as_str().contains('\\') {
			continue;
		}
		budget.parse_text(token.len(), layers)?;
		if let Ok(decoded) = serde_json::from_str::<String>(token.as_str()) {
			budget.inspect(&JsonValue::String(decoded.clone()), depth + 1)?;
			if decoded == "resourceType" || decoded.contains("\"resourceType\"") {
				return Ok(true);
			}
			if decoded.contains('"')
				&& decoded.contains('\\')
				&& resource_marker(&decoded, budget, depth + 1, layers + 1)?
			{
				return Ok(true);
			}
		}
	}
	Ok(false)
}

#[allow(clippy::too_many_arguments)]
fn update_extra_fields(
	map: &mut Map<String, JsonValue>,
	skipped: &[&str],
	profile: &Profile,
	budget: &mut Budget,
	depth: usize,
	layers: usize,
) -> Result<bool, String> {
	let mut changed = false;
	for (key, child) in map {
		if skipped.contains(&key.as_str()) {
			continue;
		}
		let (filtered, different) = walk(std::mem::take(child), profile, budget, depth + 1, layers)?;
		*child = filtered;
		changed |= different;
	}
	Ok(changed)
}

// Only actual schema containers are exempt from mutation. FHIR examples/data inside
// those schemas are rejected, rather than silently forwarded or changing the schema.
fn walk_protocol(
	value: JsonValue,
	profile: &Profile,
	budget: &mut Budget,
	depth: usize,
	layers: usize,
) -> Result<(JsonValue, bool), String> {
	match value {
		JsonValue::Object(map) if map.contains_key("resourceType") => {
			filter_resource(map, profile, budget, depth, layers)
		},
		JsonValue::Object(mut map) => {
			let mut changed = false;
			for (key, child) in &mut map {
				if [
					"parameters",
					"input_schema",
					"schema",
					"properties",
					"$defs",
					"definitions",
					"patternProperties",
					"dependentSchemas",
				]
				.contains(&key.as_str())
					&& child.is_object()
				{
					inspect_schema(child, budget, depth + 1, layers)?;
					continue;
				}
				let (filtered, different) =
					walk_protocol(std::mem::take(child), profile, budget, depth + 1, layers)?;
				*child = filtered;
				changed |= different;
			}
			Ok((JsonValue::Object(map), changed))
		},
		JsonValue::Array(mut values) => {
			let mut changed = false;
			for child in &mut values {
				let (filtered, different) =
					walk_protocol(std::mem::take(child), profile, budget, depth + 1, layers)?;
				*child = filtered;
				changed |= different;
			}
			Ok((JsonValue::Array(values), changed))
		},
		other => walk(other, profile, budget, depth, layers),
	}
}

fn inspect_schema(
	value: &JsonValue,
	budget: &mut Budget,
	depth: usize,
	layers: usize,
) -> Result<(), String> {
	if depth > MAX_DEPTH {
		return Err("FHIR request exceeds the JSON depth limit".into());
	}
	match value {
		JsonValue::Object(map) => {
			if map.get("resourceType").is_some_and(JsonValue::is_string) {
				return Err("FHIR data inside protocol schemas cannot be safely forwarded".into());
			}
			for child in map.values() {
				inspect_schema(child, budget, depth + 1, layers)?;
			}
		},
		JsonValue::Array(values) => {
			for child in values {
				inspect_schema(child, budget, depth + 1, layers)?;
			}
		},
		JsonValue::String(text) => {
			let trimmed = text.trim();
			let marker = resource_marker(text, budget, depth, layers)?;
			if matches!(
				trimmed.as_bytes().first().copied(),
				Some(b'{' | b'[' | b'"')
			) {
				budget.parse_text(text.len(), layers)?;
				let StrictJson(parsed) = match serde_json::from_str(trimmed) {
					Ok(parsed) => parsed,
					Err(_) if !marker => return Ok(()),
					Err(_) => return Err("Protocol schema contains malformed FHIR JSON text".into()),
				};
				budget.inspect(&parsed, depth + 1)?;
				inspect_schema(&parsed, budget, depth + 1, layers + 1)?;
			} else if marker {
				return Err("Protocol schema contains unsupported FHIR text".into());
			}
		},
		_ => {},
	}
	Ok(())
}

impl Budget {
	fn inspect(&mut self, value: &JsonValue, depth: usize) -> Result<(), String> {
		if depth > MAX_DEPTH {
			return Err("FHIR request exceeds the JSON depth limit".into());
		}
		self.nodes += 1;
		if self.nodes > MAX_NODES {
			return Err("FHIR request exceeds the JSON node limit".into());
		}
		match value {
			JsonValue::Object(map) => {
				for child in map.values() {
					self.inspect(child, depth + 1)?;
				}
			},
			JsonValue::Array(values) => {
				for child in values {
					self.inspect(child, depth + 1)?;
				}
			},
			_ => {},
		}
		Ok(())
	}

	fn parse_text(&mut self, bytes: usize, layers: usize) -> Result<(), String> {
		self.text_parses += 1;
		self.parsed_text_bytes += bytes;
		if self.text_parses > MAX_TEXT_PARSES || self.parsed_text_bytes > MAX_PARSED_TEXT_BYTES {
			return Err("FHIR request exceeds the JSON text inspection limit".into());
		}
		if layers >= MAX_STRING_LAYERS {
			return Err("FHIR request exceeds the encoded JSON string layer limit".into());
		}
		Ok(())
	}
}

// Inspect data slots and extra metadata without changing protocol identifiers or
// ordinary values. Definition schemas are validated separately without mutation.
fn filter_request(
	value: JsonValue,
	profile: &Profile,
	budget: &mut Budget,
	depth: usize,
	layers: usize,
) -> Result<(JsonValue, bool), String> {
	if let JsonValue::Object(mut map) = value {
		if map.contains_key("resourceType") {
			return filter_resource(map, profile, budget, depth, layers);
		}
		if ["messages", "input", "instructions"]
			.iter()
			.any(|key| map.contains_key(*key))
		{
			let mut changed = false;
			if let Some(messages) = map.get_mut("messages") {
				let messages = messages
					.as_array_mut()
					.ok_or("LLM messages must be a list")?;
				for message in messages {
					let message = message
						.as_object_mut()
						.ok_or("LLM message must be an object")?;
					if let Some(content) = message.get_mut("content") {
						changed |= update_content(content, profile, budget, depth + 2, layers)?;
					}
					if let Some(calls) = message
						.get_mut("tool_calls")
						.filter(|value| !value.is_null())
					{
						let calls = calls
							.as_array_mut()
							.ok_or("LLM tool_calls must be a list")?;
						for call in calls {
							let call = call
								.as_object_mut()
								.ok_or("LLM tool call must be an object")?;
							if let Some(function) = call.get_mut("function") {
								let function = function
									.as_object_mut()
									.ok_or("LLM function call must be an object")?;
								if let Some(arguments) = function.get_mut("arguments") {
									changed |= update_content(arguments, profile, budget, depth + 5, layers)?;
								}
								changed |= update_extra_fields(
									function,
									&["arguments"],
									profile,
									budget,
									depth + 4,
									layers,
								)?;
							}
							changed |=
								update_extra_fields(call, &["function"], profile, budget, depth + 3, layers)?;
						}
					}
					changed |= update_extra_fields(
						message,
						&["content", "tool_calls"],
						profile,
						budget,
						depth + 1,
						layers,
					)?;
				}
			}
			if let Some(input) = map.get_mut("input") {
				match input {
					JsonValue::Array(items) => {
						for item in items {
							let item = item
								.as_object_mut()
								.ok_or("Responses input item must be an object")?;
							if item.contains_key("resourceType") {
								let (filtered, different) =
									filter_resource(item.clone(), profile, budget, depth + 2, layers)?;
								*item = filtered
									.as_object()
									.expect("filtered resources are objects")
									.clone();
								changed |= different;
								continue;
							}
							if let Some(content) = item.get_mut("content") {
								changed |= update_content(content, profile, budget, depth + 3, layers)?;
							}
							let mut visited = vec!["content"];
							if matches!(
								item.get("type").and_then(JsonValue::as_str),
								Some("function_call_output" | "custom_tool_call_output")
							) {
								visited.push("output");
								if let Some(output) = item.get_mut("output") {
									changed |= update_content(output, profile, budget, depth + 3, layers)?;
								}
							}
							if item.get("type").and_then(JsonValue::as_str) == Some("function_call") {
								visited.push("arguments");
								if let Some(arguments) = item.get_mut("arguments") {
									changed |= update_content(arguments, profile, budget, depth + 3, layers)?;
								}
							}
							changed |= update_extra_fields(item, &visited, profile, budget, depth + 2, layers)?;
						}
					},
					_ => changed |= update_content(input, profile, budget, depth + 1, layers)?,
				}
			}
			if let Some(instructions) = map.get_mut("instructions") {
				changed |= update_content(instructions, profile, budget, depth + 1, layers)?;
			}
			// Additional data such as context/metadata must not bypass protection.
			for (key, child) in &mut map {
				if ["messages", "input", "instructions"].contains(&key.as_str()) {
					continue;
				}
				let (filtered, different) =
					if ["tools", "functions", "response_format", "text"].contains(&key.as_str()) {
						walk_protocol(std::mem::take(child), profile, budget, depth + 1, layers)?
					} else {
						walk(std::mem::take(child), profile, budget, depth + 1, layers)?
					};
				*child = filtered;
				changed |= different;
			}
			return Ok((JsonValue::Object(map), changed));
		}
		return walk(JsonValue::Object(map), profile, budget, depth, layers);
	}
	walk(value, profile, budget, depth, layers)
}

fn update_content(
	value: &mut JsonValue,
	profile: &Profile,
	budget: &mut Budget,
	depth: usize,
	layers: usize,
) -> Result<bool, String> {
	if let JsonValue::Array(parts) = value {
		let mut changed = false;
		for part in parts {
			let part = part
				.as_object_mut()
				.ok_or("LLM content part must be an object")?;
			if part.contains_key("resourceType") {
				let (filtered, different) =
					filter_resource(part.clone(), profile, budget, depth + 1, layers)?;
				*part = filtered
					.as_object()
					.expect("filtered resources are objects")
					.clone();
				changed |= different;
			} else if matches!(
				part.get("type").and_then(JsonValue::as_str),
				Some("text" | "input_text" | "output_text")
			) {
				if let Some(text) = part.get_mut("text") {
					if !text.is_string() {
						return Err("LLM text content must be a string".into());
					}
					let (filtered, different) =
						walk(std::mem::take(text), profile, budget, depth + 2, layers)?;
					*text = filtered;
					changed |= different;
				}
				changed |= update_extra_fields(part, &["text"], profile, budget, depth + 1, layers)?;
			} else {
				changed |= update_extra_fields(part, &[], profile, budget, depth + 1, layers)?;
			}
		}
		Ok(changed)
	} else {
		let (filtered, changed) = walk(std::mem::take(value), profile, budget, depth, layers)?;
		*value = filtered;
		Ok(changed)
	}
}

fn walk(
	value: JsonValue,
	profile: &Profile,
	budget: &mut Budget,
	depth: usize,
	layers: usize,
) -> Result<(JsonValue, bool), String> {
	if depth > MAX_DEPTH {
		return Err("FHIR request exceeds the JSON depth limit".into());
	}
	match value {
		JsonValue::Object(map) if map.contains_key("resourceType") => {
			filter_resource(map, profile, budget, depth, layers)
		},
		JsonValue::Object(mut map) => {
			let mut changed = false;
			for child in map.values_mut() {
				let (filtered, different) =
					walk(std::mem::take(child), profile, budget, depth + 1, layers)?;
				*child = filtered;
				changed |= different;
			}
			Ok((JsonValue::Object(map), changed))
		},
		JsonValue::Array(mut values) => {
			let mut changed = false;
			for child in &mut values {
				let (filtered, different) =
					walk(std::mem::take(child), profile, budget, depth + 1, layers)?;
				*child = filtered;
				changed |= different;
			}
			Ok((JsonValue::Array(values), changed))
		},
		JsonValue::String(text) => {
			let trimmed = text.trim();
			let marker = resource_marker(&text, budget, depth, layers)?;
			if !matches!(
				trimmed.as_bytes().first().copied(),
				Some(b'{' | b'[' | b'"')
			) {
				if marker {
					return Err(
						"FHIR text must contain one complete JSON value without prose or fences".into(),
					);
				}
				return Ok((JsonValue::String(text), false));
			}
			budget.parse_text(text.len(), layers)?;
			let StrictJson(parsed) = match serde_json::from_str(trimmed) {
				Ok(parsed) => parsed,
				Err(_) if !marker => return Ok((JsonValue::String(text), false)),
				Err(_) => {
					return Err("FHIR/JSON text is malformed or contains duplicate object keys".into());
				},
			};
			budget.inspect(&parsed, depth + 1)?;
			// A JSON value serialized inside a data slot is payload, not necessarily an
			// OpenAI envelope: input/messages keys must not impose protocol shape.
			let (filtered, changed) = walk_protocol(parsed, profile, budget, depth + 1, layers + 1)?;
			if !changed {
				return Ok((JsonValue::String(text), false));
			}
			let text = serde_json::to_string(&filtered).map_err(|_| "FHIR text cannot be serialized")?;
			Ok((JsonValue::String(text), true))
		},
		other => Ok((other, false)),
	}
}

fn filter_resource(
	map: Map<String, JsonValue>,
	profile: &Profile,
	budget: &mut Budget,
	depth: usize,
	layers: usize,
) -> Result<(JsonValue, bool), String> {
	if depth > MAX_DEPTH {
		return Err("FHIR request exceeds the JSON depth limit".into());
	}
	let kind = map
		.get("resourceType")
		.and_then(JsonValue::as_str)
		.ok_or("FHIR resourceType must be a string")?;
	if kind.is_empty()
		|| kind.len() > 64
		|| !kind.as_bytes()[0].is_ascii_uppercase()
		|| !kind.bytes().all(|b| b.is_ascii_alphabetic())
	{
		return Err("FHIR resourceType is invalid".into());
	}
	let mut result = Map::new();
	result.insert("resourceType".into(), JsonValue::String(kind.to_owned()));
	if let Some(contained) = map.get("contained") {
		let values = contained
			.as_array()
			.ok_or("FHIR contained must be an array of resources")?;
		let mut filtered = Vec::with_capacity(values.len());
		for child in values {
			let child = child
				.as_object()
				.ok_or("FHIR contained must contain resource objects")?;
			filtered.push(filter_resource(child.clone(), profile, budget, depth + 2, layers)?.0);
		}
		result.insert("contained".into(), JsonValue::Array(filtered));
	}
	if kind == "Bundle" {
		if let Some(entries) = map.get("entry") {
			let entries = entries
				.as_array()
				.ok_or("FHIR Bundle entry must be an array")?;
			let mut filtered = Vec::with_capacity(entries.len());
			for entry in entries {
				let entry = entry
					.as_object()
					.ok_or("FHIR Bundle entry must contain objects")?;
				let mut next = Map::new();
				if let Some(resource) = entry.get("resource") {
					let resource = resource
						.as_object()
						.ok_or("FHIR Bundle resource must be an object")?;
					next.insert(
						"resource".into(),
						filter_resource(resource.clone(), profile, budget, depth + 3, layers)?.0,
					);
				}
				filtered.push(JsonValue::Object(next));
			}
			result.insert("entry".into(), JsonValue::Array(filtered));
		}
	}
	for path in profile.allow_fields.get(kind).into_iter().flatten() {
		project_path(
			&map,
			&mut result,
			&path.split('.').collect::<Vec<_>>(),
			profile,
			budget,
			depth,
			layers,
		)?;
	}
	let changed = map != result;
	Ok((JsonValue::Object(result), changed))
}

#[allow(clippy::too_many_arguments)]
fn project_path(
	source: &Map<String, JsonValue>,
	target: &mut Map<String, JsonValue>,
	parts: &[&str],
	profile: &Profile,
	budget: &mut Budget,
	depth: usize,
	layers: usize,
) -> Result<(), String> {
	let part = parts[0];
	if let Some(prefix) = part.strip_suffix("[x]") {
		for suffix in OBSERVATION_CHOICES {
			let name = format!("{prefix}{suffix}");
			if let Some(value) = source.get(&name) {
				let valid = match *suffix {
					"String" | "Time" | "DateTime" => value.is_string(),
					"Boolean" => value.is_boolean(),
					"Integer" => value.as_i64().is_some(),
					_ => value.is_object(),
				};
				if !valid {
					return Err("Retained FHIR choice field has an invalid type".into());
				}
				target.insert(
					name,
					walk(value.clone(), profile, budget, depth + 1, layers)?.0,
				);
			}
		}
		return Ok(());
	}
	let array = part.ends_with("[]");
	let key = part.strip_suffix("[]").unwrap_or(part);
	let Some(value) = source.get(key) else {
		return Ok(());
	};
	if parts.len() == 1 {
		if array {
			let values = value
				.as_array()
				.ok_or("Retained FHIR array field has an invalid shape")?;
			if values.iter().any(|child| !child.is_object()) {
				return Err("Retained FHIR array elements must be objects".into());
			}
		} else if ["birthDate", "value", "text"].contains(&key) {
			if !value.is_string() {
				return Err("Retained FHIR scalar field must be a string".into());
			}
		} else if key == "code" && !value.is_object() {
			return Err("Retained FHIR code field must be an object".into());
		}
		target.insert(
			key.into(),
			walk(value.clone(), profile, budget, depth + 1, layers)?.0,
		);
	} else if array {
		let values = value
			.as_array()
			.ok_or("Retained FHIR array field has an invalid shape")?;
		let retained = target
			.entry(key.to_owned())
			.or_insert_with(|| JsonValue::Array(vec![JsonValue::Object(Map::new()); values.len()]));
		let retained = retained
			.as_array_mut()
			.ok_or("Retained FHIR paths have conflicting shapes")?;
		for (original, next) in values.iter().zip(retained.iter_mut()) {
			let original = original
				.as_object()
				.ok_or("Retained FHIR array elements must be objects")?;
			let next = next
				.as_object_mut()
				.ok_or("Retained FHIR paths have conflicting shapes")?;
			project_path(
				original,
				next,
				&parts[1..],
				profile,
				budget,
				depth + 2,
				layers,
			)?;
		}
	} else {
		let value = value
			.as_object()
			.ok_or("Retained FHIR object field has an invalid shape")?;
		let retained = target
			.entry(key.to_owned())
			.or_insert_with(|| JsonValue::Object(Map::new()));
		let retained = retained
			.as_object_mut()
			.ok_or("Retained FHIR paths have conflicting shapes")?;
		project_path(
			value,
			retained,
			&parts[1..],
			profile,
			budget,
			depth + 1,
			layers,
		)?;
	}
	Ok(())
}

#[cfg(test)]
mod tests {
	use cel::{Context, Program, Value, context};
	use serde_json::{Value as JsonValue, json};

	fn profile() -> JsonValue {
		json!({"version": 1, "allow_fields": {"Patient": [], "Condition": [], "Observation": []}})
	}

	fn evaluate(input: JsonValue, profile: JsonValue) -> Result<JsonValue, String> {
		evaluate_expression(input, profile, "filterFhir(args.input, args.profile)")
	}

	fn evaluate_expression(
		input: JsonValue,
		profile: JsonValue,
		expression: &str,
	) -> Result<JsonValue, String> {
		let mut ctx = Context::default();
		crate::insert_all(&mut ctx);
		let plain = Program::compile(expression).map_err(|e| e.to_string())?;
		let optimized = Program::compile_with_optimizer(expression, crate::DefaultOptimizer)
			.map_err(|e| e.to_string())?;
		let args =
			cel::to_value(json!({"input": input, "profile": profile})).map_err(|e| e.to_string())?;
		let resolver = context::SingleVarResolver::new(&context::DefaultVariableResolver, "args", args);
		let result = Value::resolve(plain.expression(), &ctx, &resolver)
			.map_err(|e| e.to_string())?
			.json()
			.map_err(|e| e.to_string())?;
		let optimized_result = Value::resolve(optimized.expression(), &ctx, &resolver)
			.map_err(|e| e.to_string())?
			.json()
			.map_err(|e| e.to_string())?;
		assert_eq!(
			result, optimized_result,
			"optimization must preserve protection"
		);
		Ok(result)
	}

	#[test]
	fn default_removes_known_and_unregistered_resource_data() {
		for resource_type in ["Patient", "Condition", "Observation", "CustomRecord"] {
			let input = json!({"resourceType": resource_type, "id": "private", "extension": [{"valueString": "private"}], "text": {"div": "private"}, "secret": "private"});
			assert_eq!(
				evaluate(input, profile()).unwrap(),
				json!({"resourceType": resource_type})
			);
		}
	}

	#[test]
	fn allow_fields_project_only_selected_leaves() {
		let mut settings = profile();
		settings["allow_fields"]["Patient"] =
			json!(["telecom[].value", "identifier[].value", "birthDate"]);
		let input = json!({"resourceType": "Patient", "name": [{"text": "private"}], "telecom": [{"value": "retained", "system": "private"}, {"system": "private"}], "identifier": [{"value": "retained-id", "system": "private"}], "birthDate": "2000-01-01", "id": "private"});
		assert_eq!(
			evaluate(input, settings).unwrap(),
			json!({"resourceType": "Patient", "telecom": [{"value": "retained"}, {}], "identifier": [{"value": "retained-id"}], "birthDate": "2000-01-01"})
		);
	}

	#[test]
	fn approved_whole_fields_stay_while_nested_resources_are_filtered() {
		let mut settings = profile();
		settings["allow_fields"]["Patient"] = json!(["name[]", "address[]"]);
		let input = json!({"resourceType": "Patient", "name": [{"text": "retained", "extra": {"resourceType": "Condition", "code": {"text": "private"}}}], "address": [{"city": "retained"}], "birthDate": "private"});
		assert_eq!(
			evaluate(input, settings).unwrap(),
			json!({"resourceType": "Patient", "name": [{"text": "retained", "extra": {"resourceType": "Condition"}}], "address": [{"city": "retained"}]})
		);
	}

	#[test]
	fn bundle_and_contained_keep_only_resource_structure() {
		let input = json!({"resourceType": "Bundle", "id": "private", "total": 4, "entry": [{"fullUrl": "private", "resource": {"resourceType": "Patient", "name": [{"text": "private"}], "contained": [{"resourceType": "Condition", "code": {"text": "private"}}]}}, {"resource": {"resourceType": "Bundle", "type": "collection", "entry": [{"resource": {"resourceType": "Observation", "valueString": "private"}}]}}]});
		assert_eq!(
			evaluate(input, profile()).unwrap(),
			json!({"resourceType": "Bundle", "entry": [{"resource": {"resourceType": "Patient", "contained": [{"resourceType": "Condition"}]}}, {"resource": {"resourceType": "Bundle", "entry": [{"resource": {"resourceType": "Observation"}}]}}]})
		);
	}

	#[test]
	fn observation_choices_and_component_projection_merge() {
		let mut settings = profile();
		settings["allow_fields"]["Observation"] = json!([
			"code",
			"value[x]",
			"component[].code",
			"component[].value[x]",
			"note[].text"
		]);
		let input = json!({"resourceType": "Observation", "code": {"text": "retained"}, "valueQuantity": {"value": 3, "unit": "retained"}, "valueUnregistered": "private", "component": [{"code": {"text": "retained"}, "valueString": "retained", "referenceRange": "private"}], "note": [{"text": "retained", "authorString": "private"}], "subject": {"reference": "private"}});
		assert_eq!(
			evaluate(input, settings).unwrap(),
			json!({"resourceType": "Observation", "code": {"text": "retained"}, "valueQuantity": {"value": 3, "unit": "retained"}, "component": [{"code": {"text": "retained"}, "valueString": "retained"}], "note": [{"text": "retained"}]})
		);
	}

	#[test]
	fn chat_json_string_preserves_envelope_tools_and_plain_text() {
		let private = json!({"resourceType": "Patient", "name": [{"text": "private"}]}).to_string();
		let input = json!({"model": "test", "stream": true, "messages": [{"role": "system", "content": "Be concise"}, {"role": "tool", "tool_call_id": "call_1", "content": private}], "tools": [{"type": "function", "function": {"name": "test", "parameters": {"type": "object", "properties": {"resourceType": {"type": "string"}}}}}]});
		let mut expected = input.clone();
		expected["messages"][1]["content"] = json!(json!({"resourceType": "Patient"}).to_string());
		assert_eq!(evaluate(input, profile()).unwrap(), expected);
	}

	#[test]
	fn chat_text_parts_preserve_nontext_parts_and_objects() {
		let input = json!({"messages": [{"role": "user", "content": [{"type": "text", "text": "{\"resourceType\":\"Patient\",\"id\":\"private\"}"}, {"type": "image_url", "image_url": {"url": "unchanged"}}, {"type": "text", "text": "hello"}]}, {"role": "user", "content": {"resourceType": "Condition", "code": "private"}}]});
		let mut expected = input.clone();
		expected["messages"][0]["content"][0]["text"] = json!("{\"resourceType\":\"Patient\"}");
		expected["messages"][1]["content"] = json!({"resourceType": "Condition"});
		assert_eq!(evaluate(input, profile()).unwrap(), expected);
	}

	#[test]
	fn responses_text_and_tool_outputs_keep_call_metadata() {
		let input = json!({"model": "test", "instructions": "{\"resourceType\":\"Patient\",\"id\":\"private\"}", "input": [{"role": "user", "content": [{"type": "input_text", "text": "{\"resourceType\":\"Observation\",\"valueString\":\"private\"}"}]}, {"type": "function_call_output", "call_id": "call_1", "output": "{\"resourceType\":\"Condition\",\"code\":\"private\"}"}, {"type": "function_call", "call_id": "call_1", "name": "read_record", "arguments": "{\"query\":\"unchanged\"}"}], "reasoning": {"effort": "low"}});
		let mut expected = input.clone();
		expected["instructions"] = json!("{\"resourceType\":\"Patient\"}");
		expected["input"][0]["content"][0]["text"] = json!("{\"resourceType\":\"Observation\"}");
		expected["input"][1]["output"] = json!("{\"resourceType\":\"Condition\"}");
		assert_eq!(evaluate(input, profile()).unwrap(), expected);
		assert_eq!(
			evaluate(
				json!({"input": "{\"resourceType\":\"Patient\",\"id\":\"private\"}"}),
				profile()
			)
			.unwrap(),
			json!({"input": "{\"resourceType\":\"Patient\"}"})
		);
	}

	#[test]
	fn wrapped_resources_are_filtered_and_nonfhir_json_text_is_byte_preserved() {
		let input = json!({"records": [{"data": {"resourceType": "Patient", "id": "private"}}], "ordinary": "  {\"answer\":  3}  "});
		assert_eq!(
			evaluate(input, profile()).unwrap(),
			json!({"records": [{"data": {"resourceType": "Patient"}}], "ordinary": "  {\"answer\":  3}  "})
		);
	}

	#[test]
	fn llm_extra_context_and_metadata_cannot_bypass_fhir_filtering() {
		let input = json!({"messages": [{"role": "user", "content": "hello"}], "context": {"record": {"resourceType": "Patient", "id": "private"}}, "metadata": {"ordinary": "unchanged", "record": "{\"resourceType\":\"Condition\",\"code\":\"private\"}"}, "text": {"format": {"type": "json_schema", "schema": {"properties": {"resourceType": {"type": "string"}}}}}});
		let mut expected = input.clone();
		expected["context"]["record"] = json!({"resourceType": "Patient"});
		expected["metadata"]["record"] = json!("{\"resourceType\":\"Condition\"}");
		assert_eq!(evaluate(input, profile()).unwrap(), expected);
	}

	#[test]
	fn historical_tool_arguments_are_filtered_without_altering_tool_definitions() {
		let record =
			"{\"record\":{\"resourceType\":\"Patient\",\"id\":\"private\"},\"query\":\"unchanged\"}";
		let filtered = json!({"record": {"resourceType": "Patient"}, "query": "unchanged"}).to_string();
		let input = json!({"messages": [{"role": "assistant", "content": null, "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "read_record", "arguments": record}}]}], "input": [{"type": "function_call", "call_id": "call_1", "name": "read_record", "arguments": record}], "tools": [{"type": "function", "name": "read_record", "parameters": {"properties": {"resourceType": {"type": "string"}}}}]});
		let mut expected = input.clone();
		expected["messages"][0]["tool_calls"][0]["function"]["arguments"] = json!(filtered);
		expected["input"][0]["arguments"] = json!(filtered);
		assert_eq!(evaluate(input, profile()).unwrap(), expected);
	}

	#[test]
	fn malformed_or_embedded_fhir_text_fails_instead_of_leaking() {
		for text in [
			"{\"resourceType\":\"Patient\",",
			"Analyze {\"resourceType\":\"Patient\",\"id\":\"private\"}",
			"```json\n{\"resourceType\":\"Patient\",\"id\":\"private\"}\n```",
		] {
			assert!(
				evaluate(json!({"input": text}), profile()).is_err(),
				"must reject {text}"
			);
		}
	}

	#[test]
	fn ordinary_bracketed_prose_and_nonfhir_code_are_preserved() {
		for text in [
			"[Follow these instructions]",
			"{hello}",
			"  {\"answer\":  3}  ",
		] {
			let input = json!({"input": text});
			assert_eq!(evaluate(input.clone(), profile()).unwrap(), input);
		}
	}

	#[test]
	fn nonfhir_json_text_protocol_key_collisions_and_schema_declarations_stay_exact() {
		for text in [
			r#"{"input":[1,2]}"#,
			r#"{"messages":"ordinary"}"#,
			r#"{"instructions":{"ordinary":true}}"#,
			r#"{"type":"object","properties":{"resourceType":{"type":"string"}}}"#,
			r#"{"messages":"ordinary","tools":[{"function":{"parameters":{"properties":{"resourceType":{"type":"string"}}}}}]}"#,
		] {
			let input = json!({"input": text});
			assert_eq!(evaluate(input.clone(), profile()).unwrap(), input);
		}
	}

	#[test]
	fn malformed_or_duplicate_outer_json_with_encoded_fhir_cannot_bypass() {
		for hidden in [
			r#"{"resourceType":"Patient","id":"PRIVATE"}"#.to_owned(),
			r#"{"res\u006furceType":"Patient","id":"PRIVATE"}"#.to_owned(),
		] {
			for encoded in [
				serde_json::to_string(&hidden).unwrap(),
				serde_json::to_string(&serde_json::to_string(&hidden).unwrap()).unwrap(),
			] {
				let malformed = format!("{{\"payload\": {encoded},");
				let duplicate = format!("{{\"payload\": {encoded}, \"payload\": \"ordinary\"}}");
				for text in [malformed, duplicate] {
					assert!(evaluate(json!({"input": text}), profile()).is_err());
				}
			}
		}
	}

	#[test]
	fn true_branch_notice_merge_is_filtered_after_the_whole_conditional() {
		let input = json!({"model": "test", "messages": [{"role": "user", "content": "{\"resourceType\":\"Patient\",\"id\":\"PRIVATE\"}"}]}).to_string();
		let expression = r#"toJson((true ? (json(args.input).with(b, b.merge({"messages": [{"role": "system", "content": "NOTICE"}] + b.messages}))) : json(args.input)).with(f, true ? filterFhir(f, args.profile) : f))"#;
		let output = evaluate_expression(json!(input), profile(), expression).unwrap();
		let output: JsonValue = serde_json::from_str(output.as_str().unwrap()).unwrap();
		assert_eq!(
			output,
			json!({"model": "test", "messages": [{"role": "system", "content": "NOTICE"}, {"role": "user", "content": "{\"resourceType\":\"Patient\"}"}]})
		);
	}

	#[test]
	fn metadata_in_messages_input_items_and_unknown_parts_is_also_protected() {
		let input = json!({"messages": [{"role": "user", "context": {"resourceType": "Patient", "id": "private"}, "content": [{"type": "text", "text": "hello", "metadata": {"resourceType": "Condition", "code": "private"}}, {"type": "custom", "data": {"resourceType": "Observation", "valueString": "private"}}]}], "input": [{"type": "message", "role": "user", "content": "hello", "metadata": {"resourceType": "Patient", "id": "private"}}]});
		let mut expected = input.clone();
		expected["messages"][0]["context"] = json!({"resourceType": "Patient"});
		expected["messages"][0]["content"][0]["metadata"] = json!({"resourceType": "Condition"});
		expected["messages"][0]["content"][1]["data"] = json!({"resourceType": "Observation"});
		expected["input"][0]["metadata"] = json!({"resourceType": "Patient"});
		assert_eq!(evaluate(input, profile()).unwrap(), expected);
	}

	#[test]
	fn tool_descriptions_are_protected_but_schema_declarations_stay_exact() {
		let input = json!({"messages": [{"role": "user", "content": "hello"}], "tools": [{"type": "function", "function": {"name": "read_record", "description": "{\"resourceType\":\"Patient\",\"id\":\"private\"}", "parameters": {"type": "object", "properties": {"resourceType": {"type": "string"}}, "required": ["resourceType"]}}}]});
		let mut expected = input.clone();
		expected["tools"][0]["function"]["description"] = json!("{\"resourceType\":\"Patient\"}");
		assert_eq!(evaluate(input, profile()).unwrap(), expected);
		assert!(evaluate(json!({"messages": [], "tools": [{"function": {"parameters": {"examples": [{"resourceType": "Patient", "id": "private"}]}}}]}), profile()).is_err());
	}

	#[test]
	fn duplicated_json_keys_and_malformed_unicode_markers_fail_closed() {
		for text in [
			"{\"record\":{\"resourceType\":\"Patient\",\"id\":\"private\"},\"record\":{\"ordinary\":1}}",
			"{\"res\\u006furceType\":\"Patient\",\"id\":\"private\",",
			"Analyze {\"res\\u006furceType\":\"Patient\",\"id\":\"private\"}",
		] {
			assert!(
				evaluate(json!({"input": text}), profile()).is_err(),
				"must reject {text}"
			);
		}
	}

	#[test]
	fn scalar_retained_leaves_and_choice_types_cannot_carry_arbitrary_objects() {
		for (resource, path, field, value) in [
			(
				"Patient",
				"birthDate",
				"birthDate",
				json!({"secret": "private"}),
			),
			(
				"Patient",
				"telecom[].value",
				"telecom",
				json!([{"value": {"secret": "private"}}]),
			),
			(
				"Patient",
				"identifier[].value",
				"identifier",
				json!([{"value": ["private"]}]),
			),
			(
				"Condition",
				"note[].text",
				"note",
				json!([{"text": {"secret": "private"}}]),
			),
			(
				"Observation",
				"value[x]",
				"valueString",
				json!({"secret": "private"}),
			),
			(
				"Observation",
				"value[x]",
				"valueBoolean",
				json!({"secret": "private"}),
			),
			("Observation", "value[x]", "valueQuantity", json!("private")),
		] {
			let mut settings = profile();
			settings["allow_fields"][resource] = json!([path]);
			let mut input = json!({"resourceType": resource});
			input[field] = value;
			assert!(
				evaluate(input, settings).is_err(),
				"must reject invalid {resource}.{path}"
			);
		}
	}

	#[test]
	fn excess_encoded_json_layers_fail_closed() {
		let mut text = "{\"resourceType\":\"Patient\",\"id\":\"private\"}".to_owned();
		for _ in 0..9 {
			text = serde_json::to_string(&text).unwrap();
		}
		assert!(evaluate(json!({"input": text}), profile()).is_err());
	}

	#[test]
	fn encoded_resource_type_keys_and_nested_json_strings_do_not_bypass() {
		let text = "{\"res\\u006furceType\":\"Patient\",\"id\":\"private\"}";
		assert_eq!(
			evaluate(json!({"input": text}), profile()).unwrap(),
			json!({"input": "{\"resourceType\":\"Patient\"}"})
		);
		let text = serde_json::to_string(&"{\"resourceType\":\"Patient\",\"id\":\"private\"}").unwrap();
		assert_eq!(
			evaluate(json!({"input": text}), profile()).unwrap(),
			json!({"input": serde_json::to_string(&"{\"resourceType\":\"Patient\"}").unwrap()})
		);
	}

	#[test]
	fn profile_rejects_unreviewed_fields_versions_and_prototype_keys() {
		for invalid in [
			json!({"version": 2, "allow_fields": {}}),
			json!({"version": 1, "allow_fields": {}, "extra": true}),
			json!({"version": 1, "allow_fields": {"Practitioner": []}}),
			json!({"version": 1, "allow_fields": {"Patient": ["resourceType"]}}),
			json!({"version": 1, "allow_fields": {"Patient": ["name[]", "name[]"]}}),
			json!({"version": 1, "allow_fields": {"Patient": {"birthDate": true}}}),
			json!({"version": 1, "allow_fields": {"Patient": ["__proto__"]}}),
			json!({"version": 1, "allow_fields": {"__proto__": []}}),
			json!({"version": 1, "allow_fields": {"constructor": []}}),
			json!([]),
			json!(null),
		] {
			assert!(evaluate(json!({"resourceType": "Patient"}), invalid).is_err());
		}
	}

	#[test]
	fn invalid_resource_or_structural_container_shapes_fail() {
		for input in [
			json!({"resourceType": 3}),
			json!({"resourceType": ""}),
			json!({"resourceType": "Patient", "contained": {"resourceType": "Condition"}}),
			json!({"resourceType": "Patient", "contained": [{"code": "private"}]}),
			json!({"resourceType": "Bundle", "entry": [{"resource": "private"}]}),
			json!({"resourceType": "Bundle", "entry": "private"}),
		] {
			assert!(evaluate(input, profile()).is_err());
		}
		let mut settings = profile();
		settings["allow_fields"]["Patient"] = json!(["telecom[].value"]);
		assert!(
			evaluate(
				json!({"resourceType": "Patient", "telecom": [{"value": "retained"}, "private"]}),
				settings
			)
			.is_err()
		);
	}

	#[test]
	fn resource_id_is_unconditionally_removed_and_exceptions_are_resource_scoped() {
		let mut settings = profile();
		settings["allow_fields"]["Patient"] = json!(["birthDate"]);
		assert_eq!(evaluate(json!([{"resourceType": "Patient", "birthDate": "retained", "id": "private"}, {"resourceType": "CustomRecord", "birthDate": "private", "id": "private"}]), settings).unwrap(), json!([{"resourceType": "Patient", "birthDate": "retained"}, {"resourceType": "CustomRecord"}]));
	}

	#[test]
	fn depth_nodes_bytes_and_parse_limits_fail_closed() {
		let mut deep = json!("private");
		for _ in 0..66 {
			deep = json!({"child": deep});
		}
		assert!(evaluate(deep, profile()).is_err());
		assert!(evaluate(json!(vec![json!(null); 100_001]), profile()).is_err());
		assert!(evaluate(json!({"input": "x".repeat(4 * 1024 * 1024 + 1)}), profile()).is_err());
		assert!(evaluate(json!({"messages": (0..257).map(|_| json!({"role": "user", "content": "{\"resourceType\":\"Patient\"}"})).collect::<Vec<_>>()}), profile()).is_err());
	}
}
