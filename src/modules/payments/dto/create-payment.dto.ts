// apps/backend/src/modules/payments/dto/create-payment.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, IsUUID, IsOptional, IsObject, Min, IsEnum } from 'class-validator';

export class CreatePaymentDto {
    @ApiProperty({ description: 'ID del cliente (UUID de la tabla customers)' })
    @IsUUID()
    @IsNotEmpty()
    customer_id: string;

    @ApiProperty({ description: 'ID del servicio para aplicar el reparto de dinero' })
    @IsUUID()
    @IsNotEmpty()
    service_id: string;

    @ApiProperty({ example: 79.90, description: 'Monto real recibido' })
    @IsNumber()
    @Min(0.01)
    @IsNotEmpty()
    amount_received: number;

    // Ampliamos el Enum para aceptar los tipos de Mercado Pago
    @ApiProperty({ example: 'CARD', enum: ['QR', 'YAPE', 'CARD', 'TRANSFER'], description: 'Método de pago recibido' })
    @IsEnum(['QR', 'YAPE', 'CARD', 'TRANSFER']) 
    @IsNotEmpty()
    payment_method: string;

    @ApiProperty({ example: 'MP-987654321', description: 'Referencia única de la pasarela' })
    @IsString()
    @IsNotEmpty()
    transaction_reference: string;

    @ApiProperty({ required: false, description: 'Cuerpo completo del Webhook para auditoría' })
    @IsObject()
    @IsOptional()
    raw_webhook_data?: any;

    @ApiProperty({ example: 'MERCADO_PAGO', enum: ['MERCADO_PAGO'], required: false, description: 'Proveedor de pago' })
    @IsEnum(['MERCADO_PAGO'])
    @IsOptional()
    provider?: string;

    @ApiProperty({ example: 'QR_DINAMICO', enum: ['QR_DINAMICO', 'CHECKOUT_LINK', 'CARD_BRICK', 'MANUAL'], required: false, description: 'Modo de pago utilizado' })
    @IsEnum(['QR_DINAMICO', 'CHECKOUT_LINK', 'CARD_BRICK', 'MANUAL'])
    @IsOptional()
    payment_mode?: string;

    @ApiProperty({ required: false, description: 'ID del checkout/preference generado' })
    @IsString()
    @IsOptional()
    checkout_id?: string;

    @ApiProperty({ required: false, description: 'ID de factura específica (con metadata)' })
    @IsUUID()
    @IsOptional()
    invoice_id?: string;
}