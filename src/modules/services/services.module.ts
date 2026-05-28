import { Module } from '@nestjs/common';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';


// --- INTEGRACIONES Y DEPENDENCIAS ---
import { CustomersModule } from '../customers/customers.module';
import { TicketsModule } from '../tickets/tickets.module';

/**
 * MÓDULO DE SERVICIOS (INSTALACIONES)
 * Encapsula la gestión de contratos de internet y su sincronización técnica.
 */
@Module({
  imports: [
    CustomersModule, // Permite usar CustomersService
    TicketsModule, // Para crear tickets automáticamente
  ],
  controllers: [ServicesController],
  providers: [
    ServicesService,
  ],
  exports: [ServicesService]
})
export class ServicesModule { }