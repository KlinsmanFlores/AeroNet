import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MercadoPagoConfig, Preference, Payment, MerchantOrder } from 'mercadopago';
import axios from 'axios';
import * as crypto from 'crypto';

/** Parámetros para validar la firma del webhook de Mercado Pago */
export interface WebhookSignatureParams {
  /** Valor del header x-signature (ej: ts=1704908010,v1=618c8534...) */
  xSignature: string;
  /** Valor del header x-request-id */
  xRequestId?: string;
  /** ID del recurso (data.id del body o query param data.id) */
  dataId?: string;
}

@Injectable()
export class MercadoPagoService {
  private readonly logger = new Logger(MercadoPagoService.name);
  private client: MercadoPagoConfig;

  /** Inicializa el cliente de Mercado Pago con MP_ACCESS_TOKEN (debe empezar con APP_USR-). */
  constructor(private readonly configService: ConfigService) {
    const accessToken =
      this.configService.get<string>('mercadopago.accessToken') ?? process.env.MP_ACCESS_TOKEN;
    if (!accessToken || !accessToken.trim()) {
      throw new Error(
        '[MercadoPago] Falta configurar MP_ACCESS_TOKEN en el servidor. Añade MP_ACCESS_TOKEN en el .env del backend (credenciales de tu aplicación en el panel de Mercado Pago).',
      );
    }
    const token = accessToken.trim();
    if (!token.startsWith('APP_USR-')) {
      throw new Error(
        '[MercadoPago] MP_ACCESS_TOKEN debe ser un token real que empiece con APP_USR-. Revisa tu .env y reemplaza el valor por el Access Token de producción o prueba de tu aplicación.',
      );
    }
    this.client = new MercadoPagoConfig({ accessToken: token });
  }

  /**
   * VALIDACIÓN DE FIRMA DE WEBHOOK
   * Usa MP_WEBHOOK_SECRET_QR para validar las notificaciones que llegan por ngrok (QR / instore).
   * Soporta x-signature con v1 y/o v2 (Mercado Pago puede enviar uno u otro según el tipo de notificación).
   *
   * Formato x-signature: ts=1704908010,v1=618c8534... o ts=...,v2=...
   * Manifest: id:[data.id];request-id:[x-request-id];ts:[ts];
   * HMAC: SHA256(manifest, secret) en hexadecimal
   */
  validateWebhookSignature(params: WebhookSignatureParams): boolean {
    const { xSignature, xRequestId, dataId: rawDataId } = params;
    const dataId = rawDataId?.toString().toLowerCase?.() ?? '';

    if (!xSignature || !xSignature.trim()) {
      this.logger.warn('Webhook MP: x-signature vacío o ausente');
      return false;
    }

    // Extraer ts, v1 y v2 del header x-signature (QR puede usar v1 o v2)
    let ts = '';
    let hashV1 = '';
    let hashV2 = '';
    const parts = xSignature.split(',');
    for (const part of parts) {
      const [key, value] = part.split('=').map((s) => s?.trim() ?? '');
      if (key === 'ts') ts = value ?? '';
      else if (key === 'v1') hashV1 = value ?? '';
      else if (key === 'v2') hashV2 = value ?? '';
    }

    const hashToValidate = hashV1 || hashV2;
    if (!ts || !hashToValidate) {
      this.logger.warn(`Webhook MP: No se pudo extraer ts o v1/v2 de x-signature (v1=${!!hashV1}, v2=${!!hashV2})`);
      return false;
    }

    // Construir manifest según documentación MP (omitir partes ausentes)
    const manifestParts: string[] = [];
    if (dataId) manifestParts.push(`id:${dataId}`);
    if (xRequestId) manifestParts.push(`request-id:${xRequestId}`);
    manifestParts.push(`ts:${ts}`);
    const manifest = manifestParts.join(';') + ';';

    // Secretos: env directo + config (ConfigService puede no exponer MP_* como key, usar mercadopago.webhookSecret que carga MP_WEBHOOK_SECRET_QR)
    const secrets: string[] = [
      process.env.MP_WEBHOOK_SECRET_QR,
      this.configService.get<string>('mercadopago.webhookSecret'),
      process.env.MP_WEBHOOK_SECRET,
      this.configService.get<string>('MP_WEBHOOK_SECRET_CHECKOUT'),
    ].filter((s): s is string => !!s && typeof s === 'string' && s.length > 0);

    if (secrets.length === 0) {
      this.logger.warn(
        'Webhook MP: No hay secretos configurados. Configure MP_WEBHOOK_SECRET_QR en .env para validar notificaciones ngrok.',
      );
      return false;
    }

    for (let i = 0; i < secrets.length; i++) {
      const secret = secrets[i];
      // Log temporal: primeros 4 caracteres del secreto para comparar con .env (quitar en producción)
      const secretPreview = secret.length >= 4 ? `${secret.slice(0, 4)}****` : '****';
      this.logger.log(`Webhook MP: Intentando secreto #${i + 1} (inicio: ${secretPreview})`);

      const computed = crypto
        .createHmac('sha256', secret)
        .update(manifest)
        .digest('hex');

      if (computed === hashV1 || computed === hashV2) {
        this.logger.log(`Webhook MP: Firma validada correctamente (secreto #${i + 1}, inicio: ${secretPreview})`);
        return true;
      }
    }

    this.logger.warn(
      `Webhook MP: Firma inválida (ningún secreto coincidió). Secretos probados: ${secrets.length}. Compara MP_WEBHOOK_SECRET_QR en .env con el valor en el panel de MP.`,
    );
    return false;
  }

