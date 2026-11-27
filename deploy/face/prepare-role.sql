\set ON_ERROR_STOP on
\getenv app_password FACE_APP_PASSWORD
SELECT format('CREATE ROLE fazemes_face_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fazemes_face_app')
\gexec
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fazemes_face_app'
               AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)) THEN
        RAISE EXCEPTION 'Use a dedicated unprivileged role for the face vector store';
    END IF;
END $$;
