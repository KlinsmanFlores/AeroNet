import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { CreateServiceWithTicketDto } from './dto/create-service-with-ticket.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

/**
 * SERVICIO DE GESTIÓN DE INSTALACIONES (SERVICIOS)
 * Maneja el ciclo de vida de las antenas/conexiones.
 */
@Injectable()
export class ServicesService {
  private readonly logger = new Logger(ServicesService.name);
  private readonly table = 'services';

  /** Inyecta SupabaseService para instalaciones. */
  constructor(
    private readonly supabaseService: SupabaseService,
  ) { }

  /**
   * MÉTODO: CREAR SERVICIO CON TICKET AUTOMÁTICO (Para Frontend Cliente)
   * Crea un servicio y su ticket de instalación asociado en una operación atómica.
   * El servicio se crea con status 'pending' y se genera automáticamente un ticket de tipo 'work_order'.
   */
  async createWithTicket(user: any, dto: CreateServiceWithTicketDto) {
    const supabase = this.supabaseService.getClient();

    // 1. Obtener customer_id desde el usuario autenticado
    const { data: customer, error: cError } = await supabase
      .from('customers')
      .select('id')
      .eq('user_id', user.userId)
      .maybeSingle();

    if (cError || !customer) {
      throw new BadRequestException('No se encontró un perfil de cliente asociado a este usuario.');
    }

    // 2. Obtener el plan para obtener el precio y nombre
    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('id, price, name')
      .eq('id', dto.plan_id)
      .single();

    if (planError || !plan) {
      throw new BadRequestException('Plan no encontrado');
    }

    // 3. Crear el servicio con status 'pending'. billing_day no se asigna hasta la activación.
    const newService = {
      customer_id: customer.id,
      plan_id: dto.plan_id,
      address_text: dto.address_text,
      latitude: dto.latitude || null,
      longitude: dto.longitude || null,
      status: 'pending', // Estado inicial pendiente
      billing_day: null, // Solo se define al pasar a active (evita facturación de servicios pending)
      monthly_amount: plan.price,
    };

    const { data: service, error: serviceError } = await supabase
      .from(this.table)
      .insert([newService])
      .select()
      .single();

    if (serviceError) {
      this.logger.error(`Error creando servicio: ${serviceError.message}`);
      throw new BadRequestException(`Error al crear el servicio: ${serviceError.message}`);
    }

    // 4. Crear el ticket de tipo 'work_order' asociado al servicio
    const ticketSubject = dto.ticket_subject || `Instalación de nuevo servicio - Plan ${plan.name || plan.id.slice(0, 8)}`;
    const ticketData = {
      customer_id: customer.id,
      type: 'work_order',
      subject: ticketSubject,
      description: dto.ticket_description || `Solicitud de instalación en: ${dto.address_text}`,
      services_id: service.id,
      priority: dto.ticket_priority || 'medium',
      status: 'open',
      technician_id: null,
      category: 'instalacion',
      requires_maintenance: false,
    };

    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .insert([ticketData])
      .select()
      .single();

    if (ticketError) {
      // Si falla la creación del ticket, eliminamos el servicio creado (rollback manual)
      this.logger.error(`Error creando ticket: ${ticketError.message}. Eliminando servicio ${service.id}`);
      await supabase.from(this.table).delete().eq('id', service.id);
      throw new BadRequestException(`Error al crear el ticket de instalación: ${ticketError.message}`);
    }

    this.logger.log(`✅ Servicio ${service.id} y ticket ${ticket.id} creados exitosamente`);

    // 5. Retornar ambos objetos creados
    return {
      message: 'Servicio y orden de trabajo creados exitosamente',
      service: service,
      ticket: ticket,
    };
  }

