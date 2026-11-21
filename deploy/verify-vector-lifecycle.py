"""Fixture-only OpenAI/Neo4j verification of update, withdrawal, republish and deletion."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from urllib.request import Request, build_opener, ProxyHandler
from urllib.parse import urlencode
from neo4j import GraphDatabase
import argparse, json, time, uuid, shutil, subprocess

parser=argparse.ArgumentParser()
parser.add_argument('--model',action='store_true',help='Generate real vectors for two new fixture documents and their test versions')
parser.add_argument('--exercise-recovery',action='store_true',help='Temporarily stop and restart the local Neo4j service')
args=parser.parse_args()
if not args.model:parser.error('--model is required for external Embedding calls')
root=Path(__file__).resolve().parents[1]
secrets=json.loads((root/'.runtime/secrets.local.json').read_text(encoding='utf-8-sig'))
connection=json.loads((root/'.runtime/neo4j/connection.local.json').read_text(encoding='utf-8-sig'))
http=build_opener(ProxyHandler({}))
headers={'Content-Type':'application/json','tenant-id':'1'}
base='http://127.0.0.1:48080/admin-api'
def api(path,body=None,method=None,raw=None,extra=None,denied=False):
    data=raw if raw is not None else None if body is None else json.dumps(body).encode()
    with http.open(Request(base+path,data=data,headers=headers | (extra or {}),method=method),timeout=30) as response:
        result=json.load(response)
    if denied:
        assert result['code']!=0,'An obsolete or deleted source was accepted'
        return
    if result['code']!=0:raise RuntimeError(f"{path.split('?')[0]}: {result.get('msg')}")
    return result.get('data')
def wait(check,label):
    end=time.monotonic()+150
    while time.monotonic()<end:
        value=check()
        if value:return value
        time.sleep(1)
    raise AssertionError('Timed out: '+label)
def multipart(path,fields,text,denied=False):
    boundary='Lifecycle'+uuid.uuid4().hex
    body=''
    for key,value in fields.items():body+=f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'
    body+=f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="vector-lifecycle-fixture.txt"\r\nContent-Type: text/plain\r\n\r\n{text}\r\n--{boundary}--\r\n'
    return api(path,method='POST',raw=body.encode(),extra={'Content-Type':'multipart/form-data; boundary='+boundary},denied=denied)
login=api('/system/auth/login',{'username':secrets['AdminUsername'],'password':secrets['AdminPassword']})
headers['Authorization']='Bearer '+login['accessToken']
kb=None
owned={}

def set_neo4j(action):
    shell=shutil.which('pwsh')
    if shell is None:raise RuntimeError('PowerShell 7 is required for the Neo4j recovery test')
    subprocess.run([shell,'-NoProfile','-File',str(root/'deploy/neo4j-local.ps1'),'-Action',action],cwd=root,check=True,timeout=120)

with GraphDatabase.driver(connection['uri'],auth=(connection['username'],connection['password'])) as driver:
    with driver.session(database=connection['database']) as graph:
        def stored(doc):
            return graph.execute_read(lambda tx:tx.run('MATCH (n:FazeVectorChunk {tenantId:1,documentId:$doc}) RETURN n.chunkId AS id,n.chunkHash AS hash,n.documentVersion AS version,n.text AS text,n.startOffset AS start,n.endOffset AS end,n.knowledgeBaseId AS base,size(n.embedding) AS dimensions ORDER BY n.chunkId',doc=doc).data())
        def cleared(doc):
            # Managed reads reconnect pooled Bolt sockets invalidated by the deliberate restart.
            def check(tx):
                checkpoint=tx.run('MATCH (n:FazeVectorDocument {tenantId:1,documentId:$doc}) RETURN n.active AS active',doc=doc).single()
                count=tx.run('MATCH (n:FazeVectorChunk {tenantId:1,documentId:$doc}) RETURN count(n) AS n',doc=doc).single()['n']
                return checkpoint is not None and checkpoint['active'] is False and count==0
            return graph.execute_read(check)
        def row(doc):return next(r for r in api('/mes/assistant/documents?knowledgeBaseId='+str(kb)) if int(r['id'])==doc)
        def indexed(doc,version):
            def check():
                current=row(doc)
                if current['vectorStatus'] in ('WAITING_CONFIG','CONFIG_CHANGED','STALE') or current['vectorStatus']=='ERROR' and current['vectorAttempts']>=5:
                    raise AssertionError('Vector task failed: '+str(current.get('vectorError','')))
                return current if current['vectorStatus']=='INDEXED' and current['vectorUsable'] and current['vectorIndexedVersion']==version else None
            return wait(check,'version '+str(version)+' index')
        def publish(doc,version,enabled=True):api('/mes/assistant/document/publish?'+urlencode({'id':doc,'published':str(enabled).lower(),'expectedVersion':version}),method='PUT')
        def not_retrieved(doc,query):
            found=api('/mes/assistant/search',{'query':query,'knowledgeBaseIds':[kb],'limit':10})
            assert all(int(item['documentId'])!=doc for item in found['items'])
        try:
            config=api('/mes/assistant/embedding-config');chat=api('/mes/assistant/model-config')
            assert config['configured'],'Enable Embedding first'
            marker=uuid.uuid4().hex[:8]
            kb=int(api('/mes/assistant/base',{'name':'向量生命周期验收'+marker,'libraryType':'PERSONAL'}))
            old='OLDLIFECYCLE'+marker+' 原版规程：设备完成点检后，记录检查结果并复核。'
            new='NEWLIFECYCLE'+marker+' 新版规程：设备点检发现异常时暂停运行，完成复核后再按规程处理。'
            first=int(multipart('/mes/assistant/document/upload',{'knowledgeBaseId':kb,'title':'生命周期主文档'},old)['id']);owned[first]=False
            other=int(multipart('/mes/assistant/document/upload',{'knowledgeBaseId':kb,'title':'保留对照文档'},old)['id']);owned[other]=False
            publish(first,1);publish(other,1);initial=indexed(first,1);indexed(other,1)
            preserved=stored(other);initial_rows=stored(first)
            assert preserved and initial_rows and preserved[0]['hash']==initial_rows[0]['hash']
            publish(first,1)
            assert row(first)['vectorUsable'] and row(first)['vectorStatus']=='INDEXED' and row(first)['vectorSyncedAt']==initial['vectorSyncedAt']
            multipart('/mes/assistant/document/update',{'id':first,'expectedVersion':0},new,denied=True)
            assert row(first)['version']==1 and row(first)['vectorUsable']
            barrier=Barrier(2,timeout=10)
            def replace_from_v1(text):
                barrier.wait()
                try:
                    return multipart('/mes/assistant/document/update',{'id':first,'expectedVersion':1},text),text
                except RuntimeError as error:
                    if '文档版本已变更' not in str(error):raise
                    return None,text
            with ThreadPoolExecutor(max_workers=2) as executor:
                outcomes=list(executor.map(replace_from_v1,[new,new+' 补充：保留复核记录。']))
            winners=[(result,text) for result,text in outcomes if result is not None]
            assert len(winners)==1,'Exactly one replacement of version 1 must succeed'
            replacement,new=winners[0]
            assert replacement['version']==2
            draft=row(first);assert draft['status']=='DRAFT' and not draft['vectorUsable'] and draft['vectorIndexedVersion'] is None
            not_retrieved(first,'OLDLIFECYCLE'+marker)
            wait(lambda:cleared(first),'old-version physical cleanup');assert stored(other)==preserved
            history=api('/mes/assistant/document/versions?id='+str(first));assert {v['version'] for v in history}=={1,2}
            assert api('/mes/assistant/document?'+urlencode({'id':first,'version':1}))['contentText'].strip()==old
            multipart('/mes/assistant/document/update',{'id':first,'expectedVersion':1},old,denied=True)
            assert api('/mes/assistant/document?id='+str(first))['contentText'].strip()==new
            publish(first,2);indexed(first,2)
            current=api('/mes/assistant/document?id='+str(first));chunks={int(c['chunkId']):c for c in current['chunks']}
            current_rows=stored(first);assert len(current_rows)==len(chunks)
            for item in current_rows:
                source=chunks[int(item['id'])]
                assert item['version']==2 and item['base']==kb and item['dimensions']==config['dimensions']
                assert item['hash']==source['contentHash'] and item['text']==source['content'] and item['start']==source['startOffset'] and item['end']==source['endOffset']
                assert item['hash'] not in {r['hash'] for r in initial_rows}
            assert stored(other)==preserved
            publish(first,2,False);assert row(first)['status']=='DRAFT' and not row(first)['vectorUsable']
            not_retrieved(first,'NEWLIFECYCLE'+marker)
            wait(lambda:cleared(first),'withdrawn document cleanup');assert stored(other)==preserved
            publish(first,2,False);assert row(first)['vectorStatus']=='READY'
            publish(first,2);indexed(first,2)
            if args.exercise_recovery:
                try:
                    set_neo4j('Stop')
                    publish(first,2,False)
                    assert not row(first)['vectorUsable']
                    wait(lambda:row(first)['vectorStatus']=='ERROR' and row(first)['vectorAction']=='REMOVE','durable cleanup failure')
                    assert not row(first)['vectorUsable']
                    payload={'query':'OLDLIFECYCLE'+marker,'knowledgeBaseIds':[kb],'limit':5}
                    fallback=api('/mes/assistant/search',payload|{'documentStrategy':'COMBINED'})
                    assert fallback['documentRetrieval']['degraded'] and fallback['documentRetrieval']['effectiveStrategy']=='LEXICAL'
                    assert {int(item['documentId']) for item in fallback['items']}=={other}
                    api('/mes/assistant/search',payload|{'documentStrategy':'SEMANTIC'},denied=True)
                finally:
                    set_neo4j('Start')
                wait(lambda:row(first)['vectorStatus']=='READY','cleanup retry after Neo4j starts')
                wait(lambda:cleared(first),'physical cleanup after Neo4j starts')
                assert stored(other)==preserved
                recovered=api('/mes/assistant/search',payload|{'documentStrategy':'SEMANTIC'})
                assert {int(item['documentId']) for item in recovered['items']}=={other}
                publish(first,2);indexed(first,2)
            api('/mes/assistant/document?id='+str(first),method='DELETE');owned[first]=True
            api('/mes/assistant/document?id='+str(first),denied=True)
            assert all(int(r['id'])!=first for r in api('/mes/assistant/documents?knowledgeBaseId='+str(kb)))
            not_retrieved(first,'NEWLIFECYCLE'+marker)
            wait(lambda:cleared(first),'deleted document cleanup');assert stored(other)==preserved
            assert api('/mes/assistant/embedding-config')==config and api('/mes/assistant/model-config')==chat
            print(json.dumps({'duplicatePublishIdempotent':True,'updateInvalidatedImmediately':True,'concurrentVersionConflict':True,'version2Provenance':True,'withdrawAndRepublish':True,'otherDocumentPreserved':True,'deleteCleanup':True,'neo4jRecovery':args.exercise_recovery,'dimensions':config['dimensions']},ensure_ascii=False))
        finally:
            for doc,deleted in owned.items():
                if not deleted:api('/mes/assistant/document?id='+str(doc),method='DELETE')
                wait(lambda doc=doc:cleared(doc),'fixture cleanup')
            if kb:api('/mes/assistant/base?id='+str(kb),method='DELETE')
            try:api('/system/auth/logout',method='POST')
            except Exception:pass
print('Lifecycle fixtures cleaned; existing documents and model configuration preserved.')
