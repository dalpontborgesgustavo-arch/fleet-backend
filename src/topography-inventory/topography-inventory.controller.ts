import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { TopographyInventoryService } from './topography-inventory.service';

@UseGuards(JwtGuard)
@Controller('topography-inventory')
export class TopographyInventoryController {
  constructor(private readonly service: TopographyInventoryService) {}

  @Get('bootstrap')
  bootstrap(@Req() req: any, @Query() query: any) {
    return this.service.bootstrap(
      query,
      req.user?.role,
      req.user?.canAccessTopographyInventory,
    );
  }

  @Get('aethos-items')
  searchActiveAethosItems(@Req() req: any, @Query() query: any) {
    return this.service.searchActiveAethosItems(
      query,
      req.user?.role,
      req.user?.canAccessTopographyInventory,
    );
  }

  @Post('materials')
  addAethosMaterial(@Req() req: any, @Body() body: any) {
    return this.service.addAethosMaterial(
      body,
      req.user?.role,
      req.user?.canAccessTopographyInventory,
    );
  }

  @Put()
  save(@Req() req: any, @Body() body: any) {
    return this.service.save(
      body,
      req.user?.role,
      req.user?.sub,
      req.user?.canAccessTopographyInventory,
    );
  }
}