  /**
   * MÉTODO ACTUALIZADO: GENERA LINK DE PAGO (PREFERENCE) + QR DINÁMICO
   * Retorna ambos para que el usuario elija cómo pagar
   */
  async createPreference(
    invoiceId: string, 
    amount: number, 
    description: string, 
    email: string, 
    customerId: string, 
    serviceId: string,
    chosenDocumentType: string
  ) {
    const preference = new Preference(this.client);
    
    // 1. CREAR PREFERENCE (CHECKOUT LINK)
    const response = await preference.create({
        body: {
        items: [{
            id: invoiceId,
            title: description,
            quantity: 1,
            unit_price: Number(amount),
            currency_id: 'PEN'
        }],
        payer: { email },
        external_reference: invoiceId, 
        metadata: {
            customer_id: customerId,
            service_id: serviceId,
            chosen_document_type: chosenDocumentType,
            invoice_id: invoiceId
        },
        notification_url: `${(process.env.BACKEND_URL || '').replace(/\/$/, '')}/api/payments/webhook/mercadopago`,
        auto_return: 'approved',
        back_urls: {
            success: `${process.env.FRONTEND_URL}/success`,
            failure: `${process.env.FRONTEND_URL}/failure`
        },
        }
    });

    // 2. CREAR QR DINÁMICO USANDO LA API DE MERCADO PAGO
    // Los QR dinámicos se crean mediante merchant orders
    let qrData = null;
    try {
      qrData = await this.createDynamicQR(
        invoiceId,
        amount,
        description,
        customerId,
        serviceId,
        chosenDocumentType
      );
      this.logger.log(`✅ QR Dinámico creado para factura ${invoiceId}`);
    } catch (error) {
      this.logger.error(`❌ Error creando QR dinámico: ${error.message}`);
      // No lanzamos error, el checkout link sigue siendo válido
    }

    return {
        id: response.id,
        init_point: response.init_point,
        qr_code_url: qrData?.qr_code_url || null,
        qr_code_base64: qrData?.qr_code_base64 || null,
        short_payment_url: response.init_point, // MP no tiene URL corta separada, usamos init_point
        checkout_id: response.id,
        payment_mode: 'CHECKOUT_LINK'
    };
  }

