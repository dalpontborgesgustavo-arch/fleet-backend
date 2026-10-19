import { Module } from '@nestjs/common';
import { AethosIntegrationModule } from '../aethos-integration/aethos-integration.module';
import { PrismaModule } from '../prisma/prisma.module';
import {
  SsmaWorkCostsController,
  SsmaWorkCostsSyncController,
} from './ssma-work-costs.controller';
import { SsmaWorkCostsService } from './ssma-work-costs.service';

@Module({
  imports: [PrismaModule, AethosIntegrationModule],
  controllers: [SsmaWorkCostsController, SsmaWorkCostsSyncController],
  providers: [SsmaWorkCostsService],
})
export class SsmaWorkCostsModule {}
