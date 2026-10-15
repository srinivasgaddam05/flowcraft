import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './auth.dto';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Post('register') register(@Body() body: RegisterDto) { return this.auth.register(body.email, body.password, body.name); }
  @Post('login') login(@Body() body: LoginDto) { return this.auth.login(body.email, body.password); }
  @Get('me') @UseGuards(AuthGuard) me(@Req() request: AuthenticatedRequest): unknown { return request.user; }
}