import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { ChecklistRemovalService } from './checklist-removal.service';

@Controller('checklists/admin/removal')
@UseGuards(JwtGuard)
export class ChecklistRemovalController {
  constructor(private readonly removal: ChecklistRemovalService) {}

  @Get('search')
  search(@Req() req: any, @Query() query: Record<string, unknown>) {
    requireAdministrator(req.user);
    return this.removal.search(query);
  }

  @Get(':id/preview')
  preview(@Req() req: any, @Param('id') id: string) {
    requireAdministrator(req.user);
    return this.removal.preview(id);
  }

  @Delete(':id')
  remove(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    requireAdministrator(req.user);
    return this.removal.remove(id, body, req.user);
  }
}

function requireAdministrator(actor?: { role?: string }) {
  if (actor?.role?.trim().toLowerCase() !== 'admin') {
    throw new ForbiddenException(
      'Somente o perfil Administrador pode excluir checklists.',
    );
  }
}
