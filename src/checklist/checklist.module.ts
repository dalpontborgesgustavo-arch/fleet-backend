import { Module } from '@nestjs/common';
import { ChecklistController } from './checklist.controller';
import { ChecklistService } from './checklist.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { ChecklistConsentService } from './checklist-consent.service';
import { ChecklistRemovalController } from './checklist-removal.controller';
import { ChecklistRemovalService } from './checklist-removal.service';

@Module({
  imports: [PrismaModule, AuthModule, EmailModule],
  controllers: [ChecklistController, ChecklistRemovalController],
  providers: [
    ChecklistService,
    ChecklistConsentService,
    ChecklistRemovalService,
  ],
})
export class ChecklistModule {}
