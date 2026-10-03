import json,sys
namespace={'__name__':'gateway_policy_connector'}
sys.stderr.reconfigure(encoding='utf-8')
payload=json.loads(sys.stdin.buffer.read().decode('utf-8'))
exec(payload['connector_source'],namespace)
try:
    result=namespace['compile_plan'](payload['documents'],set(payload['common_codes']),payload['mapping'],payload['functions'],payload['context'])
    sys.stdout.buffer.write(json.dumps(result,ensure_ascii=False).encode('utf-8'))
except (ValueError,TypeError,KeyError,IndexError) as error:
    print(str(error),file=sys.stderr)
    sys.exit(2)
