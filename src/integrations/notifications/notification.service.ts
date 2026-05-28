import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { SupabaseService } from '../../supabase.service';
import { WhatsappBaileysService } from './whatsapp-baileys.service';

/** Resultado estructurado de un envío manual (WhatsApp + email). */
export interface NotifySendResult {
    whatsapp: boolean;
    email: boolean;
    /** Detalle legible para el toast del admin. */
    detail: string;
}

@Injectable()
export class NotificationService {
    private readonly logger = new Logger('NOTIFICATION_SERVICE');

    /** URL de imagen usada como fallback cuando no hay QR. */
    private readonly fallbackImage =
        process.env.FALLBACK_QR_IMAGE_URL || 'https://aeronet.com.pe/logo.png';

    constructor(
        private readonly supabaseService: SupabaseService,
        private readonly whatsappBaileysService: WhatsappBaileysService
    ) {}

    // ═══════════════════════════════════════════════════════════════════
    // MÉTODOS PÚBLICOS DE NOTIFICACIÓN
    // ═══════════════════════════════════════════════════════════════════

    /**
     * RECORDATORIO BÁSICO
     */
    async sendReminder(to: string, clientName: string, fecha: string): Promise<boolean> {
        this.logger.log(`[REMINDER] Enviando recordatorio básico a ${clientName}`);
        const text = `Hola ${clientName}, te recordamos que tu fecha de pago es el ${fecha}.`;
        return this.whatsappBaileysService.sendTextMessage(to, text);
    }

    /**
     * MENSAJE DE BIENVENIDA / ACCESO
     */
    async sendAccessMessage(
        to: string,
        clientName: string,
        email: string,
        password: string,
    ): Promise<boolean> {
        this.logger.log(`[ACCESS] Enviando credenciales a ${clientName}`);
        const text = `Hola ${clientName}, tus credenciales de acceso son:\nCorreo: ${email}\nContraseña: ${password}`;
        
        // Intentar enviar correo (como respaldo primordial)
        if (email?.trim()) {
            const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9f9f9;border-radius:12px;overflow:hidden;">
            <div style="background:#0077B6;padding:24px 32px;">
                <h1 style="color:#fff;margin:0;font-size:22px;">AeroNet</h1>
                <p style="color:rgba(255,255,255,.85);margin:4px 0 0;font-size:14px;">Bienvenido a tu cuenta</p>
            </div>
            <div style="padding:28px 32px;background:#fff;">
                <p style="font-size:16px;">Hola <strong>${clientName}</strong>,</p>
                <p style="color:#555;">Tus credenciales de acceso a nuestro portal son las siguientes:</p>
                <p><strong>Correo:</strong> ${email}<br/><strong>Contraseña:</strong> ${password}</p>
            </div>
            <div style="padding:16px 32px;background:#f4f4f4;text-align:center;">
                <p style="font-size:11px;color:#aaa;margin:0;">Mensaje automático de AeroNet. No responder.</p>
            </div>
            </div>`;
            await this.sendEmail(email, 'Credenciales de acceso a AeroNet', html);
        }

        return this.whatsappBaileysService.sendTextMessage(to, text);
    }

    /**
     * ENVIAR COMPROBANTE LEGAL (Nubefact) — WhatsApp + Email
     */
    async sendInvoicePdf(
        invoiceId: string,
        to: string,
        clientName: string,
        monto: string = '0.00',
        email?: string,
    ): Promise<{ whatsapp: boolean; email: boolean }> {
        const supabase = this.supabaseService.getClient();

        // ── Obtener pdf_url de electronic_documents (Nubefact) ──
        let pdfUrl: string | null = null;
        const maxRetries = 3;
        const retryDelayMs = 2000;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const { data: doc, error } = await supabase
                .from('electronic_documents')
                .select('pdf_url')
                .eq('invoice_id', invoiceId)
                .maybeSingle();

            if (error) {
                this.logger.warn(`[PDF-COMPROBANTE] Error consultando electronic_documents: ${error.message}`);
                if (attempt < maxRetries) await new Promise((r) => setTimeout(r, retryDelayMs));
                continue;
            }

            pdfUrl = doc?.pdf_url?.trim() || null;
            if (pdfUrl) break;

            if (attempt < maxRetries) await new Promise((r) => setTimeout(r, retryDelayMs));
        }

        if (!pdfUrl) {
            this.logger.warn(`[PDF-COMPROBANTE] No se envió comprobante: no existe pdf_url en electronic_documents para invoice ${invoiceId}.`);
            return { whatsapp: false, email: false };
        }

        // ── 1. WHATSAPP ────────────────────────────────────────────────────
        const text = `Hola ${clientName}, aquí tienes tu comprobante electrónico por S/ ${monto}.\nDescárgalo aquí: ${pdfUrl}`;
        const whatsapp = await this.whatsappBaileysService.sendTextMessage(to, text);

        // ── 2. EMAIL (vista previa + descarga) ───────────────────────────────
        let emailSent = false;
        if (email?.trim()) {
            const subject = `📄 Tu comprobante AeroNet — ${clientName}`;
            const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9f9f9;border-radius:12px;overflow:hidden;">
                <div style="background:#0077B6;padding:24px 32px;">
                    <h1 style="color:#fff;margin:0;font-size:22px;">AeroNet</h1>
                    <p style="color:rgba(255,255,255,.85);margin:4px 0 0;font-size:14px;">Comprobante electrónico</p>
                </div>
                <div style="padding:28px 32px;background:#fff;">
                    <p style="font-size:16px;">Hola <strong>${clientName}</strong>,</p>
                    <p style="color:#555;">Tu comprobante electrónico ya está disponible. Monto: <strong>S/ ${monto}</strong>.</p>
                    <div style="text-align:center;margin:24px 0;">
                        <a href="${pdfUrl}" target="_blank" style="background:#0077B6;color:#fff;padding:12px 28px;border-radius:24px;text-decoration:none;font-weight:bold;font-size:15px;margin:4px;">
                            Ver comprobante PDF
                        </a>
                        <a href="${pdfUrl}" target="_blank" download style="background:#fff;color:#0077B6;border:2px solid #0077B6;padding:12px 28px;border-radius:24px;text-decoration:none;font-weight:bold;font-size:15px;margin:4px;display:inline-block;">
                            Descargar PDF
                        </a>
                        <p style="font-size:12px;color:#888;margin-top:12px;">
                            Enlace directo: <a href="${pdfUrl}" style="color:#0077B6;">${pdfUrl}</a>
                        </p>
                    </div>
                </div>
                <div style="padding:16px 32px;background:#f4f4f4;text-align:center;">
                    <p style="font-size:11px;color:#aaa;margin:0;">Mensaje automático de AeroNet. No responder.</p>
                </div>
            </div>`;

            this.logger.log(`[PDF-EMAIL] Enviando comprobante por email a ${email}...`);
            emailSent = await this.sendEmail(email, subject, html);
        }

        return { whatsapp, email: emailSent };
    }

