import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { BucketActivationCacheService } from './bucket-activation-cache.service';
import { BucketActivationsService } from './bucket-activations.service';

@UseGuards(JwtGuard)
@Controller('bucket-activations')
export class BucketActivationsController {
  constructor(
    private readonly service: BucketActivationsService,
    private readonly cacheService: BucketActivationCacheService,
  ) {}

  @Get('daily')
  daily(
    @Req() req: any,
    @Query() query: Record<string, unknown>,
  ): Promise<unknown> {
    return this.service.getDaily(query, req.user?.role);
  }

  @Get('cached-daily')
  cachedDaily(
    @Req() req: any,
    @Query() query: Record<string, unknown>,
  ): Promise<unknown> {
    return this.cacheService.getDaily(query, req.user?.role);
  }

  @Get('address')
  address(
    @Req() req: any,
    @Query() query: Record<string, unknown>,
  ): Promise<unknown> {
    return this.service.resolveAddress(query, req.user?.role);
  }

  @Get('fleet')
  fleet(
    @Req() req: any,
    @Query() query: Record<string, unknown>,
  ): Promise<unknown> {
    // @ts-expect-error Rota legada já presente no runtime; implementar rastreamento em release separado.
    return this.service.getFleetTracking(query, req.user?.role);
  }

  @Get('video')
  video(
    @Req() req: any,
    @Query() query: Record<string, unknown>,
  ): Promise<unknown> {
    // @ts-expect-error Rota legada já presente no runtime; implementar vídeo em release separado.
    return this.service.getLiveVideo(query, req.user?.role);
  }
}
