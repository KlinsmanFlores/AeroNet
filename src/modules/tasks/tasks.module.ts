// src/modules/tasks/tasks.module.ts
import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { InvoicesModule } from '../invoices/invoices.module';
import { NotificationModule } from '../../integrations/notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
    imports: [
        PaymentsModule,
        InvoicesModule,
        NotificationModule,
    ],
    controllers: [TasksController],
    providers: [TasksService],
})
export class TasksModule { }