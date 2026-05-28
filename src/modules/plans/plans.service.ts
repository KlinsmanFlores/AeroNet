import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';


/**
 * SERVICIO DE PERSISTENCIA DE PLANES
 * Encargado de la comunicación directa con la tabla 'plans' en Supabase.
 * Implementa la lógica CRUD para la gestión del catálogo de servicios.
 */
@Injectable()
export class PlansService {

  private readonly logger = new Logger(PlansService.name);

  /** Inyecta SupabaseService para planes. */
  constructor(
    private readonly supabaseService: SupabaseService,
  ) {}
  
  // Nombre de la tabla centralizado para facilitar cambios futuros.
  private readonly table = 'plans';





  /**
   * CREATE: Registra un nuevo plan en el catálogo.
   * Retorna el objeto creado con su respectivo ID generado por la base de datos.
   */
  async create(createPlanDto: CreatePlanDto) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from(this.table)
      .insert([createPlanDto])
      .select()
      .single();

    if (error) {
      // Manejo de errores de base de datos (ej. nombres duplicados).
      throw new BadRequestException(`Error al crear el plan: ${error.message}`);
    }

    return data;
  }

  /**
   * READ (All): Recupera todos los planes.
   * Ordena por precio de forma ascendente para una mejor visualización en el frontend.
   */
  async findAll() {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from(this.table)
      .select('*')
      .order('price', { ascending: true });

    if (error) {
      throw new BadRequestException(`Error al listar planes: ${error.message}`);
    }

    return data;
  }

  /**
   * READ (One): Busca un plan específico por su identificador UUID.
   * Lanza una excepción 404 si el plan no existe en AeroNet.
   */
  async findOne(id: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from(this.table)
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException(`El plan con ID ${id} no fue encontrado`);
    }
    
    return data;
  }

  /**
   * UPDATE: Actualiza parcialmente los datos de un plan existente.
   * Utiliza el ID para localizar el registro y aplica los cambios del DTO.
   */
  async update(id: string, updatePlanDto: UpdatePlanDto) {
    // Verificamos primero si existe antes de intentar actualizar.
    await this.findOne(id);

    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from(this.table)
      .update(updatePlanDto)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new BadRequestException(`Error al actualizar el plan: ${error.message}`);
    }
    
    return data;
  }

  /**
   * DELETE: Elimina un plan del catálogo.
   * Nota: En sistemas de producción se recomienda el "borrado lógico" (soft delete), 
   * pero aquí ejecutamos la eliminación física según requerimiento.
   */
  async remove(id: string) {
    // Verificamos existencia previa para lanzar el error correspondiente si no existe.
    await this.findOne(id);

    const supabase = this.supabaseService.getClient();
    const { error } = await supabase
      .from(this.table)
      .delete()
      .eq('id', id);

    if (error) {
      throw new BadRequestException(`Error al eliminar el plan: ${error.message}`);
    }
    
    return { 
      message: 'Plan eliminado exitosamente',
      deleted: true 
    };
  }
}