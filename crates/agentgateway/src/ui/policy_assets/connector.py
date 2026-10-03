"""Policy-card connector. No legal interpretation or gateway configuration generation."""
import argparse
import copy
import json
import re
from pathlib import Path


class ContractError(ValueError):
    pass


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def require(ok, message):
    if not ok:
        raise ContractError(message)


def text(value):
    return isinstance(value, str) and bool(value.strip()) and "<" not in value


def validate_condition(node):
    require(isinstance(node, dict) and len(node) == 1, "condition: exactly one operator required")
    op, value = next(iter(node.items()))
    if op == "constant":
        require(type(value) is bool, "condition.constant must be boolean")
    elif op in ("all", "any"):
        require(isinstance(value, list) and bool(value), "condition group must be nonempty")
        for child in value:
            validate_condition(child)
    elif op == "not":
        validate_condition(value)
    elif op in ("eq", "in", "exists"):
        require(isinstance(value, dict), "condition operand must be an object")
        require(set(value) == ({"fact"} if op == "exists" else {"fact", "value"}), "invalid condition operand")
        require(text(value.get("fact")), "condition requires fact reference")
        if op == "in":
            require(isinstance(value["value"], list), "condition.in value must be a list")
        elif op == "eq":
            require(value["value"] is None or type(value["value"]) in (str, int, float, bool), "condition.eq requires scalar")
    else:
        raise ContractError("unknown condition operator: " + op)


