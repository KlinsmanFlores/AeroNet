import { Controller, Post, Param, Body, UseGuards } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiBody } from '@nestjs/swagger';

/**
 * Panel de control manual para el Administrador.
 * Endpoints resilientes a fallos de proveedores de pago (MercadoPago).
 */
@ApiTags('Test Tasks (Panel Manual Admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('test-tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  /**
   * Enviar recordatorio preventivo (3 días antes del vencimiento).
   * WhatsApp se envía incluso si falla la generación del link de pago.
   */
  @Post('notify-preventive/:invoiceId')
  @ApiOperation({ summary: 'Enviar recordatorio preventivo por WhatsApp (manual)' })
  async notifyPreventive(@Param('invoiceId') invoiceId: string) {
    return this.tasksService.notifyPreventiveManual(invoiceId);
  }

  /**
   * Enviar notificación del día de vencimiento (billing day).
   * WhatsApp se envía incluso si falla la generación del link/QR.
   */
  @Post('notify-billing-day/:invoiceId')
  @ApiOperation({ summary: 'Enviar notificación día de vencimiento por WhatsApp (manual)' })
  async notifyBillingDay(@Param('invoiceId') invoiceId: string) {
    return this.tasksService.notifyBillingDayManual(invoiceId);
  }

  /**
   * Enviar alerta de deuda vencida (corte).
   * WhatsApp se envía incluso si falla la generación del QR.
   */
  @Post('notify-overdue/:invoiceId')
  @ApiOperation({ summary: 'Enviar alerta de corte por WhatsApp (manual)' })
  async notifyOverdue(@Param('invoiceId') invoiceId: string) {
    return this.tasksService.notifyOverdueManual(invoiceId);
  }


  /**
   * Generar comprobante Nubefact (boleta/factura) para factura pagada.
   * Solo aplica a facturas con status 'paid' sin comprobante legal.
   */
  @Post('generate-nubefact/:invoiceId')
  @ApiOperation({ summary: 'Generar comprobante Nubefact manualmente' })
  async generateNubefact(@Param('invoiceId') invoiceId: string) {
    return this.tasksService.generateNubefactManual(invoiceId);
  }

  /**
   * Enviar credenciales de acceso al cliente por WhatsApp.
   * El admin proporciona la contraseña ya que no puede recuperarse del hash.
   */
  @Post('send-credentials/:customerId')
  @ApiOperation({ summary: 'Enviar credenciales de acceso al cliente por WhatsApp (manual)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { password: { type: 'string', example: 'MiClave123' } },
      required: ['password'],
    },
  })
  async sendCredentials(
    @Param('customerId') customerId: string,
    @Body('password') password: string,
  ) {
    return this.tasksService.sendCredentialsManual(customerId, password);
  }
}