  /**
   * MÉTODO: CREAR INSTALACIÓN
   * 1. Guarda el servicio localmente (status puede ser 'pending', 'active' o 'suspended').
   * 
   * NOTA: Si no se especifica status, por defecto será 'active' para creación directa por admin/técnico.
   */
  async create(createServiceDto: CreateServiceDto) {
    const supabase = this.supabaseService.getClient();

    // 1. Preparar registro local
    // Si no se especifica status, por defecto 'active' (creación directa por admin/técnico)
    const newService = {
      ...createServiceDto,
      status: createServiceDto.status || 'active', // Por defecto 'active' si no se especifica
      billing_day: createServiceDto.billing_day || new Date().getDate()
    };

    const { data: service, error } = await supabase
      .from(this.table)
      .insert([newService])
      .select()
      .single();

    if (error) {
      throw new BadRequestException(`Error en DB local: ${error.message}`);
    }


    return this.findOne(service.id);
  }

  async findMyServices(userId: string) {
    const supabase = this.supabaseService.getClient();
    const { data: customer } = await supabase
      .from('customers').select('id').eq('user_id', userId).single();

    if (!customer) return [];

    const { data, error } = await supabase
      .from(this.table)
      .select('*, plan:plans(name, price, download_speed, upload_speed)')
      .eq('customer_id', customer.id);

    if (error) throw new BadRequestException(error.message);
    return this.excludeOrphanPendingServices(supabase, data ?? []);
  }

  async findOne(id: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from(this.table)
      .select(`
        *,
        customer:customers(id, full_name, document_number, user_id),
        plan:plans(name, price)
      `)
      .eq('id', id)
      .single();

    if (error || !data) throw new NotFoundException('Servicio no encontrado');
    return data;
  }

  async findAll() {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from(this.table)
      .select('*, customer:customers(full_name, document_number), plan:plans(name, price)');

    if (error) throw new BadRequestException(error.message);
    return this.excludeOrphanPendingServices(supabase, data ?? []);
  }

  /**
   * Excluye servicios en estado 'pending' que no tienen ticket asociado (huérfanos).
   * Evita que aparezcan en selector de mantenimiento/avería.
   */
  private async excludeOrphanPendingServices(supabase: ReturnType<SupabaseService['getClient']>, services: any[]) {
    const pendingIds = services.filter(s => s.status === 'pending').map(s => s.id);
    if (pendingIds.length === 0) return services;

    const { data: ticketRefs } = await supabase
      .from('tickets')
      .select('services_id')
      .not('services_id', 'is', null);
    const validIds = new Set((ticketRefs ?? []).map((t: { services_id: string }) => t.services_id));

    return services.filter(s => s.status !== 'pending' || validIds.has(s.id));
  }


  async update(id: string, updateServiceDto: UpdateServiceDto) {
    const supabase = this.supabaseService.getClient();

    const { data: current, error: fetchErr } = await supabase
      .from(this.table)
      .select('id, status, billing_day')
      .eq('id', id)
      .single();

    if (fetchErr || !current) throw new NotFoundException('Servicio no encontrado');

    const newStatus = updateServiceDto.status ?? current.status;
    const isTransitionToActive = current.status === 'pending' && newStatus === 'active';
    const needsBillingDay = isTransitionToActive && (current.billing_day == null || current.billing_day === undefined);

    const payload: Record<string, unknown> = { ...updateServiceDto };
    if (needsBillingDay) {
      const day = updateServiceDto.billing_day ?? new Date().getDate();
      const clamped = Math.min(31, Math.max(1, day));
      payload.billing_day = clamped;
    }

    const { data, error } = await supabase
      .from(this.table)
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async remove(id: string) {
    const supabase = this.supabaseService.getClient();
    const service = await this.findOne(id);

    const { error: deleteError } = await supabase.from(this.table).delete().eq('id', id);
    if (deleteError) throw new BadRequestException(deleteError.message);

    // Verificar si el cliente se quedó sin servicios
    const { count } = await supabase
      .from(this.table)
      .select('*', { count: 'exact', head: true })
      .eq('customer_id', service.customer_id);

    if (count === 0) {
      await supabase.from('customers').update({ status: 'suspended' }).eq('id', service.customer_id);
    }

    return { deleted: true };
  }


}