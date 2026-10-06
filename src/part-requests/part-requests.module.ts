import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PartRequestsController } from './part-requests.controller';
import { PartRequestsService } from './part-requests.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PartRequestsController],
  providers: [PartRequestsService],
})
export class PartRequestsModule {}
