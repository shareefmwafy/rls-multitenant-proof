import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { DbService } from '../db/db.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TenantRequest extends Request {
  tenantId: string | null;
}

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly db: DbService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<TenantRequest>();
    const header = req.header('x-tenant-id');

    if (header === undefined) {
      req.tenantId = null;
      return true;
    }

    // Shape check first: a non-UUID would make the parameterised lookup below
    // fail with a cast error (500) instead of a clean 403.
    if (!UUID_RE.test(header)) {
      throw new ForbiddenException('Invalid tenant id');
    }

    const { rows } = await this.db.pool.query('SELECT 1 FROM tenants WHERE id = $1', [header]);
    if (rows.length === 0) {
      throw new ForbiddenException('Unknown tenant');
    }

    req.tenantId = header;
    return true;
  }
}
