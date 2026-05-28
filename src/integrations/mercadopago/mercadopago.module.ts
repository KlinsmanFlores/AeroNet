import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { mercadopagoConfig } from './mercadopago.config';
import { MercadoPagoService } from './mercadopago.service';

@Module({
  imports: [ConfigModule.forFeature(mercadopagoConfig)],
  providers: [MercadoPagoService],
  exports: [MercadoPagoService],
})
export class MercadoPagoIntegrationModule {}