import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrumareController } from './prumare.controller';
import { PrumareService } from './prumare.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PrumareController],
  providers: [PrumareService],
})
export class PrumareModule {}
