import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtGuard } from './jwt.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  async refresh(@Body() dto: { refreshToken?: string }) {
    return this.authService.refreshSession(dto?.refreshToken);
  }

  @Post('logout')
  async logout(@Body() dto: { refreshToken?: string }) {
    return this.authService.logout(dto?.refreshToken);
  }

  @UseGuards(JwtGuard)
  @Post('change-password')
  async changePassword(@Req() req: any, @Body() dto: { newPassword?: string }) {
    return this.authService.changeTemporaryPassword(
      req.user?.sub,
      dto?.newPassword,
    );
  }
}
