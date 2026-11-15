ALTER TABLE mes_assistant_knowledge_base ADD COLUMN library_type VARCHAR(16) NOT NULL DEFAULT 'PERSONAL', ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 0;
UPDATE mes_assistant_knowledge_base SET owner_id=creator;
CREATE TABLE IF NOT EXISTS mes_assistant_base_role (
 tenant_id BIGINT NOT NULL, knowledge_base_id BIGINT NOT NULL, role_id BIGINT NOT NULL,
 PRIMARY KEY(tenant_id,knowledge_base_id,role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
