import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CommercialIndicatorsController } from './commercial-indicators.controller';
import { CommercialIndicatorsService } from './commercial-indicators.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CommercialIndicatorsController],
  providers: [CommercialIndicatorsService],
})
export class CommercialIndicatorsModule {}
