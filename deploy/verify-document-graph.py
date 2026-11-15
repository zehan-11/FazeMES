"""Authenticated end-to-end file/graph verification. Creates and removes its own UUID-scoped documents."""
from pathlib import Path
from urllib.request import Request,urlopen,build_opener,ProxyHandler
from urllib.parse import urlencode
import argparse,json,time,uuid,subprocess,shutil
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--exercise-retry',action='store_true');args=parser.parse_args()
secrets=json.loads((root/'.runtime/secrets.local.json').read_text(encoding='utf-8-sig'))
base='http://127.0.0.1:48080/admin-api';headers={'Content-Type':'application/json','tenant-id':'1'}
http=build_opener(ProxyHandler({}))
def api(path,body=None,method=None,raw=None,extra=None):
    data=raw if raw is not None else None if body is None else json.dumps(body).encode()
    with http.open(Request(base+path,data=data,headers=headers|(extra or {}),method=method),timeout=30) as response: result=json.load(response)
    assert result['code']==0,f"{path.split('?')[0]}: {result.get('code')} {result.get('msg')}"
    return result.get('data')
def until(fn,label):
    end=time.monotonic()+100
    while time.monotonic()<end:
        result=fn()
        if result:return result
        time.sleep(1)
    raise AssertionError('Timed out: '+label)
def graph():
    result=api('/mes/knowledge-graph/overview?limit=200')
    assert not result['hasMore'],'Verification requires a graph below overview capacity (200 nodes / 500 relations)'
    return result
def upload(base_id,title,text):
    boundary='GraphUpload'+uuid.uuid4().hex
    parts=[f'--{boundary}\r\nContent-Disposition: form-data; name="knowledgeBaseId"\r\n\r\n{base_id}\r\n',f'--{boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n{title}\r\n',f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="relations.md"\r\nContent-Type: text/markdown\r\n\r\n{text}\r\n',f'--{boundary}--\r\n']
    return api('/mes/assistant/document/upload',method='POST',raw=''.join(parts).encode(),extra={'Content-Type':'multipart/form-data; boundary='+boundary})['id']
def publish(doc,value):api('/mes/assistant/document/publish?'+urlencode({'id':doc,'published':str(value).lower()}),method='PUT')
def docs():return api('/mes/assistant/documents?'+urlencode({'knowledgeBaseId':base_id}))
def state(doc):return next(row for row in docs() if int(row['id'])==int(doc))
def edges_from(doc):return [e for e in graph()['relations'] if str(e['sourceEvidence'].get('documentId'))==str(doc)]
def neo(action):
    # File redirection avoids inherited PIPE handles held open by Windows background services.
    with (root/'.runtime/logs/document-graph-neo4j-control.log').open('a',encoding='utf-8') as log:
        subprocess.run([shutil.which('pwsh') or 'pwsh','-NoProfile','-File',str(root/'deploy/neo4j-local.ps1'),'-Action',action],cwd=root,check=True,stdout=log,stderr=subprocess.STDOUT,timeout=120)
login=api('/system/auth/login',{'username':secrets['AdminUsername'],'password':secrets['AdminPassword']})
headers['Authorization']='Bearer '+login['accessToken']
base_id=None;created=[];stopped=False
try:
    initial=graph();marker='文档关系-'+uuid.uuid4().hex[:10]
    base_id=api('/mes/assistant/base',{'name':marker,'description':''})
    first_text=f'# 结构\n[设备]{marker}风扇 —包含部件→ [部件]{marker}电机\n[部件]{marker}电机 —包含部件→ [部件]{marker}轴承'
    first=upload(base_id,marker+'结构',first_text);created.append(first)
    assert state(first)['graphStatus']=='READY' and not edges_from(first)
    if args.exercise_retry:stopped=True;neo('Stop')
    publish(first,True)
    if args.exercise_retry:
        until(lambda:state(first)['graphStatus']=='ERROR','durable failure status')
        neo('Start');stopped=False
    until(lambda:state(first)['graphStatus']=='SYNCED','first document sync')
    first_edges=edges_from(first);assert len(first_edges)==2
    for edge in first_edges:
        source=edge['sourceEvidence'];assert int(source['documentVersion'])==1 and source['chunkId'] and len(source['chunkHash'])==64
        assert first_text[int(source['startOffset']):int(source['endOffset'])]==source['excerpt']
    api('/mes/assistant/document/graph/rebuild?'+urlencode({'id':first}),method='POST')
    until(lambda:state(first)['graphStatus']=='SYNCED','idempotent retry');assert len(edges_from(first))==2
    second=upload(base_id,marker+'检查',f'[部件]{marker}电机 —关联现象→ [故障]{marker}异响');created.append(second);publish(second,True)
    until(lambda:state(second)['graphStatus']=='SYNCED','second document sync');assert len(edges_from(second))==1
    publish(first,False);until(lambda:not edges_from(first),'withdraw graph cleanup');assert len(edges_from(second))==1
    summary={'filePublishSync':'passed','provenance':'document/version/chunk/hash/offset verified','retry':'outage and recovery passed' if args.exercise_retry else 'manual rebuild passed','sharedSourceRetention':'passed'}
finally:
    if stopped:neo('Start')
    if base_id is not None:
        for doc in created:api('/mes/assistant/document?'+urlencode({'id':doc}),method='DELETE')
        if created:until(lambda:not any(str(e['sourceEvidence'].get('documentId')) in {str(d) for d in created} for e in graph()['relations']),'deleted document graph cleanup')
        api('/mes/assistant/base?'+urlencode({'id':base_id}),method='DELETE')
    remaining=graph()
    assert {n['id'] for n in remaining['nodes']}=={n['id'] for n in initial['nodes']},'Original nodes changed'
    assert {e['id'] for e in remaining['relations']}=={e['id'] for e in initial['relations']},'Original relations changed'
    api('/system/auth/logout',{},method='POST')
print(json.dumps(summary,ensure_ascii=False))