def compile_plan(documents, common_codes, mapping, functions, context=None):
    """Accept any packs/cards following the contract; dictionaries are injected data."""
    context = context or {"policies": []}
    require(isinstance(context, dict) and set(context) == {"policies"} and isinstance(context["policies"], list), "invalid context envelope")
    cards, packs = {}, []
    card_fields = {"law_id", "policy_id", "policy_text", "function", "legal_sources", "except"}
    for document in documents:
        require(isinstance(document, dict) and set(document) == {"policy_packs", "cards"}, "input requires policy_packs and cards")
        require(isinstance(document["cards"], list) and isinstance(document["policy_packs"], list), "cards/packs must be arrays")
        packs.extend(copy.deepcopy(document["policy_packs"]))
        for card in document["cards"]:
            require(isinstance(card, dict) and set(card) == card_fields, "card must have exactly six standard fields")
            require(all(text(card[k]) for k in ("law_id", "policy_id", "policy_text")), "card identifiers/text required")
            key = (card["law_id"], card["policy_id"])
            require(key not in cards, "duplicate card: " + str(key))
            cards[key] = copy.deepcopy(card)
    require(bool(packs), "at least one pack required")
    owners, priorities, pack_ids = {}, set(), set()
    for pack in packs:
        require(isinstance(pack, dict) and set(pack) == {"pack_id", "version", "priority", "cards"}, "invalid pack fields")
        require(text(pack["pack_id"]) and text(pack["version"]), "pack id/version required")
        require(pack["pack_id"] not in pack_ids, "duplicate pack id")
        require(type(pack["priority"]) is int and pack["priority"] not in priorities, "priorities must be unique integers")
        require(isinstance(pack["cards"], list) and bool(pack["cards"]), "pack cards must be nonempty")
        pack_ids.add(pack["pack_id"])
        priorities.add(pack["priority"])
        for ref in pack["cards"]:
            require(isinstance(ref, dict) and set(ref) == {"law_id", "policy_id"}, "invalid card reference")
            key = (ref["law_id"], ref["policy_id"])
            require(key in cards and key not in owners, "missing or multiply-owned card: " + str(key))
            owners[key] = pack
    require(set(cards) == set(owners), "unowned card")
    contexts = {}
    for item in context["policies"]:
        require(isinstance(item, dict) and set(item) <= {"law_id", "policy_id", "applies_when", "scope", "function_combination", "functions"}, "invalid policy context")
        key = (item.get("law_id"), item.get("policy_id"))
        require(key in cards and key not in contexts, "unknown/duplicate context card")
        if "applies_when" in item:
            validate_condition(item["applies_when"])
        if "scope" in item:
            require(isinstance(item["scope"], dict), "scope must be object")
        if "function_combination" in item:
            require(item["function_combination"] == "all", "only explicit all combination supported")
        params = item.get("functions", [])
        require(isinstance(params, list), "context functions must be array")
        seen = set()
        for entry in params:
            require(isinstance(entry, dict) and set(entry) == {"index", "parameters"}, "invalid function context")
            index = entry["index"]
            require(type(index) is int and index >= 0 and isinstance(cards[key]["function"], list) and index < len(cards[key]["function"]), "invalid function index")
            require(index not in seen and isinstance(entry["parameters"], dict), "duplicate index/invalid parameters")
            seen.add(index)
        contexts[key] = item
    function_index = {f["id"]: f for f in functions["functions"]}
    mapping_index = {m["object"]: m for m in mapping["objects"]}
    require(len(mapping_index) == len(mapping["objects"]), "duplicate mapping object")
    issues = []

    def pending(key, code, detail):
        issues.append({"law_id": key[0], "policy_id": key[1], "code": code, "detail": detail})

    output = []
    for pack in sorted(packs, key=lambda p: -p["priority"]):
        policies = []
        for ref in pack["cards"]:
            key = (ref["law_id"], ref["policy_id"])
            card = cards[key]
            ctx = contexts.get(key, {})
            require(card["except"] is None or isinstance(card["except"], list), "except must be null or array")
            exclusions = None if card["except"] is None else []
            if exclusions is None:
                pending(key, "EXCEPT_UNREVIEWED", "배제 관계 검토 필요; 빈 배열로 바꾸지 않음")
            else:
                seen_refs = set()
                for excluded in card["except"]:
                    require(isinstance(excluded, dict) and set(excluded) == {"law_id", "policy_id"}, "invalid except reference")
                    target = (excluded["law_id"], excluded["policy_id"])
                    require(target in owners and owners[target]["priority"] < pack["priority"], "except must reference lower-priority selected card")
                    require(target not in seen_refs, "duplicate except reference")
                    seen_refs.add(target)
                    exclusions.append({**excluded, "pack_id": owners[target]["pack_id"]})
                if exclusions:
                    pending(key, "CONDITIONAL_EXCLUSION", "어댑터가 적용 조건과 겹치는 범위를 요청마다 평가; 전역 삭제 금지")
            require(isinstance(card["legal_sources"], list) and bool(card["legal_sources"]), "legal sources required")
            for source in card["legal_sources"]:
                require(isinstance(source, dict) and set(source) == {"level", "law_name", "provision", "revision_no", "promulgation_date", "effective_date", "source_url"}, "invalid legal source fields")
                require(source["level"] in ("LAW", "ENFORCEMENT_DECREE", "ENFORCEMENT_RULE"), "invalid legal level")
                require(text(source["law_name"]) and text(source["provision"]) and isinstance(source["source_url"], str) and source["source_url"].startswith("https://"), "legal source identity/url required")
                for field in ("revision_no", "promulgation_date", "effective_date"):
                    require(source[field] is None or text(source[field]), "invalid source value")
                    if source[field] is None:
                        pending(key, "LEGAL_SOURCE_INCOMPLETE", field + " 확인 필요")
                    elif field.endswith("date"):
                        from datetime import date
                        try:
                            date.fromisoformat(source[field])
                        except ValueError:
                            raise ContractError("invalid legal source date")
            require(card["function"] is None or isinstance(card["function"], list), "function must be null or array")
            compiled = None if card["function"] is None else []
            if compiled is None:
                pending(key, "FUNCTION_UNREVIEWED", "기능 분류 필요")
            else:
                for index, func in enumerate(card["function"]):
                    require(isinstance(func, dict) and set(func) == {"function_id", "action", "object"}, "invalid function fields")
                    require(func["function_id"] in function_index, "unknown function id")
                    spec = function_index[func["function_id"]]
                    require(func["action"] in {a["action_id"] for a in spec["actions"]}, "unknown action for function")
                    obj = func["object"]
                    require(obj is None or isinstance(obj, str) and obj in common_codes, "unregistered object code")
                    target = {"object": obj, "status": "not_applicable", "mappings": []}
                    if obj is not None:
                        if obj in mapping_index:
                            entry = mapping_index[obj]
                            target = {k: copy.deepcopy(v) for k, v in entry.items() if k != "policy_ids"}
                            target["mapping_role"] = "candidate_only"
                            if entry["status"] != "non_fhir":
                                pending(key, "TARGET_SELECTION_REQUIRED", f"function[{index}]: FHIR 후보 경로의 분류·선택·실제 본문 위치 확정 필요")
                        else:
                            target["status"] = "unmapped"
                            pending(key, "MAPPING_MISSING", obj + " 매핑 없음")
                    parameters = next((p["parameters"] for p in ctx.get("functions", []) if p["index"] == index), {})
                    if not parameters:
                        pending(key, "ACTION_CONFIGURATION_REQUIRED", f"function[{index}]: {func['action']} 설정값/기본값 검증 필요")
                    compiled.append({**func, "traffic": spec["traffic"], "direction": spec["direction"], "target": target, "parameters": copy.deepcopy(parameters)})
            if "applies_when" not in ctx:
                pending(key, "APPLICABILITY_REQUIRED", "정책 문장에서 조건을 추론하지 않음; 검토된 적용 조건 필요")
            if "scope" not in ctx:
                pending(key, "SCOPE_REQUIRED", "적용 경로·시스템·데이터 범위 필요")
            combination = "all" if isinstance(compiled, list) and len(compiled) <= 1 else ctx.get("function_combination")
            if compiled and len(compiled) > 1 and combination is None:
                pending(key, "FUNCTION_COMBINATION_REQUIRED", "복수 후보를 모두 적용할지 검토 필요")
            policies.append({**card, "applies_when": copy.deepcopy(ctx.get("applies_when")), "scope": copy.deepcopy(ctx.get("scope")), "function_combination": combination, "function": compiled, "except": exclusions})
        output.append({"pack_id": pack["pack_id"], "version": pack["version"], "priority": pack["priority"], "policies": policies})
    return {"version": "1.1-draft", "status": "pending_adapter_resolution", "executable": False,
            "dictionaries": {"mapping": {"id": mapping["dictionary_id"], "version": mapping["version"]}, "functions": {"id": functions["dictionaryId"], "version": functions["version"]}},
            "policy_packs": output, "adapter_requirements": issues}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", nargs="+", required=True)
    parser.add_argument("--common", required=True)
    parser.add_argument("--mapping", required=True)
    parser.add_argument("--functions", required=True)
    parser.add_argument("--context")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        codes = set(re.findall(r"^\| `([A-Z][A-Z0-9_]*)`", Path(args.common).read_text(encoding="utf-8-sig"), re.M))
        require(bool(codes), "empty common dictionary")
        result = compile_plan([read_json(p) for p in args.input], codes, read_json(args.mapping), read_json(args.functions), read_json(args.context) if args.context else None)
        destination = Path(args.output)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".tmp")
        temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(destination)
    except (ContractError, OSError, ValueError, TypeError, KeyError) as exc:
        parser.exit(2, "Connector error: " + str(exc) + "\n")


if __name__ == "__main__":
    main()
