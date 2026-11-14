"""Explicit scoped graph import. Uses local credentials; never resets any database."""
from pathlib import Path
import argparse,json
from neo4j import GraphDatabase
root=Path(__file__).resolve().parents[1]
def seed(driver,database,tenant,owner,graph):
    with driver.session(database=database) as session:
        session.run("CREATE CONSTRAINT fazemes_entity_scope IF NOT EXISTS FOR (n:FazeEntity) REQUIRE (n.tenantId,n.ownerId,n.id) IS UNIQUE").consume()
        session.run("CREATE CONSTRAINT fazemes_relation_scope IF NOT EXISTS FOR ()-[r:FazeRelation]-() REQUIRE (r.tenantId,r.ownerId,r.id) IS UNIQUE").consume()
        def write(tx):
            tx.run("UNWIND $nodes AS item MERGE (n:FazeEntity {tenantId:$tenant,ownerId:$owner,id:item.id}) SET n.name=item.name,n.kind=item.kind,n.description=item.description",nodes=graph['nodes'],tenant=tenant,owner=owner).consume()
            tx.run("""UNWIND $edges AS item
MATCH (a:FazeEntity {tenantId:$tenant,ownerId:$owner,id:item.source})
MATCH (b:FazeEntity {tenantId:$tenant,ownerId:$owner,id:item.target})
MERGE (a)-[r:FazeRelation {tenantId:$tenant,ownerId:$owner,id:item.id}]->(b)
SET r.type=item.type,r.sourceTitle=item.sourceEvidence.title,r.sourceSection=item.sourceEvidence.section,r.sourceExcerpt=item.sourceEvidence.excerpt""",edges=graph['relations'],tenant=tenant,owner=owner).consume()
        session.execute_write(write)
        return session.run("MATCH (n:FazeEntity {tenantId:$tenant,ownerId:$owner}) OPTIONAL MATCH (n)-[r:FazeRelation {tenantId:$tenant,ownerId:$owner}]->(:FazeEntity {tenantId:$tenant,ownerId:$owner}) RETURN count(DISTINCT n) AS nodes,count(DISTINCT r) AS relations",tenant=tenant,owner=owner).single().data()
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--tenant-id',type=int,required=True);parser.add_argument('--owner-id',type=int,required=True)
    args=parser.parse_args()
    if args.tenant_id<1 or args.owner_id<1:parser.error('Scope IDs must be positive')
    connection=json.loads((root/'.runtime/neo4j/connection.local.json').read_text(encoding='utf-8-sig'))
    graph=json.loads((root/'database/graph/fan-knowledge.json').read_text(encoding='utf-8'))
    with GraphDatabase.driver(connection['uri'],auth=(connection['username'],connection['password'])) as driver:
        driver.verify_connectivity();print(json.dumps(seed(driver,connection['database'],args.tenant_id,args.owner_id,graph)))
if __name__=='__main__':main()
