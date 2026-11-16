"""Read-only authenticated checks; never prints tokens or database credentials."""
from pathlib import Path
from urllib.request import Request,urlopen
import argparse,json
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--expect-unavailable',action='store_true');args=parser.parse_args()
secrets=json.loads((root/'.runtime/secrets.local.json').read_text(encoding='utf-8-sig'))
base='http://127.0.0.1:48080/admin-api'
headers={'Content-Type':'application/json','tenant-id':'1'}
def request(path,body=None):
    data=None if body is None else json.dumps(body).encode()
    with urlopen(Request(base+path,data=data,headers=headers),timeout=25) as response:return json.load(response)
login=request('/system/auth/login',{'username':secrets['AdminUsername'],'password':secrets['AdminPassword']})
assert login['code']==0,login.get('msg')
headers['Authorization']='Bearer '+login['data']['accessToken']
try:
    prefix='/mes/knowledge-graph'
    result=request(prefix+'/overview?limit=8')
    if args.expect_unavailable:
        assert result['code']==1047150000,result.get('code')
        assert 'nodes' not in (result.get('data') or {}),'Unexpected fallback data'
        print('Database unavailable: explicit error returned; no graph fallback.')
    else:
        assert result['code']==0,result.get('msg')
        data=result['data'];assert len(data['nodes'])<=8
        search=request(prefix+'/search?query=motor')
        assert search['code']==0
        search=request(prefix+'/search?query=%E7%94%B5%E6%9C%BA')
        assert search['code']==0 and any(n['id']=='motor' for n in search['data']['items'])
        from urllib.parse import urlencode
        def pages(route,size):
            rows=[];cursor='';seen=set()
            while True:
                page=request(prefix+route+'?'+urlencode({'after':cursor,'limit':size}))
                assert page['code']==0,page.get('msg')
                rows.extend(page['data']['items']);next_cursor=page['data'].get('nextCursor')
                if not next_cursor:break
                assert next_cursor not in seen and next_cursor>cursor
                seen.add(next_cursor);cursor=next_cursor
            return rows
        all_nodes=pages('/nodes-page',4);all_edges=pages('/relations-page',5)
        node_ids={n['id'] for n in all_nodes}
        assert len(node_ids)==len(all_nodes)
        assert len({e['id'] for e in all_edges})==len(all_edges)
        assert all(e['source'] in node_ids and e['target'] in node_ids for e in all_edges)
        detail=request(prefix+'/node?id=motor');assert detail['code']==0 and detail['data']['name']=='电机'
        graph=request(prefix+'/neighbors?id=motor')['data'];again=request(prefix+'/neighbors?id=motor')['data']
        assert graph==again,'Read results changed across repeated expansion'
        ids={n['id'] for n in graph['nodes']}
        assert 'motor' in ids and 'bearing' in ids
        for edge in graph['relations']:
            assert edge['source'] in ids and edge['target'] in ids
            assert edge['sourceEvidence']['title'] and edge['sourceEvidence']['excerpt']
        missing=request(prefix+'/node?id=not-existing');assert missing['code']==1047150001
        invalid=request(prefix+'/overview?limit=201');assert invalid['code']==1047150002
        injection=request(prefix+'/search?query=%27%20OR%20true%20%2F%2F');assert injection['code']==0 and not injection['data']['items']
        print(json.dumps({'completeNodes':len(all_nodes),'completeRelations':len(all_edges),'overviewNodes':len(data['nodes']),'overviewHasMore':data['hasMore'],'motorNeighborhoodNodes':len(graph['nodes']),'motorNeighborhoodRelations':len(graph['relations']),'checks':'search/detail/expansion/sources/limits/parameterization passed'}))
finally:
    request('/system/auth/logout',{})
