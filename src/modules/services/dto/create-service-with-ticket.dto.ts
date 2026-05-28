import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { 
  IsEnum, 
  IsNotEmpty, 
  IsOptional, 
  IsString, 
  IsUUID, 
  IsLatitude, 
  IsLongitude 
} from 'class-validator';

/**
 * DTO PARA CREACIÓN DE SERVICIO CON TICKET AUTOMÁTICO
 * Incluye los datos del servicio y del ticket de instalación asociado
 * 
 * NOTA IMPORTANTE:
 * - El campo 'status' NO está incluido en este DTO
 * - El servicio se crea automáticamente con status='pending'
 * - Esto es correcto porque cuando se crea por ticket, el servicio aún no está instalado
 * - El técnico cambiará el status a 'active' cuando complete la instalación
 * 
 * ESTADOS PERMITIDOS EN BD: 'pending', 'active', 'suspended'
 */
export class CreateServiceWithTicketDto {
  // Campos del Servicio
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

  // billing_day NO es enviado por el cliente: se asigna al activar el servicio (admin/técnico).

  // Campos del Ticket (Orden de Trabajo)
  @ApiPropertyOptional({ description: 'Asunto del ticket de instalación' })
  @IsString()
  @IsOptional()
  ticket_subject?: string;

  @ApiPropertyOptional({ description: 'Descripción adicional para el técnico' })
  @IsString()
  @IsOptional()
  ticket_description?: string;

  @ApiPropertyOptional({ 
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium',
    description: 'Prioridad del ticket' 
  })
  @IsEnum(['low', 'medium', 'high', 'urgent'])
  @IsOptional()
  ticket_priority?: 'low' | 'medium' | 'high' | 'urgent';
}
