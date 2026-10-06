import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UsinaBomMissingAlertService } from './usina-bom-missing-alert.service';
import { UsinaMonthlyResultController } from './usina-monthly-result.controller';
import { UsinaMonthlyResultService } from './usina-monthly-result.service';

@Module({
  imports: [PrismaModule, AuthModule, EmailModule],
  controllers: [UsinaMonthlyResultController],
  providers: [UsinaMonthlyResultService, UsinaBomMissingAlertService],
})
export class UsinaMonthlyResultModule {}
