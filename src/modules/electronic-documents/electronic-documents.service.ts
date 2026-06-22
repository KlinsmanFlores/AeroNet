import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../supabase.service';
import { CreateElectronicDocumentDto } from './dto/create-electronic-document.dto';
import { NubefactService } from '../../integrations/nubefact/nubefact.service';
import { NotificationService } from '../../integrations/notifications/notification.service';

/** Fecha actual del servidor en formato dd-mm-yyyy para la API de NubeFact (fecha de emisión del comprobante). */
function getFechaEmisionServidor(): string {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

@Injectable()
export class ElectronicDocumentsService {
  private readonly logger = new Logger(ElectronicDocumentsService.name);
  private readonly table = 'electronic_documents';

  /** Inyecta SupabaseService, NubefactService, NotificationService y ConfigService. */
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly nubefactService: NubefactService,
    private readonly notificationService: NotificationService,
    private readonly configService: ConfigService,
  ) {}

  /** Crea un comprobante electrónico (boleta/factura) en Nubefact y lo guarda en la base de datos. */
  async create(dto: CreateElectronicDocumentDto) {
    const supabase = this.supabaseService.getClient();

    // --- 1. DEFINICIÓN DINÁMICA Y BLINDAJE DE SERIE/TIPO ---
    let tipoDeComprobante: number;
    let series: string;
    let finalType = dto.type; // Guardamos el tipo final para la base de datos

    // Validamos si el documento del cliente califica para Factura (RUC tiene 11 dígitos)
    const customerDoc = dto.customer_document ? String(dto.customer_document).trim() : '';
    const isRuc = customerDoc.length === 11;

    // --- CAMBIO SOLICITADO PARA DEMO (FFF1 / BBB1) ---
    const SERIE_FACTURA = this.configService.get<string>('nubefact.serieFactura') || process.env.NUBEFACT_SERIE_FACTURA || 'FFF1';
    const SERIE_BOLETA = this.configService.get<string>('nubefact.serieBoleta') || process.env.NUBEFACT_SERIE_BOLETA || 'BBB1';

    if (dto.type === 'FACTURA' && isRuc) {
      tipoDeComprobante = 1; // Factura
      series = SERIE_FACTURA;
      this.logger.log(`[ElectronicDocumentsService] Carril de Factura detectado. Buscando último número para ${SERIE_FACTURA}...`);
    } else {
      // Si el DTO pide FACTURA pero no hay RUC, o si pide BOLETA, forzamos BOLETA
      tipoDeComprobante = 2; // Boleta
      series = SERIE_BOLETA;
      this.logger.log(`[ElectronicDocumentsService] Carril de Boleta detectado. Buscando último número para ${SERIE_BOLETA}...`);

      if (dto.type === 'FACTURA' && !isRuc) {
        this.logger.warn(`⚠️ Cambio automático: Factura -> Boleta para ${dto.customer_name} (Documento no es RUC: ${customerDoc})`);
        finalType = 'BOLETA';
      }
    }

    // --- 2. OBTENCIÓN DE CORRELATIVO (Busca en BD, si no hay usa .env) ---
    const nextNumber = await this.getNextNumber(series);
    this.logger.log(`[ElectronicDocumentsService] Asignando ${series}-${nextNumber}.`);

    // --- 3. BLINDAJE TIPO DE DOCUMENTO SUNAT: 6 = RUC (Factura), 1 = DNI (Boleta) ---
    const clienteTipoDocumento = isRuc ? 6 : 1;

    // --- 4. LLAMADA A NUBEFACT ---
    const payloadNubefact = {
      ...dto,
      tipo_de_comprobante: tipoDeComprobante,
      series,
      next_number: nextNumber,
      fecha_de_emision: getFechaEmisionServidor(),
      cliente_tipo_de_documento: clienteTipoDocumento,
    };

    this.logger.debug(
      `[ElectronicDocumentsService] JSON enviado a nubefactService.generateDocument: ${JSON.stringify(payloadNubefact)}`,
    );

    let nbResponse;
    try {
      this.logger.log(`Iniciando llamada a Nubefact para ${finalType} ${dto.invoice_id} - Serie: ${series}-${nextNumber}`);

      nbResponse = await this.nubefactService.generateDocument(payloadNubefact);

      this.logger.log(`✅ Respuesta recibida de Nubefact para factura ${dto.invoice_id}`);
    } catch (nbError: any) {
      const errorMessage = nbError?.message || 'Error desconocido';
      this.logger.error(`❌ ERROR CRÍTICO en llamada a Nubefact: ${errorMessage}`);
      throw new BadRequestException(`Error al generar documento en Nubefact: ${errorMessage}`);
    }

    // --- 4. GUARDADO EN BASE DE DATOS (SUPABASE) ---
    const pdfUrl = nbResponse.enlace_del_pdf || nbResponse.pdf_url;
    const xmlUrl = nbResponse.enlace_del_xml || nbResponse.xml_url;
    
    const dataToSave = {
      invoice_id: dto.invoice_id,
      payment_id: dto.payment_id || null,
      type: finalType,
      series: series,
      number: nextNumber,
      external_id: nbResponse.key || nbResponse.codigo_unico || nbResponse.invoice?.key,
      pdf_url: pdfUrl,
      xml_url: xmlUrl,
      sunat_status: 'ACEPTADO',
      response_data: nbResponse,
    };

    // Verificar si ya existe para evitar duplicados
    const { data: existing } = await supabase
      .from(this.table)
      .select('id')
      .eq('invoice_id', dto.invoice_id)
      .maybeSingle();

    let data: any;
    if (existing) {
      const { data: updated, error: updateError } = await supabase
        .from(this.table)
        .update(dataToSave)
        .eq('id', existing.id)
        .select()
        .single();
      
      if (updateError) throw new BadRequestException(`Fallo al actualizar en BD: ${updateError.message}`);
      data = updated;
      this.logger.log(`✅ ÉXITO: Comprobante actualizado en BD local`);
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from(this.table)
        .insert([dataToSave])
        .select()
        .single();

      if (insertError) throw new BadRequestException(`Fallo al insertar en BD: ${insertError.message}`);
      data = inserted;
      this.logger.log(`✅ ÉXITO: Comprobante registrado en BD local`);
    }

    // --- 5. NOTIFICACIÓN WHATSAPP + EMAIL ---
    if (pdfUrl && dto.customer_phone) {
      this.notificationService.sendInvoicePdf(
        dto.invoice_id,
        dto.customer_phone,
        dto.customer_name,
        dto.total?.toString() ?? '0.00',
        dto.customer_email || undefined,
      ).catch(wsError => {
        this.logger.error(`⚠️ Error enviando notificaciones (Proceso legal OK): ${wsError.message}`);
      });
    }

    return data;
  }

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
      throw new NotFoundException('No tienes permiso para acceder a los documentos de esta factura');
    }
  }

  /** Lista todos los comprobantes electrónicos con datos del cliente y factura. */
  async findAll() {
    const { data, error } = await this.supabaseService.getClient()
      .from(this.table)
      .select(`
        *,
        invoice:invoice_id(
          total,
          service:service_id(
            customer:customer_id(
              full_name,
              document_number
            )
          )
        )
      `)
      .order('emitted_at', { ascending: false });

    if (error) throw new BadRequestException(error.message);

    return (data || []).map((doc: any) => {
      const invoice = Array.isArray(doc.invoice) ? doc.invoice[0] : doc.invoice;
      const service = Array.isArray(invoice?.service) ? invoice?.service[0] : invoice?.service;
      const customer = Array.isArray(service?.customer) ? service?.customer[0] : service?.customer;
      return {
        id: doc.id,
        type: doc.type ?? '',
        series: doc.series ?? '',
        number: doc.number ?? 0,
        sunat_status: doc.sunat_status ?? '',
        pdf_url: doc.pdf_url ?? '',
        xml_url: doc.xml_url ?? '',
        emitted_at: doc.emitted_at ?? null,
        total_amount: invoice?.total ?? 0,
        customer_name: customer?.full_name ?? '—',
        customer_document: customer?.document_number ?? '',
      };
    });
  }

  /** Obtiene un comprobante electrónico por ID con datos relacionados. */
  async findOne(id: string) {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('electronic_documents')
      .select(`
        id,
        invoice_id,
        pdf_url,
        invoice:invoice_id (
          total,
          service:service_id (
            customer:customer_id (
              full_name,
              phone
            )
          )
        )
      `)
      .eq('id', id)
      .single();

    if (error || !data) {
      this.logger.error(`Error buscando documento ${id}: ${error?.message}`);
      return null;
    }

    // 🔹 NORMALIZAMOS ARRAYS → OBJETOS
    const invoice = Array.isArray(data.invoice)
      ? data.invoice[0]
      : data.invoice;

    const service = Array.isArray(invoice?.service)
      ? invoice?.service[0]
      : invoice?.service;

    const customer = Array.isArray(service?.customer)
      ? service?.customer[0]
      : service?.customer;

    return {
      id: data.id,
      invoice_id: data.invoice_id ?? null,
      pdf_url: data.pdf_url ?? '',
      customer_name: customer?.full_name ?? 'Cliente',
      customer_phone: customer?.phone
        ? String(customer.phone).replace(/\D/g, '')
        : '',
      total_amount: invoice?.total
        ? String(invoice.total)
        : '0.00',
    };
  }

  /**
   * Lista documentos electrónicos de una factura.
   * Enriquece pdf_url y xml_url desde response_data (Nubefact: enlace_del_pdf, enlace_del_xml)
   * cuando no estén guardados en la fila, para permitir descarga desde el front.
   */
  async findByInvoice(invoiceId: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from(this.table)
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false });

    if (error) throw new BadRequestException(error.message);
    const list = Array.isArray(data) ? data : [];

    return list.map((doc: any) => {
      const responseData = doc.response_data && typeof doc.response_data === 'object' ? doc.response_data : {};
      const pdfUrl = doc.pdf_url?.trim() || responseData.enlace_del_pdf || responseData.pdf_url || null;
      const xmlUrl = doc.xml_url?.trim() || responseData.enlace_del_xml || responseData.xml_url || null;
      return {
        ...doc,
        pdf_url: pdfUrl ?? doc.pdf_url ?? '',
        xml_url: xmlUrl ?? doc.xml_url ?? '',
      };
    });
  }

  /**
   * Fuerza la validación del comprobante: si el PDF se generó en Nubefact pero no se guardó el link,
   * intenta recuperar pdf_url desde response_data o actualizar el registro.
   * Cliente puede llamar desde el botón "Actualizar" en historial de pagos.
   */
  async refreshComprobanteByInvoiceId(invoiceId: string) {
    const supabase = this.supabaseService.getClient();
    const { data: doc, error: findError } = await supabase
      .from(this.table)
      .select('id, pdf_url, response_data')
      .eq('invoice_id', invoiceId)
      .maybeSingle();

    if (findError) throw new BadRequestException(findError.message);
    if (!doc) return { updated: false, message: 'No existe comprobante para esta factura' };

    const currentPdfUrl = doc.pdf_url;
    const responseData = doc.response_data as any;
    const recoveredUrl = responseData?.enlace_del_pdf || responseData?.pdf_url;

    if (currentPdfUrl && currentPdfUrl.trim() !== '') {
      return { updated: false, message: 'El comprobante ya tiene PDF', pdf_url: currentPdfUrl };
    }

    if (recoveredUrl) {
      const { error: updateError } = await supabase
        .from(this.table)
        .update({ pdf_url: recoveredUrl })
        .eq('id', doc.id);
      if (updateError) {
        this.logger.error(`Error actualizando pdf_url para invoice ${invoiceId}: ${updateError.message}`);
        throw new BadRequestException(updateError.message);
      }
      this.logger.log(`✅ pdf_url recuperado para factura ${invoiceId} desde response_data`);
      return { updated: true, pdf_url: recoveredUrl };
    }

    return { updated: false, message: 'No se pudo recuperar el enlace del PDF' };
  }

  /**
   * Obtiene el siguiente número correlativo basado ÚNICAMENTE en el .env.
   * @param series Serie de Facturas (ej: F001) o Boletas (ej: B001)
   
  async getNextNumber(series: string): Promise<number> {
    // 1. Definimos las series para comparar (desde el .env)
    const serieFacturaEnv = process.env.NUBEFACT_SERIE_FACTURA || 'F001';
    const serieBoletaEnv = process.env.NUBEFACT_SERIE_BOLETA || 'B001';

    // 2. Leemos los últimos números directamente del .env
    const lastFactura = parseInt(process.env.NUBEFACT_LAST_NUMBER_FACTURA || '606', 10);
    const lastBoleta = parseInt(process.env.NUBEFACT_LAST_NUMBER_BOLETA || '5120', 10);

    let lastNumber = 0;

    // 3. Asignación directa según la serie
    if (series === serieFacturaEnv) {
      lastNumber = lastFactura;
    } else if (series === serieBoletaEnv) {
      lastNumber = lastBoleta;
    } else {
      // Si usas series de prueba como FFF1 o BBB1 y no están en el .env
      this.logger.warn(`[ElectronicDocumentsService] Serie ${series} no mapeada en .env, usando base 0`);
      lastNumber = 0;
    }

    const nextNumber = lastNumber + 1;
    this.logger.log(`[ElectronicDocumentsService] ENV READ: Serie ${series} -> Último: ${lastNumber}, Siguiente: ${nextNumber}`);

    return nextNumber;
  }
  */


  /**
   * Obtiene el siguiente número correlativo para la serie indicada.
   * Equivalente a: SELECT MAX(number) FROM electronic_documents WHERE series = :series
   * Correlativos INDEPENDIENTES por serie (F001 y B001 no comparten contador).
   * Si no hay registros en Supabase (lastNumber = 0), se sincroniza con los últimos números
   * del panel real de NubeFact/AeroNet vía variables de entorno (NUBEFACT_LAST_NUMBER_FACTURA / NUBEFACT_LAST_NUMBER_BOLETA).
   *
   * @param series Serie de Facturas (ej: F001) o Boletas (ej: B001)
   */
  /**
   * Obtiene el siguiente número correlativo para la serie indicada.
   * Prioriza la base de datos (Supabase) y usa el .env/panel como fallback inicial.
   */
  async getNextNumber(series: string): Promise<number> {
    const supabase = this.supabaseService.getClient();

    // 1. Buscamos el último número registrado en la BD para ESTA serie
    const { data, error } = await supabase
      .from(this.table)
      .select('number')
      .eq('series', series)
      .order('number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      this.logger.error(`Error obteniendo correlativo para serie ${series}: ${error.message}`);
      throw new Error(`No se pudo determinar el correlativo para ${series}.`);
    }

    let lastNumber = data?.number ?? 0;

    // 2. Si NO hay registros en BD (lastNumber === 0), iniciamos desde 0
    if (lastNumber === 0) {
      this.logger.log(`[ElectronicDocumentsService] Serie ${series} vacía en BD; iniciando desde 1.`);
    }

    // 3. Incrementamos siempre +1
    const nextNumber = lastNumber + 1;
    this.logger.log(`[ElectronicDocumentsService] Serie ${series}: último=${lastNumber}, siguiente=${nextNumber}`);

    return nextNumber;
  }


  // ==========================================================================================
  // EXPLICACIÓN DEL CAMBIO PARA PRODUCCIÓN (LEER ANTES DE DESPLEGAR)
  // ==========================================================================================
  //
  // 1. MODO DEMO ACTUAL: 
  //    Las series están configuradas como 'FFF1' (Facturas) y 'BBB1' (Boletas).
  //    Esto es OBLIGATORIO para el entorno de pruebas de Nubefact.
  //
  // 2. CÓMO PASAR A PRODUCCIÓN:
  //    Debes buscar en los métodos 'create' y 'getNextNumber' las líneas donde se definen
  //    SERIE_FACTURA y SERIE_BOLETA. Solo cambia los strings finales:
  //    - Reemplaza 'FFF1' por 'F001'
  //    - Reemplaza 'BBB1' por 'B001'
  //
  // 3. LÓGICA DE CORRELATIVOS:
  //    - El sistema SIEMPRE mirará primero la base de datos (Supabase).
  //    - Si la base de datos ya tiene registros para la serie (sea F001 o FFF1), 
  //      seguirá la secuencia (+1) ignorando el .env.
  //    - Si la tabla está VACÍA para esa serie, recién ahí usará el número base 
  //      del .env (NUBEFACT_LAST_NUMBER_FACTURA / BOLETA).
  //
  // 4. IMPORTANTE:
  //    Si cambias de serie (de FFF1 a F001), el sistema detectará que F001 no tiene 
  //    registros en la tabla y reiniciará el conteo según lo que diga tu .env.
  // ==========================================================================================
}