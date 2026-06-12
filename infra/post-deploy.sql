-- INFRA-4: least-privilege application user.
-- Run ONCE as osfinadmin after first deployment. The API's DATABASE_URL must
-- use osfinapp — the admin account is for migrations/maintenance by a human only.
-- (Better still: enable Entra ID auth on Postgres and grant the App Service's
--  managed identity database access — zero stored passwords.)
CREATE USER osfinapp WITH PASSWORD :'app_password';
GRANT CONNECT ON DATABASE postgres TO osfinapp;
GRANT USAGE ON SCHEMA public TO osfinapp;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO osfinapp;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO osfinapp;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO osfinapp;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO osfinapp;
