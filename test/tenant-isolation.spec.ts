import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const UNKNOWN_TENANT = '99999999-9999-9999-9999-999999999999';
const MALFORMED_TENANT = "' OR 1=1 --";

describe('GET /students tenant isolation', () => {
  let app: INestApplication;
  let db: DbService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DbService);
  });

  afterAll(async () => {
    await app.close();
  });

  const getStudents = (tenantId?: string) => {
    const req = request(app.getHttpServer()).get('/students');
    return tenantId === undefined ? req : req.set('x-tenant-id', tenantId);
  };

  it('returns exactly the two tenant A rows for tenant A', async () => {
    const res = await getStudents(TENANT_A);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    for (const row of res.body) {
      expect(row.tenant_id).toBe(TENANT_A);
    }
  });

  it('returns exactly the one tenant B row for tenant B', async () => {
    const res = await getStudents(TENANT_B);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].tenant_id).toBe(TENANT_B);
  });

  it('returns an empty list when no tenant header is sent', async () => {
    const res = await getStudents();
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('rejects a well-formed but unknown tenant id with 403', async () => {
    const res = await getStudents(UNKNOWN_TENANT);
    expect(res.status).toBe(403);
  });

  it('rejects a malformed tenant id with 403', async () => {
    const res = await getStudents(MALFORMED_TENANT);
    expect(res.status).toBe(403);
  });

  it('does not leak tenant context across sequential requests on a single-connection pool', async () => {
    // With max=1 every request below reuses the same physical connection,
    // so any tenant setting left behind by one request would affect the next.
    expect(db.pool.options.max).toBe(1);

    const a = await getStudents(TENANT_A);
    expect(a.status).toBe(200);
    expect(a.body.map((row: { tenant_id: string }) => row.tenant_id)).toEqual([TENANT_A, TENANT_A]);

    const none = await getStudents();
    expect(none.status).toBe(200);
    expect(none.body).toEqual([]);

    const b = await getStudents(TENANT_B);
    expect(b.status).toBe(200);
    expect(b.body.map((row: { tenant_id: string }) => row.tenant_id)).toEqual([TENANT_B]);
  });

  it('leaves no tenant context on the pooled connection after a tenant A request', async () => {
    const a = await getStudents(TENANT_A);
    expect(a.status).toBe(200);
    expect(a.body).toHaveLength(2);

    // Raw query outside withTenant: the policy must see no tenant and return nothing.
    const { rows } = await db.pool.query('SELECT count(*)::int AS count FROM students');
    expect(rows[0].count).toBe(0);
  });
});
