import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

export interface Student {
  id: string;
  tenant_id: string;
  name: string;
}

@Injectable()
export class StudentsService {
  constructor(private readonly db: DbService) {}

  list(tenantId: string | null): Promise<Student[]> {
    return this.db.withTenant(tenantId, async (client) => {
      // Deliberately no WHERE tenant_id = ... here. Isolation is enforced by the
      // row-level security policy on students, which reads the app.tenant_id that
      // withTenant set for this transaction. Adding a WHERE clause would mask a
      // missing or broken policy, and the tests must prove the database filters.
      const { rows } = await client.query<Student>('SELECT id, tenant_id, name FROM students ORDER BY name');
      return rows;
    });
  }
}
