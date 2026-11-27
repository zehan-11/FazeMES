-- Applied after 20261018_face_login.sql. MySQL is authoritative for login and revocation.
SET @ddl = IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE()
  AND table_name='mes_face_credential' AND column_name='row_version'), 'SELECT 1',
  'ALTER TABLE mes_face_credential ADD binding_status VARCHAR(24) NOT NULL DEFAULT ''UNBOUND'',
   ADD storage_kind VARCHAR(12) NOT NULL DEFAULT ''NONE'', ADD row_version BIGINT NOT NULL DEFAULT 0,
   ADD active_version CHAR(36) NULL, ADD sample_count TINYINT NOT NULL DEFAULT 0,
   ADD model_version VARCHAR(64) NULL, ADD consented_at DATETIME(6) NULL, ADD consent_version VARCHAR(16) NULL');
PREPARE face_ddl FROM @ddl;
EXECUTE face_ddl;
DEALLOCATE PREPARE face_ddl;
UPDATE mes_face_credential SET binding_status='ACTIVE',storage_kind='LEGACY',row_version=1
 WHERE row_version=0 AND deleted=0 AND enabled=1 AND template_cipher<>'';
UPDATE mes_face_credential SET binding_status='SELF_REVOKED',enabled=0,template_cipher='',row_version=1
 WHERE row_version=0 AND (enabled=0 OR deleted<>0 OR template_cipher='');

CREATE TABLE IF NOT EXISTS mes_face_cleanup (
 tenant_id BIGINT NOT NULL, user_id BIGINT NOT NULL, template_version CHAR(36) NOT NULL,
 due_at DATETIME(6) NOT NULL, attempts INT NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,user_id,template_version), KEY ix_face_due(due_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS mes_face_audit (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, tenant_id BIGINT NOT NULL,
 actor_id BIGINT NULL, user_id BIGINT NULL, action VARCHAR(24) NOT NULL,
 request_id CHAR(36) NULL, reason VARCHAR(160) NOT NULL DEFAULT '', result VARCHAR(24) NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 KEY ix_face_request(tenant_id,user_id,actor_id,action,request_id,result),
 KEY ix_face_history(tenant_id,user_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO system_menu(id,name,permission,type,sort,parent_id,path,icon,component,component_name,status,visible,keep_alive,always_show,creator,updater,deleted)
SELECT 971291,'管理人脸绑定','mes:face:manage',3,90,parent_id,'','','','',0,b'1',b'0',b'0','1','1',b'0'
FROM system_menu WHERE permission='system:user:query' AND deleted=0 LIMIT 1
ON DUPLICATE KEY UPDATE permission='mes:face:manage',deleted=b'0';
UPDATE system_tenant_package SET menu_ids=JSON_ARRAY_APPEND(menu_ids,'$',971291)
 WHERE JSON_VALID(menu_ids) AND JSON_CONTAINS(menu_ids,CAST('23' AS JSON))
 AND NOT JSON_CONTAINS(menu_ids,CAST('971291' AS JSON));
UPDATE system_tenant_package SET menu_ids=JSON_ARRAY_APPEND(menu_ids,'$',971290)
 WHERE JSON_VALID(menu_ids) AND JSON_CONTAINS(menu_ids,CAST('959' AS JSON))
 AND NOT JSON_CONTAINS(menu_ids,CAST('971290' AS JSON));
-- Business roles are opt-in via role management. No role receives broader user/dept scope.
INSERT INTO system_role_menu(role_id,menu_id,tenant_id,creator,updater)
SELECT r.id,971291,r.tenant_id,'1','1' FROM system_role r
WHERE r.code IN ('super_admin','tenant_admin') AND r.deleted=0
 AND EXISTS (SELECT 1 FROM system_role_menu q WHERE q.role_id=r.id AND q.tenant_id=r.tenant_id
             AND q.menu_id=23 AND q.deleted=0)
 AND NOT EXISTS(SELECT 1 FROM system_role_menu m WHERE m.role_id=r.id AND m.tenant_id=r.tenant_id
             AND m.menu_id=971291 AND m.deleted=0);
