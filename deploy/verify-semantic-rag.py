"""Fixture-only real Embedding, Neo4j semantic/combined retrieval and cited answer verification."""
from pathlib import Path
from urllib.request import Request, build_opener, ProxyHandler
from urllib.parse import urlencode
from neo4j import GraphDatabase
import argparse, json, re, time, uuid
parser=argparse.ArgumentParser()
parser.add_argument('--model',action='store_true',help='Embed fixture documents/questions and generate two fixture-only cited answers')
args=parser.parse_args()
if not args.model:parser.error('--model is required for external model calls')
root=Path(__file__).resolve().parents[1]
secrets=json.loads((root/'.runtime/secrets.local.json').read_text(encoding='utf-8-sig'))
http=build_opener(ProxyHandler({}))
headers={'Content-Type':'application/json','tenant-id':'1'}
base='http://127.0.0.1:48080/admin-api'
def api(path,body=None,method=None,raw=None,extra=None):
    data=raw if raw is not None else None if body is None else json.dumps(body).encode()
    with http.open(Request(base+path,data=data,headers=headers | (extra or {}),method=method),timeout=240) as response:
        result=json.load(response)
    if result['code']!=0:raise RuntimeError(f"{path.split('?')[0]}: {result.get('msg')}")
    return result.get('data')
def wait(check,label):
    end=time.monotonic()+150
    while time.monotonic()<end:
        value=check()
        if value:return value
        time.sleep(1)
    raise AssertionError('Timed out: '+label)
login=api('/system/auth/login',{'username':secrets['AdminUsername'],'password':secrets['AdminPassword']})
headers['Authorization']='Bearer '+login['accessToken']
kb=None;documents=[];sessions=[]
def upload(title,text):
    boundary='Semantic'+uuid.uuid4().hex
    body=f'--{boundary}\r\nContent-Disposition: form-data; name="knowledgeBaseId"\r\n\r\n{kb}\r\n--{boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n{title}\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="semantic-fixture.md"\r\nContent-Type: text/markdown\r\n\r\n{text}\r\n--{boundary}--\r\n'
    doc=int(api('/mes/assistant/document/upload',method='POST',raw=body.encode(),extra={'Content-Type':'multipart/form-data; boundary='+boundary})['id']);documents.append(doc)
    api('/mes/assistant/document/publish?'+urlencode({'id':doc,'published':'true','expectedVersion':1}),method='PUT')
    return doc
def search(query,strategy='SEMANTIC',mode='DOCUMENT'):
    return api('/mes/assistant/evidence/search',{'query':query,'knowledgeBaseIds':[kb],'mode':mode,'hops':2,'limit':10,'documentStrategy':strategy})
def current_sources():
    result={}
    for doc in documents:
        current=api('/mes/assistant/document?id='+str(doc))
        for chunk in current['chunks']:result[int(chunk['chunkId'])]=(doc,chunk)
    return result
