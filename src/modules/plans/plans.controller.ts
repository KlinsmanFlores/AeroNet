import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { PlansService } from './plans.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

// --- SEGURIDAD Y ACCESO ---
// Se importan los mecanismos de protección centralizados del sistema AeroNet.
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * CONTROLADOR DE PLANES DE INTERNET
 * * Este módulo gestiona el catálogo de servicios ofrecidos por AeroNet.
 * La política de seguridad restringe las operaciones de escritura (POST, PATCH, DELETE)
 * únicamente al perfil de Administrador para evitar alteraciones no autorizadas en precios o velocidades.
 */
@ApiTags('Plans')
@ApiBearerAuth() 
@Controller('plans')
export class PlansController {
  /** Inyecta PlansService para CRUD del catálogo de planes. */
  constructor(private readonly plansService: PlansService) {}

  /**
   * CREAR PLAN
   * Solo accesible por el rol 'admin'. Inicia la oferta de un nuevo servicio de red.
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin') 
  @ApiOperation({ summary: 'Crear un nuevo plan de internet (Solo Admin)' })
  create(@Body() createPlanDto: CreatePlanDto) {
    return this.plansService.create(createPlanDto);
  }

  /**
   * LISTAR PLANES
   * Accesible por cualquier usuario autenticado (Admin, Técnico o Cliente) para consulta de catálogo.
   */
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'technician', 'customer') 
  @ApiOperation({ summary: 'Obtener la lista de todos los planes disponibles' })
  findAll() {
    return this.plansService.findAll();
  }

  /**
   * OBTENER DETALLE DE UN PLAN
   * Permite consultar las especificaciones técnicas de un plan mediante su ID.
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'technician', 'customer')
  @ApiOperation({ summary: 'Obtener el detalle de un plan específico' })
  findOne(@Param('id') id: string) {
    return this.plansService.findOne(id);
  }

  /**
   * ACTUALIZAR PLAN
   * Modificación parcial de campos (Precio, Download/Upload). Restringido a 'admin'.
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Actualizar los datos de un plan (Solo Admin)' })
  update(@Param('id') id: string, @Body() updatePlanDto: UpdatePlanDto) {
    return this.plansService.update(id, updatePlanDto);
  }

  /**
   * ELIMINAR PLAN
   * Eliminación lógica o física de un plan del catálogo. Acción crítica restringida a 'admin'.
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Eliminar un plan del catálogo (Solo Admin)' })
  remove(@Param('id') id: string) {
    return this.plansService.remove(id);
  }




}