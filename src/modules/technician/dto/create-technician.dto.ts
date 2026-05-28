import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * DTO para creación de Técnico
 * El administrador proporciona email, password y datos del técnico.
 * El sistema crea el usuario en Auth, lo vincula con el rol 'technician' y crea el perfil.
 */
export class CreateTechnicianDto {
  @ApiProperty({
    description: 'Correo electrónico del técnico (usado para login)',
    example: 'juan.perez@aeronet.com',
  })
  @IsEmail({}, { message: 'El formato del correo es inválido' })
  @IsNotEmpty({ message: 'El email es obligatorio' })
  email: string;

  @ApiProperty({
    description: 'Contraseña para el acceso del técnico (mínimo 6 caracteres)',
    example: 'password123',
    minLength: 6,
  })
  @IsString()
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  password: string;

  @ApiProperty({
    description: 'Nombre completo del técnico',
    example: 'Juan Pérez García',
  })
  @IsString()
  @IsNotEmpty({ message: 'El nombre completo es obligatorio' })
  full_name: string;

  @ApiProperty({
    description: 'Número de teléfono del técnico',
    example: '987654321',
    required: false,
  })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({
    description: 'Zona de trabajo asignada al técnico',
    example: 'Lima Norte',
    required: false,
  })
  @IsString()
  @IsOptional()
  zone?: string;
}
