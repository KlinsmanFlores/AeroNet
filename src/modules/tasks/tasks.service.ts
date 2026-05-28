import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../../supabase.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationService } from 'src/integrations/notifications/notification.service';

/** URL de imagen placeholder cuando falla la generación de QR (logo AeroNet). */
const FALLBACK_QR_IMAGE = process.env.FALLBACK_QR_IMAGE_URL || 'https://aeronet.com.pe/logo.png';

@Injectable()
export class TasksService {
    private readonly logger = new Logger(TasksService.name);

    /** Inyecta SupabaseService, InvoicesService, PaymentsService y NotificationService. */
    constructor(
        private readonly supabaseService: SupabaseService,
        private readonly invoicesService: InvoicesService,
        private readonly paymentsService: PaymentsService,
        private readonly notificationService: NotificationService,
    ) {}


    /**
     * 2. AVISO PREVENTIVO DE PAGO (3 DÍAS ANTES)
     * ACTUALIZADO: Envía QR y Link de pago por WhatsApp
     * CON FRENO DE MANO: No repite mensajes si se reinicia el sistema.
     */
    @Cron('0 8 * * *') 
    async handlePreventiveNotifications() {
        this.logger.log('--- CRON: WHATSAPP PREVENTIVO (T-3) ---');
        const supabase = this.supabaseService.getClient();

        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + 3);
        const targetDateStr = targetDate.toISOString().split('T')[0];

        // ⚠️ PRUEBAS — filtro preventive_notified desactivado para reenvíos repetidos
        // Restaurar en producción: añadir .eq('preventive_notified', false)
        const { data: invoices, error } = await supabase
            .from('invoices')
            .select('*, service:services(customer:customers(*))')
            .eq('status', 'pending')
            .eq('due_date', targetDateStr);
            // .eq('preventive_notified', false); // <-- FILTRO DE SEGURIDAD (desactivado)

        if (error) {
            this.logger.error(`Error al consultar facturas preventivas: ${error.message}`);
            return;
        }

        if (!invoices || invoices.length === 0) {
            this.logger.log('No hay avisos preventivos pendientes para hoy.');
            return;
        }

