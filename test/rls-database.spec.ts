import { Pool, PoolClient } from 'pg';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

describe('PostgreSQL row-level security on students (connected as app_user)', () => {
  let pool: Pool;

  beforeAll(() => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL must be set to the app_user connection string');
    }
    // max=1 so every query in this file runs on the same physical connection.
    pool = new Pool({ connectionString, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function countStudents(queryable: Pool | PoolClient): Promise<number> {
    const { rows } = await queryable.query('SELECT count(*)::int AS count FROM students');
    return rows[0].count;
  }

  it('connects as a role that is neither superuser nor allowed to bypass RLS', async () => {
    const { rows } = await pool.query(
      'SELECT rolbypassrls, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it('has row-level security enabled and forced on students', async () => {
    const { rows } = await pool.query(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'students'::regclass",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('returns no rows when app.tenant_id is not set', async () => {
    expect(await countStudents(pool)).toBe(0);
  });

  it('scopes a transaction-local app.tenant_id to that transaction', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_A]);
      expect(await countStudents(client)).toBe(2);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Same physical connection (max=1), but the local setting died with the transaction.
    expect(await countStudents(pool)).toBe(0);
  });

  it('negative control: a session-level app.tenant_id leaks across pooled queries', async () => {
    try {
      await pool.query("SELECT set_config('app.tenant_id', $1, false)", [TENANT_A]);
      expect(await countStudents(pool)).toBe(2);
    } finally {
      await pool.query('RESET app.tenant_id');
    }
    expect(await countStudents(pool)).toBe(0);
  });

  it('rejects an INSERT for tenant B inside a tenant A transaction', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_A]);
      await expect(
        client.query('INSERT INTO students (id, tenant_id, name) VALUES ($1, $2, $3)', [
          'cccccccc-cccc-cccc-cccc-cccccccccccc',
          TENANT_B,
          'Intruder',
        ]),
      ).rejects.toThrow(/row-level security policy/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
