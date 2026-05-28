import { IsString, IsNotEmpty, IsOptional, IsEnum, IsUUID, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TicketType {
    TICKET = 'ticket',         // Soporte, consultas
    WORK_ORDER = 'work_order'  // Instalaciones, traslados, mantenimiento en campo
}

export enum TicketPriority {
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
    URGENT = 'urgent'
}

/** 10 categorías de tickets AeroNet (columna category). */
export enum TicketCategory {
    NUEVO_SERVICIO = 'NUEVO_SERVICIO',
    REACTIVACION = 'REACTIVACION',
    FACTURACION = 'FACTURACION',
    TRASLADO = 'TRASLADO',
    RECIBO_FISICO = 'RECIBO_FISICO',
    RECLAMO = 'RECLAMO',
    SUSPENSION = 'SUSPENSION',
    MEJORA_PLAN = 'MEJORA_PLAN',
    COBERTURA_WIFI = 'COBERTURA_WIFI',
    PAUSA_VACACIONES = 'PAUSA_VACACIONES',
}

export class CreateTicketDto {
    @ApiProperty({ enum: TicketType, description: 'Tipo: ticket (soporte) o work_order (instalación/traslado)' })
    @IsEnum(TicketType)
    type: TicketType;

    @ApiPropertyOptional({ description: 'Asunto; si no se envía, se genera como "Trámite de [Categoría]"' })
    @IsString()
    @IsOptional()
    subject?: string;

    @ApiProperty({ description: 'Descripción detallada del problema o solicitud' })
    @IsString()
    @IsNotEmpty()
    description: string;

    @ApiPropertyOptional({ description: 'ID del servicio asociado (UUID en aeronet.services)' })
    @IsUUID()
    @IsOptional()
    service_id?: string;

    @ApiProperty({ enum: TicketCategory, description: 'Categoría del trámite (mapeada a aeronet.tickets.category)' })
    @IsEnum(TicketCategory)
    category: TicketCategory;

    @ApiPropertyOptional({ description: 'ID del plan solicitado (para instalaciones)' })
    @IsString()
    @IsOptional()
    requested_plan?: string;

    @ApiPropertyOptional({ description: 'Prioridad del ticket', default: TicketPriority.MEDIUM })
    @IsEnum(TicketPriority)
    @IsOptional()
    priority?: TicketPriority;

    @ApiPropertyOptional({ description: 'Indica si requiere visita técnica (mantenimiento)' })
    @IsBoolean()
    @IsOptional()
    requires_maintenance?: boolean;
}
