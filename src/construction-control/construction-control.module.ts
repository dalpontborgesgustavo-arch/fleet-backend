import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ConstructionControlController } from './construction-control.controller';
import { ConstructionControlService } from './construction-control.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ConstructionControlController],
  providers: [ConstructionControlService],
})
export class ConstructionControlModule {}