    /**
     * ALERTA DE VENCIMIENTO — T-3 (preventivo) y T+3 (corte)
     */
    async sendAlertVencimiento(
        to: string,
        clientName: string,
        dueDate: string,
        amount: string,
        paymentLink?: string,
    ): Promise<boolean> {
        const linkText = paymentLink ? `\nPuedes pagar aquí: ${paymentLink}` : '';
        const text = `Hola ${clientName},\nTe recordamos que el ${dueDate} vence tu recibo por S/ ${amount}.${linkText}`;
        return this.whatsappBaileysService.sendTextMessage(to, text);
    }

    /**
     * ALERTA DE PAGO — DÍA DE VENCIMIENTO (BILLING DAY)
     */
    async sendPaymentDayAlertWithQr(
        to: string,
        clientName: string,
        dueDate: string,
        amount: string,
        _qrImageUrl: string,
        paymentLink?: string,
    ): Promise<boolean> {
        const linkText = paymentLink ? `\nPuedes pagar aquí: ${paymentLink}` : '';
        const text = `¡Hola ${clientName}!\nHoy ${dueDate} vence tu recibo por S/ ${amount}.${linkText}`;
        if (_qrImageUrl) {
            return this.whatsappBaileysService.sendMediaMessage(to, _qrImageUrl, text);
        }
        return this.whatsappBaileysService.sendTextMessage(to, text);
    }

