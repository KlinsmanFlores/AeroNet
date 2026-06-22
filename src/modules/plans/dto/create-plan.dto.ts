import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsString, IsNotEmpty, IsNumber, Min, MaxLength, IsOptional } from "class-validator";

/**
 * ESQUEMA DE TRANSFERENCIA: CREACIÓN DE PLAN
 * Define las reglas de validación para la entrada de datos al catálogo de servicios.
 * Estas reglas protegen la integridad de la base de datos en Supabase.
 */
export class CreatePlanDto {

    @ApiProperty({ 
        example: 'Duo Fibra 100 Mbps', 
        description: 'Nombre comercial del plan de internet' 
    })
    @IsString({ message: 'El nombre debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El nombre del plan es obligatorio' })
    @MaxLength(100, { message: 'El nombre es demasiado largo (máx. 100 caracteres)' })
    name: string;

    @ApiProperty({ 
        example: 100, 
        description: 'Velocidad en Mbps' 
    })
    @IsNumber({}, { message: 'La velocidad debe ser un número' })
    @Min(1, { message: 'La velocidad mínima es de 1 Mbps' })
    speed_mbps: number;

    @ApiProperty({ 
        example: 79.90, 
        description: 'Costo mensual del servicio en soles (PEN)' 
    })
    @IsNumber({}, { message: 'El precio debe ser un número decimal o entero' })
    @Min(0, { message: 'El precio no puede ser un valor negativo' })
    price: number;

    @ApiPropertyOptional({ 
        example: 'Plan ideal para teletrabajo y Netflix', 
        description: 'Descripción del plan' 
    })
    @IsString({ message: 'La descripción debe ser una cadena de texto' })
    @IsOptional()
    description?: string;

}