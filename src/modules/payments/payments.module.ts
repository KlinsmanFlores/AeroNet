import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { NubefactIntegrationModule } from '../../integrations/nubefact/nubefact.module';
import { ElectronicDocumentsModule } from '../electronic-documents/electronic-documents.module';

import { NotificationModule } from '../../integrations/notifications/notifications.module'; 

@Module({
  imports: [
    ConfigModule,
    NubefactIntegrationModule,
    ElectronicDocumentsModule,
    // AGREGARLO AQUÍ TAMBIÉN
    NotificationModule 
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService
  ],
  exports: [PaymentsService],
})
export class PaymentsModule { }