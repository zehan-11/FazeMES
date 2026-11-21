"""Local authenticated lifecycle verification; only updates/removes its own UUID-named files."""
from pathlib import Path
from urllib.request import Request,build_opener,ProxyHandler
from urllib.parse import urlencode
from neo4j import GraphDatabase
import argparse,json,time,uuid,subprocess,shutil,hashlib
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--exercise-retry',action='store_true');parser.add_argument('--manual',action='store_true');args=parser.parse_args()
secrets=json.loads((root/'.runtime/secrets.local.json').read_text(encoding='utf-8-sig'))
connection=json.loads((root/'.runtime/neo4j/connection.local.json').read_text(encoding='utf-8-sig'))
http=build_opener(ProxyHandler({}));headers={'Content-Type':'application/json','tenant-id':'1'};base='http://127.0.0.1:48080/admin-api'
def api(path,body=None,method=None,raw=None,extra=None,allow_failure=False):
    data=raw if raw is not None else None if body is None else json.dumps(body).encode()
    with http.open(Request(base+path,data=data,headers=headers|(extra or {}),method=method),timeout=30) as response:result=json.load(response)
    if allow_failure:return result
    assert result['code']==0,f"{path.split('?')[0]}: {result.get('code')} {result.get('msg')}"
    return result.get('data')
def until(fn,label):
    end=time.monotonic()+120
    while time.monotonic()<end:
        result=fn()
        if result:return result
        time.sleep(1)
    raise AssertionError('Timed out: '+label)
def graph():
    # Managed read retries discard pooled sockets invalidated by the deliberate server restart.
    def snapshot(tx):
        nodes=tx.run('MATCH(n:FazeEntity) WHERE n.tenantId=1 AND n.ownerId=1 RETURN n.id AS id,properties(n) AS p').data()
        edges=tx.run('MATCH(a:FazeEntity)-[r:FazeRelation]->(b:FazeEntity) WHERE a.tenantId=1 AND a.ownerId=1 AND b.tenantId=1 AND b.ownerId=1 AND r.tenantId=1 AND r.ownerId=1 RETURN r.id AS id,a.id AS source,b.id AS target,properties(r) AS p').data()
        return {'nodes':{n['id']:n for n in nodes},'relations':{e['id']:e for e in edges}}
    with driver.session(database=connection['database']) as session:return session.execute_read(snapshot)
def edges_from(doc):return [e for e in graph()['relations'].values() if int(e['p'].get('documentId') or 0)==int(doc)]
def file_request(route,fields,text,filename):
    boundary='VersionUpload'+uuid.uuid4().hex;parts=[]
    for key,value in fields.items():parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n')
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: text/markdown\r\n\r\n{text}\r\n--{boundary}--\r\n')
    return api('/mes/assistant/document/'+route,method='POST',raw=''.join(parts).encode(),extra={'Content-Type':'multipart/form-data; boundary='+boundary},allow_failure=route=='update')
def upload(title,text):return file_request('upload',{'knowledgeBaseId':base_id,'title':title},text,'v1.md')['id']
def replace(doc,version,text,allow_failure=False):
    result=file_request('update',{'id':doc,'expectedVersion':version,'title':marker},text,'v'+str(version+1)+'.md')
    if allow_failure:return result
    assert result['code']==0,result.get('msg');return result['data']
def publish(doc):api('/mes/assistant/document/publish?'+urlencode({'id':doc,'published':'true'}),method='PUT')
def state(doc):return next(row for row in api('/mes/assistant/documents?'+urlencode({'knowledgeBaseId':base_id})) if int(row['id'])==int(doc))
def remove(doc):api('/mes/assistant/document?'+urlencode({'id':doc}),method='DELETE');deleted.add(doc)
def neo(action):
    with (root/'.runtime/logs/document-version-neo4j-control.log').open('a',encoding='utf-8') as log:
        subprocess.run([shutil.which('pwsh') or 'pwsh','-NoProfile','-File',str(root/'deploy/neo4j-local.ps1'),'-Action',action],cwd=root,check=True,stdout=log,stderr=subprocess.STDOUT,timeout=120)
def download(doc,version):
    with http.open(Request(base+'/mes/assistant/document/download?'+urlencode({'id':doc,'version':version}),headers=headers),timeout=20) as response:return response.read()
