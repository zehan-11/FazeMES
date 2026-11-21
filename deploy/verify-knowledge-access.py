"""Local-only two-user ACL verification. Creates and cleans its own users, roles, libraries and files."""
from pathlib import Path
from urllib.request import Request,build_opener,ProxyHandler
from urllib.error import HTTPError
from urllib.parse import urlencode
from neo4j import GraphDatabase
import argparse,json,time,uuid
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--semantic',action='store_true',help='Use configured Embedding with fixture documents and questions')
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
secrets=json.loads((root/'.runtime/secrets.local.json').read_text(encoding='utf-8-sig'))
connection=json.loads((root/'.runtime/neo4j/connection.local.json').read_text(encoding='utf-8-sig'))
http=build_opener(ProxyHandler({}));base='http://127.0.0.1:48080/admin-api';marker=uuid.uuid4().hex[:8]
class Client:
 def __init__(self):self.headers={'Content-Type':'application/json','tenant-id':'1'}
 def call(self,path,body=None,method=None,raw=None,extra=None,denied=False):
  request=Request(base+path,data=raw if raw is not None else None if body is None else json.dumps(body).encode(),headers=self.headers|(extra or {}),method=method)
  try:
   with http.open(request,timeout=30) as response:result=json.load(response)
  except HTTPError as error:
   if denied and error.code in (401,403,404):return None
   raise
  if denied:assert result['code']!=0,'Unauthorized operation succeeded: '+path.split('?')[0];return None
  assert result['code']==0,f"{path.split('?')[0]}: {result.get('code')} {result.get('msg')}"
  return result.get('data')
 def login(self,user,password):self.headers['Authorization']='Bearer '+self.call('/system/auth/login',{'username':user,'password':password})['accessToken']
 def logout(self):self.call('/system/auth/logout',{},'POST')
def until(fn,label):
 end=time.monotonic()+120
 while time.monotonic()<end:
  value=fn()
  if value:return value
  time.sleep(1)
 raise AssertionError('Timed out: '+label)
def graph(client):
 result={'nodes':{},'relations':{}}
 for route,key,size in [('nodes-page','nodes',200),('relations-page','relations',500)]:
  cursor='';seen=set()
  while True:
   response=client.call('/mes/knowledge-graph/'+route+'?'+urlencode({'after':cursor,'limit':size}))
   for item in response['items']:result[key][item['id']]=item
   cursor=response.get('nextCursor')
   if not cursor:break
   assert cursor not in seen;seen.add(cursor)
 return result
def upload(client,kb,title,text,publish=True):
 boundary='AclFile'+uuid.uuid4().hex
 content=f'--{boundary}\r\nContent-Disposition: form-data; name="knowledgeBaseId"\r\n\r\n{kb}\r\n--{boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n{title}\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="relations.md"\r\nContent-Type: text/markdown\r\n\r\n{text}\r\n--{boundary}--\r\n'
 doc=int(client.call('/mes/assistant/document/upload',method='POST',raw=content.encode(),extra={'Content-Type':'multipart/form-data; boundary='+boundary})['id']);documents.append(doc)
 if publish:
  client.call('/mes/assistant/document/publish?'+urlencode({'id':doc,'published':'true','expectedVersion':1}),method='PUT')
  until(lambda:next(row for row in client.call('/mes/assistant/documents?knowledgeBaseId='+str(kb)) if int(row['id'])==doc)['graphStatus']=='SYNCED','file graph sync')
 return doc
def create_base(client,name,kind='PERSONAL',roles=None):
 kb=int(client.call('/mes/assistant/base',{'name':name,'description':'','libraryType':kind,'readerRoleIds':roles or []}));libraries.append((client,kb));return kb
