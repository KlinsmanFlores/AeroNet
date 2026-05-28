import { IsEmail, IsString } from "class-validator"
import {ApiProperty} from '@nestjs/swagger' 


export class LoginDto {
    @ApiProperty({example:'admin@aeronet.com'})
    @IsEmail()
    email:string;

    @ApiProperty({example: 'aeronet2026'})
    @IsString()
    password: string;
}