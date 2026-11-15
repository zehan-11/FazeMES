CREATE TABLE IF NOT EXISTS mes_assistant_graph_state (
 tenant_id BIGINT NOT NULL, document_id BIGINT NOT NULL, owner_id BIGINT NOT NULL,
 document_version INT NOT NULL, generation BIGINT NOT NULL DEFAULT 1,
 desired_state VARCHAR(16) NOT NULL, status VARCHAR(24) NOT NULL,
 extraction_method VARCHAR(32) NOT NULL DEFAULT 'explicit_v1',
 entity_count INT NOT NULL DEFAULT 0, relation_count INT NOT NULL DEFAULT 0,
 payload_json MEDIUMTEXT NOT NULL, attempts INT NOT NULL DEFAULT 0,
 error_message VARCHAR(500) NOT NULL DEFAULT '', next_attempt_at DATETIME DEFAULT NULL,
 update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 synced_at DATETIME DEFAULT NULL,
 PRIMARY KEY(tenant_id,document_id), KEY idx_graph_pending(status,next_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
