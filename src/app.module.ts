import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { StudentsModule } from './students/students.module';

@Module({
  imports: [DbModule, StudentsModule],
})
export class AppModule {}