  /**
   * GENERAR ORDEN QR DINÁMICO (API Instore Orders QR)
   * POST a instore/orders/qr/seller/collectors/{user_id}/pos/{external_pos_id}/qrs
   * Retorna qr_data para mostrar en el frontend (tramma EMVCo para generar la imagen QR).
   */
  async generarOrdenQR(params: {
    external_reference: string;
    title: string;
    description: string;
    total_amount: number;
    notification_url?: string;
  }) {
    const userId =
      this.configService.get<string>('mercadopago.userId') ?? process.env.MP_USER_ID;
    const externalPosId =
      this.configService.get<string>('mercadopago.externalPosId') ?? process.env.MP_EXTERNAL_POS_ID;
    const accessToken =
      this.configService.get<string>('mercadopago.accessToken') ?? process.env.MP_ACCESS_TOKEN;
    const notificationUrl =
      params.notification_url ||
      this.configService.get<string>('mercadopago.notificationUrl') ||
      process.env.MP_NOTIFICATION_URL;

    if (!accessToken?.trim()) {
      throw new Error(
        '[MercadoPago] MP_ACCESS_TOKEN no configurado. Añade MP_ACCESS_TOKEN en el .env del backend.',
      );
    }
    const token = accessToken.trim();
    if (!token.startsWith('APP_USR-')) {
      throw new Error(
        '[MercadoPago] MP_ACCESS_TOKEN debe ser un token real (empieza con APP_USR-). Revisa tu .env.',
      );
    }
    if (!userId?.trim()) {
      throw new Error(
        '[MercadoPago] MP_USER_ID no configurado. Añade MP_USER_ID en el .env del backend.',
      );
    }
    if (!externalPosId?.trim()) {
      throw new Error(
        '[MercadoPago] MP_EXTERNAL_POS_ID no configurado. Añade MP_EXTERNAL_POS_ID en el .env del backend.',
      );
    }
    if (!notificationUrl?.trim()) {
      throw new Error(
        '[MercadoPago] MP_NOTIFICATION_URL no configurado. Añade MP_NOTIFICATION_URL en el .env.',
      );
    }

    // Endpoint exacto: .../collectors/{userId}/pos/{externalPosId}/qrs
    // Con .env: MP_USER_ID=3175759716, MP_EXTERNAL_POS_ID=CAJAAERONET01 (sucursal/caja ya existen en MP)
    const url = `https://api.mercadopago.com/instore/orders/qr/seller/collectors/${userId.trim()}/pos/${externalPosId.trim()}/qrs`;

    // Body sin category ni sponsor: la caja está preconfigurada; esos campos provocan errores de validación.
    const body = {
      external_reference: params.external_reference,
      title: params.title,
      description: params.description,
      notification_url: notificationUrl!.trim(),
      total_amount: Number(params.total_amount),
      items: [
        {
          sku_number: params.external_reference,
          title: params.title,
          description: params.description,
          unit_price: Number(params.total_amount),
          quantity: 1,
          unit_measure: 'unit',
          currency_id: 'PEN',
          total_amount: Number(params.total_amount),
        },
      ],
      cash_out: { amount: 0 },
    };

    try {
      const response = await axios.post<{ qr_data: string; in_store_order_id?: string }>(url, body, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const qr_data = response.data?.qr_data ?? null;
      const in_store_order_id = response.data?.in_store_order_id ?? null;
      this.logger.log(
        `Orden QR generada: external_ref=${params.external_reference}, in_store_order_id=${in_store_order_id}`,
      );
      return { qr_data, in_store_order_id };
    } catch (error: any) {
      const msg = error?.response?.data || error?.message;
      this.logger.error(`Error generarOrdenQR: ${JSON.stringify(msg)}`);
      throw error;
    }
  }

  /**
   * CREAR QR DINÁMICO (legacy: usado por createPreference)
   * Usa generarOrdenQR internamente para mantener compatibilidad.
   */
  private async createDynamicQR(
    invoiceId: string,
    amount: number,
    description: string,
    _customerId: string,
    _serviceId: string,
    _chosenDocumentType: string,
  ) {
    const notificationUrl = this.configService.get<string>('mercadopago.notificationUrl');
    const result = await this.generarOrdenQR({
      external_reference: invoiceId,
      title: description,
      description,
      total_amount: amount,
      notification_url: notificationUrl || undefined,
    });
    return {
      qr_code_url: result.qr_data,
      qr_code_base64: result.qr_data,
      qr_id: result.in_store_order_id,
    };
  }

  /**
   * Procesar notificación de webhook (type: payment).
   * Consulta el estado del pago con el ID recibido; si status es approved,
   * el llamador (p. ej. PaymentsService) debe marcar como pagado / emitir facturación.
   * URL del webhook: https://kiltlike-trigly-hana.ngrok-free.dev/payments/webhook/mercadopago
   */
  async processWebhookNotification(rawBody: any): Promise<{
    type: string;
    paymentId?: string;
    payment?: any;
    isApproved?: boolean;
  }> {
    const type = rawBody.type || 'unknown';
    if (type !== 'payment') {
      return { type };
    }
    const paymentId = rawBody.data?.id ?? rawBody.id;
    if (!paymentId) {
      this.logger.warn('Webhook MP type=payment sin data.id');
      return { type };
    }
    try {
      const payment = await this.getPaymentDetails(String(paymentId));
      const isApproved = (payment as any)?.status === 'approved';
      if (isApproved) {
        this.logger.log(`Pago MP aprobado: ${paymentId}`);
      }
      return { type, paymentId: String(paymentId), payment, isApproved };
    } catch (err: any) {
      this.logger.error(`Error obteniendo pago MP ${paymentId}: ${err?.message}`);
      return { type, paymentId: String(paymentId), isApproved: false };
    }
  }

  /**
   * OBTENER DETALLES DE UN PAGO
   * Para webhooks de tipo 'payment'
   */
  async getPaymentDetails(paymentId: string) {
    const payment = new Payment(this.client);
    return await payment.get({ id: paymentId });
  }

  /**
   * Extrae el ID del recurso del body del webhook de MP.
   * Si viene data.id o id se usan; si no, se obtiene del final de la URL en resource
   * (ej: .../merchant_orders/12345 → 12345). Útil cuando MP no envía data.id.
   */
  getWebhookResourceId(body: { data?: { id?: string }; id?: string; resource?: string }): string | undefined {
    if (body.data?.id != null && body.data.id !== '') return String(body.data.id);
    if (body.id != null && body.id !== '') return String(body.id);
    if (body.resource && typeof body.resource === 'string') {
      const trimmed = body.resource.trim();
      if (trimmed.length > 0) {
        const lastSegment = trimmed.replace(/\/+$/, '').split('/').pop();
        if (lastSegment) return lastSegment;
      }
    }
    return undefined;
  }

  /**
   * OBTENER DETALLES DE UNA ORDEN DE COMERCIO (MERCHANT ORDER)
   * Para webhooks de tipo 'merchant_order' (usado en pagos QR)
   */
  async getMerchantOrder(orderId: string) {
    if (!orderId || orderId === 'undefined') {
      this.logger.error('getMerchantOrder llamado sin orderId válido');
      throw new Error('Invalid Id');
    }
    try {
      const merchantOrder = new MerchantOrder(this.client);
      return await merchantOrder.get({ merchantOrderId: orderId });
    } catch (error) {
      this.logger.error(`Error obteniendo merchant order ${orderId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * OBTENER DETALLES DE UNA PREFERENCIA
   * Útil para verificar el estado de un checkout
   */
  async getPreferenceDetails(preferenceId: string) {
    try {
      const preference = new Preference(this.client);
      return await preference.get({ preferenceId });
    } catch (error) {
      this.logger.error(`Error obteniendo preferencia ${preferenceId}: ${error.message}`);
      throw error;
    }
  }
}