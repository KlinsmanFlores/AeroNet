import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto'; 
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ClientRegisterDto } from './dto/client-register.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Auth')
@ApiBearerAuth() 
@Controller('auth')
export class AuthController {
  /** Inyecta AuthService para registro, login y signup de clientes. */
  constructor(private readonly authService: AuthService) {}

  /** POST register: registra un nuevo usuario (admin o técnico; actualmente sin guard). */
  @Post('register')
  @UseGuards(JwtAuthGuard, RolesGuard) // Activamos ambos porteros
  @Roles('admin') // Restricción total: Solo el Admin de AeroNet
  @ApiOperation({ summary: 'Registrar un nuevo usuario (Solo Admin)' })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  /** POST login: inicia sesión y devuelve el token JWT. */
  @Post('login')
  @ApiOperation({ summary: 'Iniciar sesión y obtener el token JWT' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  /** POST signup-client: registro público solo para clientes (Auth + auth_users + customers). */
  @Post('signup-client') 
  @ApiOperation({ summary: 'registro solo para clientes' })
  async clientSignUp(@Body() dto: ClientRegisterDto) {
    return this.authService.clientRegister(dto);
  }
}