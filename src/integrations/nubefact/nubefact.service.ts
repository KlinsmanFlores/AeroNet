import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import axios from 'axios';
import { nubefactConfig, NubefactConfig } from './nubefact.config';

@Injectable()
export class NubefactService {
  private readonly logger = new Logger(NubefactService.name);

  /** Inyecta la configuración de Nubefact (API URL, token, series). */
  constructor(
    @Inject(nubefactConfig.KEY)
    private readonly config: ConfigType<NubefactConfig>,
  ) {}

  /** Envía el comprobante a Nubefact (boleta/factura electrónica) y devuelve la respuesta de la API. */
  async generateDocument(invoiceData: any) {
    try {
      const response = await axios.post(
        this.config.apiUrl!,
        this.mapInvoiceToNubefact(invoiceData),
        {
          headers: {
            'Authorization': `Token token="${this.config.token}"`,
            'Content-Type': 'application/json',
          },
          timeout: 15000, 
        },
      );
      // Retornamos la data limpia que usará el ElectronicDocumentsService
      return response.data;
    } catch (error) {
      // Capturamos el error específico de la API de Nubefact si existe
      const errorMsg = error.response?.data?.errors || error.message;
      this.logger.error(`Error en Nubefact: ${JSON.stringify(errorMsg)}`);
      throw new BadRequestException(`Nubefact API Error: ${JSON.stringify(errorMsg)}`);
    }
  }

  /** Mapea los datos de la factura al formato JSON que espera la API de Nubefact (SUNAT). */
  private mapInvoiceToNubefact(data: any) {
    const isFactura = String(data.customer_document).length === 11;
    const total = Number(data.total);

    // REDONDEO MATEMÁTICO: Evita errores de "Cálculo incorrecto" en SUNAT
    const valorUnitario = Math.round((total / 1.18) * 100) / 100;
    const igv = Math.round((total - valorUnitario) * 100) / 100;

    // Fecha de emisión: la que envía el caller (electronic-documents: dd-mm-yyyy)
    const fechaEmision = data.fecha_de_emision ?? new Date().toLocaleDateString('es-PE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).replace(/\//g, '-');

    const SERIE_FACTURA = this.config.serieFactura ?? 'F001';
    const SERIE_BOLETA = this.config.serieBoleta ?? 'B001';
    // SUNAT: 6 = RUC (Factura), 1 = DNI (Boleta). Usar el que envía el caller si viene en el payload.
    const clienteTipoDoc = data.cliente_tipo_de_documento ?? (isFactura ? 6 : 1);

    return {
      operacion: 'generar_comprobante',
      tipo_de_comprobante: data.tipo_de_comprobante ?? (isFactura ? 1 : 2),
      serie: data.series || (isFactura ? SERIE_FACTURA : SERIE_BOLETA),
      numero: data.next_number,
      sunat_transaction: 1,
      cliente_tipo_de_documento: clienteTipoDoc,
      cliente_numero_de_documento: data.customer_document,
      cliente_denominacion: data.customer_name,
      cliente_direccion: data.customer_address || "LIMA",
      fecha_de_emision: fechaEmision,
      moneda: 1, // Soles
      porcentaje_de_igv: 18.00,
      total_gravada: valorUnitario,
      total_igv: igv,
      total: total,
      enviar_automaticamente_a_la_sunat: true,
      enviar_automaticamente_al_cliente: !!data.customer_email,
      items: [{
        unidad_de_medida: "NIU",
        codigo: "SERV01",
        descripcion: `SERVICIO INTERNET AERONET - ${data.period}`,
        cantidad: 1,
        valor_unitario: valorUnitario,
        precio_unitario: total,
        subtotal: valorUnitario,
        tipo_de_igv: 1, // Gravado - Operación Onerosa
        igv: igv,
        total: total,
      }]
    };
  }
}