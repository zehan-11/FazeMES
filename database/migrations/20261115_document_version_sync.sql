CREATE TABLE IF NOT EXISTS mes_assistant_document_revision (
 tenant_id BIGINT NOT NULL, document_id BIGINT NOT NULL, version INT NOT NULL,
 knowledge_base_id BIGINT NOT NULL, title VARCHAR(200) NOT NULL,
 file_name VARCHAR(200) NOT NULL, file_type VARCHAR(20) NOT NULL,
 file_size BIGINT NOT NULL, file_sha256 CHAR(64) NOT NULL,
 original_bytes MEDIUMBLOB NOT NULL, content_text MEDIUMTEXT NOT NULL,
 chunk_count INT NOT NULL, chunks_json MEDIUMTEXT NOT NULL,
 status VARCHAR(20) NOT NULL, creator BIGINT NOT NULL, changed_by BIGINT NOT NULL,
 create_time DATETIME NOT NULL, archived_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,document_id,version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE mes_assistant_graph_state ADD COLUMN validation_error VARCHAR(500) NOT NULL DEFAULT '';
