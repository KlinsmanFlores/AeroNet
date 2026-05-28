import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketCategory } from './dto/create-ticket.dto';

/** Etiquetas para generar el subject: "Trámite de [label]" */
const CATEGORY_SUBJECT_LABEL: Record<TicketCategory, string> = {
  [TicketCategory.NUEVO_SERVICIO]: 'Nuevo servicio',
  [TicketCategory.REACTIVACION]: 'Reactivación de servicio',
  [TicketCategory.FACTURACION]: 'Facturación',
  [TicketCategory.TRASLADO]: 'Traslado / cambio de domicilio',
  [TicketCategory.RECIBO_FISICO]: 'Recibo en físico',
  [TicketCategory.RECLAMO]: 'Reclamo, queja o apelación',
  [TicketCategory.SUSPENSION]: 'Suspensión de servicio',
  [TicketCategory.MEJORA_PLAN]: 'Mejora de plan',
  [TicketCategory.COBERTURA_WIFI]: 'Ampliación cobertura Wi-Fi',
  [TicketCategory.PAUSA_VACACIONES]: 'Pausa por vacaciones',
};

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);
  private readonly table = 'tickets';

  /** Inyecta SupabaseService para acceso a la tabla tickets. */
  constructor(private readonly supabaseService: SupabaseService) { }

  /**
   * CREAR NUEVO TICKET
   * Asigna customer_id desde el usuario autenticado (JWT). Genera subject como "Trámite de [Categoría]" si no se envía.
   */
  async create(user: any, dto: CreateTicketDto) {
    const supabase = this.supabaseService.getClient();

    // 1. Obtener customer_id real desde la tabla customers usando el user_id de Auth
    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('user_id', user.userId)
      .maybeSingle();

    const customerId = customer ? customer.id : null;

    const subject = (dto.subject?.trim() && dto.subject) || `Trámite de ${CATEGORY_SUBJECT_LABEL[dto.category]}`;

    // 2. Preparar payload para la DB (columna en tabla = services_id, no service_id)
    const newTicket = {
      customer_id: customerId,
      user_id: user.userId, // Soporte para prospectos
      type: dto.type,
      subject,
      description: dto.description,
      services_id: dto.service_id || null,
      requested_plan: dto.requested_plan || null,
      category: dto.category,
      priority: dto.priority || 'medium',
      requires_maintenance: dto.requires_maintenance || false,
      status: 'open',
      technician_id: null
    };

    // 3. Insertar en Supabase
    const { data, error } = await supabase
      .from(this.table)
      .insert([newTicket])
      .select()
      .single();

    if (error) {
      this.logger.error(`Error creando ticket: ${error.message}`);
      throw new BadRequestException(`No se pudo crear el ticket: ${error.message}`);
    }

    return {
      message: 'Ticket creado exitosamente',
      ticket: data
    };
  }

  /**
   * VER TICKETS DEL CLIENTE LOGUEADO
   */
  async getMyTickets(user: any) {
    const supabase = this.supabaseService.getClient();

    // 1. Obtener customer_id
    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('user_id', user.userId)
      .maybeSingle();

    // 2. Consultar TODOS los tickets del cliente/prospecto
    const orFilter = customer ? `customer_id.eq.${customer.id},user_id.eq.${user.userId}` : `user_id.eq.${user.userId}`;
    const { data, error } = await supabase
      .from(this.table)
      .select(`
        *,
        service:services (id, address_text, plan:plans(name))
      `)
      .or(orFilter)
      .order('created_at', { ascending: false });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return data ?? [];
  }

  /**
   * VER TICKETS ASIGNADOS AL TÉCNICO LOGUEADO
   */
  async getAssignedToMe(user: any) {
    const supabase = this.supabaseService.getClient();

    const { data: tech } = await supabase
      .from('technicians')
      .select('id')
      .eq('user_id', user.userId)
      .maybeSingle();

    if (!tech) throw new BadRequestException('No se encontró tu perfil de técnico');

    const { data, error } = await supabase
      .from(this.table)
      .select(`
        *,
        service:services (id, address_text, plan:plans(name)),
        customer:customers (id, full_name, phone)
      `)
      .eq('technician_id', tech.id)
      .order('created_at', { ascending: false });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return data ?? [];
  }

  /**
   * FINALIZAR INSTALACIÓN (Vista Técnico):
   * Cierra el ticket, activa el servicio y convierte al prospecto en cliente automáticamente.
   */
  async completeInstallation(ticketId: string, user: any) {
    const supabase = this.supabaseService.getClient();

    // 1. Validar que el técnico existe
    const { data: tech } = await supabase.from('technicians').select('id').eq('user_id', user.userId).maybeSingle();
    const isTech = user.role === 'technician';
    if (isTech && !tech) throw new BadRequestException('No eres un técnico válido');

    // 2. Obtener el ticket
    const { data: ticket, error: ticketError } = await supabase.from(this.table).select('*').eq('id', ticketId).single();
    if (ticketError || !ticket) throw new NotFoundException('Ticket no encontrado');
    
    // 3. Seguridad: Si eres técnico, el ticket debe estar asignado a ti
    if (isTech && ticket.technician_id !== tech.id) {
        throw new ForbiddenException('No puedes finalizar un ticket que no te fue asignado');
    }

    // 4. Actualizar estado del ticket a completado
    await supabase.from(this.table).update({ status: 'completed' }).eq('id', ticketId);

    // 5. Activar el servicio si existe
    if (ticket.services_id) {
        await supabase.from('services').update({ status: 'active' }).eq('id', ticket.services_id);
    }

    // 6. Promover de Prospecto a Cliente si es necesario
    if (ticket.user_id && !ticket.customer_id) {
        const { data: existingCustomer } = await supabase.from('customers').select('id').eq('user_id', ticket.user_id).maybeSingle();
        
        if (!existingCustomer) {
            // Intentar recuperar email del auth
            let email = `cliente-${ticket.user_id.slice(0,6)}@aeronet.pe`;
            let fullName = 'Cliente Autogenerado (Actualizar)';
            
            try {
                const { data: authUser } = await supabase.auth.admin.getUserById(ticket.user_id);
                if (authUser?.user) {
                    email = authUser.user.email || email;
                    fullName = authUser.user.user_metadata?.full_name || fullName;
                }
            } catch (e) {
                this.logger.warn('No se pudo obtener data de auth.admin, usando valores genéricos');
            }

            const { data: roleData } = await supabase.from('role').select('id').eq('name', 'customer').single();
            if (roleData) {
                // Actualizar rol
                await supabase.from('auth_users').update({ role_id: roleData.id }).eq('id', ticket.user_id);
                
                // Insertar customer
                const { data: newCustomer } = await supabase.from('customers').insert([{
                    user_id: ticket.user_id,
                    full_name: fullName,
                    email: email,
                    status: 'active'
                }]).select('id').single();

                // Enlazar el ticket al nuevo customer
                if (newCustomer) {
                    await supabase.from(this.table).update({ customer_id: newCustomer.id }).eq('id', ticketId);
                }
            }
        }
    }

    return { message: 'Instalación finalizada. Cliente y servicio activados automáticamente.' };
  }

  /**
   * LISTAR TODOS LOS TICKETS (solo admin)
   */
  async findAll() {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from(this.table)
      .select(`
        *,
        service:services (id, address_text, plan:plans(name)),
        customer:customers (id, full_name)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Error listando tickets: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    return data;
  }

  /**
   * OBTENER UN TICKET POR ID
   * El controlador valida que el cliente solo acceda a los suyos.
   */
  async findOne(id: string) {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from(this.table)
      .select(`
        *,
        service:services (id, address_text, plan:plans(name)),
        customer:customers (id, full_name, user_id)
      `)
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException('Ticket no encontrado');
    }

    return data;
  }

  /**
   * ACTUALIZAR TICKET (solo admin: estado, técnico, prioridad, etc.)
   */
  async update(id: string, dto: UpdateTicketDto) {
    const supabase = this.supabaseService.getClient();

    const { data: existing } = await supabase
      .from(this.table)
      .select('id')
      .eq('id', id)
      .single();

    if (!existing) {
      throw new NotFoundException('Ticket no encontrado');
    }

    const payload: Record<string, unknown> = {};
    if (dto.status !== undefined) payload.status = dto.status;
    if (dto.technician_id !== undefined) payload.technician_id = dto.technician_id;
    if (dto.priority !== undefined) payload.priority = dto.priority;
    if (dto.category !== undefined) payload.category = dto.category;
    if (dto.description !== undefined) payload.description = dto.description;
    if (dto.requires_maintenance !== undefined) payload.requires_maintenance = dto.requires_maintenance;

    const { data, error } = await supabase
      .from(this.table)
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error actualizando ticket: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    return data;
  }

  /**
   * ELIMINAR TICKET (solo admin)
   * Si es work_order con servicio en pending: eliminar facturas asociadas → servicio → ticket (sin huérfanos).
   */
  async remove(id: string) {
    const supabase = this.supabaseService.getClient();

    const { data: ticket, error: fetchError } = await supabase
      .from(this.table)
      .select('id, type, services_id')
      .eq('id', id)
      .single();

    if (fetchError || !ticket) {
      throw new NotFoundException('Ticket no encontrado');
    }

    const serviceId = ticket.services_id ?? (ticket as { service_id?: string }).service_id;

    if (ticket.type === 'work_order' && serviceId) {
      const { data: service } = await supabase
        .from('services')
        .select('id, status')
        .eq('id', serviceId)
        .single();

      if (service?.status === 'pending') {
        const { error: delInvoices } = await supabase.from('invoices').delete().eq('service_id', serviceId);
        if (delInvoices) this.logger.warn(`No se pudieron eliminar facturas del servicio ${serviceId}: ${delInvoices.message}`);

        const { error: delSvc } = await supabase.from('services').delete().eq('id', serviceId);
        if (delSvc) {
          this.logger.warn(`No se pudo eliminar servicio ${serviceId}: ${delSvc.message}`);
          throw new BadRequestException(`No se pudo eliminar el servicio asociado: ${delSvc.message}`);
        }
      }
    }

    const { error } = await supabase
      .from(this.table)
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Error eliminando ticket: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    return { message: 'Ticket eliminado correctamente' };
  }
}

