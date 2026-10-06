import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ThirdPartyMeasurementsController } from './third-party-measurements.controller';
import { ThirdPartyMeasurementsService } from './third-party-measurements.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ThirdPartyMeasurementsController],
  providers: [ThirdPartyMeasurementsService],
  exports: [ThirdPartyMeasurementsService],
})
export class ThirdPartyMeasurementsModule {}
