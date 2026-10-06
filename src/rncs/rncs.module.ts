import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { RncEmailResponseController } from './rnc-email-response.controller';
import { RncProfileAccessGuard } from './rnc-profile-access.guard';
import { RncsController } from './rncs.controller';
import { RncsService } from './rncs.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    NotificationsModule,
    StorageModule,
    EmailModule,
  ],
  controllers: [RncEmailResponseController, RncsController],
  providers: [RncsService, RncProfileAccessGuard],
})
export class RncsModule {}
