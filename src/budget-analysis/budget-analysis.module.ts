import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BudgetAnalysisController } from './budget-analysis.controller';
import { BudgetAnalysisService } from './budget-analysis.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [BudgetAnalysisController],
  providers: [BudgetAnalysisService],
  exports: [BudgetAnalysisService],
})
export class BudgetAnalysisModule {}
