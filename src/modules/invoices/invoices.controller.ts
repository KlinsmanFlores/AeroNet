import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, Request, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { NotificationService } from '../../integrations/notifications/notification.service';
import { SupabaseService } from '../../supabase.service';
import { PaymentsService } from '../payments/payments.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

// SEGURIDAD Y ROLES
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Invoices (Gestión de Deuda)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('invoices')
export class InvoicesController {
  /** Inyecta InvoicesService, NotificationService, SupabaseService y PaymentsService. */
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly notificationService: NotificationService,
    private readonly supabaseService: SupabaseService,
    private readonly paymentsService: PaymentsService
  ) {}

  /**
   * GENERAR DEUDA (Individual)
   * Solo Admin puede crear deudas manualmente.
   */
  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Registrar una deuda/cuenta por cobrar (Solo Admin)' })
  create(@Body() createInvoiceDto: CreateInvoiceDto) {
    return this.invoicesService.create(createInvoiceDto);
  }

  /**
   * GENERADOR MASIVO DE MES
   * Dispara la creación de deudas para todos los servicios activos del periodo.
   */
  @Post('generate-monthly')
  @Roles('admin')
  @ApiOperation({ summary: 'Generar deudas del mes para todos los servicios activos' })
  generateMonthly(@Query('period') period?: string) {
    if (!period) {
      const today = new Date();
      period = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    }
    return this.invoicesService.generateMonthlyInvoices(period);
  }

  /**
   * EJECUTAR FACTURACIÓN DIARIA MANUALMENTE
   * Dispara manualmente el proceso de facturación diaria (igual que el cron de medianoche).
   * Útil para testing o ejecución fuera del horario programado.
   */
  @Post('force-billing')
  @Roles('admin')
  @ApiOperation({ summary: 'Disparar manualmente el proceso de facturación diaria (Solo Admin)' })
  async forceBilling() {
    const result = await this.invoicesService.handleDailyBilling();
    return result;
  }

  /**
   * LISTAR TODAS LAS DEUDAS (Panel Admin)
   */
  @Get()
  @Roles('admin', 'technician')
  @ApiOperation({ summary: 'Listar todas las deudas del sistema (Admin/Técnicos)' })
  findAll() {
    return this.invoicesService.findAll();
  }

  /**
   * VER MIS DEUDAS (App Móvil - Cliente)
   * Extraemos el userId del token JWT para asegurar que el cliente solo vea sus deudas.
   */
  @Get('my-debts')
  @Roles('customer', 'admin')
  @ApiOperation({ summary: 'Consultar deudas del cliente autenticado (App Móvil)' })
  findMyDebts(@Request() req) {
    // req.user.userId viene del payload del JWT decodificado
    return this.invoicesService.findByCustomer(req.user.userId);
  }

  /**
   * Obtener datos de factura para pago (cliente).
   * Devuelve factura, servicio, plan y cliente para renderizar el formulario de pago.
   */
  @Get(':id/payment-details')
  @Roles('customer', 'admin')
  @ApiOperation({ summary: 'Obtener datos de factura para pago (cliente)' })
  findPaymentDetails(@Param('id') id: string, @Request() req: { user: { userId: string } }) {
    return this.invoicesService.findPaymentDetails(id, req.user.userId);
  }

  /**
   * CONSULTAR DEUDA ESPECÍFICA POR ID
   * Verifica que si es cliente, la deuda le pertenezca.
   */
  @Get(':id')
  @Roles('admin', 'technician', 'customer')
  @ApiOperation({ summary: 'Ver detalle de una deuda específica' })
  async findOne(@Param('id') id: string, @Request() req) {
    const user = req.user;
    const invoice = await this.invoicesService.findOne(id);

    // Seguridad: si es customer, la factura debe estar en un servicio que pertenezca a su customer profile
    if (user.role === 'customer') {
      const serviceData = Array.isArray(invoice.service) ? invoice.service[0] : invoice.service;
      const invCustomer = serviceData?.customer;
      
      if (!invCustomer || invCustomer.user_id !== user.userId) {
        throw new NotFoundException('No tienes permiso para ver esta factura');
      }
    }

    return invoice;
  }

  /**
   * ACTUALIZAR DEUDA
   * Útil para marcar como pagado manualmente o actualizar datos.
   */
  @Patch(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Actualizar estado de deuda o link de pago (Solo Admin)' })
  update(@Param('id') id: string, @Body() updateInvoiceDto: UpdateInvoiceDto) {
    return this.invoicesService.update(id, updateInvoiceDto);
  }

  /**
   * ELIMINAR REGISTRO
   */
  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Eliminar registro de deuda' })
  remove(@Param('id') id: string) {
    return this.invoicesService.remove(id);
  } 
  

}