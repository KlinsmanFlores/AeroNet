import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { TechnicianService } from './technician.service';
import { CreateTechnicianDto } from './dto/create-technician.dto';
import { UpdateTechnicianDto } from './dto/update-technician.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Technicians')
@ApiBearerAuth()
@Controller('technician')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TechnicianController {
  /** Inyecta TechnicianService para CRUD de técnicos. */
  constructor(private readonly technicianService: TechnicianService) {}

  /** POST /: crea un nuevo técnico (solo admin; registra en Auth y tabla technicians). */
  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Crear nuevo técnico' })
  create(@Body() createTechnicianDto: CreateTechnicianDto) {
    return this.technicianService.create(createTechnicianDto);
  }

  /** GET /: lista todos los técnicos (admin o supervisor). */
  @Get()
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Listar todos los técnicos' })
  findAll() {
    return this.technicianService.findAll();
  }

  @Get('me')
  @Roles('technician')
  @ApiOperation({ summary: 'Obtener mi propio perfil' })
  async findMe(@Request() req) {
    return this.technicianService.findByUserId(req.user.userId);
  }

  /** GET :id: obtiene un técnico por ID; el técnico solo puede ver su propio perfil. */
  @Get(':id')
  @Roles('admin', 'supervisor', 'technician')
  @ApiOperation({ summary: 'Obtener técnico por ID' })
  async findOne(@Param('id') id: string, @Request() req) {
    const technician = await this.technicianService.findOne(id);
    
    // Si el usuario es técnico, solo puede ver su propio registro
    if (req.user.role === 'technician' && technician.user_id !== req.user.userId) {
      throw new ForbiddenException('No tienes permiso para ver este perfil');
    }
    
    return technician;
  }

  /** PATCH :id: actualiza un técnico (admin o el propio técnico). */
  @Patch(':id')
  @Roles('admin', 'technician')
  @ApiOperation({ summary: 'Actualizar técnico' })
  async update(@Param('id') id: string, @Body() updateTechnicianDto: UpdateTechnicianDto, @Request() req) {
    const technician = await this.technicianService.findOne(id);
    
    if (req.user.role === 'technician' && technician.user_id !== req.user.userId) {
      throw new ForbiddenException('No tienes permiso para actualizar este perfil');
    }
    
    return this.technicianService.update(id, updateTechnicianDto);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Eliminar técnico' })
  remove(@Param('id') id: string) {
    return this.technicianService.remove(id);
  }
}