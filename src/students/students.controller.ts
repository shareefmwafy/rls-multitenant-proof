import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentTenant } from '../tenant/tenant.decorator';
import { TenantGuard } from '../tenant/tenant.guard';
import { Student, StudentsService } from './students.service';

@Controller('students')
@UseGuards(TenantGuard)
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get()
  list(@CurrentTenant() tenantId: string | null): Promise<Student[]> {
    return this.students.list(tenantId);
  }
}
