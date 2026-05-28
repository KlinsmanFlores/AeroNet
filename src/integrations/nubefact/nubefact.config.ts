import { registerAs } from '@nestjs/config';

export const nubefactConfig = registerAs('nubefact', () => ({
  apiUrl: process.env.NUBEFACT_API_URL,
  token: process.env.NUBEFACT_TOKEN,
  /** Serie de Facturas (ej: F001). Debe coincidir con el panel de NubeFact. */
  serieFactura: process.env.NUBEFACT_SERIE_FACTURA || 'F001',
  /** Serie de Boletas (ej: B001). Debe coincidir con el panel de NubeFact. */
  serieBoleta: process.env.NUBEFACT_SERIE_BOLETA || 'B001',
  /** Último número emitido en Facturas (panel real). Si Supabase está vacío, se usa este + 1. */
  lastNumberFactura: parseInt(process.env.NUBEFACT_LAST_NUMBER_FACTURA || '606', 10),
  /** Último número emitido en Boletas (panel real). Si Supabase está vacío, se usa este + 1. */
  lastNumberBoleta: parseInt(process.env.NUBEFACT_LAST_NUMBER_BOLETA || '5120', 10),
}));

export type NubefactConfig = typeof nubefactConfig;