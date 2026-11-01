# rls-multitenant-proof

A small NestJS + PostgreSQL proof that tenant isolation can be enforced by the
database rather than by remembering a `WHERE` clause. The application only tells
Postgres which tenant the current transaction belongs to; row-level security
(RLS) decides what that transaction can read and write.

The prompt log for how this was built is in [PROMPTS.md](PROMPTS.md).

## Requirements → files

| # | Requirement | Where |
|---|-------------|-------|
| 1 | Tenant-scoped schema: `tenants`, `students` with `tenant_id` referencing `tenants`, index on `students.tenant_id` | `db/001_schema.sql` |
| 2 | RLS **enabled and forced** on `students`, one `FOR ALL` policy (`USING` + `WITH CHECK`) keyed on `app.tenant_id` | `db/001_schema.sql` |
| 3 | Application role that cannot bypass RLS: `app_user` with `NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE` and least-privilege grants | `db/001_schema.sql`, `db/setup.sh` |
| 4 | Tenant resolved per request from `x-tenant-id`: absent → no tenant, malformed or unknown → 403 | `src/tenant/tenant.guard.ts`, `src/tenant/tenant.decorator.ts` |
| 5 | Tenant context applied transaction-locally per request; application SQL carries no tenant filter | `src/db/db.service.ts`, `src/students/students.service.ts` |
| 6 | Automated proof at HTTP and database level, including pool-leak checks, run in CI | `test/tenant-isolation.spec.ts`, `test/rls-database.spec.ts`, `.github/workflows/ci.yml` |

## Tests

`npm test` runs Jest in-band with `NODE_ENV=test`. In that mode the app's pool
has a single connection, so any tenant state left on it by one request is seen
by the very next query instead of hiding behind pooling.

### `test/tenant-isolation.spec.ts` — HTTP, through the real app

1. returns exactly the two tenant A rows for tenant A
2. returns exactly the one tenant B row for tenant B
3. returns an empty list when no tenant header is sent
4. rejects a well-formed but unknown tenant id with 403
5. rejects a malformed tenant id with 403 (`' OR 1=1 --`)
6. does not leak tenant context across sequential requests on a single-connection pool (A → none → B)
7. leaves no tenant context on the pooled connection after a tenant A request (raw `pool.query` outside `withTenant` counts 0)

### `test/rls-database.spec.ts` — database, `pg` Pool as `app_user` with `max: 1`

1. connects as a role that is neither superuser nor allowed to bypass RLS
2. has row-level security enabled and forced on `students`
3. returns no rows when `app.tenant_id` is not set
4. scopes a transaction-local `app.tenant_id` to that transaction (2 inside, 0 after COMMIT on the same connection)
5. negative control: a session-level `app.tenant_id` leaks across pooled queries (2, then `RESET`)
6. rejects an INSERT for tenant B inside a tenant A transaction with a row-level security error

## Mutation results

Two deliberate breaks, each reverted afterwards. No test was modified.

### Mutation 1: `set_config('app.tenant_id', $1, false)` in `src/db/db.service.ts`

<!-- paste npm test result here -->

### Mutation 2: `ALTER ROLE app_user BYPASSRLS;`

<!-- paste npm test result here -->

Revert with `ALTER ROLE app_user NOBYPASSRLS;`. Note that `npm run db:setup`
does not undo it: the role is created only if missing, so attributes on an
existing role are never re-applied.

## Why

### ENABLE vs FORCE

`ENABLE ROW LEVEL SECURITY` applies the table's policies to everyone except the
table owner (and superusers or `BYPASSRLS` roles). `FORCE ROW LEVEL SECURITY`
makes the owner subject to the policies as well. In this proof the tables are
owned by `postgres` and the app connects as `app_user`, so `ENABLE` alone would
pass the tests today. `FORCE` closes a whole class of future mistakes: a
migration tool, a script, or a connection string that runs as the owner would
otherwise silently see every tenant. The database spec asserts both flags
(`relrowsecurity` and `relforcerowsecurity`) so neither can be dropped quietly.

### NOBYPASSRLS

`BYPASSRLS` is a role attribute that switches row security off for that role
entirely, regardless of `ENABLE` or `FORCE` on any table. Superusers have it
implicitly. `app_user` is created with `NOBYPASSRLS NOSUPERUSER`, and the first
database test reads `rolbypassrls` and `rolsuper` for `current_user`, so the
guarantee is pinned to the role the app actually connects as rather than to a
default somebody could change later. Mutation 2 shows what happens without it.

### SET LOCAL vs SET

