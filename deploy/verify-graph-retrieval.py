"""Local evidence API lifecycle check. Never calls a model; cleans only its UUID-named files/library."""
from pathlib import Path
from urllib.request import Request, build_opener, ProxyHandler
from urllib.parse import urlencode
import json, time, uuid

root = Path(__file__).resolve().parents[1]
secrets = json.loads((root / '.runtime/secrets.local.json').read_text(encoding='utf-8-sig'))
http = build_opener(ProxyHandler({}))
headers = {'Content-Type': 'application/json', 'tenant-id': '1'}
base = 'http://127.0.0.1:48080/admin-api'

def api(path, body=None, method=None, raw=None, extra=None, denied=False):
    data = raw if raw is not None else None if body is None else json.dumps(body).encode()
    with http.open(Request(base + path, data=data, headers=headers | (extra or {}), method=method), timeout=60) as response:
        result = json.load(response)
    if denied:
        assert result['code'] != 0, path
        return
    assert result['code'] == 0, f"{path.split('?')[0]}: {result.get('code')} {result.get('msg')}"
    return result.get('data')

def until(check, label):
    end = time.monotonic() + 90
    while time.monotonic() < end:
        if check(): return
        time.sleep(1)
    raise AssertionError('Timed out: ' + label)

def upload(title, content, publish=True):
    boundary = 'Retrieval' + uuid.uuid4().hex
    body = f'--{boundary}\r\nContent-Disposition: form-data; name="knowledgeBaseId"\r\n\r\n{kb}\r\n--{boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n{title}\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="relations.md"\r\nContent-Type: text/markdown\r\n\r\n{content}\r\n--{boundary}--\r\n'
    doc = int(api('/mes/assistant/document/upload', method='POST', raw=body.encode(), extra={'Content-Type': 'multipart/form-data; boundary=' + boundary})['id'])
    documents.append(doc)
    if publish:
        api('/mes/assistant/document/publish?' + urlencode({'id': doc, 'published': 'true'}), method='PUT')
        until(lambda: next(d for d in api('/mes/assistant/documents?knowledgeBaseId=' + str(kb)) if int(d['id']) == doc)['graphStatus'] == 'SYNCED', 'graph sync')
    return doc

def search(mode='GRAPH', hops=2, query=None):
    return api('/mes/assistant/evidence/search', {'query': query or '请问' + entity + '的关联原因有哪些？', 'knowledgeBaseIds': [kb], 'mode': mode, 'hops': hops, 'limit': 10})

login = api('/system/auth/login', {'username': secrets['AdminUsername'], 'password': secrets['AdminPassword']})
headers['Authorization'] = 'Bearer ' + login['accessToken']
marker = uuid.uuid4().hex[:8]
entity, part, cause = '检索设备' + marker, '检索部件' + marker, '检索原因' + marker
kb = None
documents = []
try:
    kb = int(api('/mes/assistant/base', {'name': '检索验收' + marker, 'libraryType': 'PERSONAL'}))
    first = upload('第一跳' + marker, f'[设备]{entity} —包含部件→ [部件]{part}')
    second = upload('第二跳' + marker, f'[部件]{part} —可能原因→ [原因]{cause}')
    unrelated = upload('独立来源' + marker, f'[设备]独立设备{marker} —包含部件→ [部件]独立部件{marker}')
    draft = upload('草稿来源' + marker, f'[设备]{entity} —包含部件→ [部件]草稿部件{marker}', False)
    one, two = search(hops=1), search(hops=2)
    assert {int(e['documentId']) for e in one['items']} == {first}
    assert {int(e['documentId']) for e in two['items']} == {first, second}
    assert any(len(p['relationIds']) == 2 for p in two['graph']['paths'])
    assert all('独立' not in n['name'] and '草稿' not in n['name'] for n in two['graph']['nodes'])
    for mode, expected in [('DOCUMENT', {'DOCUMENT'}), ('GRAPH', {'GRAPH'}), ('HYBRID', {'DOCUMENT', 'GRAPH'})]:
        result = search(mode=mode, query=entity)
        assert result['mode'] == mode
        assert {e['sourceType'] for e in result['items']} == expected
        assert ('graph' in result) == (mode != 'DOCUMENT')
    assert not search(query='完全没有对应实体的提问')['graph']['matchedEntities']
    for edge in two['graph']['relations']:
        evidence = edge['evidence']
        doc = api('/mes/assistant/document?' + urlencode({'id': evidence['documentId']}))
        assert doc['version'] == evidence['documentVersion']
        assert doc['contentText'][evidence['startOffset']:evidence['endOffset']] == evidence['text']
    api('/mes/assistant/document/publish?' + urlencode({'id': second, 'published': 'false'}), method='PUT')
    assert {int(e['documentId']) for e in search()['items']} == {first}
    api('/mes/assistant/evidence/search', {'query': entity, 'mode': 'GRAPH', 'hops': 3}, denied=True)
    api('/mes/assistant/evidence/search', {'query': entity, 'mode': 'GRAPH', 'sources': ['DOCUMENT']}, denied=True)
    print(json.dumps({'modes': 'DOCUMENT/GRAPH/HYBRID passed', 'naturalEntityLinking': 'passed', 'hops': 'one/two passed', 'independentAndDraftSources': 'excluded', 'sourcePositionsAndVersions': 'verified', 'withdrawal': 'immediately excluded'}, ensure_ascii=False))
finally:
    for doc in documents:
        api('/mes/assistant/document?' + urlencode({'id': doc}), method='DELETE')
    if kb is not None:
        api('/mes/assistant/base?' + urlencode({'id': kb}), method='DELETE')
    api('/system/auth/logout', {}, method='POST')
