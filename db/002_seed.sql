-- 002_seed.sql
-- Fixed fixtures for tests. Idempotent. Run as a superuser (bypasses RLS).

INSERT INTO tenants (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Tenant A'),
  ('22222222-2222-2222-2222-222222222222', 'Tenant B')
ON CONFLICT DO NOTHING;

INSERT INTO students (id, tenant_id, name) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111111', 'Student A1'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', '11111111-1111-1111-1111-111111111111', 'Student A2'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', '22222222-2222-2222-2222-222222222222', 'Student B1')
ON CONFLICT DO NOTHING;
