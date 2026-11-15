-- Embedding model settings reuse the tenant's encrypted model connection; no credentials are copied.
SET NAMES utf8mb4;
CREATE TABLE IF NOT EXISTS mes_assistant_embedding_config (
 tenant_id BIGINT NOT NULL PRIMARY KEY,
 model_name VARCHAR(200) NOT NULL,
 dimensions INT NOT NULL,
 enabled BIT(1) NOT NULL DEFAULT b'0',
 updater BIGINT NOT NULL,
 update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
