import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  BadRequestException,
  NotFoundException,
  Logger,
  HttpCode,
  UnauthorizedException,
  Headers,
  Query,
  Res,
  Request,
} from '@nestjs/common';
import { Response } from 'express';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

// SEGURIDAD (Solo importamos los Guards, no el decorador Public)
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Payments (Dinero y Webhooks)')
@Controller('payments')
export class PaymentsController {

  private readonly logger = new Logger(PaymentsController.name);

  /** Inyecta PaymentsService para pagos locales. */
  constructor(
    private readonly paymentsService: PaymentsService,
  ) { }



  /**
   * SIMULAR PAGO LOCAL (Bypass de Mercado Pago)
   * Útil para pruebas o cobros directos sin pasarela externa.
   */
  @Post('simulate/:invoiceId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'customer')
  @ApiOperation({ summary: 'Simular el pago de una factura localmente' })
  async simulatePayment(
    @Param('invoiceId') invoiceId: string,
    @Request() req
  ) {
    if (req.user.role === 'customer') {
      await this.paymentsService.checkCustomerAccessToInvoice(invoiceId, req.user.userId);
    }

    const supabase = this.paymentsService['supabaseService'].getClient();

    // 1. Obtener la factura
    const { data: invoice, error } = await supabase
      .from('invoices')
      .select('*, service:services(customer_id)')
      .eq('id', invoiceId)
      .single();

    if (error || !invoice) {
      throw new BadRequestException('Factura no encontrada');
    }

    if (invoice.status !== 'pending') {
      throw new BadRequestException('La factura ya está pagada o en otro estado');
    }

    const customer_id = (invoice.service as any).customer_id;

    // 2. Crear el pago que internamente llama a Nubefact si es necesario, 
    // pero aquí sólo simulamos el flujo creando el registro de payment.
    const paymentData: CreatePaymentDto = {
      customer_id: customer_id,
      service_id: invoice.service_id,
      amount_received: Number(invoice.total),
      payment_method: 'CASH', // Pago simulado en efectivo
      transaction_reference: `SIM-${Date.now()}`,
      provider: 'LOCAL_SIMULATOR',
      payment_mode: 'DIRECT',
      invoice_id: invoiceId
    };

    return this.paymentsService.create(paymentData);
  }





  /**
   * MÉTODOS ADMINISTRATIVOS (CRUD)
   * PROTEGIDOS: Todos llevan @UseGuards
   */
  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Registrar un pago manualmente (Efectivo/Transferencia)' })
  create(@Body() createPaymentDto: CreatePaymentDto) {
    return this.paymentsService.create(createPaymentDto);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'technician')
  @ApiOperation({ summary: 'Listar todos los pagos registrados' })
  findAll() {
    return this.paymentsService.findAll();
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'customer')
  @ApiOperation({ summary: 'Obtener detalle de un pago por ID' })
  async findOne(@Param('id') id: string, @Request() req) {
    const payment = await this.paymentsService.findOne(id);
    if (!payment) throw new NotFoundException('Pago no encontrado');

    if (req.user.role === 'customer') {
      // Necesitamos validar que la factura asociada a este pago pertenece al usuario
      // El payment devuelto por findOne trae customer_id. Podemos validar directo con customer profile.
      const supabase = this.paymentsService['supabaseService'].getClient();
      const { data: customer } = await supabase.from('customers').select('id').eq('user_id', req.user.userId).single();
      if (!customer || payment.customer_id !== customer.id) {
         throw new NotFoundException('No tienes permiso para ver este pago');
      }
    }

    return payment;
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Actualizar datos de un pago' })
  update(@Param('id') id: string, @Body() updatePaymentDto: UpdatePaymentDto) {
    return this.paymentsService.update(id, updatePaymentDto);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Eliminar un registro de pago' })
  remove(@Param('id') id: string) {
    return this.paymentsService.remove(id);
  }






}