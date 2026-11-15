"""Exercise the configured Embedding API with fixed test text; never sends knowledge files or prints credentials/vectors."""
from pathlib import Path
from urllib.request import Request, build_opener, ProxyHandler
import argparse
import json

parser = argparse.ArgumentParser()
parser.add_argument('--model', action='store_true', help='Call the external Embedding model with fixed test text')
parser.add_argument('--enable-default', action='store_true', help='Save text-embedding-3-small / 1536 if Embedding has not been enabled')
args = parser.parse_args()
if not args.model:
    parser.error('--model is required for the external API test')
root = Path(__file__).resolve().parents[1]
secrets = json.loads((root / '.runtime/secrets.local.json').read_text(encoding='utf-8-sig'))
http = build_opener(ProxyHandler({}))
headers = {'Content-Type': 'application/json', 'tenant-id': '1'}
base = 'http://127.0.0.1:48080/admin-api'

def api(path, body=None, method=None):
    request = Request(base + path, data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
    with http.open(request, timeout=100) as response:
        result = json.load(response)
    if result['code'] != 0:
        raise RuntimeError(f"{path}: {result.get('msg', 'Request failed')}")
    return result.get('data')

login = api('/system/auth/login', {'username': secrets['AdminUsername'], 'password': secrets['AdminPassword']})
headers['Authorization'] = 'Bearer ' + login['accessToken']
try:
    chat = api('/mes/assistant/model-config')
    embedding = api('/mes/assistant/embedding-config')
    assert embedding['connectionReady'], 'Save an OpenAI-compatible connection and key first'
    if args.enable_default and not embedding['enabled']:
        embedding = api('/mes/assistant/embedding-config', {'model': 'text-embedding-3-small', 'dimensions': 1536, 'enabled': True}, 'PUT')
    result = api('/mes/assistant/embedding-config/test', method='POST')
    assert result['connected'] and result['vectorCount'] == 1
    assert result['model'] == embedding['model'] and result['dimensions'] == embedding['dimensions']
    assert not any(k in result for k in ('apiKey', 'vectors', 'embedding'))
    assert api('/mes/assistant/model-config') == chat, 'Chat configuration unexpectedly changed'
    print(json.dumps({k: result[k] for k in ('connected', 'model', 'dimensions', 'vectorCount', 'inputTokens')}, ensure_ascii=False))
finally:
    try:
        api('/system/auth/logout', method='POST')
    except Exception:
        pass