    /**
     * RECORDATORIO PREVENTIVO CON QR (T-3 días)
     */
    async sendReminderThreeDaysWithQr(
        to: string,
        clientName: string,
        dueDate: string,
        amount: string,
        qrImageUrl: string,
    ): Promise<boolean> {
        const text = `Hola ${clientName}, faltan 3 días para el vencimiento de tu recibo el ${dueDate} por S/ ${amount}.`;
        return this.whatsappBaileysService.sendMediaMessage(to, qrImageUrl || this.fallbackImage, text);
    }

    /**
     * ALERTA VENCIDO CON QR (T+3 días)
     */
    async sendOverdueAlertWithQr(
        to: string,
        clientName: string,
        dueDate: string,
        amount: string,
        qrImageUrl: string,
    ): Promise<boolean> {
        const text = `URGENTE ${clientName}: Tu servicio tiene un recibo vencido del ${dueDate} por S/ ${amount}. Evita el corte del servicio.`;
        return this.whatsappBaileysService.sendMediaMessage(to, qrImageUrl || this.fallbackImage, text);
    }

    /**
     * NOTIFICACIÓN DE COBRO AUTOMATIZADA CON LOGS
     */
    async sendPaymentReminder(
        phone: string,
        customerName: string,
        customerId: string,
        invoiceId: string,
        amount: string,
        dueDate: string,
        qrUrl?: string,
        paymentLink?: string,
        messageType: 'PREVENTIVO' | 'BILLING_DAY' | 'MOROSO' = 'PREVENTIVO',
    ): Promise<boolean> {
        const supabase = this.supabaseService.getClient();
        this.logger.log(`[PAYMENT-REMINDER] tipo=${messageType} cliente=${customerName} factura=${invoiceId}`);

        let text = '';
        if (messageType === 'BILLING_DAY') text = `Hola ${customerName}, hoy vence tu recibo por S/ ${amount}.`;
        else if (messageType === 'MOROSO') text = `URGENTE ${customerName}: Recibo vencido del ${dueDate} por S/ ${amount}.`;
        else text = `Hola ${customerName}, recordatorio preventivo: el ${dueDate} vence tu recibo por S/ ${amount}.`;

        if (paymentLink) text += `\nPaga aquí: ${paymentLink}`;

        let sent = false;
        try {
            if (qrUrl) {
                sent = await this.whatsappBaileysService.sendMediaMessage(phone, qrUrl, text);
            } else {
                sent = await this.whatsappBaileysService.sendTextMessage(phone, text);
            }

            await supabase.from('whatsapp_logs').insert([{
                customer_id: customerId,
                invoice_id: invoiceId,
                message_type: messageType,
                phone_number: phone,
                status: sent ? 'sent' : 'failed',
                error_message: sent ? null : 'Error simulado',
            }]);
        } catch (e) {
            this.logger.error(`[PAYMENT-REMINDER-ERROR] ${e.message}`);
        }

        return sent;
    }

    /**
     * NOTIFICACIÓN MANUAL DESDE ADMIN
     */
    async sendManualPaymentNotification(
        phone: string,
        customerName: string,
        customerId: string,
        invoiceId: string,
        amount: string,
        qrUrl?: string,
        paymentLink?: string,
    ): Promise<boolean> {
        const supabase = this.supabaseService.getClient();
        let text = `Hola ${customerName}, recordatorio manual de pago por S/ ${amount}.`;
        if (paymentLink) text += `\nPaga aquí: ${paymentLink}`;

        let sent = false;
        try {
            if (qrUrl) {
                sent = await this.whatsappBaileysService.sendMediaMessage(phone, qrUrl, text);
            } else {
                sent = await this.whatsappBaileysService.sendTextMessage(phone, text);
            }

            await supabase.from('whatsapp_logs').insert([{
                customer_id: customerId,
                invoice_id: invoiceId,
                message_type: 'MANUAL',
                phone_number: phone,
                status: sent ? 'sent' : 'failed',
            }]);
        } catch (e) {
            this.logger.error(`[MANUAL-ERROR] ${e.message}`);
        }

        return sent;
    }

    // ═══════════════════════════════════════════════════════════════════
    // EMAIL (SMTP) Y UNIFIED
    // ═══════════════════════════════════════════════════════════════════

