import { Module, forwardRef } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { ConfigModule } from '@nestjs/config';
import { NotificationModule } from '../../integrations/notifications/notifications.module';
import { ElectronicDocumentsModule } from '../electronic-documents/electronic-documents.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationService } from '../../integrations/notifications/notification.service';

/**
 * MÓDULO DE FACTURACIÓN ADMINISTRATIVA (INVOICES)
 * Este módulo gestiona las cuentas por cobrar y el cálculo de impuestos (IGV).
 * Es el paso previo a la pasarela de pagos y la facturación electrónica.
 */
@Module({
  imports: [
    NotificationModule,
    ElectronicDocumentsModule,
    forwardRef(() => PaymentsModule), // Usar forwardRef para evitar dependencias circulares

    // Importamos el ConfigModule para que el servicio pueda leer 
    // variables de entorno si fuera necesario.
    ConfigModule,
  ],
  controllers: [InvoicesController],
  providers: [
    InvoicesService,
    NotificationService
  ],
  exports: [
    // Exportamos el InvoicesService para que el módulo de Payments 
    // pueda marcar deudas como pagadas.
    InvoicesService
  ],
})
export class InvoicesModule { }