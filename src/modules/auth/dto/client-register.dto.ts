import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ClientRegisterDto {
    @ApiProperty({ 
        description: 'Correo electrónico del cliente',
        example: 'cliente@gmail.com' 
    })
    @IsEmail()
    email: string;

    @ApiProperty({ 
        description: 'Contraseña (mínimo 6 caracteres)',
        example: 'password123',
        minLength: 6 
    })
    @IsString()
    @MinLength(6)
    password: string;

    @ApiProperty({ 
        description: 'Nombre completo del cliente',
        example: 'Juan Pérez'
    })
    @IsString()
    @IsNotEmpty()
    full_name: string;
}