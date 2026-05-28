import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateTechnicianDto } from './create-technician.dto';
import { IsOptional, IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO para actualización de Técnico
 * Permite actualizar datos del perfil (full_name, phone, zone, status)
 * NO permite cambiar email ni password (eso se hace desde Auth)
 */
export class UpdateTechnicianDto extends PartialType(
  OmitType(CreateTechnicianDto, ['email', 'password'] as const)
) {
  @ApiProperty({
    description: 'Estado del técnico',
    enum: ['active', 'inactive'],
    example: 'active',
    required: false,
  })
  @IsEnum(['active', 'inactive'], { message: 'El estado debe ser "active" o "inactive"' })
  @IsOptional()
  status?: 'active' | 'inactive';
}