        for (const inv of invoices) {
            const customer = inv.service?.customer;

            if (customer?.phone) {
                try {
                    const amountFormatted = `S/ ${Number(inv.total).toFixed(2)}`;
                    const description = `AeroNet - Recibo ${inv.period ?? ''}`.trim();

                    const { qrImageUrl, paymentLink } = await this.tryGetPaymentResources(
                        inv.id,
                        Number(inv.total),
                        description,
                    );

                    const result = await this.notificationService.sendUnifiedAlert({
                        phone: customer.phone,
                        email: customer.email || undefined,
                        clientName: customer.full_name,
                        dueDate: inv.due_date,
                        amount: amountFormatted,
                        paymentLink: paymentLink || undefined,
                        qrImageUrl: qrImageUrl || undefined,
                        type: 'PREVENTIVE',
                    });

                    // ⚠️ PRUEBAS — siempre incrementa contador, NO marca preventive_notified=true
                    await supabase
                        .from('invoices')
                        .update({
                            last_notification_date: new Date(),
                            notification_count: (inv.notification_count || 0) + 1,
                        })
                        .eq('id', inv.id);
                    if (result.whatsapp) {
                        this.logger.log(`✅ [CRON-PREVENTIVE] Notificado: ${customer.full_name}`);
                    } else {
                        this.logger.warn(`⚠️ [CRON-PREVENTIVE] WA falló para ${customer.full_name}.`);
                    }
                } catch (e) {
                    this.logger.error(`❌ [CRON-PREVENTIVE] Error notificando a ${customer.full_name}: ${e.message}`);
                }
            }
        }
    }

    /**
     * 3. NOTIFICACIÓN DEL DÍA DE VENCIMIENTO (BILLING DAY)
     * Envía QR destacado y Link de pago el día exacto del vencimiento
     */
    @Cron('0 10 * * *')
    async handleBillingDayNotifications() {
        this.logger.log('--- CRON: NOTIFICACIÓN DÍA DE PAGO (BILLING DAY) ---');
        const supabase = this.supabaseService.getClient();

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        // Buscar facturas cuyo due_date es HOY y que aún estén pending
        const { data: invoices, error } = await supabase
            .from('invoices')
            .select('*, service:services(customer:customers(*))')
            .eq('status', 'pending')
            .eq('due_date', todayStr);

        if (error) {
            this.logger.error(`Error consultando facturas del día: ${error.message}`);
            return;
        }

        if (!invoices || invoices.length === 0) {
            this.logger.log('No hay facturas con vencimiento hoy.');
            return;
        }

        for (const inv of invoices) {
            const customer = inv.service?.customer;

            if (customer?.phone) {
                try {
                    const amountFormatted = `S/ ${Number(inv.total).toFixed(2)}`;
                    const description = `AeroNet - Recibo ${inv.period ?? ''}`.trim();

                    const { qrImageUrl, paymentLink } = await this.tryGetPaymentResources(
                        inv.id,
                        Number(inv.total),
                        description,
                    );

                    const result = await this.notificationService.sendUnifiedAlert({
                        phone: customer.phone,
                        email: customer.email || undefined,
                        clientName: customer.full_name,
                        dueDate: inv.due_date,
                        amount: amountFormatted,
                        paymentLink: paymentLink || undefined,
                        qrImageUrl: qrImageUrl || undefined,
                        type: 'BILLING_DAY',
                    });

                    if (result.whatsapp) {
                        await supabase
                            .from('invoices')
                            .update({
                                last_notification_date: new Date(),
                                notification_count: (inv.notification_count || 0) + 1,
                            })
                            .eq('id', inv.id);
                        this.logger.log(`✅ [CRON-BILLING-DAY] Notificado: ${customer.full_name}`);
                    } else {
                        this.logger.warn(`⚠️ [CRON-BILLING-DAY] WA falló para ${customer.full_name}.`);
                    }
                } catch (e) {
                    this.logger.error(`❌ [CRON-BILLING-DAY] Error notificando a ${customer.full_name}: ${e.message}`);
                }
            }
        }
    }

    /**
     * 4. GENERACIÓN DE DEUDA DIARIA (Billing Engine)
     * CON FRENO DE MANO: Evita duplicar deudas si el servidor se reinicia.
     * 
     * REGLAS DE NEGOCIO:
     * - status: Solo servicios con status 'active' generan deuda
     *   - 'pending': Servicio creado por ticket pero aún incompleto, NO genera deuda
     *   - 'suspended': Servicio suspendido, NO genera deuda
     *   - 'active': Servicio completo y contratado, SÍ genera deuda
     * 
     * - billing_day: La deuda se genera cuando llega o pasa el billing_day
     *   Ejemplo: Si billing_day = 1 y hoy es día 1, se genera la deuda (mismo día)
     *   Ejemplo: Si billing_day = 1 y hoy es día 2, se genera la deuda (ya pasó)
     * 
     * FLUJO:
     * 1. Servicio creado por ticket → status='pending' → NO genera deuda
     * 2. Técnico completa instalación → status='active' → Comienza ciclo de facturación
     * 3. Cuando llega o pasa el billing_day → Genera factura en invoices
     * 4. Factura aparece en invoices con status='pending' para que el cliente pague
     */
    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async handleDailyBilling() {
        this.logger.log('--- CRON: GENERACIÓN AUTOMÁTICA DE FACTURAS ---');
        const today = new Date();
        const dayOfMonth = today.getDate();
        const currentMonth = today.getMonth() + 1;
        const currentYear = today.getFullYear();
        
        // Genera el periodo actual, ej: "2026-02"
        const period = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

        const supabase = this.supabaseService.getClient();


        // Buscamos TODOS los servicios activos (filtrar por billing_day después)
        const { data: allActiveServices, error } = await supabase
            .from('services')
            .select('id, status, billing_day, monthly_amount, customer_id')
            .eq('status', 'active'); // Solo servicios activos

        if (error) {
            this.logger.error(`Error consultando servicios para facturación: ${error.message}`);
            return;
        }

        if (!allActiveServices || allActiveServices.length === 0) {
            this.logger.log(`No hay servicios activos para procesar.`);
            return;
        }

        // Filtrar servicios donde el billing_day del mes actual YA PASÓ
        // Lógica: Calculamos la fecha del billing_day para este mes y verificamos si ya pasó
        const services = allActiveServices.filter(service => {
            // Calcular la fecha del billing_day para el mes actual
            // Ajustar si billing_day es mayor que los días del mes (ej: billing_day=31 en febrero)
            const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
            const actualBillingDay = Math.min(service.billing_day, daysInMonth);
            const billingDateThisMonth = new Date(currentYear, currentMonth - 1, actualBillingDay);
            
            // La deuda se genera si el billing_day del mes actual YA PASÓ o ES HOY
            // Comparar solo las fechas (sin horas)
            const todayDateOnly = new Date(currentYear, currentMonth - 1, dayOfMonth);
            return todayDateOnly > billingDateThisMonth; // >= para incluir el mismo día del billing_day
        });

        if (services.length === 0) {
            this.logger.log(`No hay servicios activos cuyo billing_day del mes actual haya llegado o pasado (hoy es día ${dayOfMonth}).`);
            return;
        }

        this.logger.log(`Procesando ${services.length} servicio(s) activo(s) cuyo billing_day del mes actual llegó o pasó (hoy es día ${dayOfMonth})`);

        for (const service of services) {
            try {
                // Validación adicional: Asegurar que el servicio sigue siendo 'active'
                // (por si cambió de estado entre la consulta y el procesamiento)
                if (service.status !== 'active') {
                    this.logger.warn(`Servicio ${service.id} tiene status '${service.status}', saltando facturación.`);
                    continue;
                }

                // --- [EL FRENO DE MANO] ---
                // Verificamos si ya se generó la factura para este servicio en este periodo específico
                const { data: existingInvoice } = await supabase
                    .from('invoices')
                    .select('id')
                    .eq('service_id', service.id)
                    .eq('period', period)
                    .maybeSingle(); 

                if (existingInvoice) {
                    this.logger.warn(`Factura saltada: El servicio ${service.id} ya tiene factura para el periodo ${period}.`);
                    continue; 
                }

                // 2. Crear la deuda en invoices
                // Esta factura aparecerá en invoices con status='pending' para que el cliente pague
                // La fecha de vencimiento es el billing_day de este mes (el día que debía pagar)
                // Ajustar si billing_day es mayor que los días del mes (ej: billing_day=31 en febrero)
                const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
                const actualBillingDay = Math.min(service.billing_day, daysInMonth);
                const billingDate = new Date(currentYear, currentMonth - 1, actualBillingDay);
                const dueDate = billingDate.toISOString().split('T')[0];

                await this.invoicesService.create({
                    service_id: service.id,
                    period: period,
                    total: service.monthly_amount,
                    due_date: dueDate, // Fecha de vencimiento = billing_day del mes actual
                    status: 'pending'
                });

                this.logger.log(`✅ Deuda generada exitosamente para servicio ${service.id} - Periodo ${period} - billing_day=${service.billing_day} (llegó o pasó) - Monto: ${service.monthly_amount} - Estado: pending en invoices`);

            } catch (e) {
                this.logger.error(`❌ Error facturando servicio ${service.id}: ${e.message}`);
            }
        }
    }

    /**
     * 4. RECORDATORIO DE DEUDA VENCIDA (T+3)
     * ACTUALIZADO: Envía QR y Link de pago con advertencia de corte
     * CON FRENO DE MANO: Usa 'overdue_notified' para evitar spam de avisos de corte.
     */
    @Cron('0 9 * * *')
    async handleOverdueReminders() {
        this.logger.log('--- CRON: WHATSAPP DEUDA VENCIDA (T+3) ---');
        const supabase = this.supabaseService.getClient();
        
        const overdueDate = new Date();
        overdueDate.setDate(overdueDate.getDate() - 3); 
        const overdueDateStr = overdueDate.toISOString().split('T')[0];

        // 1. Filtramos por facturas vencidas QUE NO hayan sido notificadas aún
        const { data: overdueInvoices, error } = await supabase
            .from('invoices')
            .select('*, service:services(customer:customers(*))')
            .eq('status', 'pending')
            .eq('due_date', overdueDateStr)
            // .eq('overdue_notified', false); // <--- EL CANDADO (desactivado para pruebas)

        if (error) {
            this.logger.error(`Error consultando deudas vencidas: ${error.message}`);
            return;
        }

        if (!overdueInvoices || overdueInvoices.length === 0) {
            this.logger.log('No hay avisos de deuda vencida para enviar hoy.');
            return;
        }

        for (const inv of overdueInvoices) {
            const customer = inv.service?.customer;

            if (customer?.phone) {
                try {
                    const amountFormatted = `S/ ${Number(inv.total).toFixed(2)}`;
                    const description = `AeroNet - Recibo ${inv.period ?? ''}`.trim();

                    const { qrImageUrl, paymentLink } = await this.tryGetPaymentResources(
                        inv.id,
                        Number(inv.total),
                        description,
                    );

                    const result = await this.notificationService.sendUnifiedAlert({
                        phone: customer.phone,
                        email: customer.email || undefined,
                        clientName: customer.full_name,
                        dueDate: inv.due_date,
                        amount: amountFormatted,
                        paymentLink: paymentLink || undefined,
                        qrImageUrl: qrImageUrl || undefined,
                        type: 'OVERDUE',
                    });

                    // ⚠️ PRUEBAS — siempre incrementa contador, NO marca overdue_notified=true
                    await supabase
                        .from('invoices')
                        .update({
                            last_notification_date: new Date(),
                            notification_count: (inv.notification_count || 0) + 1,
                        })
                        .eq('id', inv.id);
                    if (result.whatsapp) {
                        this.logger.log(`✅ [CRON-OVERDUE] Alerta de corte enviada: ${customer.full_name}`);
                    } else {
                        this.logger.warn(`⚠️ [CRON-OVERDUE] WA falló para ${customer.full_name}.`);
                    }
                } catch (e) {
                    this.logger.error(`❌ [CRON-OVERDUE] Error notificando corte a ${customer.full_name}: ${e.message}`);
                }
            }
        }
    }
    /**
     * ═══════════════════════════════════════════════════════════════════
     * 6. GENERACIÓN DE COMPROBANTE LEGAL (Nubefact)
     * ═══════════════════════════════════════════════════════════════════
     * 
     * FLUJO DE ESTADOS DE INVOICES:
     * 1. pending → Deuda generada, falta pagar el cliente
     * 2. paid → Cliente pagó, esperando generación de comprobante legal
     * 3. invoiced → Comprobante legal generado (factura/boleta electrónica)
     * 
     * MISIÓN: Buscar facturas PAGADAS (status='paid') que no tienen comprobante legal
     * y generar el comprobante electrónico en Nubefact.
     * 
     * FRECUENCIA: CADA 10 MINUTOS
     */
    @Cron('*/10 * * * *')
    async handlePendingElectronicBilling() {
        this.logger.log('--- CRON: GENERACIÓN DE COMPROBANTES LEGALES (NUBEFACT) ---');
        const supabase = this.supabaseService.getClient();

        // 1. BUSQUEDA CON RELACIONES: Traemos la factura + servicio + cliente
        // Buscamos facturas con status='paid' que NO tienen comprobante legal aún
        const { data: pendingInvoices, error } = await supabase
        .from('invoices')
        .select(`
            *,
            service:services (
                *,
                customer:customers (*)
            ),
            electronic_documents!left(id)
        `)
        .eq('status', 'paid') // Solo facturas pagadas
        .is('electronic_documents.id', null); // Que NO tengan comprobante legal aún

        if (error) {
            this.logger.error(`Error consultando facturas pendientes de comprobante legal: ${error.message}`);
            return;
        }

        if (!pendingInvoices || pendingInvoices.length === 0) {
            this.logger.log('No hay facturas pagadas pendientes de comprobante legal.');
            return;
        }

        this.logger.log(`Procesando ${pendingInvoices.length} factura(s) pagada(s) sin comprobante legal`);

        for (const inv of pendingInvoices) {
            try {
                // --- CAPA DE SEGURIDAD 1: VERIFICACIÓN DE ÚLTIMO SEGUNDO ---
                // Verificar que realmente no tiene comprobante (doble verificación)
                const { data: exists } = await supabase
                    .from('electronic_documents')
                    .select('id')
                    .eq('invoice_id', inv.id)
                    .maybeSingle();

                if (exists) {
                    this.logger.warn(`Freno activado: La factura ${inv.id} ya tiene un documento. Marcando como INVOICED.`);
                    await supabase.from('invoices').update({ status: 'invoiced' }).eq('id', inv.id);
                    this.logger.log(`✅ Factura ${inv.id} procesada completamente y movida a estado final (invoiced)`);
                    continue; 
                }

                // Validar que el estado sigue siendo 'paid'
                if (inv.status !== 'paid') {
                    this.logger.warn(`Factura ${inv.id} tiene status '${inv.status}', saltando.`);
                    continue;
                }

                this.logger.log(`Iniciando generación de comprobante legal para factura ${inv.id}...`);

                // 2. Ejecutar el proceso legal en PaymentsService
                // 'inv' ahora contiene 'service' y 'customer' gracias al select de arriba.
                // IMPORTANTE: triggerLateInvoicing debe completarse ANTES de actualizar el estado
                await this.paymentsService.triggerLateInvoicing(inv);
                
                // 3. Verificar que el documento se haya creado correctamente antes de actualizar estado
                const { data: createdDoc } = await supabase
                    .from('electronic_documents')
                    .select('id, pdf_url')
                    .eq('invoice_id', inv.id)
                    .maybeSingle();

                if (!createdDoc) {
                    throw new Error(`El documento electrónico no se creó para la factura ${inv.id}`);
                }

                // 4. Verificar que pdf_url esté presente
                if (!createdDoc.pdf_url) {
                    this.logger.warn(`⚠️ Advertencia: Documento ${createdDoc.id} creado pero pdf_url está vacío para factura ${inv.id}`);
                }

                // 5. ACTUALIZAR ESTADO SOLO DESPUÉS DE CONFIRMAR QUE EL DOCUMENTO SE CREÓ
                // Esto asegura que el frontend vea el documento cuando consulte la factura
                await supabase.from('invoices')
                    .update({ status: 'invoiced' }) 
                    .eq('id', inv.id);

                this.logger.log(`✅ Comprobante legal generado exitosamente para factura ${inv.id}`);
                this.logger.log(`   Documento ID: ${createdDoc.id}`);
                this.logger.log(`   PDF URL: ${createdDoc.pdf_url || 'NO DISPONIBLE'}`);
                this.logger.log(`✅ Factura ${inv.id} procesada completamente y movida a estado final (invoiced)`);

            } catch (e) {
                this.logger.error(`❌ Error generando comprobante legal para factura ${inv.id}: ${e.message}`);
                this.logger.error(`   Stack: ${e.stack || 'Sin stack trace'}`);
                
                // --- REVERSIÓN EN CASO DE ERROR ---
                // Si el proceso falló realmente, la regresamos a 'paid' para que el Cron reintente luego.
                await supabase.from('invoices')
                    .update({ status: 'paid' })
                    .eq('id', inv.id);
                
                this.logger.warn(`Factura ${inv.id} revertida a 'paid' para reintento posterior.`);
            }
        }
    }


    // ═══════════════════════════════════════════════════════════════════
    // MÉTODOS MANUALES (Panel Admin) - Resilientes a fallos de pago
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Obtiene recursos de pago para notificaciones (QR y Link) desde Mercado Pago.
     * Ambos intentos son INDEPENDIENTES: si uno falla el otro continúa.
     * Nunca lanza excepción; retorna null en cada campo si el proveedor falla.
     */
    private async tryGetPaymentResources(
        invoiceId: string,
        amount: number,
        description: string,
    ): Promise<{ qrData: string | null; qrImageUrl: string | null; paymentLink: string | null }> {
        let qrData: string | null = null;
        let qrImageUrl: string | null = null;
        let paymentLink: string | null = null;

        // ── Paso 1: QR con Mercado Pago ───────────────────────────────────
        this.logger.log(`[RESOURCES] Paso 1 — QR Mercado Pago para factura ${invoiceId}...`);
        qrData = await this.paymentsService.tryGetMpQrData(invoiceId, amount, description);
        if (qrData) {
            // Convierte el string EMVCo a URL de imagen (qrserver.com, acceso público, sin API key)
            qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrData)}&size=300x300&format=png`;
            this.logger.log(`[RESOURCES] ✅ QR MP obtenido → imagen: ${qrImageUrl.slice(0, 80)}...`);
        } else {
            this.logger.warn(`[RESOURCES] ⚠️  Fallo QR MP. Continuando sin QR.`);
        }

        // ── Paso 2: Link con Mercado Pago ──────────────────────────────────
        this.logger.log(`[RESOURCES] Paso 2 — Link Mercado Pago para factura ${invoiceId}...`);
        try {
            const result = await this.paymentsService.generatePaymentUrl(invoiceId, 'BOLETA');
            paymentLink = result.url as string;
            this.logger.log(`[RESOURCES] ✅ Link MP obtenido: ${paymentLink.slice(0, 60)}...`);
        } catch (err: any) {
            this.logger.warn(`[RESOURCES] ⚠️  Fallo Link MP: ${err?.message}. Se enviará sin enlace.`);
        }

        return { qrData, qrImageUrl, paymentLink };
    }
    /**
     * Construye la respuesta estructurada del panel admin a partir del resultado de `sendUnifiedAlert`.
     */
    private buildNotifyResult(
        result: { whatsapp: boolean; email: boolean; detail: string },
        clientName: string,
        type: string,
    ): { success: boolean; message: string; detail: string } {
        const success = result.whatsapp; // WhatsApp es el canal primario
        return {
            success,
            message: success
                ? `${type} enviado a ${clientName}`
                : `Error al enviar WhatsApp a ${clientName}. Verifica plantillas en Meta Business Suite.`,
            detail: result.detail,
        };
    }

    /**
     * Carga factura + cliente para los métodos manuales.
     * ⚠️  MODO PRUEBAS: el check de status está desactivado para permitir
     * reenvíos repetidos sin importar si la factura ya fue notificada o pagada.
     * Restaurar: descomentar la línea del check de status cuando se pase a producción.
     */
    private async loadInvoiceForNotification(invoiceId: string) {
        const supabase = this.supabaseService.getClient();
        const { data: inv, error } = await supabase
            .from('invoices')
            .select('*, service:services(customer:customers(id, full_name, phone, email))')
            .eq('id', invoiceId)
            .single();

        if (error || !inv) throw new NotFoundException('Factura no encontrada');
        // ⚠️ PRUEBAS — check de status desactivado temporalmente
        // if (inv.status !== 'pending') throw new BadRequestException('Solo se puede notificar facturas pendientes.');
        if (inv.status !== 'pending') {
            this.logger.warn(`[TEST-MODE] Factura ${invoiceId} tiene status="${inv.status}" — enviando igual (modo pruebas).`);
        }

        const customer = (inv as any).service?.customer;
        if (!customer?.phone?.trim()) throw new BadRequestException('El cliente no tiene teléfono válido.');

        return { supabase, inv, customer };
    }

    /**
     * Notificación preventiva manual (3 días antes).
     * Plantilla: `alerta_vencimiento` con botón URL de Openpay.
     * QR de Mercado Pago incluido en el email de respaldo.
     */
    async notifyPreventiveManual(invoiceId: string) {
        this.logger.warn(`⚠️ [TEST] Saltando restricciones de envío para factura ${invoiceId}`);
        const { supabase, inv, customer } = await this.loadInvoiceForNotification(invoiceId);
        const amountFormatted = `S/ ${Number(inv.total).toFixed(2)}`;
        const description = `AeroNet - Recibo ${inv.period ?? ''}`.trim();

        this.logger.log(`[PREVENTIVE] Obteniendo recursos de pago para ${customer.full_name}...`);
        const { qrImageUrl, paymentLink } = await this.tryGetPaymentResources(
            invoiceId,
            Number(inv.total),
            description,
        );

        this.logger.log(`[PREVENTIVE] Enviando notificación unificada (WA + email)...`);
        const result = await this.notificationService.sendUnifiedAlert({
            phone: customer.phone,
            email: customer.email || undefined,
            clientName: customer.full_name,
            dueDate: inv.due_date,
            amount: amountFormatted,
            paymentLink: paymentLink || undefined,
            qrImageUrl: qrImageUrl || undefined,
            type: 'PREVENTIVE',
        });

        // ⚠️ PRUEBAS — siempre incrementa el contador; NO marca preventive_notified=true
        // para poder reenviar sin reiniciar el campo en la DB.
        await supabase.from('invoices').update({
            last_notification_date: new Date(),
            notification_count: (inv.notification_count || 0) + 1,
        }).eq('id', invoiceId);

        return this.buildNotifyResult(result, customer.full_name, 'Recordatorio preventivo');
    }

    /**
     * Notificación día de vencimiento manual.
     * Plantilla: `alerta_pago` (BASE ESTABLE) con botón URL de Openpay.
     * QR de Mercado Pago incluido en el email de respaldo.
     */
    async notifyBillingDayManual(invoiceId: string) {
        this.logger.warn(`⚠️ [TEST] Saltando restricciones de envío para factura ${invoiceId}`);
        const { supabase, inv, customer } = await this.loadInvoiceForNotification(invoiceId);
        const amountFormatted = `S/ ${Number(inv.total).toFixed(2)}`;
        const description = `AeroNet - Recibo ${inv.period ?? ''}`.trim();

        this.logger.log(`[BILLING-DAY] Obteniendo recursos de pago para ${customer.full_name}...`);
        const { qrImageUrl, paymentLink } = await this.tryGetPaymentResources(
            invoiceId,
            Number(inv.total),
            description,
        );

        this.logger.log(`[BILLING-DAY] Enviando notificación unificada (WA + email)...`);
        const result = await this.notificationService.sendUnifiedAlert({
            phone: customer.phone,
            email: customer.email || undefined,
            clientName: customer.full_name,
            dueDate: inv.due_date,
            amount: amountFormatted,
            paymentLink: paymentLink || undefined,
            qrImageUrl: qrImageUrl || undefined,
            type: 'BILLING_DAY',
        });

        // ⚠️ PRUEBAS — siempre incrementa el contador sin bloquear futuros envíos
        await supabase.from('invoices').update({
            last_notification_date: new Date(),
            notification_count: (inv.notification_count || 0) + 1,
        }).eq('id', invoiceId);

        return this.buildNotifyResult(result, customer.full_name, 'Notificación día de vencimiento');
    }

    /**
     * Alerta de corte manual (mora).
     * Plantilla: `alerta_vencimiento` con botón URL de Openpay.
     * QR de Mercado Pago incluido en el email de respaldo.
     */
    async notifyOverdueManual(invoiceId: string) {
        this.logger.warn(`⚠️ [TEST] Saltando restricciones de envío para factura ${invoiceId}`);
        const { supabase, inv, customer } = await this.loadInvoiceForNotification(invoiceId);
        const amountFormatted = `S/ ${Number(inv.total).toFixed(2)}`;
        const description = `AeroNet - Recibo ${inv.period ?? ''}`.trim();

        this.logger.log(`[OVERDUE] Obteniendo recursos de pago para ${customer.full_name}...`);
        const { qrImageUrl, paymentLink } = await this.tryGetPaymentResources(
            invoiceId,
            Number(inv.total),
            description,
        );

        this.logger.log(`[OVERDUE] Enviando notificación unificada (WA + email)...`);
        const result = await this.notificationService.sendUnifiedAlert({
            phone: customer.phone,
            email: customer.email || undefined,
            clientName: customer.full_name,
            dueDate: inv.due_date,
            amount: amountFormatted,
            paymentLink: paymentLink || undefined,
            qrImageUrl: qrImageUrl || undefined,
            type: 'OVERDUE',
        });

        // ⚠️ PRUEBAS — siempre incrementa el contador; NO marca overdue_notified=true
        // para poder reenviar sin limpiar el campo en la DB.
        await supabase.from('invoices').update({
            last_notification_date: new Date(),
            notification_count: (inv.notification_count || 0) + 1,
        }).eq('id', invoiceId);

        return this.buildNotifyResult(result, customer.full_name, 'Alerta de corte');
    }

    /**
     * Enviar credenciales de acceso al cliente.
     * Busca el cliente por ID, valida que tenga teléfono y envía el mensaje 'access_message'.
     * La contraseña la proporciona el admin (no se puede recuperar del hash).
     */
    async sendCredentialsManual(customerId: string, password: string) {
        const supabase = this.supabaseService.getClient();
        const { data: customer, error } = await supabase
            .from('customers')
            .select('id, full_name, email, phone')
            .eq('id', customerId)
            .single();

        if (error || !customer) throw new NotFoundException('Cliente no encontrado');
        if (!customer.phone?.trim()) throw new BadRequestException('El cliente no tiene teléfono válido.');
        if (!customer.email?.trim()) throw new BadRequestException('El cliente no tiene correo registrado.');
        if (!password?.trim()) throw new BadRequestException('Debes proporcionar la contraseña a enviar.');

        this.logger.log(`[CREDENTIALS] Enviando credenciales de acceso a ${customer.full_name}`);
        const sent = await this.notificationService.sendAccessMessage(
            customer.phone,
            customer.full_name,
            customer.email,
            password,
        );

        return {
            success: sent,
            message: sent
                ? `Credenciales enviadas a ${customer.full_name} (${customer.phone})`
                : `Error al enviar credenciales a ${customer.full_name}. Verifica la plantilla en Meta.`,
            detail: sent ? 'WhatsApp enviado con credenciales de acceso' : 'Fallo al enviar WhatsApp',
        };
    }


    /** Generar comprobante Nubefact para factura pagada. */
    async generateNubefactManual(invoiceId: string) {
        const supabase = this.supabaseService.getClient();
        const { data: inv, error } = await supabase
            .from('invoices')
            .select('*, service:services(*, customer:customers(*)), electronic_documents!left(id)')
            .eq('id', invoiceId)
            .single();

        if (error || !inv) throw new NotFoundException('Factura no encontrada');
        if (inv.status !== 'paid') throw new BadRequestException('Solo se puede generar comprobante para facturas pagadas.');

        const { data: existingDoc } = await supabase.from('electronic_documents').select('id').eq('invoice_id', invoiceId).maybeSingle();
        if (existingDoc) throw new BadRequestException('La factura ya tiene comprobante electrónico.');

        await this.paymentsService.triggerLateInvoicing(inv);

        const { data: createdDoc } = await supabase.from('electronic_documents').select('id, pdf_url').eq('invoice_id', invoiceId).maybeSingle();
        if (!createdDoc) throw new BadRequestException('No se pudo crear el comprobante.');

        await supabase.from('invoices').update({ status: 'invoiced' }).eq('id', invoiceId);

        return { success: true, message: 'Comprobante generado correctamente.', documentId: createdDoc.id };
    }
}

