-- 001_schema.sql
-- Tables, row-level security, and the application role.
-- Idempotent. Run as a superuser (the table owner).

CREATE TABLE IF NOT EXISTS tenants (
  id   uuid PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS students (
  id        uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  name      text NOT NULL
);

CREATE INDEX IF NOT EXISTS students_tenant_id_idx ON students (tenant_id);

-- ENABLE turns RLS on for ordinary roles; FORCE applies it to the table owner too.
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;

-- Single policy covering SELECT/INSERT/UPDATE/DELETE.
-- current_setting(..., true) returns NULL (not an error) when app.tenant_id is unset;
-- NULLIF maps an empty string to NULL as well. tenant_id = NULL is never true,
-- so a connection without a tenant context sees and can write nothing.
DROP POLICY IF EXISTS tenant_isolation ON students;
CREATE POLICY tenant_isolation ON students
  FOR ALL
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Application role. CREATE ROLE has no IF NOT EXISTS, so guard it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user
      LOGIN PASSWORD 'app_pass'
      NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT ON tenants TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON students TO app_user;
