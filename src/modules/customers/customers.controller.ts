import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request, ForbiddenException, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  /** Inyecta CustomersService para CRUD de clientes. */
  constructor(private readonly customersService: CustomersService) {}

  /** POST /: crea un perfil de cliente manualmente (solo admin). */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Crear perfil manual (Solo Admin - Emergencias)' })
  create(@Body() createCustomerDto: CreateCustomerDto) {
    return this.customersService.create(createCustomerDto);
  }

  /** POST :userId/convert: convierte un prospecto en cliente (solo admin o técnico). */
  @Post(':userId/convert')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'technician')
  @ApiOperation({ summary: 'Convertir prospecto en cliente fijo' })
  convertProspectToCustomer(
    @Param('userId') userId: string,
    @Body() createCustomerDto: CreateCustomerDto
  ) {
    return this.customersService.convertProspectToCustomer(userId, createCustomerDto);
  }

  /** GET /: lista todos los clientes (admin o técnico). */
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'technician')
  @ApiOperation({ summary: 'Listar todos los clientes (Solo Admin/Técnico)' })
  findAll() {
    return this.customersService.findAll();
  }

  /** GET me: obtiene el perfil del cliente/técnico autenticado. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Obtener mi propio perfil' })
  async findMe(@Request() req) {
    return this.customersService.findByUserId(req.user.userId);
  }

  /** POST me/avatar: sube o actualiza la foto de perfil del usuario autenticado. */
  @Post('me/avatar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer', 'admin', 'technician', 'prospect')
  @UseInterceptors(FileInterceptor('avatar'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { avatar: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Subir o actualizar foto de perfil' })
  async uploadAvatar(@Request() req, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new ForbiddenException('Debes enviar un archivo con el campo "avatar"');
    return this.customersService.uploadAvatar(req.user.userId, file);
  }

  /** GET :id: obtiene un cliente por ID; el cliente solo puede ver su propio perfil. */
  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'technician', 'customer')
  async findOne(@Param('id') id: string, @Request() req) {
    const user = req.user;
    const customer = await this.customersService.findOne(id);

    if (user.role === 'customer' && customer.user_id !== user.userId) {
      throw new ForbiddenException('No tienes permiso para ver este perfil');
    }
    return customer;
  }

  /** PATCH :id: actualiza un cliente; el cliente solo puede actualizar su propio perfil. */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'technician', 'customer')
  async update(@Param('id') id: string, @Body() updateCustomerDto: UpdateCustomerDto, @Request() req) {
    const user = req.user;
    const customer = await this.customersService.findOne(id);

    if (user.role === 'customer' && customer.user_id !== user.userId) {
      throw new ForbiddenException('No tienes permiso para actualizar este perfil');
    }
    return this.customersService.update(id, updateCustomerDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'technician')
  remove(@Param('id') id: string) {
    return this.customersService.remove(id);
  }

}