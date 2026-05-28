import { IsUUID, IsString, IsOptional } from 'class-validator';

export class RequestServiceDto {
  @IsUUID()
  plan_id: string;

  @IsString()
  subject: string;

  @IsOptional()
  @IsString()
  description?: string;
}