`withTenant` runs `SELECT set_config('app.tenant_id', $1, true)` inside
`BEGIN … COMMIT`. The third argument is `is_local`; `true` is the function form
of `SET LOCAL`. The value exists only until the transaction ends and then
reverts by itself, on `COMMIT` and on `ROLLBACK`, so the connection goes back
to the pool clean no matter how the request ends.

A session-level `SET` (`is_local = false`) would stay on the connection after
release, and the next request to borrow that connection would inherit the
previous tenant. With a pool of size 1 this is deterministic, which is what the
leak tests rely on. Mutation 1 shows which test catches it, and also why the
sequential A → none → B test does not: every request overwrites the value
before it reads, so only a query that runs outside `withTenant` sees the
leftover.

### `current_setting(..., true)` + `NULLIF`

The policy expression is:

```sql
tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
```

- `current_setting(name, true)`: the second argument is `missing_ok`. Without
  it, a connection that has never set `app.tenant_id` fails every query with
  "unrecognized configuration parameter", turning a missing tenant into a 500.
  With it the call returns `NULL`.
- `NULLIF(…, '')`: once a custom setting has been set in a session, `RESET`
  leaves it as an empty string rather than `NULL`, and `withTenant(null)`
  deliberately stores `''` for "no tenant". `NULLIF` maps both to `NULL`.
- `tenant_id = NULL` is never true, so "no tenant" means zero rows read and
  zero rows written. The policy fails closed, not open.
- The `::uuid` cast would raise on garbage. The guard rejects non-UUID values
  before anything reaches the database, which is why a malformed header is a
  clean 403 rather than a database error.

### No `WHERE tenant_id` in the service

`StudentsService.list` runs
`SELECT id, tenant_id, name FROM students ORDER BY name` with no tenant filter,
on purpose. The point of the proof is that the database does the filtering. A
`WHERE tenant_id = $1` in application code would make every test pass even if
the policy were missing, disabled, or bypassed, so it would hide exactly the
failures the tests exist to catch. Mutation 2 is the demonstration: with
`BYPASSRLS` the unfiltered query returns every tenant's rows and the isolation
tests fail.

## Running it

Prerequisites: Node 22, a PostgreSQL 16 server you can reach as a superuser,
and `psql` on your `PATH`.

```bash
# A throwaway Postgres if you need one
docker run -d --name pg-rls -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16

npm ci

export ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/rls_proof   # superuser
export DATABASE_URL=postgres://app_user:app_pass@localhost:5432/rls_proof         # role created by db:setup

npm run db:setup      # creates rls_proof if missing, applies db/001_schema.sql and db/002_seed.sql; idempotent
npm test
npm run build && npm start   # or: npm run start:dev
```

Nothing loads `.env` automatically; export the variables yourself (for example
`set -a; . ./.env; set +a`). `db/setup.sh` replaces the database segment of
`ADMIN_DATABASE_URL` with `rls_proof`, so it only needs to point at the right
server.

```bash
curl -s localhost:3000/students -H 'x-tenant-id: 11111111-1111-1111-1111-111111111111'   # 2 rows
curl -s localhost:3000/students -H 'x-tenant-id: 22222222-2222-2222-2222-222222222222'   # 1 row
curl -s localhost:3000/students                                                            # []
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/students \
  -H 'x-tenant-id: 99999999-9999-9999-9999-999999999999'                                   # 403
```

CI (`.github/workflows/ci.yml`) runs the same `db:setup`, `build`, `test`
sequence on every push and pull request against a `postgres:16` service
container.

## Not done / known limits

- **Tenant comes from a header, not a JWT.** `x-tenant-id` is trusted as-is
  after a shape check and an existence check, so any caller can claim any
  tenant. In a real system the tenant id comes from a verified token claim or
  session and the guard reads it from there; the rest of the pipeline
  (guard → `withTenant` → policy) stays the same.
- **Credentials are fixed and visible.** `app_user`'s password is hard-coded in
  `db/001_schema.sql`, `.env.example`, and the CI workflow. Fine for a proof on
  a throwaway database, not for anything shared.
- **One table only.** Only `students` has a policy. `tenants` has none, and
  `app_user` can read all of it, which the guard needs for the existence check.
  Every new tenant-scoped table needs its own `ENABLE`, `FORCE`, and policy;
  nothing enforces that automatically.
- **`.env` is not loaded automatically.** There is no dotenv; the variables
  must be exported before `db:setup`, `test`, or `start`.
- **`db:setup` never re-applies role attributes.** `app_user` is created only if
  missing, so a `BYPASSRLS` added by hand survives re-runs until reverted
  explicitly.
