CREATE TABLE mes_assistant_knowledge_base(id BIGINT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(100),description VARCHAR(1000),tenant_id BIGINT NOT NULL,creator BIGINT NOT NULL,create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,deleted INT DEFAULT 0);
CREATE TABLE mes_assistant_document(id BIGINT AUTO_INCREMENT PRIMARY KEY,knowledge_base_id BIGINT,title VARCHAR(200),file_name VARCHAR(200),file_type VARCHAR(20),file_size BIGINT,file_sha256 VARCHAR(64),original_bytes BLOB,content_text CLOB,chunk_count INT,version INT,status VARCHAR(20),tenant_id BIGINT NOT NULL,creator BIGINT,create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,deleted INT DEFAULT 0);
CREATE TABLE mes_assistant_chunk(id BIGINT AUTO_INCREMENT PRIMARY KEY,document_id BIGINT,chunk_index INT,heading VARCHAR(300),page_number INT,start_offset INT,end_offset INT,content_text CLOB,content_sha256 VARCHAR(64),tenant_id BIGINT NOT NULL,deleted INT DEFAULT 0,UNIQUE(tenant_id,document_id,chunk_index));
CREATE TABLE mes_assistant_session(id BIGINT AUTO_INCREMENT PRIMARY KEY,version INT NOT NULL DEFAULT 0,pending_request_id VARCHAR(36),pending_started_at TIMESTAMP,title VARCHAR(100),user_id BIGINT NOT NULL,tenant_id BIGINT NOT NULL,create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,deleted INT DEFAULT 0);
CREATE TABLE mes_assistant_message(id BIGINT AUTO_INCREMENT PRIMARY KEY,session_id BIGINT,user_id BIGINT NOT NULL,role VARCHAR(20),content_text CLOB,status VARCHAR(40),citations_json CLOB,model_name VARCHAR(200),tenant_id BIGINT NOT NULL,create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,deleted INT DEFAULT 0);
CREATE TABLE mes_assistant_model_config(id BIGINT AUTO_INCREMENT PRIMARY KEY,tenant_id BIGINT NOT NULL UNIQUE,provider VARCHAR(20),base_url VARCHAR(500),model_name VARCHAR(200),secret_ciphertext CLOB,temperature DECIMAL(4,2),max_tokens INT,enabled BOOLEAN,updater BIGINT,context_tokens INT DEFAULT 8192,update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE mes_assistant_graph_state(tenant_id BIGINT NOT NULL,document_id BIGINT NOT NULL,owner_id BIGINT NOT NULL,document_version INT NOT NULL,generation BIGINT NOT NULL DEFAULT 1,desired_state VARCHAR(16) NOT NULL,status VARCHAR(24) NOT NULL,extraction_method VARCHAR(32) DEFAULT 'explicit_v1',entity_count INT DEFAULT 0,relation_count INT DEFAULT 0,payload_json CLOB NOT NULL,attempts INT DEFAULT 0,error_message VARCHAR(500) DEFAULT '',next_attempt_at TIMESTAMP,update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,synced_at TIMESTAMP,PRIMARY KEY(tenant_id,document_id));

CREATE TABLE IF NOT EXISTS mes_assistant_document_revision (
 tenant_id BIGINT NOT NULL, document_id BIGINT NOT NULL, version INT NOT NULL,
 knowledge_base_id BIGINT NOT NULL, title VARCHAR(200) NOT NULL,
 file_name VARCHAR(200) NOT NULL, file_type VARCHAR(20) NOT NULL,
 file_size BIGINT NOT NULL, file_sha256 CHAR(64) NOT NULL,
 original_bytes BLOB NOT NULL, content_text CLOB NOT NULL,
 chunk_count INT NOT NULL, chunks_json CLOB NOT NULL,
 status VARCHAR(20) NOT NULL, creator BIGINT NOT NULL, changed_by BIGINT NOT NULL,
 create_time TIMESTAMP NOT NULL, archived_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,document_id,version)
);
ALTER TABLE mes_assistant_graph_state ADD COLUMN validation_error VARCHAR(500) NOT NULL DEFAULT '';

ALTER TABLE mes_assistant_knowledge_base ADD COLUMN library_type VARCHAR(16) NOT NULL DEFAULT 'PERSONAL';
ALTER TABLE mes_assistant_knowledge_base ADD COLUMN owner_id BIGINT NOT NULL DEFAULT 0;
CREATE TABLE mes_assistant_base_role(tenant_id BIGINT NOT NULL,knowledge_base_id BIGINT NOT NULL,role_id BIGINT NOT NULL,PRIMARY KEY(tenant_id,knowledge_base_id,role_id));
CREATE TABLE system_role(id BIGINT PRIMARY KEY,tenant_id BIGINT,name VARCHAR(100),code VARCHAR(100),status INT DEFAULT 0,deleted INT DEFAULT 0);
CREATE TABLE system_user_role(id BIGINT AUTO_INCREMENT PRIMARY KEY,user_id BIGINT,role_id BIGINT,deleted INT DEFAULT 0);
