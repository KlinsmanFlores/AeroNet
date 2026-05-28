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
  Logger,
  HttpCode,
  UnauthorizedException,
  Headers,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { PaymentsService } from './payments.service';
import { MercadoPagoService } from '../../integrations/mercadopago/mercadopago.service';
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

  /** Inyecta PaymentsService y MercadoPagoService para pagos y webhooks. */
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly mercadopagoService: MercadoPagoService,
  ) { }

  /**
   * GENERAR LINK DE PAGO PARA EL CLIENTE
   * PROTEGIDO: Requiere JWT (Cliente o Admin)
   */
  @Post('generate-link/:invoiceId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'customer')
  @ApiOperation({ summary: 'Generar Link de Pago con Mercado Pago para una factura' })
  async generateLink(
    @Param('invoiceId') invoiceId: string,
    @Body() body: { 
      chosenDocumentType: 'BOLETA' | 'FACTURA'; 
    }
  ) {
    const { chosenDocumentType } = body;
    
    if (!chosenDocumentType) {
      throw new BadRequestException('Debes elegir el tipo de documento (BOLETA o FACTURA)');
    }

    return this.paymentsService.generatePaymentUrl(invoiceId, chosenDocumentType);
  }

  /**
   * GENERAR QR MERCADO PAGO PARA UNA FACTURA
   * PROTEGIDO: Requiere JWT (Cliente o Admin)
   */
  @Post('mercadopago/qr')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'customer')
  @ApiOperation({ summary: 'Generar orden QR de Mercado Pago para pagar una factura' })
  async generateMercadoPagoQR(@Body() body: { invoiceId: string }) {
    const { invoiceId } = body;
    if (!invoiceId?.trim()) {
      throw new BadRequestException('invoiceId es requerido');
    }
    return this.paymentsService.generateMercadoPagoQR(invoiceId.trim());
  }

  /**
   * WEBHOOK DE MERCADO PAGO (Público)
   * LIBRE: No tiene @UseGuards, por lo tanto es accesible desde internet.
   * URL configurada en MP: https://kiltlike-trigly-hana.ngrok-free.dev/payments/webhook/mercadopago
   */
  @Post('webhook/mercadopago')
  @HttpCode(200)
  @ApiOperation({ summary: 'Recibir notificación de pago desde Mercado Pago (Payment o Merchant Order)' })
  async handleMPWebhook(
    @Body() rawBody: any,
    @Headers('x-signature') xSignature: string,
    @Headers('x-request-id') xRequestId: string,
  ) {
    const webhookType = rawBody.type || rawBody.topic || 'unknown';
    this.logger.log(`🔔 Webhook MP recibido - Tipo: ${webhookType}`);

    if (webhookType === 'unknown') {
      this.logger.log(`[Webhook MP] Body completo (tipo unknown): ${JSON.stringify(rawBody, null, 2)}`);
    }

    const dataId = this.mercadopagoService.getWebhookResourceId(rawBody) ?? rawBody.data?.id ?? rawBody.id;
    const isValid = this.mercadopagoService.validateWebhookSignature({
      xSignature: xSignature ?? '',
      xRequestId: xRequestId ?? '',
      dataId: dataId != null ? String(dataId) : undefined,
    });

    const skipValidation = process.env.MP_WEBHOOK_SKIP_VALIDATION === 'true';
    if (!isValid) {
      if (skipValidation) {
        this.logger.warn('⚠️ [MODO PRUEBA] Webhook MP: Firma no válida pero MP_WEBHOOK_SKIP_VALIDATION=true — procesando igual. No uses esto en producción.');
        return this.paymentsService.processMPWebhook(rawBody);
      }
      throw new UnauthorizedException('Firma de webhook inválida');
    }

    return this.paymentsService.processMPWebhook(rawBody);
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
  findOne(@Param('id') id: string) {
    return this.paymentsService.findOne(id);
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





  /**
   * RECORDATORIO MANUAL
   * PROTEGIDO: Solo Admin
   */
  @Post('send-manual-reminder/:invoiceId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Enviar manualmente recordatorio de cobro por WhatsApp (con QR y Link)' })
  async sendManualReminder(@Param('invoiceId') invoiceId: string) {
    return this.paymentsService.sendManualPaymentReminder(invoiceId);
  }
}