try:
    embedding=api('/mes/assistant/embedding-config');chat=api('/mes/assistant/model-config')
    assert embedding['configured'] and chat['enabled'],'Configure both Embedding and chat first'
    marker=uuid.uuid4().hex[:8]
    fan,part,cause='验收风扇'+marker,'验收轴承'+marker,'验收润滑不足'+marker
    kb=int(api('/mes/assistant/base',{'name':'语义问答验收'+marker,'libraryType':'PERSONAL'}))
    first=upload('设备检修规程',f'# 检修规程\n[设备]{fan} —包含部件→ [部件]{part}\n旋转装置出现刺耳摩擦声时，应检查支承件是否缺少润滑脂；检修前断开电源。')
    second=upload('部件检查依据',f'# 检查依据\n[部件]{part} —可能原因→ [原因]{cause}\n轴承缺少润滑脂可能造成异常摩擦和噪声，应按维护规程检查并补充合适的润滑脂。')
    def ready():
        rows=api('/mes/assistant/documents?knowledgeBaseId='+str(kb))
        return rows if len(rows)==2 and all(r['vectorUsable'] and r['graphStatus']=='SYNCED' for r in rows) else None
    wait(ready,'fixture vector and graph ingestion')
    sources=current_sources()
    english='What checks address squealing during rotation?'
    keyword=search(english,'LEXICAL');assert not keyword['items'],'Expected the constructed English fixture question to have no lexical match'
    semantic=search(english)
    assert semantic['documentRetrieval']['effectiveStrategy']=='SEMANTIC' and not semantic['documentRetrieval']['degraded'] and semantic['items']
    for item in semantic['items']:
        doc,chunk=sources[int(item['chunkId'])]
        assert item['retrievalMethod']=='vector_cosine' and item['documentId']==doc and item['documentVersion']==1
        assert item['text']==chunk['content'] and item['chunkHash']==chunk['contentHash'] and item['startOffset']==chunk['startOffset'] and item['endOffset']==chunk['endOffset']
        assert item['retrievalDetails']['semanticRank']>=1 and 0<=item['retrievalDetails']['semanticScore']<=1
    combined=search(f'{fan}出现异响应检查什么？','COMBINED')
    assert combined['documentRetrieval']['effectiveStrategy']=='COMBINED' and not combined['documentRetrieval']['degraded']
    assert all(item['retrievalMethod']=='document_rrf' for item in combined['items'])
    mixed=search(f'请问{fan}与{cause}有哪些关联？','COMBINED','HYBRID')
    assert {i['sourceType'] for i in mixed['items']}=={'DOCUMENT','GRAPH'}
    assert any(len(p['relationIds'])==2 for p in mixed['graph']['paths'])
    answers=[]
    for mode,strategy,question in [
        ('DOCUMENT','SEMANTIC',english+' Please answer in Chinese based only on these sources and cite [1] style source numbers.'),
        ('HYBRID','COMBINED',f'根据资料，{fan}通过什么部件与{cause}关联？请按原文说明并用[1]等编号引用，不得把关联当成必然因果。')]:
        session=int(api('/mes/assistant/session',{'title':'语义问答验收'+marker}));sessions.append(session)
        result=api('/mes/assistant/message',{'sessionId':session,'question':question,'knowledgeBaseIds':[kb],'mode':mode,'hops':2,'documentStrategy':strategy})
        assert result['status']=='ANSWERED',result.get('message')
        refs=[int(n) for n in re.findall(r'\[(\d+)\]',result['answer'])]
        assert refs and all(1<=n<=len(result['citations']) for n in refs)
        assert result['documentRetrieval']['effectiveStrategy']==strategy
        if mode=='HYBRID':assert {c['evidence']['sourceType'] for c in result['citations']}=={'DOCUMENT','GRAPH'}
        else:assert all(c['evidence']['retrievalMethod']=='vector_cosine' for c in result['citations'])
        history=api('/mes/assistant/session?id='+str(session))['messages']
        assert len(history)==2 and all(m['documentStrategy']==strategy and m['documentRetrieval']['effectiveStrategy']==strategy for m in history)
        assert all(m['citations'] for m in history)
        answers.append({'mode':mode,'strategy':strategy,'citations':len(result['citations']),'savedStrategyVerified':True})
    api('/mes/assistant/document/publish?'+urlencode({'id':first,'published':'false','expectedVersion':1}),method='PUT')
    after=search(english)
    assert all(int(item['documentId'])!=first for item in after['items']),'Withdrawn document entered semantic results'
    assert api('/mes/assistant/embedding-config')==embedding and api('/mes/assistant/model-config')==chat
    print(json.dumps({'lexicalCrossLanguageMatches':len(keyword['items']),'semanticMatches':len(semantic['items']),'combinedVerified':True,'mixedGraphVerified':True,'withdrawalFilteredImmediately':True,'answers':answers},ensure_ascii=False))
finally:
    for session in sessions:api('/mes/assistant/session?id='+str(session),method='DELETE')
    for doc in documents:api('/mes/assistant/document?id='+str(doc),method='DELETE')
    if documents:
        connection=json.loads((root/'.runtime/neo4j/connection.local.json').read_text(encoding='utf-8-sig'))
        with GraphDatabase.driver(connection['uri'],auth=(connection['username'],connection['password'])) as driver:
            with driver.session(database=connection['database']) as graph:
                def removed():
                    vectors=graph.run('MATCH (n:FazeVectorChunk {tenantId:1}) WHERE n.documentId IN $ids RETURN count(n) AS n',ids=documents).single()['n']
                    relations=graph.run('MATCH ()-[r:FazeRelation {tenantId:1}]->() WHERE r.documentId IN $ids RETURN count(r) AS n',ids=documents).single()['n']
                    inactive=graph.run('MATCH (n:FazeVectorDocument {tenantId:1}) WHERE n.documentId IN $ids AND n.active=false RETURN count(n) AS n',ids=documents).single()['n']
                    return vectors==0 and relations==0 and inactive==len(documents)
                wait(removed,'fixture vector and graph cleanup')
    if kb:api('/mes/assistant/base?id='+str(kb),method='DELETE')
    try:api('/system/auth/logout',method='POST')
    except Exception:pass
print('Only fixture documents/questions were sent; fixture files and conversations cleaned.')
