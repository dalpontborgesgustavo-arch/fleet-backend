import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { LegalCasesController } from './legal-cases.controller';
import { LegalCasesService } from './legal-cases.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [LegalCasesController],
  providers: [LegalCasesService],
  exports: [LegalCasesService],
})
export class LegalCasesModule {}