login=api('/system/auth/login',{'username':secrets['AdminUsername'],'password':secrets['AdminPassword']});headers['Authorization']='Bearer '+login['accessToken']
driver=GraphDatabase.driver(connection['uri'],auth=(connection['username'],connection['password']))
base_id=None;created=[];deleted=set();stopped=False;initial=graph()
try:
    marker='版本同步-'+uuid.uuid4().hex[:10];base_id=api('/mes/assistant/base',{'name':marker,'description':''})
    old_text=f'{marker}风扇配备电机。' if args.manual else f'[部件]电机 —包含部件→ [部件]{marker}旧部件'
    first=upload(marker,old_text);created.append(first);publish(first);until(lambda:state(first)['graphStatus']=='SYNCED','v1 sync')
    original=api('/mes/assistant/document?'+urlencode({'id':first}));old_chunks=original['chunks'];assert len(edges_from(first))==1
    if args.manual: assert edges_from(first)[0]['p']['extractionMethod']=='manual_rules_v1'
    second=upload(marker+'共同来源','电机由轴承组成。' if args.manual else f'[部件]{marker}旧部件 —关联现象→ [故障]{marker}异响');created.append(second);publish(second);until(lambda:state(second)['graphStatus']=='SYNCED','second file sync')
    new_text=f'{marker}风扇配备叶轮。' if args.manual else f'[部件]电机 —包含部件→ [部件]{marker}新部件';result=replace(first,1,new_text);assert int(result['id'])==first and int(result['version'])==2
    assert state(first)['status']=='DRAFT';until(lambda:state(first)['graphStatus']=='READY','v2 draft cleanup');assert not edges_from(first) and len(edges_from(second))==1
    assert download(first,1)==old_text.encode() and download(first,2)==new_text.encode()
    archived=api('/mes/assistant/document?'+urlencode({'id':first,'version':1}));assert archived['contentText']==old_text and archived['chunks']==old_chunks
    revisions=api('/mes/assistant/document/versions?'+urlencode({'id':first}));assert [int(r['version']) for r in revisions]==[2,1]
    assert archived['fileSha256']==hashlib.sha256(old_text.encode()).hexdigest()
    assert replace(first,1,'过时的替换内容',True)['code']!=0
    publish(first);until(lambda:state(first)['graphStatus']=='SYNCED','v2 publication');evidence=edges_from(first)[0]['p'];assert int(evidence['documentVersion'])==2 and evidence['chunkId']!=old_chunks[0]['chunkId'];assert new_text[evidence['startOffset']:evidence['endOffset']]==evidence['sourceExcerpt']
    if args.manual: assert evidence['extractionMethod']=='manual_rules_v1' and evidence['targetOriginalName']=='叶轮'
    replace(first,2,'第三版保养记录，暂无明确关系。');until(lambda:state(first)['graphStatus']=='EMPTY','v3 empty cleanup');publish(first);until(lambda:state(first)['graphStatus']=='EMPTY','empty publication');assert not edges_from(first) and len(edges_from(second))==1
    assert len(api('/mes/assistant/document/versions?'+urlencode({'id':first})))==3
    if args.exercise_retry:
        stopped=True;neo('Stop');api('/mes/assistant/document/graph/rebuild?'+urlencode({'id':second}),method='POST');until(lambda:state(second)['graphStatus']=='ERROR','outage error persisted');remove(second);neo('Start');stopped=False
        until(lambda:not edges_from(second),'offline deletion recovery')
    else:remove(second);until(lambda:not edges_from(second),'deletion cleanup')
    summary={'inputFormat':'manual prose' if args.manual else 'explicit triples','fileUpdate':'v1/v2/v3 passed','historicalBytesAndChunks':'verified','staleVersionRejected':True,'sharedSources':'preserved','emptyVersionClearsOldGraph':True,'deleteRecovery':'outage passed' if args.exercise_retry else 'passed'}
finally:
    if stopped:neo('Start')
    for doc in created:
        if doc not in deleted:remove(doc)
    if created:until(lambda:not any(int(e['p'].get('documentId') or 0) in created for e in graph()['relations'].values()),'fixture cleanup')
    if base_id is not None:api('/mes/assistant/base?'+urlencode({'id':base_id}),method='DELETE')
    remaining=graph();assert remaining==initial,'Original graph changed';driver.close();api('/system/auth/logout',{},method='POST')
print(json.dumps(summary,ensure_ascii=False))
