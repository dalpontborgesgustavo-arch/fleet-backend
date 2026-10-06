import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { AwsBillingService } from './aws-billing.service';

@UseGuards(JwtGuard)
@Controller('aws-billing')
export class AwsBillingController {
  constructor(private readonly awsBilling: AwsBillingService) {}

  @Get('dashboard')
  dashboard(@Req() req: any, @Query('months') months?: string) {
    this.awsBilling.assertOwner(req.user?.email);
    return this.awsBilling.dashboard(months);
  }

  @Get('invoices/:invoiceId/pdf')
  async invoicePdf(
    @Req() req: any,
    @Param('invoiceId') invoiceId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.awsBilling.assertOwner(req.user?.email);
    const document = await this.awsBilling.downloadInvoice(invoiceId);

    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${document.fileName}"`,
      'Cache-Control': 'private, no-store',
    });

    return new StreamableFile(document.buffer);
  }
}
