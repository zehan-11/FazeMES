-- Functional rollback on MySQL. Quiesce face APIs first; keep the new cleanup worker running until the queue drains.
-- Legacy credentials that are still active retain their original encrypted templates. Never restore revoked data.
START TRANSACTION;
INSERT INTO mes_face_cleanup(tenant_id,user_id,template_version,due_at)
SELECT tenant_id,user_id,active_version,CURRENT_TIMESTAMP(6) FROM mes_face_credential
 WHERE storage_kind='PGVECTOR' AND active_version IS NOT NULL
ON DUPLICATE KEY UPDATE due_at=CURRENT_TIMESTAMP(6);
INSERT INTO mes_face_audit(tenant_id,actor_id,user_id,action,reason,result)
SELECT tenant_id,NULL,user_id,'ROLLBACK','DBA 回退向量登录版本','SUCCESS'
 FROM mes_face_credential WHERE storage_kind='PGVECTOR';
UPDATE mes_face_credential
   SET binding_status='REENROLL_REQUIRED',storage_kind='NONE',row_version=row_version+1,
       active_version=NULL,sample_count=0,model_version=NULL,enabled=0,template_cipher=''
 WHERE storage_kind='PGVECTOR';
COMMIT;
SELECT COUNT(*) AS pending_face_cleanup FROM mes_face_cleanup;
