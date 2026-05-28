import { registerAs } from '@nestjs/config';

/**
 * Configuración de Mercado Pago para QR Dinámico y Webhooks.
 * Todas las variables se leen del .env; no dejar Access Token ni Clave Secreta en código.
 */
export const mercadopagoConfig = registerAs('mercadopago', () => ({
  /** User ID del vendedor (dashboard de Mercado Pago) */
  userId: process.env.MP_USER_ID,
  /** Access Token para llamadas a la API (credenciales de la aplicación) */
  accessToken: process.env.MP_ACCESS_TOKEN,
  publicKey: process.env.MP_PUBLIC_KEY,
  /** Clave secreta para validar la firma de las notificaciones del webhook */
  webhookSecret:
    process.env.MP_WEBHOOK_SECRET_QR ||
    process.env.MP_WEBHOOK_SECRET,
  /** POS fijo para generar órdenes QR (instore) */
  externalPosId: process.env.MP_EXTERNAL_POS_ID,
  /** URL donde Mercado Pago enviará las notificaciones (webhook). Ej: ngrok + /payments/webhook/mercadopago */
  notificationUrl: process.env.MP_NOTIFICATION_URL,
}));
