import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsEnum, IsNotEmpty, IsString, IsUUID, IsOptional } from "class-validator";

/**
 * DTO PARA CREACIÓN DE CLIENTE
 * Se usa tanto en el registro inicial (Auth) como en creaciones manuales.
 */
export class CreateCustomerDto {
    @ApiProperty({ 
        description: 'ID del usuario obtenido del registro en Auth', 
        example: '8ee999ac-78ff-4002-9645-dcfad81a9099'
    })
    @IsUUID('4', { message: 'El user_id debe ser un UUID válido' })
    @IsNotEmpty({ message: 'El user_id es obligatorio' })
    user_id: string;

    @ApiProperty({ enum: ['DNI', 'RUC'], example: 'DNI', required: false })
    @IsEnum(['DNI', 'RUC'], { message: 'El tipo de documento debe ser DNI o RUC' })
    @IsOptional() 
    document_type?: string;

    @ApiProperty({ example: '74859632', required: false })
    @IsString()
    @IsOptional() 
    document_number?: string;

    @ApiProperty({ example: 'Klinsman Mauricio' })
    @IsString()
    @IsNotEmpty({ message: 'El nombre completo es obligatorio' })
    full_name: string;

    @ApiProperty({ example: '987654321', required: false })
    @IsString()
    @IsOptional()
    phone?: string;

    @ApiProperty({ example: 'nombre@gmail.com' })
    @IsEmail({}, { message: 'El formato del correo es inválido' })
    @IsNotEmpty({ message: 'El email es obligatorio' })
    email: string;

    @ApiProperty({
        description: 'Tipo de comprobante preferido para AeroNet',
        enum: ['BOLETA', 'FACTURA', 'PROFORMA'],
        example: 'BOLETA',
        required: false
    })
    @IsEnum(['BOLETA', 'FACTURA', 'PROFORMA'], { message: 'Comprobante no válido' })
    @IsOptional() 
    billing_document_type?: string; 


    @ApiProperty({ description: 'URL de la foto de perfil', required: false })
    @IsString()
    @IsOptional()
    avatar_url?: string;

    @ApiProperty({ description: 'Dirección de facturación', example: 'Av. Ejemplo 123', required: false })
    @IsString()
    @IsOptional()
    address?: string;

    @ApiProperty({ description: 'Ciudad / Distrito', example: 'Yanahuara', required: false })
    @IsString()
    @IsOptional()
    city?: string;

    @ApiProperty({ description: 'Departamento / Estado', example: 'Arequipa', required: false })
    @IsString()
    @IsOptional()
    state?: string;

    @ApiProperty({ description: 'Código postal', example: '04017', required: false })
    @IsString()
    @IsOptional()
    postal_code?: string;
}