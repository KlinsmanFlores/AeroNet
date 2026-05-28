import { Module } from '@nestjs/common';
import { ElectronicDocumentsService } from './electronic-documents.service';
import { ElectronicDocumentsController } from './electronic-documents.controller';
import { NubefactIntegrationModule } from '../../integrations/nubefact/nubefact.module';
import { NotificationService } from '../../integrations/notifications/notification.service';

@Module({
  imports: [
    NubefactIntegrationModule,
    
  ],
  controllers: [ElectronicDocumentsController],
  providers: [ElectronicDocumentsService, NotificationService],
  exports: [ElectronicDocumentsService]
})
export class ElectronicDocumentsModule { }