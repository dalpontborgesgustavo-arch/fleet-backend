import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AethosIntegrationService } from '../aethos-integration/aethos-integration.service';
import { JwtGuard } from '../auth/jwt.guard';
import { SsmaWorkCostsService } from './ssma-work-costs.service';

@Controller('ssma/work-costs')
export class SsmaWorkCostsController {
  constructor(private readonly service: SsmaWorkCostsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @UseGuards(JwtGuard)
  read(@Req() request: { user?: { role?: string } }) {
    return this.service.read(request.user?.role);
  }
}

@Controller('integrations/aethos/ssma-work-costs')
export class SsmaWorkCostsSyncController {
  constructor(
    private readonly service: SsmaWorkCostsService,
    private readonly aethos: AethosIntegrationService,
  ) {}

  @Post('sync')
  sync(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.aethos.assertToken(token, authorization);
    return this.service.sync(body);
  }

  @Get('runs/:runId')
  readRun(
    @Headers('x-aethos-sync-token') token: string | string[] | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Param('runId') runId: string,
  ) {
    this.aethos.assertToken(token, authorization);
    return this.service.readRun(runId);
  }
}