def evidence(client,kb):return client.call('/mes/assistant/evidence/search',{'query':'电机','knowledgeBaseIds':[kb],'sources':['DOCUMENT','GRAPH'],'limit':10})['items']
admin=Client();admin.login(secrets['AdminUsername'],secrets['AdminPassword']);roles=[];users=[];clients=[];libraries=[];documents=[]
initial=graph(admin)
try:
 if args.semantic:assert admin.call('/mes/assistant/embedding-config')['configured'],'Configure Embedding before semantic ACL verification'
 menus=admin.call('/system/menu/list');menu_ids=[m['id'] for m in menus if m.get('permission') in ('mes:assistant:knowledge','mes:assistant:query')];assert any(m.get('permission')=='mes:assistant:knowledge' for m in menus)
 for suffix in ('A','B'):
  role=int(admin.call('/system/role/create',{'name':'知识权限验证'+suffix+marker,'code':'kgacl'+suffix+marker,'sort':900,'status':0}));roles.append(role);admin.call('/system/permission/assign-role-menu',{'roleId':role,'menuIds':menu_ids})
  username='kgacl'+suffix+marker;password='Aa1!'+uuid.uuid4().hex[:10]
  user=int(admin.call('/system/user/create',{'username':username,'nickname':'权限验证'+suffix+marker,'password':password}));users.append(user);admin.call('/system/permission/assign-user-role',{'userId':user,'roleIds':[role]})
  client=Client();client.login(username,password);clients.append(client)
 a,b=clients;pa=create_base(a,'个人A'+marker);pb=create_base(b,'个人B'+marker);corp=create_base(admin,'企业规则'+marker,'RULES',[roles[0]])
 da=upload(a,pa,'保密A'+marker,f'[设备]保密设备A{marker} —包含部件→ [部件]保密部件A{marker}')
 db=upload(b,pb,'保密B'+marker,f'[设备]保密设备B{marker} —包含部件→ [部件]保密部件B{marker}')
 dc=upload(admin,corp,'企业电机规程'+marker,'[部件]电机 —包含部件→ [部件]轴承')
 draft=upload(admin,corp,'未审阅草稿'+marker,'[设备]草稿设备 —包含部件→ [部件]草稿部件',False)
 for client in (admin,b):
  assert pa not in {int(row['id']) for row in client.call('/mes/assistant/bases')}
  for route in ['/mes/assistant/documents?knowledgeBaseId='+str(pa),'/mes/assistant/document?id='+str(da),'/mes/assistant/document/versions?id='+str(da),'/mes/assistant/document/download?id='+str(da)]:client.call(route,denied=True)
  client.call('/mes/assistant/document/publish?'+urlencode({'id':da,'published':'false'}),method='PUT',denied=True)
 for client,own,other in [(a,pa,pb),(b,pb,pa)]:
  assert own in {int(row['id']) for row in client.call('/mes/assistant/bases')};client.call('/mes/assistant/search',{'query':'保密','knowledgeBaseIds':[other],'limit':5},denied=True)
 assert [int(d['id']) for d in a.call('/mes/assistant/documents?knowledgeBaseId='+str(corp))]==[dc]
 a.call('/mes/assistant/document/versions?id='+str(dc),denied=True);a.call('/mes/assistant/document/publish?'+urlencode({'id':dc,'published':'false'}),method='PUT',denied=True)
 b.call('/mes/assistant/evidence/search',{'query':'电机','knowledgeBaseIds':[corp],'sources':['GRAPH']},denied=True)
 result=evidence(a,corp);assert {e['sourceType'] for e in result}=={'DOCUMENT','GRAPH'};assert all(int(e['documentId'])==dc and e['libraryType']=='RULES' for e in result)
 ga,gb,gm=graph(a),graph(b),graph(admin);assert all(int(r['sourceEvidence'].get('documentId') or 0)!=db for r in ga['relations'].values());assert all(int(r['sourceEvidence'].get('documentId') or 0) not in (da,dc,draft) for r in gb['relations'].values());assert all(int(r['sourceEvidence'].get('documentId') or 0) not in (da,db) for r in gm['relations'].values())
 private_node=next(n for n in ga['nodes'].values() if '保密设备A' in n['name']);b.call('/mes/knowledge-graph/node?'+urlencode({'id':private_node['id']}),denied=True);admin.call('/mes/knowledge-graph/neighbors?'+urlencode({'id':private_node['id']}),denied=True)
 if args.semantic:
  for owner,library,document in [(a,pa,da),(b,pb,db),(admin,corp,dc)]:
   until(lambda:next(row for row in owner.call('/mes/assistant/documents?knowledgeBaseId='+str(library)) if int(row['id'])==document)['vectorUsable'],'fixture vector index')
  def semantic(client,library,document=None,denied=False):
   result=client.call('/mes/assistant/evidence/search',{'query':'电机检查','knowledgeBaseIds':[library],'documentStrategy':'SEMANTIC'},denied=denied)
   if not denied:
    assert result['documentRetrieval']['effectiveStrategy']=='SEMANTIC' and result['items']
    assert all(row['retrievalMethod']=='vector_cosine' and int(row['documentId'])==document for row in result['items'])
  semantic(a,pa,da);semantic(b,pb,db);semantic(a,corp,dc)
  semantic(admin,pa,denied=True);semantic(b,pa,denied=True);semantic(b,corp,denied=True)
 admin.call('/mes/assistant/base',{'id':corp,'name':'企业规则'+marker,'description':'','libraryType':'RULES','readerRoleIds':[]})
 if args.semantic:semantic(a,corp,denied=True)
 assert not any(int(r['sourceEvidence'].get('documentId') or 0)==dc for r in graph(a)['relations'].values());a.call('/mes/assistant/evidence/search',{'query':'电机','knowledgeBaseIds':[corp]},denied=True)
 admin.call('/mes/assistant/base',{'id':corp,'name':'企业规则'+marker,'description':'','libraryType':'RULES','readerRoleIds':[roles[1]]});assert {e['sourceType'] for e in evidence(b,corp)}=={'DOCUMENT','GRAPH'}
 if args.semantic:semantic(b,corp,dc)
 a.call('/mes/assistant/base',{'id':pa,'name':'错误共享','description':'','libraryType':'RULES','readerRoleIds':[roles[0]]},denied=True)
 summary={'personalIsolation':'two users and administrator passed','roleGrantAndRevocation':'passed','graphEvidenceVisibility':'passed','unifiedEvidenceContract':'DOCUMENT/GRAPH verified','draftAndHistoryProtection':'passed','semanticIsolationAndRevocation':'passed' if args.semantic else 'not exercised'}
