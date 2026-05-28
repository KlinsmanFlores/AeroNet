import { PartialType } from '@nestjs/swagger';
import { CreateElectronicDocumentDto } from './create-electronic-document.dto';

export class UpdateElectronicDocumentDto extends PartialType(CreateElectronicDocumentDto) {}
