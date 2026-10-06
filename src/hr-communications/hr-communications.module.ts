import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { HrCommunicationsController } from './hr-communications.controller';
import { HrCommunicationsService } from './hr-communications.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [HrCommunicationsController],
  providers: [HrCommunicationsService],
})
export class HrCommunicationsModule {}
