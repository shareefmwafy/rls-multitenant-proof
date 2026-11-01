import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenantRequest } from './tenant.guard';

/** Tenant id established by TenantGuard, or null when no x-tenant-id header was sent. */
export const CurrentTenant = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | null => {
  const req = ctx.switchToHttp().getRequest<TenantRequest>();
  return req.tenantId ?? null;
});