finally:
 for client,kb in reversed(libraries):
  for doc in client.call('/mes/assistant/documents?knowledgeBaseId='+str(kb)):
   doc_id=int(doc['id']);documents.append(doc_id);client.call('/mes/assistant/document?id='+str(doc_id),method='DELETE')
  client.call('/mes/assistant/base?id='+str(kb),method='DELETE')
 with GraphDatabase.driver(connection['uri'],auth=(connection['username'],connection['password'])) as driver:
  def cleared():
   with driver.session(database=connection['database']) as session:
    graph_count=session.run('MATCH ()-[r:FazeRelation]->() WHERE r.tenantId=1 AND r.documentId IN $docs RETURN count(r) AS n',docs=documents).single()['n']
    vector_count=session.run('MATCH (n:FazeVectorChunk {tenantId:1}) WHERE n.documentId IN $docs RETURN count(n) AS n',docs=documents).single()['n']
    return graph_count==0 and vector_count==0
  until(cleared,'physical fixture graph cleanup')
 assert graph(admin)==initial,'Existing authorized graph changed'
 for client in clients:client.logout()
 for user in users:admin.call('/system/user/delete?id='+str(user),method='DELETE')
 for role in roles:admin.call('/system/role/delete?id='+str(role),method='DELETE')
 admin.logout()
print(json.dumps(summary,ensure_ascii=False))
