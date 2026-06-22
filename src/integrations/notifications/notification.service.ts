import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { SupabaseService } from '../../supabase.service';

/** Resultado estructurado de un envío manual (solo email ahora). */
export interface NotifySendResult {
    whatsapp: boolean;
    email: boolean;
    detail: string;
}

@Injectable()
export class NotificationService {
    private readonly logger = new Logger('NOTIFICATION_SERVICE');

    constructor(private readonly supabaseService: SupabaseService) {}

    // ═══════════════════════════════════════════════════════════════════
    // MÉTODOS PÚBLICOS DE NOTIFICACIÓN (SOLO EMAIL)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * RECORDATORIO BÁSICO (Omitido localmente)
     */
    async sendReminder(to: string, clientName: string, fecha: string): Promise<boolean> {
        this.logger.log(`[REMINDER] Recordatorio local simulado para ${clientName}`);
        return true;
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
        this.logger.log(`[ACCESS] Enviando credenciales a ${clientName} por email`);
        
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
            return await this.sendEmail(email, 'Credenciales de acceso a AeroNet', html);
        }
        return false;
    }

    /**
     * ENVIAR COMPROBANTE LEGAL (Nubefact) — Email
     */
    async sendInvoicePdf(
        invoiceId: string,
        to: string,
        clientName: string,
        monto: string = '0.00',
        email?: string,
    ): Promise<{ whatsapp: boolean; email: boolean }> {
        const supabase = this.supabaseService.getClient();

        // Obtener pdf_url de electronic_documents (Nubefact)
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

        return { whatsapp: false, email: emailSent };
    }

    /**
     * ENVÍO UNIFICADO DE ALERTA DE COBRO — Email
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
        const { email, clientName, dueDate, amount, paymentLink, qrImageUrl, type } = params;
        const linkPrincipal = paymentLink?.trim() || 'https://aeronet.com.pe';

        let emailSent = false;
        if (email?.trim()) {
            this.logger.log(`[UNIFIED] Enviando email de alerta a ${email}...`);
            const subject = this.buildEmailSubject(type, dueDate);
            const html = this.buildEmailBody(clientName, dueDate, amount, linkPrincipal, qrImageUrl, type);
            emailSent = await this.sendEmail(email, subject, html);
        }

        return { whatsapp: false, email: emailSent, detail: emailSent ? 'Email ✅' : 'Email ❌' };
    }

    private buildEmailSubject(type: string, dueDate: string): string {
        const dateShort = dueDate?.slice(0, 10) ?? '';
        if (type === 'BILLING_DAY') return `⚠️ Tu recibo AeroNet vence HOY — ${dateShort}`;
        if (type === 'OVERDUE') return `🔴 Servicio en riesgo de corte — AeroNet`;
        return `📅 Recordatorio de pago AeroNet — ${dateShort}`;
    }

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
                <p style="color:#888;font-size:13px;text-align:center;">Contacta a AeroNet para gestionar tu pago.</p>
            </div>
            <div style="padding:16px 32px;background:#f4f4f4;text-align:center;">
                <p style="font-size:11px;color:#aaa;margin:0;">Este mensaje fue enviado automáticamente por AeroNet. No responder.</p>
            </div>
        </div>`;
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
                '[EMAIL] Configuración SMTP incompleta. Omitiendo envío.',
            );
            return false;
        }

        const isHtml = body.trim().startsWith('<');
        const htmlContent = isHtml
            ? body
            : `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
                <h2 style="color:#0077B6;">AeroNet</h2>
                <p>${body.replace(/\n/g, '<br/>')}</p>
                <hr/>
                <p style="font-size:12px;color:#888;">Mensaje automático de AeroNet. No responder.</p>
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
}
