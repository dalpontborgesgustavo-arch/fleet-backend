import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  Post,
} from '@nestjs/common';
import { RncsService } from './rncs.service';

@Controller('rncs/email-response')
export class RncEmailResponseController {
  constructor(private readonly rncsService: RncsService) {}

  @Get(':token')
  findByToken(@Param('token') token: string) {
    return this.rncsService.findEmailResponseByToken(token);
  }

  @Post(':token/respond')
  respondByToken(
    @Param('token') token: string,
    @Body() body: { response?: unknown },
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.rncsService.respondEmailResponseToken(
      token,
      body?.response,
      ip,
      userAgent,
    );
  }

  @Post(':token/manager-action')
  managerActionByToken(
    @Param('token') token: string,
    @Body()
    body: {
      action?: unknown;
      reason?: unknown;
      assignedToId?: unknown;
    },
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.rncsService.performEmailManagerAction(
      token,
      body?.action,
      body?.reason,
      body?.assignedToId,
      ip,
      userAgent,
    );
  }
}
