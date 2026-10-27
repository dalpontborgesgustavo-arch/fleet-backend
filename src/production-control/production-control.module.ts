import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductionControlController } from './production-control.controller';
import { ProductionControlService } from './production-control.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ProductionControlController],
  providers: [ProductionControlService],
})
export class ProductionControlModule {}
