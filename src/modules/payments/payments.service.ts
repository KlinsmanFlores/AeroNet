import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { NubefactService } from '../../integrations/nubefact/nubefact.service';
import { ElectronicDocumentsService } from '../electronic-documents/electronic-documents.service';
import { NotificationService } from '../../integrations/notifications/notification.service';



@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly table = 'payments';

  /** Inyecta SupabaseService, NubefactService, ElectronicDocumentsService y NotificationService. */
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly nubefactService: NubefactService,
    private readonly electronicDocsService: ElectronicDocumentsService,
    private readonly notificationService: NotificationService,
  ) { }

  /** Verifica si un invoiceId pertenece al userId del cliente logueado */
  async checkCustomerAccessToInvoice(invoiceId: string, userId: string) {
    const supabase = this.supabaseService.getClient();

    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (!customer) throw new NotFoundException('Cliente no encontrado');

    const { data: invoice } = await supabase
      .from('invoices')
      .select('service:service_id(customer_id)')
      .eq('id', invoiceId)
      .single();

    if (!invoice) throw new NotFoundException('Factura no encontrada');

    const service = Array.isArray(invoice.service) ? invoice.service[0] : invoice.service;
    if (!service || service.customer_id !== customer.id) {
      throw new NotFoundException('No tienes permiso para operar con esta factura');
    }
  }

  /**
   * PROCESAR PAGO (Lógica de Reparto a Allocations + Nubefact)
   * ESTE MÉTODO SE QUEDA TAL CUAL, es el corazón de tu sistema.
   */
  async create(createPaymentDto: CreatePaymentDto) {
    const supabase = this.supabaseService.getClient();

    // 1. Registrar el Pago (con provider, payment_mode y checkout_id)
    const { data: payment, error: pError } = await supabase
      .from(this.table)
      .insert([{
        customer_id: createPaymentDto.customer_id,
        amount_received: createPaymentDto.amount_received,
        payment_method: createPaymentDto.payment_method,
        transaction_reference: createPaymentDto.transaction_reference,
        raw_webhook_data: createPaymentDto.raw_webhook_data,
        provider: createPaymentDto.provider || null,
        payment_mode: createPaymentDto.payment_mode || null,
        checkout_id: createPaymentDto.checkout_id || null,
        payment_date: new Date()
      }])
      .select()
      .single();

    if (pError) throw new BadRequestException(`Error en pago: ${pError.message}`);

    // 2. Buscar facturas pendientes (Lógica FIFO; si invoice_id viene del webhook, priorizar esa)
    let pendingInvoices: any[] = [];
    const { data: fetched } = await supabase
      .from('invoices')
      .select('*, service:services(customer:customers(*))')
      .eq('status', 'pending')
      .eq('service_id', createPaymentDto.service_id)
      .order('due_date', { ascending: true });
    pendingInvoices = fetched ?? [];

    if (createPaymentDto.invoice_id && pendingInvoices.length > 0) {
      const target = pendingInvoices.find((i) => i.id === createPaymentDto.invoice_id);
      if (target) {
        pendingInvoices = [target, ...pendingInvoices.filter((i) => i.id !== createPaymentDto.invoice_id)];
      }
    }

    let remainingMoney = Number(createPaymentDto.amount_received);

    if (pendingInvoices && pendingInvoices.length > 0) {
      for (const invoice of pendingInvoices) {
        if (remainingMoney <= 0) break;

        const invoiceTotal = Number(invoice.total);
        const amountToApply = Number(Math.min(remainingMoney, invoiceTotal).toFixed(2));

        // 3. Crear Alocación de Pago (aeronet.payment_allocations)
        await supabase
          .from('payment_allocations')
          .insert([{
            payment_id: payment.id,
            invoice_id: invoice.id,
            amount_applied: amountToApply
          }]);

        // 4. Si se cancela completamente la factura, actualizar status a 'paid'
        // El comprobante legal será generado por el task handlePendingElectronicBilling
        if (amountToApply >= invoiceTotal) {
          await supabase
            .from('invoices')
            .update({ status: 'paid' }) // Solo cambiar a 'paid' - el task generará el comprobante
            .eq('id', invoice.id);

          this.logger.log(`✅ Factura ${invoice.id} marcada como pagada. El task generará el comprobante legal.`);
          
          // NO generamos el comprobante aquí - el task handlePendingElectronicBilling lo hará
          // Esto asegura que el proceso sea asíncrono y pueda reintentarse si falla
        }
        remainingMoney = Number((remainingMoney - amountToApply).toFixed(2));
      }
    }
    return { payment, status: 'Pago procesado exitosamente' };
  }

  // --- MÉTODOS CRUD ---
  /**
   * Lista pagos con customer. Enriquece con plan de servicio vía payment_allocations → invoices → services → plans
   * (sin usar relación directa payments-services que puede no existir en el schema).
   */
  async findAll() {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from(this.table)
      .select('*, customer:customers(id, full_name, document_number, email)')
      .order('payment_date', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    const payments = data ?? [];
    if (payments.length === 0) return payments;

    const paymentIds = payments.map((p) => p.id);
    const { data: allocations } = await supabase
      .from('payment_allocations')
      .select('payment_id, invoice_id')
      .in('payment_id', paymentIds);
    if (!allocations?.length) return payments;

    const invoiceIds = [...new Set(allocations.map((a) => a.invoice_id).filter(Boolean))];
    if (invoiceIds.length === 0) return payments;

    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, service_id')
      .in('id', invoiceIds);
    if (!invoices?.length) return payments;

    const serviceIds = [...new Set(invoices.map((i) => i.service_id).filter(Boolean))];
    if (serviceIds.length === 0) return payments;

    const { data: services } = await supabase
      .from('services')
      .select('id, plan:plans(name)')
      .in('id', serviceIds);

    const invoiceToService = Object.fromEntries(invoices.map((i) => [i.id, i.service_id]));
    const serviceToPlan = new Map<string, string>();
    for (const s of services ?? []) {
      const name = (s as { plan?: { name?: string } }).plan?.name;
      if (name) serviceToPlan.set(s.id, name);
    }
    const paymentToInvoice = new Map<string, string>();
    for (const a of allocations) {
      if (!paymentToInvoice.has(a.payment_id)) paymentToInvoice.set(a.payment_id, a.invoice_id);
    }
    for (const p of payments) {
      const invoiceId = paymentToInvoice.get(p.id);
      const serviceId = invoiceId ? invoiceToService[invoiceId] : null;
      const planName = serviceId ? serviceToPlan.get(serviceId) : null;
      if (planName) {
        (p as any).service = { plan: { name: planName } };
      }
    }
    return payments;
  }

  /** Obtiene un pago por ID desde la tabla payments. */
  async findOne(id: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from(this.table)
      .select('*, allocations:payment_allocations(*)')
      .eq('id', id)
      .single();
    if (error || !data) throw new NotFoundException('Pago no encontrado');
    return data;
  }

  /** Actualiza un registro de pago por ID con los campos enviados en el DTO. */
  async update(id: string, updatePaymentDto: UpdatePaymentDto) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from(this.table)
      .update(updatePaymentDto)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /** Elimina un registro de pago por ID de la base de datos. */
  async remove(id: string) {
    const supabase = this.supabaseService.getClient();
    const { error } = await supabase.from(this.table).delete().eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }


  /**
   * REINTENTO DE FACTURACIÓN (Llamado por el Cron de Tasks)
   * Extrae los datos del cliente desde la relación anidada y dispara la creación legal.
   */
  async triggerLateInvoicing(invoice: any) {
    const supabase = this.supabaseService.getClient();
    try {
      // 1. Extraemos el cliente
      const customer = invoice.service?.customer; 
      
      if (!customer) {
        throw new Error(`Factura ${invoice.id} no pudo cargar los datos del cliente.`);
      }

      // 2. Buscamos la alocación y la relación con el pago
      const { data: allocation } = await supabase
        .from('payment_allocations')
        .select(`
          payment_id,
          payments (
            raw_webhook_data
          )
        `)
        .eq('invoice_id', invoice.id)
        .limit(1)
        .maybeSingle();

      // 3. Lógica dinámica: Extraemos la elección del webhook de Mercado Pago
      // Casteamos a any para evitar errores de compilación
      const rawData = (allocation as any)?.payments?.raw_webhook_data;
      const chosenType = rawData?.chosen_document_type || customer.billing_document_type || 'BOLETA';

      // 4. Disparamos la creación en Nubefact
      await this.electronicDocsService.create({
        invoice_id: invoice.id,
        customer_phone: customer.phone || '999999999', 
        payment_id: allocation?.payment_id || null,
        type: chosenType as 'BOLETA' | 'FACTURA',
        customer_document: customer.document_number,
        customer_name: customer.full_name,
        customer_address: customer.address || "LIMA - PERU",
        customer_email: customer.email,
        total: Number(invoice.total),
        period: invoice.period,
      });

      this.logger.log(`✅ Reintento exitoso para ${customer.full_name} como ${chosenType}`);
      
    } catch (err) {
      this.logger.error(`❌ Falló triggerLateInvoicing para Factura ${invoice.id}: ${err.message}`);
      throw err; 
    }
  }

}