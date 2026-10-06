import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BucketActivationsController } from './bucket-activations.controller';
import { BucketActivationCacheService } from './bucket-activation-cache.service';
import { BucketActivationsService } from './bucket-activations.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [BucketActivationsController],
  providers: [BucketActivationsService, BucketActivationCacheService],
})
export class BucketActivationsModule {}
