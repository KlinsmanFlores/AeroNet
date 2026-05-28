import { PartialType } from '@nestjs/swagger';
import { CreateInvoiceDto } from './create-invoice.dto';

/**
 * DTO PARA ACTUALIZACIÓN DE INVOICES
 * Hereda todas las validaciones de CreateInvoiceDto pero hace que todos los campos
 * sean opcionales. Se utiliza principalmente para:
 * 1. Marcar una deuda como pagada (status: 'paid').
 * 2. Actualizar la metadata de notificaciones enviadas.
 */
export class UpdateInvoiceDto extends PartialType(CreateInvoiceDto) {}