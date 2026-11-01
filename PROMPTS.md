# PROMPTS

Prompt log for this proof. Each task was given as one message, the resulting
diff was reviewed by hand, and nothing was committed by the assistant.

## Session rules

### Prompt

```text
We're building a small multi-tenant proof with NestJS + PostgreSQL RLS, test-first, in small reviewed commits.
Rules for this whole session:
- Only do the task I give you. Don't add extra files, features, or "improvements".
- Never run git commit; I review the diff and commit myself.
- Show me the full diff of every file you create or change.
- When unsure, ask instead of guessing.
Acknowledge and wait.
```

### Review notes

No deliverable. The rules were acknowledged and held for the rest of the
session: no commits by the assistant, a full diff after every task, and
judgment calls listed for me to veto.

## Task 1: Project scaffold

### Prompt

```text
Task 1: project scaffold only. Create package.json (name rls-multitenant-proof, private), tsconfig.json (commonjs, ES2021, strict, experimentalDecorators + emitDecoratorMetadata), jest.config.js (ts-jest, tests in src/ and test/ matching *.spec.ts, testTimeout 15000), .gitignore (node_modules, dist, .env), .env.example with DATABASE_URL for app_user and ADMIN_DATABASE_URL for the postgres superuser.
Scripts: build, start, start:dev, test (NODE_ENV=test jest --runInBand), db:setup (bash db/setup.sh).
Dependencies: @nestjs/common@10, @nestjs/core@10, @nestjs/platform-express@10, pg, reflect-metadata, rxjs. Dev: @nestjs/testing@10, typescript@5.7, jest@29, ts-jest@29, ts-node, supertest, @types/jest@29, @types/node@22, @types/pg, @types/supertest, @types/express@4.
Do not create any src/ or test/ files yet.
```

### Review notes

Accepted as-is; no changes needed. I ran `npm install` and committed
`package-lock.json` with the scaffold. Open item carried forward: the
`.env.example` placeholders chosen here (password `app_user`, database
`rls_multitenant_proof`) do not match the values fixed in Task 2 (`app_pass`,
`rls_proof`). Flagged in Tasks 2, 4 and 7; not yet corrected.

## Task 2: Database schema, RLS policy, app role

### Prompt

```text
Task 2: database only, no app code.
Create db/001_schema.sql (idempotent, runs as superuser): tenants(id uuid pk, name), students(id uuid pk, tenant_id uuid not null references tenants, name), index on students.tenant_id.
ENABLE and FORCE row level security on students. One policy FOR ALL with USING and WITH CHECK: tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid.
Create role app_user LOGIN PASSWORD 'app_pass' NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE (only if not exists). Grant USAGE on schema public, SELECT on tenants, SELECT/INSERT/UPDATE/DELETE on students.
Create db/002_seed.sql with two tenants using fixed UUIDs (1111...-1111 = Tenant A, 2222...-2222 = Tenant B), two students for A, one for B, ON CONFLICT DO NOTHING.
Create db/setup.sh that creates database rls_proof if missing and applies both files via psql with ON_ERROR_STOP.
Explain in two sentences why FORCE and not just ENABLE, and why NOBYPASSRLS.
```

### Review notes

Accepted as-is; no changes needed. The SQL could not be executed at the time
(no `psql` on this machine); the shell script was only syntax-checked. It was
first run against a real Postgres 16 during Task 4, where it applied cleanly
and a second run proved it idempotent.

## Task 3: Tests first (red)

### Prompt

```text
Task 3: tests only. Do NOT create anything under src/. Import AppModule from '../src/app.module' and DbService from '../src/db/db.service' even though they don't exist yet; the suite must fail to compile on first run.
test/tenant-isolation.spec.ts (supertest, GET /students, header x-tenant-id):
- tenant A gets 200 with exactly 2 rows all tenant_id A
- tenant B gets 200 with 1 row
- no header -> 200 and []
- well-formed but unknown UUID 9999...-9999 -> 403
- malformed value like "' OR 1=1 --" -> 403
- sequential requests A -> none -> B on a pool with max=1 do not leak
- after a tenant A request, a raw db.pool.query('SELECT count(*) FROM students') outside withTenant returns 0
test/rls-database.spec.ts (pg Pool max=1 as app_user):
- current_user has rolbypassrls=false and rolsuper=false
- students has relrowsecurity=true and relforcerowsecurity=true
- no setting -> count 0
- BEGIN; set_config('app.tenant_id', A, true); count=2; COMMIT; then count on the pool = 0
- negative control: set_config(..., false) leaks (count 2), then RESET app.tenant_id
- inside a tenant A transaction, INSERT with tenant_id B is rejected with a row-level security error
```

