"""Explicit --model exercise of the configured model using only newly constructed local test files. Cleans its own files and conversations."""
from pathlib import Path
from urllib.request import Request, build_opener, ProxyHandler
from urllib.parse import urlencode
import argparse, json, time, uuid, re
parser = argparse.ArgumentParser()
parser.add_argument("--model", action="store_true", help="Send two fixture-only questions to the configured model")
args = parser.parse_args()
if not args.model: parser.error("--model is required to exercise the external model")

root = Path(__file__).resolve().parents[1]
secrets = json.loads((root / '.runtime/secrets.local.json').read_text(encoding='utf-8-sig'))
http = build_opener(ProxyHandler({}))
headers = {'Content-Type': 'application/json', 'tenant-id': '1'}
base = 'http://127.0.0.1:48080/admin-api'

def api(path, body=None, method=None, raw=None, extra=None, denied=False):
    data = raw if raw is not None else None if body is None else json.dumps(body).encode()
    with http.open(Request(base + path, data=data, headers=headers | (extra or {}), method=method), timeout=120) as response:
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
entity, part, cause = '验收装置' + marker, '验收轴承' + marker, '验收润滑不足' + marker
kb = None
documents, sessions, results = [], [], []
try:
    assert api('/mes/assistant/status')['configured'], 'Configure the model before this verification'
    kb = int(api('/mes/assistant/base', {'name': '问答验收' + marker, 'libraryType': 'PERSONAL'}))
    first = upload('装置部件资料' + marker, f'[设备]{entity} —包含部件→ [部件]{part}')
    second = upload('部件原因资料' + marker, f'[部件]{part} —可能原因→ [原因]{cause}')
    for mode in ('GRAPH', 'HYBRID'):
        session = int(api('/mes/assistant/session', {'title': '问答验收' + marker}))
        sessions.append(session)
        result = api('/mes/assistant/message', {'sessionId': session, 'question': f'根据当前资料，{entity}通过哪个部件与{cause}关联？请按资料关系说明并用[1]等编号引用来源；不能据此断言故障必然发生。', 'knowledgeBaseIds': [kb], 'mode': mode, 'hops': 2})
        assert result['status'] == 'ANSWERED', f"{mode}: {result.get('message')}"
        assert result['answer']
        refs = [int(n) for n in re.findall(r'\[(\d+)\]', result['answer'])]
        assert refs and all(1 <= n <= len(result['citations']) for n in refs)
        types = {c['evidence']['sourceType'] for c in result['citations']}
        assert types == ({'GRAPH'} if mode == 'GRAPH' else {'GRAPH', 'DOCUMENT'})
        assert {int(c['documentId']) for c in result['citations']} == {first, second}
        history = api('/mes/assistant/session?' + urlencode({'id': session}))['messages']
        assert len(history) == 2 and all(m['retrievalMode'] == mode for m in history)
        assert history[1]['content'] == result['answer']
        results.append({'mode': mode, 'status': result['status'], 'model': result.get('model'), 'citations': len(result['citations']), 'references': refs, 'savedHistory': 'verified'})
    empty_session = int(api('/mes/assistant/session', {'title': '无证据验收' + marker}))
    sessions.append(empty_session)
    empty = api('/mes/assistant/message', {'sessionId': empty_session, 'question': '完全不存在的实体和关系' + marker, 'knowledgeBaseIds': [kb], 'mode': 'GRAPH', 'hops': 2})
    assert empty['status'] == 'NO_EVIDENCE' and empty['answer'] is None
    api('/mes/assistant/document/publish?' + urlencode({'id': second, 'published': 'false'}), method='PUT')
    visible = api('/mes/assistant/evidence/search', {'query': entity, 'knowledgeBaseIds': [kb], 'mode': 'GRAPH', 'hops': 2, 'limit': 10})
    assert all(int(e['documentId']) != second for e in visible['items'])
finally:
    for session in sessions:
        api('/mes/assistant/session?' + urlencode({'id': session}), method='DELETE')
    for doc in documents:
        api('/mes/assistant/document?' + urlencode({'id': doc}), method='DELETE')
    if kb is not None:
        api('/mes/assistant/base?' + urlencode({'id': kb}), method='DELETE')
    api('/system/auth/logout', {}, method='POST')
print(json.dumps({'modelAnswers': results, 'noEvidence': 'passed', 'withdrawal': 'passed', 'cleanup': 'completed'}, ensure_ascii=False))
