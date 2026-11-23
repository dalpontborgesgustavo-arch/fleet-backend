import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductionControlController } from './production-control.controller';
import { ProductionControlService } from './production-control.service';
import { AsphaltDayController } from './asphalt-day.controller';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ProductionControlController, AsphaltDayController],
  providers: [ProductionControlService],
})
export class ProductionControlModule {}
