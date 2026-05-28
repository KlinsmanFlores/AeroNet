import { 
  IsUUID, 
  IsEnum, 
  IsString, 
  IsNumber, 
  IsOptional, 
  IsNotEmpty, 
  IsEmail, 
  Length 
} from 'class-validator';

export class CreateElectronicDocumentDto {
  @IsUUID()
  @IsNotEmpty()
  invoice_id: string;

  @IsUUID()
  @IsOptional()
  payment_id?: string;

  @IsEnum(['BOLETA', 'FACTURA', 'PROFORMA'])
  type: 'BOLETA' | 'FACTURA' | 'PROFORMA';

  @IsString()
  @IsNotEmpty()
  @Length(8, 11, { message: 'El documento debe tener entre 8 (DNI) y 11 (RUC) dígitos' })
  customer_document: string; // Este es el número de DNI o RUC

  @IsString()
  @IsNotEmpty()
  customer_name: string;

  @IsString()
  @IsOptional()
  customer_address?: string; 

  @IsEmail()
  @IsOptional()
  customer_email?: string;

  @IsNumber()
  @IsNotEmpty()
  total: number;

  @IsString()
  @IsNotEmpty()
  period: string;

  @IsNumber()
  @IsOptional() 
  next_number?: number;
  
  @IsString()
  @IsNotEmpty()
  customer_phone: string;

  @IsString()
  @IsOptional()
  external_id?: string;

  // Campo adicional opcional por si necesitas pasar el tipo de documento de Sunat (1 para DNI, 6 para RUC)
  @IsNumber()
  @IsOptional()
  customer_document_type?: number;
}