import { ApiProperty } from '@nestjs/swagger';
import { 
  IsEnum, 
  IsInt, 
  IsNotEmpty, 
  IsNumber, 
  IsOptional, 
  IsString, 
  IsUUID, 
  Max, 
  Min, 
  IsLatitude, 
  IsLongitude 
} from 'class-validator';

/**
 * DTO PARA CREACIÓN DE SERVICIOS (INSTALACIONES)
 * Define el contrato de datos necesario para activar un servicio de internet.
 * 
 * ESTADOS PERMITIDOS (según constraint de BD):
 * - 'pending': Servicio creado pero aún no instalado/completo
 * - 'active': Servicio activo y funcionando
 * - 'suspended': Servicio suspendido temporalmente
 */
export class CreateServiceDto {
  
  @ApiProperty({ description: 'ID del cliente en AeroNet' })
  @IsUUID('4', { message: 'El ID del cliente debe ser un UUID válido' })
  @IsNotEmpty()
  customer_id: string;

  @ApiProperty({ description: 'ID del plan seleccionado' })
  @IsUUID('4', { message: 'El ID del plan debe ser un UUID válido' })
  @IsNotEmpty()
  plan_id: string;

  @ApiProperty({ example: 'Av. Ejército 123, Cayma', description: 'Dirección de la instalación' })
  @IsString()
  @IsNotEmpty({ message: 'La dirección es obligatoria' })
  address_text: string;

  @ApiProperty({ example: -16.398, required: false, description: 'Latitud GPS' })
  @IsLatitude({ message: 'La latitud no es válida' })
  @IsOptional()
  latitude?: number;

  @ApiProperty({ example: -71.536, required: false, description: 'Longitud GPS' })
  @IsLongitude({ message: 'La longitud no es válida' })
  @IsOptional()
  longitude?: number;

  @ApiProperty({ 
    enum: ['pending', 'active', 'suspended'], 
    default: 'active',
    description: 'Estado del servicio: pending (pendiente de instalación), active (activo), suspended (suspendido)'
  })
  @IsEnum(['pending', 'active', 'suspended'], { message: 'Estado inválido. Debe ser: pending, active o suspended' })
  @IsOptional()
  status?: string;

  @ApiProperty({ example: 5, description: 'Día de facturación (1-31)' })
  @IsInt()
  @Min(1)
  @Max(31)
  billing_day: number;

  @ApiProperty({ example: 85.00, description: 'Monto mensual final' })
  @IsNumber({}, { message: 'El monto debe ser numérico' })
  @Min(0)
  monthly_amount: number;


}