    /**
     * ENVÍO UNIFICADO DE ALERTA DE COBRO — WhatsApp + Email simultáneos
     */
    async sendUnifiedAlert(params: {
        phone: string;
        email?: string;
        clientName: string;
        dueDate: string;
        amount: string;
        paymentLink?: string;
        qrImageUrl?: string;
        type: 'PREVENTIVE' | 'BILLING_DAY' | 'OVERDUE';
    }): Promise<NotifySendResult> {
        const { phone, email, clientName, dueDate, amount, paymentLink, qrImageUrl, type } = params;
        const linkPrincipal = paymentLink?.trim() || 'https://aeronet.com.pe';

        // ── 1. WHATSAPP ────────────────────────────────────────────────────────
        let text = `Hola ${clientName}, `;
        if (type === 'BILLING_DAY') text += `hoy vence tu recibo por S/ ${amount}.`;
        else if (type === 'OVERDUE') text += `tienes un recibo vencido del ${dueDate} por S/ ${amount}.`;
        else text += `te recordamos que el ${dueDate} vence tu recibo por S/ ${amount}.`;

        text += `\nPuedes pagar aquí: ${linkPrincipal}`;

        let whatsapp = false;
        if (qrImageUrl) {
            whatsapp = await this.whatsappBaileysService.sendMediaMessage(phone, qrImageUrl, text);
        } else {
            whatsapp = await this.whatsappBaileysService.sendTextMessage(phone, text);
        }

        // ── 2. EMAIL BACKUP (simultáneo) ─────────────────────────
        let emailSent = false;
        if (email?.trim()) {
            this.logger.log(`[UNIFIED] Enviando email a ${email}...`);
            const subject = this.buildEmailSubject(type, dueDate);
            const html = this.buildEmailBody(clientName, dueDate, amount, linkPrincipal, qrImageUrl, type);
            emailSent = await this.sendEmail(email, subject, html);
        }

        // ── 3. RESULTADO ────────────────────────────────────────────────────────
        const detail = this.buildUnifiedDetail(whatsapp, emailSent, !!paymentLink, !!qrImageUrl);
        return { whatsapp, email: emailSent, detail };
    }

    /** Construye el asunto del email según el tipo de alerta. */
    private buildEmailSubject(type: string, dueDate: string): string {
        const dateShort = dueDate?.slice(0, 10) ?? '';
        if (type === 'BILLING_DAY') return `⚠️ Tu recibo AeroNet vence HOY — ${dateShort}`;
        if (type === 'OVERDUE') return `🔴 Servicio en riesgo de corte — AeroNet`;
        return `📅 Recordatorio de pago AeroNet — ${dateShort}`;
    }

