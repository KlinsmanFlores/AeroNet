import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Req,
  Body,
  Param,
  UseGuards,
  HttpException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Tickets')
@ApiBearerAuth() // <--- CRUCIAL: Esto habilita el envío del Token desde Swagger
@UseGuards(JwtAuthGuard, RolesGuard) // Protege todo el controlador con ambos guards
@Controller('tickets')
export class TicketsController {
  /** Inyecta TicketsService para CRUD de tickets y órdenes de trabajo. */
  constructor(private readonly ticketsService: TicketsService) {}

  /** POST /: crea un nuevo ticket (solo clientes; tipo work_order o ticket). */
  @Post()
  @Roles('customer', 'prospect')
  @ApiOperation({ summary: 'Crear un nuevo ticket (Solo Clientes o Prospectos)' })
  create(@Req() req, @Body() dto: CreateTicketDto) {
    return this.ticketsService.create(req.user, dto);
  }

  /** GET my-tickets: lista los tickets del cliente autenticado. */
  @Get('my-tickets')
  @Roles('customer', 'prospect')
  @ApiOperation({ summary: 'Listar mis propios tickets (Solo Clientes o Prospectos)' })
  myTickets(@Req() req) {
    return this.ticketsService.getMyTickets(req.user);
  }

  /** GET assigned/me: lista los tickets asignados al técnico logueado. */
  @Get('assigned/me')
  @Roles('technician')
  @ApiOperation({ summary: 'Listar tickets asignados a mí (Solo Técnico)' })
  assignedToMe(@Req() req) {
    return this.ticketsService.getAssignedToMe(req.user);
  }

  /** POST :id/complete-installation: el técnico finaliza la instalación y automatiza la conversión. */
  @Post(':id/complete-installation')
  @Roles('technician', 'admin')
  @ApiOperation({ summary: 'Finalizar instalación y convertir prospecto a cliente automáticamente' })
  completeInstallation(@Param('id') id: string, @Req() req) {
    return this.ticketsService.completeInstallation(id, req.user);
  }

  /** GET /: lista todos los tickets del sistema (solo admin). */
  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'Listar todos los tickets del sistema (Solo Admin)' })
  findAll() {
    return this.ticketsService.findAll();
  }

  /** GET :id: obtiene el detalle de un ticket; el cliente solo puede ver los suyos. */
  @Get(':id')
  @Roles('admin', 'customer', 'prospect')
  @ApiOperation({ summary: 'Obtener detalle de un ticket específico' })
  async findOne(@Param('id') id: string, @Req() req) {
    const ticket = await this.ticketsService.findOne(id);
    const user = req.user;

    // Lógica de seguridad para clientes y prospectos:
    if (user.role === 'customer' || user.role === 'prospect') {
      const customer = ticket.customer as { user_id?: string } | null;
      if ((!customer || customer.user_id !== user.userId) && ticket.user_id !== user.userId) {
        throw new ForbiddenException('No tienes permiso para ver este ticket');
      }
    }

    return ticket;
  }

  /** PATCH :id: actualiza un ticket (solo admin). */
  @Patch(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Actualizar estado/datos de un ticket (Solo Admin)' })
  async update(@Param('id') id: string, @Body() dto: UpdateTicketDto) {
    try {
      return await this.ticketsService.update(id, dto);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new BadRequestException(err?.message ?? 'Error al actualizar el ticket');
    }
  }

  /** DELETE :id: elimina un ticket (solo admin). */
  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Eliminar un ticket (Solo Admin)' })
  remove(@Param('id') id: string) {
    return this.ticketsService.remove(id);
  }
}