### Review notes

Accepted as-is; no changes needed. First run failed to compile exactly as
intended: two TS2307 errors for the missing `AppModule` and `DbService`
imports and nothing else. The database spec compiled and failed only on the
missing `DATABASE_URL`, with a clear message.

## Task 4: Implementation (green)

### Prompt

```text
Task 4: implement the minimum to make test/ pass. No extra endpoints.
- src/db/db.service.ts: pg Pool as app_user from DATABASE_URL, max=1 when NODE_ENV=test. Method withTenant(tenantId | null, fn): BEGIN, SELECT set_config('app.tenant_id', $1, true) with '' when null, run fn(client), COMMIT; ROLLBACK on error; always release. Add a comment explaining why set_config(..., true) (= SET LOCAL) and not a session SET.
- src/db/db.module.ts: @Global module exporting DbService.
- src/tenant/tenant.guard.ts: CanActivate. Header absent -> req.tenantId = null, allow. Not a UUID shape -> ForbiddenException. UUID not found in tenants -> ForbiddenException. Else set req.tenantId.
- src/tenant/tenant.decorator.ts: @CurrentTenant() param decorator.
- src/students/: service list(tenantId) using withTenant and 'SELECT id, tenant_id, name FROM students ORDER BY name' with NO where clause on tenant_id (comment why); controller GET /students with the guard; module.
- src/app.module.ts and src/main.ts.
Show me every file.
```

### Review notes

Accepted as-is; no changes needed. Verified against a throwaway `postgres:16`
container on a spare port (my `pg-rls` container on 5432 was left alone):
13 of 13 tests passed, twice, with `db/setup.sh` re-run in between and
`npm run build` emitting `dist/main.js`. The commit message mix-up on my side
is recorded under process issues below.

## Task 5: Mutation check

### Prompt

```text
Task 5: mutation check, no permanent code changes.
1) Change set_config third argument from true to false in db.service.ts, run npm test, report which tests fail, then revert.
2) Tell me the psql command to give app_user BYPASSRLS, I'll run it; after npm test tell me how to revert it.
Do not modify any test.
```

### Review notes

No code to review: both mutations were reverted and the tree was clean
afterwards. Mutation 1 was run here: 1 failed, 12 passed. Mutation 2 was
pre-run on the throwaway container: 10 failed, 3 passed, back to 13 passed
after `NOBYPASSRLS`. I ran mutation 2 on my own database and reported the
same numbers and the same failing test names back in Task 8; they are
recorded in `README.md` under Mutation results.

## Task 6: CI

### Prompt

```text
Task 6: .github/workflows/ci.yml on push and pull_request. ubuntu-latest, postgres:16 service with health check, Node 22 with npm cache, npm ci, install postgresql-client, npm run db:setup, npm run build, npm test. Env: ADMIN_DATABASE_URL and DATABASE_URL.
```

_(The message arrived with the text pasted twice; quoted once.)_

### Review notes

Accepted as-is; no changes needed. The YAML was parsed and the step order
checked locally. The service container and action versions could not be
exercised without pushing. The commit message mix-up on my side is recorded
under process issues below.

## Task 7: README and prompt log

### Prompt

```text
Task 7: README.md with: a table mapping each of the 6 requirements to a file; the list of tests; the mutation results I'll paste; a "why" section for ENABLE vs FORCE, NOBYPASSRLS, SET LOCAL vs SET, current_setting(..., true) + NULLIF, and why there is no WHERE tenant_id in the service; run instructions; a "not done / known limits" section (header instead of JWT, password in .env.example, one table only).
Also PROMPTS.md: I'll dictate the prompts and review notes; create the skeleton with one section per task.
```

_(The message arrived with the text pasted twice; quoted once.)_

### Review notes

Accepted as-is; no changes needed. The wording of the six requirements in the
table was the assistant's inference, since I never listed them in the session,
and I kept it. Two known-limits bullets beyond the three I named (`.env` is not
auto-loaded; `db:setup` never re-applies role attributes) were added and
flagged, and I kept them. The mutation results were left as placeholders and
filled in Task 8 with the output from my own run.

## Process issues found during review

While reviewing git log, I found the implementation commit carried the same message as the tests commit (a copy-paste error on my side), and the CI commit had been given the docs message. I fixed both by amending and rebasing before anyone else built on the branch, then force-pushed with --force-with-lease.