    /** Construye el cuerpo HTML del email con QR (si disponible) y link. */
    private buildEmailBody(
        clientName: string,
        dueDate: string,
        amount: string,
        paymentLink?: string,
        qrImageUrl?: string,
        type?: string,
    ): string {
        const colorMap: Record<string, string> = {
            PREVENTIVE: '#0077B6',
            BILLING_DAY: '#F4A261',
            OVERDUE: '#E63946',
        };
        const accent = colorMap[type ?? 'PREVENTIVE'] ?? '#0077B6';

        const qrSection = qrImageUrl
            ? `<div style="text-align:center;margin:20px 0;">
                <p style="color:#555;font-size:14px;">Escanea el QR con tu app Mercado Pago:</p>
                <img src="${qrImageUrl}" alt="QR Pago" style="width:200px;height:200px;border:1px solid #ddd;border-radius:8px;" />
               </div>`
            : '';

        const linkSection = paymentLink
            ? `<div style="text-align:center;margin:24px 0;">
                <a href="${paymentLink}" style="background:${accent};color:#fff;padding:12px 28px;border-radius:24px;text-decoration:none;font-weight:bold;font-size:15px;">
                  Pagar ahora
                </a>
                <p style="font-size:12px;color:#888;margin-top:8px;">
                  O copia este link: <a href="${paymentLink}" style="color:${accent};">${paymentLink}</a>
                </p>
               </div>`
            : `<p style="color:#888;font-size:13px;text-align:center;">Contacta a AeroNet para obtener tu link de pago.</p>`;

        return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9f9f9;border-radius:12px;overflow:hidden;">
            <div style="background:${accent};padding:24px 32px;">
                <h1 style="color:#fff;margin:0;font-size:22px;">AeroNet</h1>
                <p style="color:rgba(255,255,255,.85);margin:4px 0 0;font-size:14px;">Notificación de pago</p>
            </div>
            <div style="padding:28px 32px;background:#fff;">
                <p style="font-size:16px;">Hola <strong>${clientName}</strong>,</p>
                <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                    <tr><td style="padding:8px;color:#555;">Monto pendiente</td><td style="padding:8px;font-weight:bold;color:${accent};">${amount}</td></tr>
                    <tr style="background:#f4f4f4;"><td style="padding:8px;color:#555;">Fecha de vencimiento</td><td style="padding:8px;">${dueDate}</td></tr>
                </table>
                ${qrSection}
                ${linkSection}
            </div>
            <div style="padding:16px 32px;background:#f4f4f4;text-align:center;">
                <p style="font-size:11px;color:#aaa;margin:0;">Este mensaje fue enviado automáticamente por AeroNet. No responder.</p>
            </div>
        </div>`;
    }

    /** Genera el `detail` legible para el toast del admin. */
    private buildUnifiedDetail(
        whatsapp: boolean,
        emailSent: boolean,
        hasLink: boolean,
        hasQr: boolean,
    ): string {
        const wa = whatsapp
            ? `WhatsApp ✅${hasLink ? ' (con link)' : ''}`
            : 'WhatsApp ❌';
        const em = emailSent
            ? `Email ✅${hasQr ? ' (con QR)' : ''}`
            : 'Email ❌';
        return `${wa} | ${em}`;
    }

    /**
     * ENVÍO GENÉRICO DE CORREO (SMTP)
     */
    async sendEmail(to: string, subject: string, body: string): Promise<boolean> {
        if (!to?.trim()) {
            this.logger.warn('[EMAIL] Destinatario vacío, omitiendo envío.');
            return false;
        }

        const host = process.env.EMAIL_HOST;
        const user = process.env.EMAIL_USER;
        const pass = process.env.EMAIL_PASS;
        const port = Number(process.env.EMAIL_PORT ?? 465);

        if (!host || !user || !pass) {
            this.logger.warn(
                '[EMAIL] Configuración SMTP incompleta (faltan EMAIL_HOST, EMAIL_USER o EMAIL_PASS en .env). Omitiendo envío.',
            );
            return false;
        }

        this.logger.log(`[EMAIL] Enviando a ${to}: "${subject}"`);

        const isHtml = body.trim().startsWith('<');
        const htmlContent = isHtml
            ? body
            : `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
                <h2 style="color:#0077B6;">AeroNet</h2>
                <p>${body.replace(/\n/g, '<br/>')}</p>
                <hr/>
                <p style="font-size:12px;color:#888;">
                    Mensaje automático de AeroNet. No responder.
                </p>
               </div>`;
        const textContent = isHtml ? body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : body;

        try {
            const secure = port === 465;
            const transporter = nodemailer.createTransport({
                host,
                port,
                secure,
                auth: { user, pass },
                tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
            });

            await transporter.sendMail({
                from: `"AeroNet Notificaciones" <${user}>`,
                to,
                subject,
                text: textContent,
                html: htmlContent,
            });

            this.logger.log(`✅ [EMAIL] Correo enviado a ${to}`);
            return true;
        } catch (error) {
            this.logger.error(`[EMAIL-ERROR] to=${to}: ${error.message}`);
            return false;
        }
    }

    /**
     * ENVIAR COMPROBANTE NUBEFACT POR CORREO
     */
    async sendInvoiceByEmail(
        to: string,
        clientName: string,
        pdfUrl: string,
        amount: string,
        period: string,
    ): Promise<boolean> {
        if (!to?.trim()) {
            this.logger.warn(`[EMAIL-INVOICE] Sin correo para ${clientName}, omitiendo.`);
            return false;
        }
        this.logger.log(`[EMAIL-INVOICE] Enviando comprobante a ${clientName} → ${to}`);

        const subject = `Tu comprobante AeroNet · Periodo ${period}`;
        const body = `Hola ${clientName},

Tu comprobante electrónico del periodo ${period} por S/ ${amount} está disponible.

Descárgalo aquí: ${pdfUrl}

Si tienes alguna duda, contáctanos.

— Equipo AeroNet`;

        return this.sendEmail(to, subject, body);
    }
}
