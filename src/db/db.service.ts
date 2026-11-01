import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL must be set (app_user connection string)');
    }
    this.pool = new Pool({
      connectionString,
      // One connection in tests: any tenant state left on it by one request
      // is guaranteed to be seen by the next, so leaks cannot hide behind pooling.
      ...(process.env.NODE_ENV === 'test' ? { max: 1 } : {}),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Runs fn inside a transaction whose app.tenant_id is visible only to that transaction.
   *
   * set_config(name, value, true) is the function form of SET LOCAL: the value lasts
   * until COMMIT or ROLLBACK and then reverts by itself. A session-level SET (is_local
   * = false) would stay on the connection after release, and the next request to
   * borrow that connection from the pool would inherit the previous tenant. SET LOCAL
   * means the connection goes back to the pool clean no matter how fn exits.
   *
   * null means "no tenant": an empty string is stored, which the RLS policy maps to
   * NULL via NULLIF, so no rows match.
   */
  async withTenant<T>(tenantId: string | null, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId ?? '']);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
