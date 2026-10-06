import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { LegalCasesController } from './legal-cases.controller';
import { LegalCasesService } from './legal-cases.service';

@Module({
  imports: [AuthModule, PrismaModule, StorageModule],
  controllers: [LegalCasesController],
  providers: [LegalCasesService],
  exports: [LegalCasesService],
})
export class LegalCasesModule {}
