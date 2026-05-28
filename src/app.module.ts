import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseModule } from './supabase.module';

// --- MÓDULOS DE NEGOCIO ---
import { AuthModule } from './modules/auth/auth.module';
import { CustomersModule } from './modules/customers/customers.module';
import { PlansModule } from './modules/plans/plans.module';
import { ServicesModule } from './modules/services/services.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ElectronicDocumentsModule } from './modules/electronic-documents/electronic-documents.module';
import { TasksModule } from './modules/tasks/tasks.module';


import { DiscoveryModule } from '@nestjs/core';
import { TechnicianModule } from './modules/technician/technician.module';

@Module({
  imports: [
    DiscoveryModule,
    ScheduleModule.forRoot(),

    ConfigModule.forRoot({
      isGlobal: true,
    }),
    SupabaseModule, // Main Shared Module
    AuthModule,
    CustomersModule,
    PlansModule,
    ServicesModule,
    InvoicesModule,
    PaymentsModule,
    ElectronicDocumentsModule,
    TasksModule,
    TechnicianModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
  ],
})
export class AppModule { }