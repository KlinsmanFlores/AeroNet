import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { MercadoPagoService } from '../../integrations/mercadopago/mercadopago.service';
import { NubefactService } from '../../integrations/nubefact/nubefact.service';
import { ElectronicDocumentsService } from '../electronic-documents/electronic-documents.service';
import { NotificationService } from '../../integrations/notifications/notification.service';



@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly table = 'payments';

  /** Inyecta SupabaseService, MercadoPagoService, NubefactService, ElectronicDocumentsService y NotificationService. */
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly mpService: MercadoPagoService,
    private readonly nubefactService: NubefactService,
    private readonly electronicDocsService: ElectronicDocumentsService,
    private readonly notificationService: NotificationService,
  ) { }

  /**
   * GENERAR LINK DE PAGO CON MERCADO PAGO
   * Guarda checkout_id, qr_code_url y short_payment_url en la tabla invoices
   */
  async generatePaymentUrl(
    invoiceId: string,
    chosenDocumentType: 'BOLETA' | 'FACTURA',
  ) {
    const supabase = this.supabaseService.getClient();

    const { data: invoice, error } = await supabase
      .from('invoices')
      .select('*, service:services(address_text, customer:customers(*))')
      .eq('id', invoiceId)
      .single();

    if (error || !invoice) throw new NotFoundException('Factura no encontrada');

    // Mapeamos el cliente de forma segura
    const customer = (invoice as any).service.customer;

    // Generar link con Mercado Pago
    const paymentLink = await this.mpService.createPreference(
      invoice.id,
      invoice.total,
      `AeroNet - Recibo ${invoice.period}`,
      customer.email,
      customer.id,
      invoice.service_id,
      chosenDocumentType,
    );
    const provider = 'MERCADO_PAGO';
    const paymentMode = paymentLink.qr_code_url ? 'QR_DINAMICO' : 'CHECKOUT_LINK';

    const pl = paymentLink as Record<string, unknown>;
    const updateData: Record<string, unknown> = {
      payment_link: pl.init_point ?? pl.url,
      checkout_id: pl.checkout_id ?? pl.id,
      qr_code_url: pl.qr_code_url ?? pl.qr_url ?? null,
      short_payment_url: pl.short_payment_url ?? pl.init_point ?? pl.url,
    };

    await supabase
      .from('invoices')
      .update(updateData)
      .eq('id', invoiceId);

    this.logger.log(`✅ Pago generado: Provider=${provider}, Mode=${paymentMode}, Checkout=${updateData.checkout_id}`);

    const qrUrl = pl.qr_code_url ?? pl.qr_url ?? pl.init_point ?? pl.url;
    const result: Record<string, unknown> = {
      url: pl.init_point ?? pl.url,
      preferenceId: pl.checkout_id ?? pl.id,
      qr_url: qrUrl,
      qr_code_base64: pl.qr_code_base64,
      short_url: updateData.short_payment_url,
      provider,
      payment_mode: paymentMode,
      amount: invoice.total,
    };
    return result;
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

  /**
   * GENERAR ORDEN QR DE MERCADO PAGO PARA UNA FACTURA
   * Orquesta la llamada a MercadoPagoService.generarOrdenQR con la notification_url del .env (MP_NOTIFICATION_URL).
   */
  async generateMercadoPagoQR(invoiceId: string) {
    const supabase = this.supabaseService.getClient();
    const { data: invoice, error } = await supabase
      .from('invoices')
      .select('id, total, period, service:services(id, customer:customers(id))')
      .eq('id', invoiceId)
      .single();

    if (error || !invoice) {
      throw new NotFoundException('Factura no encontrada');
    }

    const description = `Factura ${(invoice as any).period || invoiceId}`;
    const totalAmount = Number((invoice as any).total ?? 0);
    if (totalAmount <= 0) {
      throw new BadRequestException('El monto de la factura debe ser mayor a 0');
    }

    return this.mpService.generarOrdenQR({
      external_reference: String(invoice.id),
      title: description,
      description,
      total_amount: totalAmount,
      // notification_url se usa desde MP_NOTIFICATION_URL en MercadoPagoService (ngrok)
    });
  }

  /**
   * PROCESAR WEBHOOK DE MERCADO PAGO
   * Recibe el JSON de MP y lo transforma para el reparto de deudas en AeroNet.
   * Detecta tipo por type o topic (MP puede enviar uno u otro).
   * merchant_order: se ignora la notificación de creación; solo se procesa cuando la orden está paid o closed.
   */
  async processMPWebhook(rawBody: any) {
    try {
      const topic = rawBody.type || rawBody.topic;

      // TIPO 1: MERCHANT ORDER (QR DINÁMICO)
      if (topic === 'merchant_order') {
        this.logger.log('🔔 Webhook tipo merchant_order (QR) recibido');
        return await this.processMPMerchantOrder(rawBody);
      }

      // TIPO 2: PAYMENT (CHECKOUT LINK / PREFERENCE)
      if (rawBody.action !== 'payment.created' && topic !== 'payment') {
        return { status: 'ignored' };
      }

        const paymentId = rawBody.data?.id || rawBody.id;
        const mpPayment = await this.mpService.getPaymentDetails(String(paymentId));

        if (mpPayment.status !== 'approved') return { status: 'not_approved' };

        let mappedMethod = 'CARD'; 
        if (mpPayment.payment_method_id === 'account_money') mappedMethod = 'QR';
        if (mpPayment.payment_method_id === 'bank_transfer') mappedMethod = 'TRANSFER';

        const paymentData: CreatePaymentDto = {
            customer_id: mpPayment.metadata.customer_id, 
            service_id: mpPayment.metadata.service_id,   
            amount_received: Number(mpPayment.transaction_amount),
            payment_method: mappedMethod as any,
            transaction_reference: `MP-${paymentId}`,
            provider: 'MERCADO_PAGO',
            payment_mode: 'CHECKOUT_LINK',
            checkout_id: mpPayment.id.toString(),
            // INYECTAMOS la elección del documento en el raw_webhook_data para que triggerLateInvoicing lo vea
            raw_webhook_data: {
                ...rawBody,
                chosen_document_type: mpPayment.metadata.chosen_document_type
            }
        };

        return await this.create(paymentData);

    } catch (error) {
        this.logger.error(`Error crítico en Webhook MP: ${error.message}`);
        throw new BadRequestException('Error al procesar el pago');
    }
  }

  /**
   * PROCESAR MERCHANT ORDER DE MERCADO PAGO (QR DINÁMICO)
   * MP envía una notificación de creación y otra cuando se paga. Ignoramos la de creación y solo
   * procesamos cuando la orden está paid o closed.
   */
  private async processMPMerchantOrder(rawBody: any) {
    try {
      const orderId = this.mpService.getWebhookResourceId(rawBody);
      if (!orderId) {
        this.logger.warn('[Webhook MP] merchant_order sin ID (revisar data.id o resource)');
        return { status: 'ignored', reason: 'missing_order_id' };
      }
      const merchantOrder = await this.mpService.getMerchantOrder(orderId);

      const status = (merchantOrder.order_status || '').toLowerCase();
      const isPaidOrClosed = status === 'paid' || status === 'closed';
      if (!isPaidOrClosed) {
        this.logger.log(`Merchant Order ${orderId} ignorada (creación o pendiente): order_status=${merchantOrder.order_status}`);
        return { status: 'ignored', order_status: merchantOrder.order_status };
      }

      // Obtener el primer pago de la orden
      const payment = merchantOrder.payments?.[0];
      if (!payment) {
        throw new BadRequestException('Merchant Order sin pagos asociados');
      }

      const paymentDetails = await this.mpService.getPaymentDetails(String(payment.id));

      // Forzamos el tipo a 'any' para poder leer la metadata que la interfaz oficial no reconoce
      const orderData = merchantOrder as any;
      const customer_id = orderData.metadata?.customer_id || merchantOrder.external_reference;
      const service_id = orderData.metadata?.service_id;
      const chosen_document_type = orderData.metadata?.chosen_document_type || 'BOLETA';

      let mappedMethod = 'QR'; // Por defecto QR para merchant orders
      if (paymentDetails.payment_method_id === 'debit_card' || paymentDetails.payment_method_id === 'credit_card') {
        mappedMethod = 'CARD';
      }

      const paymentData: CreatePaymentDto = {
        customer_id,
        service_id,
        amount_received: Number(merchantOrder.total_amount),
        payment_method: mappedMethod as any,
        transaction_reference: `MP-MO-${orderId}`,
        provider: 'MERCADO_PAGO',
        payment_mode: 'QR_DINAMICO',
        checkout_id: orderId,
        raw_webhook_data: {
          ...rawBody,
          chosen_document_type
        }
      };

      this.logger.log(`✅ Pago QR procesado: Orden ${orderId}, Monto: ${merchantOrder.total_amount}`);
      return await this.create(paymentData);

    } catch (error) {
      this.logger.error(`Error procesando Merchant Order: ${error.message}`);
      throw new BadRequestException('Error al procesar el pago QR');
    }
  }



  /**
   * MÉTODO: NOTIFICACIÓN MANUAL CON REDUNDANCIA (OpenPay + Mercado Pago)
   * RESILIENTE: El envío de WhatsApp ocurre INCLUSO si falla la generación del link de pago.
   * Try-catch aislado para obtención de recursos de pago.
   */
  /**
   * GENERACIÓN DE QR CON MERCADO PAGO (solo para notificaciones)
   * Retorna el string EMVCo del QR dinámico sin actualizar la factura.
   * El llamador puede convertir el qr_data a imagen usando api.qrserver.com.
   * Retorna null si falla (no lanza excepciones).
   */
  async tryGetMpQrData(
    invoiceId: string,
    amount: number,
    description: string,
  ): Promise<string | null> {
    try {
      this.logger.log(`[MP-QR] Intentando generar QR Mercado Pago para factura ${invoiceId}...`);
      const result = await this.mpService.generarOrdenQR({
        external_reference: invoiceId,
        title: description,
        description,
        total_amount: amount,
      });
      const qrData = result?.qr_data || null;
      if (qrData) {
        this.logger.log(`[MP-QR] ✅ QR MP obtenido (${qrData.slice(0, 30)}...)`);
      } else {
        this.logger.warn(`[MP-QR] MP respondió pero sin qr_data.`);
      }
      return qrData;
    } catch (err: any) {
      this.logger.warn(`[MP-QR] Fallo: ${err?.message ?? String(err)}. Continuando sin QR.`);
      return null;
    }
  }



  async sendManualPaymentReminder(invoiceId: string) {
    const supabase = this.supabaseService.getClient();

    const { data: invoice, error } = await supabase
      .from('invoices')
      .select('*, service:services(customer:customers(*))')
      .eq('id', invoiceId)
      .single();

    if (error || !invoice) {
      throw new NotFoundException('Factura no encontrada');
    }

    const customer = (invoice as any).service?.customer;
    if (!customer?.phone?.trim()) {
      throw new BadRequestException('El cliente no tiene un celular registrado');
    }

    const amountFormatted = `S/ ${Number(invoice.total).toFixed(2)}`;
    const FALLBACK_IMAGE = process.env.FALLBACK_QR_IMAGE_URL || 'https://aeronet.com.pe/logo.png';

    let qrToData = invoice.mp_qr_code?.trim() || invoice.qr_code_url?.trim() || null;
    let paymentLink = invoice.short_payment_url?.trim() || invoice.payment_link?.trim() || null;

    // Try-catch aislado: intentar obtener QR/Link de proveedores sin crashear
    if (!qrToData || !paymentLink) {
      try {
        const result = await this.generatePaymentUrl(invoiceId, 'BOLETA');
        qrToData = qrToData || (result.qr_url as string);
        paymentLink = paymentLink || (result.url as string);
      } catch (err: any) {
        this.logger.warn(`No se pudo generar link/QR para factura ${invoiceId}: ${err?.message}. Enviando WhatsApp sin enlace.`);
      }
    }

    qrToData = qrToData || FALLBACK_IMAGE;
    paymentLink = paymentLink || 'https://aeronet.com.pe';

    const sent = await this.notificationService.sendPaymentDayAlertWithQr(
      customer.phone,
      customer.full_name,
      invoice.due_date,
      amountFormatted,
      qrToData,
      paymentLink,
    );

    if (sent) {
      await supabase
        .from('invoices')
        .update({
          last_notification_date: new Date(),
          notification_count: (invoice.notification_count || 0) + 1,
        })
        .eq('id', invoiceId);

      this.logger.log(`✅ WhatsApp enviado a ${customer.full_name}`);
      return { success: true, message: `Notificación enviada a ${customer.full_name}` };
    }

    throw new BadRequestException('Error al enviar WhatsApp. Verifica plantillas en Meta Business Suite.');
  }
}