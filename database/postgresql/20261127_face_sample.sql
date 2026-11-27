\set ON_ERROR_STOP on
BEGIN;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS mes_face_sample (
    tenant_id bigint NOT NULL,
    user_id bigint NOT NULL,
    template_version uuid NOT NULL,
    sample_no smallint NOT NULL CHECK (sample_no BETWEEN 1 AND 3),
    model_version varchar(64) NOT NULL,
    embedding vector(128) NOT NULL,
    PRIMARY KEY (tenant_id, user_id, template_version, sample_no)
);
ALTER TABLE mes_face_sample ENABLE ROW LEVEL SECURITY;
ALTER TABLE mes_face_sample FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS face_account ON mes_face_sample;
CREATE POLICY face_account ON mes_face_sample
    USING (tenant_id = NULLIF(current_setting('mes.tenant_id',true),'')::bigint
       AND user_id = NULLIF(current_setting('mes.user_id',true),'')::bigint)
    WITH CHECK (tenant_id = NULLIF(current_setting('mes.tenant_id',true),'')::bigint
       AND user_id = NULLIF(current_setting('mes.user_id',true),'')::bigint);
REVOKE ALL ON mes_face_sample FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO fazemes_face_app;
GRANT SELECT, INSERT, DELETE ON mes_face_sample TO fazemes_face_app;
COMMIT;
