import { IsString, IsOptional, IsEnum, IsUUID, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TicketPriority } from './create-ticket.dto';

export class UpdateTicketDto {
  @ApiPropertyOptional({ description: 'Estado del ticket', example: 'open' })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ description: 'ID del técnico asignado' })
  @IsUUID()
  @IsOptional()
  technician_id?: string | null;

  @ApiPropertyOptional({ description: 'Prioridad', enum: TicketPriority })
  @IsEnum(TicketPriority)
  @IsOptional()
  priority?: TicketPriority;

  @ApiPropertyOptional({ description: 'Categoría del ticket' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ description: 'Descripción o notas internas' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Requiere visita de mantenimiento' })
  @IsBoolean()
  @IsOptional()
  requires_maintenance?: boolean;

  @ApiPropertyOptional({ description: 'Notas de resolución para el cliente' })
  @IsString()
  @IsOptional()
  resolution_notes?: string;
}
