import { Controller, Get, Post, Body, Param, UseGuards, NotFoundException,BadRequestException } from '@nestjs/common';
import { ElectronicDocumentsService } from './electronic-documents.service';
import { CreateElectronicDocumentDto } from './dto/create-electronic-document.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
// IMPORTANTE: Asegúrate de importar tu servicio de notificaciones
import { NotificationService } from '../../integrations/notifications/notification.service'; 

@ApiTags('Electronic Documents (SUNAT)')
@Controller('electronic-documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ElectronicDocumentsController {
  /** Inyecta ElectronicDocumentsService y NotificationService para comprobantes y reenvío por WhatsApp. */
  constructor(
    private readonly service: ElectronicDocumentsService,
    private readonly notificationService: NotificationService 
  ) {}

  /** POST :id/resend-whatsapp: reenvía el comprobante electrónico por WhatsApp (plantilla recordatoriopago). */
  @Post(':id/resend-whatsapp')
  @Roles('admin')
  @ApiBearerAuth()
  @ApiOperation({ 
    summary: 'Reenvío manual de comprobante por WhatsApp', 
    description: 'Busca el documento por ID y dispara la plantilla recordatoriopago de Meta' 
  })
  async resendInvoice(@Param('id') id: string) {
    // 1. Buscamos el documento (Asegúrate que findOne devuelva los campos necesarios)
    const doc = await this.service.findOne(id);
    
    // 2. Validaciones estrictas antes de llamar a Meta
    if (!doc) throw new NotFoundException('Documento no encontrado');
    
    // Verificamos que existan los datos mínimos para la plantilla 'recordatoriopago'
    if (!doc.customer_phone) throw new BadRequestException('El cliente no tiene un teléfono registrado');
    if (!doc.pdf_url) throw new BadRequestException('El documento no tiene una URL de PDF generada');

    const customer_phone = doc.customer_phone;
    const customer_name = doc.customer_name || 'Cliente';
    const total_amount = doc.total_amount ? doc.total_amount.toString() : '0.00';
    const customer_email: string | undefined = (doc as any).customer_email || undefined;
    const invoice_id = (doc as { invoice_id?: string }).invoice_id;

    if (!invoice_id) throw new BadRequestException('El documento no tiene invoice_id asociado');

    const result = await this.notificationService.sendInvoicePdf(
      invoice_id,
      customer_phone,
      customer_name,
      total_amount,
      customer_email,
    );

    if (!result.whatsapp) {
        return {
            success: false,
            message: `Error al procesar el envío en Meta para ${customer_name}. Revisa los logs del servidor.`,
            emailSent: result.email,
        };
    }

    return { 
      success: true, 
      message: `WhatsApp enviado a ${customer_name} (${customer_phone})${result.email ? ' + Email ✅' : ''}`,
      emailSent: result.email,
    };
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Generar y registrar un nuevo comprobante en Nubefact/SUNAT' })
  create(@Body() dto: CreateElectronicDocumentDto) {
    return this.service.create(dto);
  }

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'Listar todos los documentos electrónicos' })
  findAll() {
    return this.service.findAll();
  }

  @Get('invoice/:invoiceId')
  @Roles('admin', 'customer')
  @ApiOperation({ summary: 'Listar documentos asociados a una factura específica' })
  findByInvoice(@Param('invoiceId') invoiceId: string) {
    return this.service.findByInvoice(invoiceId);
  }

  @Post('invoice/:invoiceId/refresh')
  @Roles('admin', 'customer')
  @ApiOperation({ summary: 'Forzar validación del comprobante (recuperar pdf_url si se generó pero no se guardó)' })
  refreshComprobante(@Param('invoiceId') invoiceId: string) {
    return this.service.refreshComprobanteByInvoiceId(invoiceId);
  }

  @Get(':id')
  @Roles('admin', 'customer')
  @ApiOperation({ summary: 'Obtener detalle de un documento por UUID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}