import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ContractsController],
  providers: [ContractsService],
})
export class ContractsModule {}
