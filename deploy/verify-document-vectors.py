"""End-to-end vector ingestion using newly constructed fixture text and the configured external Embedding API."""
from pathlib import Path
from urllib.request import Request, build_opener, ProxyHandler
from urllib.parse import urlencode
from neo4j import GraphDatabase
import argparse, json, time, uuid
parser=argparse.ArgumentParser()
parser.add_argument('--model',action='store_true',help='Send only newly constructed fixture chunks to the configured Embedding model')
args=parser.parse_args()
if not args.model: parser.error('--model is required for external Embedding calls')
root=Path(__file__).resolve().parents[1]
secrets=json.loads((root/'.runtime/secrets.local.json').read_text(encoding='utf-8-sig'))
connection=json.loads((root/'.runtime/neo4j/connection.local.json').read_text(encoding='utf-8-sig'))
http=build_opener(ProxyHandler({}))
headers={'Content-Type':'application/json','tenant-id':'1'}
base='http://127.0.0.1:48080/admin-api'
def api(path,body=None,method=None,raw=None,extra=None):
    data=raw if raw is not None else None if body is None else json.dumps(body).encode()
    with http.open(Request(base+path,data=data,headers=headers | (extra or {}),method=method),timeout=30) as response:
        result=json.load(response)
    if result['code']!=0: raise RuntimeError(f"{path.split('?')[0]}: {result.get('msg')}")
    return result.get('data')
def until(check,label,seconds=120):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        result=check()
        if result:return result
        time.sleep(1)
    raise AssertionError('Timed out: '+label)
login=api('/system/auth/login',{'username':secrets['AdminUsername'],'password':secrets['AdminPassword']})
headers['Authorization']='Bearer '+login['accessToken']
kb=doc=None
with GraphDatabase.driver(connection['uri'],auth=(connection['username'],connection['password'])) as driver:
    with driver.session(database=connection['database']) as graph:
        try:
            config=api('/mes/assistant/embedding-config')
            assert config['configured'],'Enable Embedding before this verification'
            marker=uuid.uuid4().hex[:8]
            kb=int(api('/mes/assistant/base',{'name':'向量入库验收'+marker,'libraryType':'PERSONAL'}))
            content=('验收设备'+marker+'的检修资料：发现异常后按操作规程处理，记录结果并复核。\n')*45
            boundary='Vector'+uuid.uuid4().hex
            raw=(f'--{boundary}\r\nContent-Disposition: form-data; name="knowledgeBaseId"\r\n\r\n{kb}\r\n'
                 f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="vector-fixture.txt"\r\nContent-Type: text/plain\r\n\r\n{content}\r\n--{boundary}--\r\n').encode()
            doc=int(api('/mes/assistant/document/upload',method='POST',raw=raw,extra={'Content-Type':'multipart/form-data; boundary='+boundary})['id'])
            def row():return next(d for d in api('/mes/assistant/documents?knowledgeBaseId='+str(kb)) if int(d['id'])==doc)
            assert row()['vectorStatus']=='READY'
            assert graph.run('MATCH (n:FazeVectorChunk {tenantId:1,documentId:$doc}) RETURN count(n) AS n',doc=doc).single()['n']==0
            api('/mes/assistant/document/publish?'+urlencode({'id':doc,'published':'true','expectedVersion':1}),method='PUT')
            def indexed():
                current=row()
                if current['vectorStatus'] in ('WAITING_CONFIG','CONFIG_CHANGED','STALE') or current['vectorStatus']=='ERROR' and current['vectorAttempts']>=5:
                    raise AssertionError('Vector delivery failed: '+str(current.get('vectorError','')))
                return current if current['vectorStatus']=='INDEXED' else None
            result=until(indexed,'published document vector delivery')
            original=api('/mes/assistant/document?id='+str(doc))
            chunks={int(c['chunkId']):c for c in original['chunks']}
            rows=graph.run('MATCH (n:FazeVectorChunk {tenantId:1,documentId:$doc}) RETURN n.chunkId AS chunkId,n.documentVersion AS version,n.knowledgeBaseId AS base,n.chunkHash AS hash,n.startOffset AS start,n.endOffset AS end,n.text AS text,size(n.embedding) AS dimensions',doc=doc).data()
            assert len(rows)==len(chunks)==result['vectorChunkCount']==result['vectorCompletedChunks']
            for stored in rows:
                source=chunks[int(stored['chunkId'])]
                assert stored['version']==1 and stored['base']==kb and stored['dimensions']==config['dimensions']
                assert stored['hash']==source['contentHash'] and stored['text']==source['content']
                assert stored['start']==source['startOffset'] and stored['end']==source['endOffset']
            index=graph.run('SHOW INDEXES YIELD name,type,state WHERE name=$name RETURN type,state',name=result['vectorIndexName']).single()
            assert index['type']=='VECTOR' and index['state']=='ONLINE'
            print(json.dumps({'status':result['vectorStatus'],'chunks':len(rows),'model':result['vectorModel'],'dimensions':result['vectorDimensions'],'indexState':index['state'],'provenanceVerified':True},ensure_ascii=False))
        finally:
            if doc:
                api('/mes/assistant/document?id='+str(doc),method='DELETE')
                def cleaned():
                    checkpoint=graph.run('MATCH (d:FazeVectorDocument {tenantId:1,documentId:$doc}) RETURN d.active AS active',doc=doc).single()
                    return checkpoint is not None and checkpoint['active'] is False and graph.run('MATCH (n:FazeVectorChunk {tenantId:1,documentId:$doc}) RETURN count(n) AS n',doc=doc).single()['n']==0
                until(cleaned,'fixture vector cleanup')
            if kb:api('/mes/assistant/base?id='+str(kb),method='DELETE')
            try:api('/system/auth/logout',method='POST')
            except Exception:pass
print('Fixture document, knowledge base and vectors cleaned; existing files were not sent.')
