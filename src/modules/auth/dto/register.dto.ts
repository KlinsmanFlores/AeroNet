import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, IsEnum, MinLength } from 'class-validator';

export class RegisterDto {
    @ApiProperty({ 
        description: 'Correo electrónico para el login',
        example: 'admin@aeronet.com' 
    })
    @IsEmail()
    email: string;

    @ApiProperty({ 
        description: 'Contraseña (mínimo 6 caracteres)',
        example: 'aeronet2026',
        minLength: 6 
    })
    @IsString()
    @MinLength(6)
    password: string;

    @ApiProperty({ 
        description: 'Nombre del rol asigando',
        example: 'admin', 
        enum:['admin','technician','supervisor','customer']
    })
    @IsEnum(['admin','technician','supervisor','customer'])
    @IsNotEmpty()
    role_name: string;
}