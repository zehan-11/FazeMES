-- Preserve requested document strategy and actual retrieval/fallback metadata for both message roles.
ALTER TABLE mes_assistant_message
 ADD COLUMN document_strategy VARCHAR(16) NOT NULL DEFAULT 'LEXICAL',
 ADD COLUMN document_retrieval_json MEDIUMTEXT DEFAULT NULL;
