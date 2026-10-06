import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AwsBillingController } from './aws-billing.controller';
import { AwsBillingService } from './aws-billing.service';

@Module({
  imports: [AuthModule, EmailModule, PrismaModule],
  controllers: [AwsBillingController],
  providers: [AwsBillingService],
})
export class AwsBillingModule {}
