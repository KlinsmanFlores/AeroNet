import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { CreateServiceWithTicketDto } from './dto/create-service-with-ticket.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Services (Instalaciones)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('services')
export class ServicesController {
  /** Inyecta ServicesService para CRUD de instalaciones/servicios. */
  constructor(private readonly servicesService: ServicesService) {}

  /** POST /: crea una nueva instalación (admin, técnico o cliente). */
  @Post()
  @Roles('admin', 'technician','customer')
  @ApiOperation({ summary: 'Registrar nueva instalación' })
  create(@Body() createServiceDto: CreateServiceDto) {
    return this.servicesService.create(createServiceDto);
  }

  /** POST with-ticket: crea servicio y ticket de instalación en una operación (solo cliente). */
  @Post('with-ticket')
  @Roles('customer')
  @ApiOperation({ summary: 'Crear servicio con ticket de instalación automático (Frontend Cliente)' })
  createWithTicket(@Request() req, @Body() dto: CreateServiceWithTicketDto) {
    return this.servicesService.createWithTicket(req.user, dto);
  }

  /** GET /: lista todas las instalaciones (admin o técnico). */
  @Get()
  @Roles('admin', 'technician')
  @ApiOperation({ summary: 'Ver todas las instalaciones de la red' })
  findAll() {
    return this.servicesService.findAll();
  }

  /** GET my-services: lista los servicios del cliente/técnico autenticado. */
  @Get('my-services')
  @Roles('admin', 'technician', 'customer')
  @ApiOperation({ summary: 'Listar servicios del cliente logueado (App)' })
  findMyServices(@Request() req) {
    return this.servicesService.findMyServices(req.user.userId);
  }

  /** GET :id: obtiene un servicio por ID; el cliente solo puede ver los suyos. */
  @Get(':id')
  @Roles('admin', 'technician', 'customer')
  async findOne(@Param('id') id: string, @Request() req) {
    const user = req.user;
    const service = await this.servicesService.findOne(id);

    if (user.role === 'customer' && service.customer.user_id !== user.userId) {
      throw new ForbiddenException('No tienes permiso para ver esta instalación');
    }
    return service;
  }

  /** PATCH :id: actualiza un servicio (admin o técnico). */
  @Patch(':id')
  @Roles('admin', 'technician')
  update(@Param('id') id: string, @Body() updateServiceDto: UpdateServiceDto) {
    return this.servicesService.update(id, updateServiceDto);
  }

  /** DELETE :id: elimina una instalación (solo admin). */
  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Eliminar instalación (Solo Admin)' })
  remove(@Param('id') id: string) {
    return this.servicesService.remove(id);
  }

}
