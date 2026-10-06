import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { EmailModule } from '../email/email.module';
import { SsmaLicensesController } from './ssma-licenses.controller';
import { SsmaLicensesService } from './ssma-licenses.service';

@Module({
  imports: [PrismaModule, AuthModule, StorageModule, EmailModule],
  controllers: [SsmaLicensesController],
  providers: [SsmaLicensesService],
})
export class SsmaLicensesModule {}
