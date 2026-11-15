-- Durable vector delivery and completed-batch checkpoints. No pre-existing documents are enqueued.
CREATE TABLE IF NOT EXISTS mes_assistant_vector_state (
 tenant_id BIGINT NOT NULL, document_id BIGINT NOT NULL, owner_id BIGINT NOT NULL, knowledge_base_id BIGINT NOT NULL,
 document_version INT NOT NULL, generation BIGINT NOT NULL, desired_state VARCHAR(16) NOT NULL,
 status VARCHAR(24) NOT NULL, space_id VARCHAR(64) NOT NULL DEFAULT '', model_name VARCHAR(200) NOT NULL DEFAULT '',
 dimensions INT NOT NULL DEFAULT 0, chunk_count INT NOT NULL DEFAULT 0, completed_chunks INT NOT NULL DEFAULT 0,
 payload_json MEDIUMTEXT NOT NULL, claim_token VARCHAR(36) DEFAULT NULL, lease_until DATETIME DEFAULT NULL,
 attempts INT NOT NULL DEFAULT 0, next_attempt_at DATETIME DEFAULT NULL, error_message VARCHAR(500) NOT NULL DEFAULT '',
 index_name VARCHAR(100) NOT NULL DEFAULT '', synced_at DATETIME DEFAULT NULL,
 update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,document_id), KEY idx_vector_pending(status,next_attempt_at,lease_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS mes_assistant_vector_chunk (
 tenant_id BIGINT NOT NULL, document_id BIGINT NOT NULL, generation BIGINT NOT NULL, chunk_id BIGINT NOT NULL,
 vector_json MEDIUMTEXT NOT NULL,
 PRIMARY KEY(tenant_id,document_id,generation,chunk_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
