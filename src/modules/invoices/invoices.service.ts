import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { NotificationService } from 'src/integrations/notifications/notification.service';
import { ElectronicDocumentsService } from 'src/modules/electronic-documents/electronic-documents.service';

/**
 * ═══════════════════════════════════════════════════════════════════
 * SERVICIO DE GESTIÓN DE FACTURAS (INVOICES)
 * ═══════════════════════════════════════════════════════════════════
 * 
 * FLUJO COMPLETO DE ESTADOS:
 * 
 * 1. pending → Deuda generada automáticamente por el task handleDailyBilling
 *    - Se genera cuando pasa el billing_day del servicio
 *    - Estado inicial: falta pagar el cliente
 *    - Aparece en invoices como "pendiente de pago"
 * 
 * 2. paid → Cliente realizó el pago
 *    - Se actualiza cuando el cliente paga (payment manual o webhook)
 *    - El comprobante legal AÚN NO está generado
 *    - El task handlePendingElectronicBilling detectará esta factura
 * 
 * 3. invoiced → Comprobante legal generado
 *    - El task handlePendingElectronicBilling genera el comprobante en Nubefact
 *    - Factura/Boleta electrónica emitida y enviada al cliente
 *    - Estado final del ciclo de facturación
 * 
 * PROCESOS AUTOMÁTICOS:
 * - handleDailyBilling: Genera facturas con status='pending' cuando pasa billing_day
 * - handlePreventiveNotifications: Notifica facturas 'pending' 3 días antes del vencimiento
 * - handleOverdueReminders: Notifica facturas 'pending' vencidas (T+3)
 * - handlePendingElectronicBilling: Genera comprobantes para facturas 'paid' sin comprobante
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);
  private readonly table = 'invoices';

  /** Inyecta SupabaseService, NotificationService y ElectronicDocumentsService. */
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly notificationService: NotificationService,
    private readonly electronicDocsService: ElectronicDocumentsService,
  ) { }

  /**
   * MÉTODO: CREAR DEUDA INDIVIDUAL
   * 
   * FLUJO DE ESTADOS:
   * - pending: Deuda generada, falta pagar el cliente
   * - paid: Cliente pagó, esperando generación de comprobante legal
   * - invoiced: Comprobante legal generado (factura/boleta electrónica)
   */
  async create(createInvoiceDto: CreateInvoiceDto) {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from(this.table)
      .insert([{
        ...createInvoiceDto,
        status: createInvoiceDto.status || 'pending' // Por defecto 'pending' (falta pagar)
      }])
      .select()
      .single();

    if (error) {
      if (error.code === '23505') throw new BadRequestException('Ya existe una deuda para este periodo.');
      throw new BadRequestException(error.message);
    }
    return data;
  }

  /**
   * MÉTODO: GENERADOR MASIVO DE DEUDA (Por Admin)
   * Genera deudas para todos los servicios activos del periodo especificado.
   * 
   * IMPORTANTE: Verifica si ya existe una factura para evitar duplicados.
   */
  async generateMonthlyInvoices(period: string) {
    const supabase = this.supabaseService.getClient();

    const { data: activeServices, error: sError } = await supabase
      .from('services')
      .select('id, monthly_amount, billing_day')
      .eq('status', 'active');

    if (sError) throw new BadRequestException(sError.message);

    if (!activeServices || activeServices.length === 0) {
      return { message: `No hay servicios activos para el periodo ${period}`, count: 0, data: [] };
    }

    const createdInvoices: any[] = [];
    const skippedInvoices: any[] = [];

    for (const service of activeServices) {
      // Ajustar billing_day si es mayor que los días del mes
      const periodDate = new Date(period + '-01');
      const daysInMonth = new Date(periodDate.getFullYear(), periodDate.getMonth() + 1, 0).getDate();
      const actualBillingDay = Math.min(service.billing_day, daysInMonth);
      const dueDate = `${period}-${String(actualBillingDay).padStart(2, '0')}`;

      try {
        // Verificar si ya existe una factura para este servicio en este periodo
        const { data: existingInvoice } = await supabase
          .from(this.table)
          .select('id')
          .eq('service_id', service.id)
          .eq('period', period)
          .maybeSingle();

        if (existingInvoice) {
          skippedInvoices.push({
            service_id: service.id,
            reason: 'Ya existe factura para este periodo'
          });
          continue;
        }

        const invoiceData: CreateInvoiceDto = {
          service_id: service.id,
          period: period,
          total: service.monthly_amount,
          status: 'pending',
          due_date: dueDate
        };

        const invoice = await this.create(invoiceData);
        if (invoice) {
          createdInvoices.push(invoice);
          this.logger.log(`✅ Factura generada para servicio ${service.id} - Periodo ${period}`);
        }

      } catch (e) {
        this.logger.warn(`Servicio ${service.id} - Error al generar factura: ${e.message}`);
        skippedInvoices.push({
          service_id: service.id,
          reason: e.message
        });
      }
    }

    return { 
      message: `Periodo ${period} procesado`, 
      count: createdInvoices.length, 
      created: createdInvoices,
      skipped: skippedInvoices.length,
      skipped_details: skippedInvoices
    };
  }

  /**
   * MÉTODO: PROCESAR PAGO EXITOSO
   * 
   * IMPORTANTE: Solo cambia el estado a 'paid'
   * El comprobante legal será generado por el task handlePendingElectronicBilling
   * 
   * FLUJO:
   * 1. Cliente paga → status='paid'
   * 2. Task detecta factura 'paid' sin comprobante → genera comprobante → status='invoiced'
   */
  async markAsPaid(id: string) {
    const supabase = this.supabaseService.getClient();

    const { data: invoice, error } = await supabase
      .from(this.table)
      .update({
        status: 'paid', // Cambiar a 'paid' - el task generará el comprobante
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new BadRequestException('No se pudo actualizar el pago');

    this.logger.log(`✅ Pago confirmado para factura ${id}. Estado: paid. El task generará el comprobante legal.`);

    // NO generamos el comprobante aquí - el task handlePendingElectronicBilling lo hará
    // Esto asegura que el proceso sea asíncrono y pueda reintentarse si falla

    return invoice;
  }

  /**
   * MÉTODO: BUSCAR DEUDAS POR CLIENTE (CONSOLIDADO PARA N SERVICIOS)
   * Obtiene todos los servicios del customer_id, consulta sus facturas en una sola query
   * y devuelve un único array plano con todas las facturas (vencidas y por vencer).
   */
  async findByCustomer(userId: string) {
    const supabase = this.supabaseService.getClient();

    // 1. Buscar el customer real según el userId de auth
    const { data: customer, error: cError } = await supabase
      .from('customers')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (cError || !customer) {
      this.logger.warn(`No se encontró perfil de cliente para el usuario: ${userId}`);
      return { totalPending: 0, items: [] };
    }

    const realCustomerId = customer.id;

    // 2. Obtener TODOS los servicios asociados al cliente
    const { data: services } = await supabase
      .from('services')
      .select('id')
      .eq('customer_id', realCustomerId);

    if (!services || services.length === 0) {
      return { totalPending: 0, items: [] };
    }

    const serviceIds = services.map(s => s.id);

    // 3. Una sola query: facturas de todos los servicios (incluye customer para address/phone)
    const { data: debts, error: dError } = await supabase
      .from('invoices')
      .select(`
        *,
        service:services (
          address_text,
          plan:plans(name),
          customer:customers(id, full_name, email, phone)
        ),
        electronic_documents (
          pdf_url,
          xml_url,
          series,
          number,
          external_id,
          type
        ),
        payment_allocations (
          amount_applied,
          payment:payments (
            payment_method,
            payment_date
          )
        )
      `)
      .in('service_id', serviceIds)
      .order('due_date', { ascending: false })
      .limit(10000);

    if (dError) {
      throw new BadRequestException(dError.message);
    }

    const debtsList = Array.isArray(debts) ? debts : [];

    // 4. Total pendiente: suma de todas las facturas con status = 'pending'
    const totalPending = debtsList
      .filter(d => d.status === 'pending')
      .reduce((acc, curr) => acc + Number(curr.total), 0);

    // 5. Normalización final: array plano para el frontend (pdf_url desde electronic_documents)
    return {
      totalPending: Number(totalPending.toFixed(2)),
      items: debtsList.map(d => {
        const rawDocs = d.electronic_documents;
        const doc = Array.isArray(rawDocs) ? rawDocs[0] : rawDocs;
        const docRecord = doc && typeof doc === 'object' ? doc : null;

        const pagoInfo = d.payment_allocations?.[0]?.payment || null;

        return {
          ...d,
          pdf_url: docRecord?.pdf_url ?? null,
          xml_url: docRecord?.xml_url ?? null,
          series: docRecord?.series ?? null,
          number: docRecord?.number ?? null,
          external_id: docRecord?.external_id ?? null,
          document_type: docRecord?.type ?? null,
          electronic_documents: docRecord,
          payment_method: pagoInfo?.payment_method ?? null,
          payment_date: pagoInfo?.payment_date ?? null,
          service_info: d.service
        };
      })
    };
  }

  // --- MÉTODOS CRUD DE MANTENIMIENTO ---

  async findAll() {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from(this.table)
      .select(`
        *,
        service:services (
          id,
          address_text,
          sync_status,
          customer:customers (id, full_name, phone, email, document_number)
        )
      `)
      .order('due_date', { ascending: false });

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /**
   * Obtener datos de factura para pago (cliente autenticado).
   * JOIN estricto: Invoices -> Services -> Customers.
   * Retorna full_name, phone, email (cliente) y address_text (tabla services).
   */
  async findPaymentDetails(invoiceId: string, userId: string) {
    const supabase = this.supabaseService.getClient();

    const { data: customer, error: cError } = await supabase
      .from('customers')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (cError || !customer) throw new NotFoundException('Cliente no encontrado');

    const { data: invoice, error } = await supabase
      .from('invoices')
      .select(`
        id,
        period,
        total,
        due_date,
        status,
        service_id,
        service:services (
          address_text,
          plan:plans(name),
          customer:customers(id, full_name, email, phone)
        )
      `)
      .eq('id', invoiceId)
      .single();

    if (error || !invoice) throw new NotFoundException('Factura no encontrada');
    if (invoice.status !== 'pending') throw new BadRequestException('Esta factura ya fue pagada');

    const serviceData = Array.isArray(invoice.service) 
      ? invoice.service[0] 
      : invoice.service;

    const service = serviceData as Record<string, any> | undefined;
    const invCustomer = service?.customer as Record<string, unknown> | undefined;
    if (!invCustomer || invCustomer.id !== customer.id) {
      throw new NotFoundException('No tienes acceso a esta factura');
    }

    const address_text = (service?.address_text as string) ?? '';

    return {
      id: invoice.id,
      period: invoice.period,
      total: invoice.total,
      due_date: invoice.due_date,
      address_text,
      service_info: {
        address_text: service?.address_text,
        plan: service?.plan,
        customer: invCustomer,
      },
      customer: {
        id: invCustomer.id,
        full_name: invCustomer.full_name,
        email: invCustomer.email,
        phone: invCustomer.phone,
      },
    };
  }

  async findOne(id: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from(this.table)
      .select(`
        *,
        service:services (
          *,
          customer:customers (*)
        )
      `)
      .eq('id', id)
      .single();

    if (error || !data) throw new NotFoundException('Factura no encontrada');
    return data;
  }

  async update(id: string, updateInvoiceDto: UpdateInvoiceDto) {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from(this.table)
      .update(updateInvoiceDto)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async remove(id: string) {
    const supabase = this.supabaseService.getClient();
    const { error } = await supabase
      .from(this.table)
      .delete()
      .eq('id', id);

    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  /**
   * MÉTODO: EJECUTAR FACTURACIÓN DIARIA MANUALMENTE
   * Permite ejecutar manualmente el proceso de facturación diaria.
   * Útil para testing o cuando se necesita ejecutar fuera del horario programado.
   */
  async handleDailyBilling() {
    const supabase = this.supabaseService.getClient();
    const today = new Date();
    const dayOfMonth = today.getDate();
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();
    
    // Genera el periodo actual, ej: "2026-02"
    const period = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

    this.logger.log(`--- EJECUCIÓN MANUAL: GENERACIÓN AUTOMÁTICA DE FACTURAS ---`);

    // Buscamos TODOS los servicios activos
    const { data: allActiveServices, error } = await supabase
      .from('services')
      .select('id, status, billing_day, monthly_amount, customer_id')
      .eq('status', 'active');

    if (error) {
      this.logger.error(`Error consultando servicios para facturación: ${error.message}`);
      throw new BadRequestException(`Error consultando servicios: ${error.message}`);
    }

    if (!allActiveServices || allActiveServices.length === 0) {
      this.logger.log(`No hay servicios activos para procesar.`);
      return { message: 'No hay servicios activos para facturar', count: 0 };
    }

    // Filtrar servicios donde el billing_day del mes actual llegó o pasó
    const services = allActiveServices.filter(service => {
      const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
      const actualBillingDay = Math.min(service.billing_day, daysInMonth);
      const billingDateThisMonth = new Date(currentYear, currentMonth - 1, actualBillingDay);
      const todayDateOnly = new Date(currentYear, currentMonth - 1, dayOfMonth);
      return todayDateOnly >= billingDateThisMonth; // >= para incluir el mismo día
    });

    if (services.length === 0) {
      this.logger.log(`No hay servicios activos cuyo billing_day haya llegado o pasado (hoy es día ${dayOfMonth}).`);
      return { message: `No hay servicios para facturar hoy (día ${dayOfMonth})`, count: 0 };
    }

    this.logger.log(`Procesando ${services.length} servicio(s) activo(s) cuyo billing_day llegó o pasó (hoy es día ${dayOfMonth})`);

    let createdCount = 0;
    let skippedCount = 0;

    for (const service of services) {
      try {
        if (service.status !== 'active') {
          this.logger.warn(`Servicio ${service.id} tiene status '${service.status}', saltando facturación.`);
          skippedCount++;
          continue;
        }

        // Verificar si ya existe factura para este periodo
        const { data: existingInvoice } = await supabase
          .from(this.table)
          .select('id')
          .eq('service_id', service.id)
          .eq('period', period)
          .maybeSingle(); 

        if (existingInvoice) {
          this.logger.warn(`Factura saltada: El servicio ${service.id} ya tiene factura para el periodo ${period}.`);
          skippedCount++;
          continue; 
        }

        // Calcular fecha de vencimiento
        const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
        const actualBillingDay = Math.min(service.billing_day, daysInMonth);
        const billingDate = new Date(currentYear, currentMonth - 1, actualBillingDay);
        const dueDate = billingDate.toISOString().split('T')[0];

        // Crear la deuda
        await this.create({
          service_id: service.id,
          period: period,
          total: service.monthly_amount,
          due_date: dueDate,
          status: 'pending'
        });

        createdCount++;
        this.logger.log(`✅ Deuda generada para servicio ${service.id} - Periodo ${period} - Monto: ${service.monthly_amount}`);

      } catch (e) {
        this.logger.error(`❌ Error facturando servicio ${service.id}: ${e.message}`);
        skippedCount++;
      }
    }

    return { 
      message: 'Proceso de facturación ejecutado manualmente',
      period: period,
      created: createdCount,
      skipped: skippedCount,
      total_processed: services.length
    };
  }

  /**
   * MÉTODO PARA EL TASK: Buscar facturas pagadas sin comprobante legal
   */
  async findPaidWithoutDocument() {
    const supabase = this.supabaseService.getClient();

    // Traemos facturas 'paid' y verificamos que NO existan en electronic_documents
    const { data, error } = await supabase
      .from(this.table)
      .select(`
        *,
        service:services (
          customer:customers (*)
        ),
        electronic_documents!left(id)
      `)
      .eq('status', 'paid')
      .is('electronic_documents.id', null); // Filtro clave: "Donde el ID del documento sea nulo"

    if (error) {
      this.logger.error(`Error buscando facturas pendientes de legalizar: ${error.message}`);
      return [];
    }

    return data;
  }
}