import { ApiProperty } from '@nestjs/swagger';
import { 
    IsNotEmpty, 
    IsNumber, 
    IsString, 
    IsUUID, 
    IsEnum, 
    IsDateString, 
    IsOptional, 
    Min 
} from 'class-validator';

/**
 * DTO PARA REGISTRO DE CUENTAS POR COBRAR (INVOICES)
 * Define la estructura de la deuda interna antes de ser enviada a facturación electrónica.
 */
export class CreateInvoiceDto {
    
    @ApiProperty({ 
        description: 'ID del servicio (antena/plan) que genera la deuda',
        example: '550e8400-e29b-41d4-a716-446655440000' 
    })
    @IsUUID('4', { message: 'El service_id debe ser un UUID válido' })
    @IsNotEmpty({ message: 'El service_id es obligatorio' })
    service_id: string;

    @ApiProperty({ 
        example: '2026-01', 
        description: 'Periodo de facturación mensual (Formato YYYY-MM)' 
    })
    @IsString({ message: 'El periodo debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El periodo es obligatorio' })
    period: string;

    @ApiProperty({ 
        example: 79.90, 
        description: 'Monto total que el cliente debe pagar (Incluye IGV)' 
    })
    @IsNumber({}, { message: 'El total debe ser un valor numérico' })
    @Min(0, { message: 'El total no puede ser negativo' })
    @IsNotEmpty({ message: 'El monto total es obligatorio' })
    total: number;

    @ApiProperty({ 
        enum: ['pending', 'paid', 'invoiced'], 
        default: 'pending',
        description: 'Estado administrativo de la deuda: pending (pendiente), paid (pagado internamente), invoiced (facturado en Nubefact)' 
    })
    @IsEnum(['pending', 'paid', 'invoiced'], { 
        message: 'El estado debe ser pending, paid o invoiced' 
    })
    status: string;

    @ApiProperty({ 
        example: '2026-02-05', 
        description: 'Fecha límite de pago' 
    })
    @IsDateString({}, { message: 'La fecha de vencimiento debe tener formato de fecha válido (YYYY-MM-DD)' })
    @IsNotEmpty({ message: 'La fecha de vencimiento es obligatoria' })
    due_date: string;

    // --- CAMPOS PARA INTEGRACIÓN DE PAGOS ---

    @ApiProperty({ 
        required: false, 
        description: 'Link de pago generado para este recibo específico' 
    })
    @IsString()
    @IsOptional()
    payment_link?: string;


    // --- CAMPOS PARA GESTIÓN DE NOTIFICACIONES ---

    @ApiProperty({ 
        required: false, 
        description: 'Cantidad de veces que se ha notificado al cliente sobre esta deuda',
        example: 0 
    })
    @IsNumber()
    @IsOptional()
    notification_count?: number;

    @ApiProperty({ 
        required: false, 
        description: 'Fecha y hora del último recordatorio enviado (WhatsApp/Email)' 
    })
    @IsDateString()
    @IsOptional()
    last_notification_date?: string;

    /**
     * NOTA TÉCNICA:
     * Los campos 'subtotal' e 'igv' se omiten aquí ya que la base de datos AeroNet 
     * cuenta con un TRIGGER que los calcula automáticamente al insertar el 'total'.
     */
}