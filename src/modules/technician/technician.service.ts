import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase.service';
import { CreateTechnicianDto } from './dto/create-technician.dto';
import { UpdateTechnicianDto } from './dto/update-technician.dto';

@Injectable()
export class TechnicianService {
  private readonly logger = new Logger(TechnicianService.name);
  private readonly table = 'technicians';

  /** Inyecta SupabaseService para Auth y tabla technicians. */
  constructor(private readonly supabaseService: SupabaseService) {}

  /** Crea un técnico: registro en Supabase Auth, auth_users y tabla technicians. */
  async create(createTechnicianDto: CreateTechnicianDto) {
    const { email, password, full_name, phone, zone } = createTechnicianDto;
    const supabase = this.supabaseService.getClient();

    try {
      // PASO 0: Verificar rol 'technician'
      const { data: roleData, error: roleError } = await supabase
        .from('role')
        .select('id')
        .eq('name', 'technician')
        .single();

      if (roleError || !roleData) {
        throw new BadRequestException('El rol "technician" no existe en la tabla role');
      }

      // PASO 1: Crear en Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (authError || !authData?.user) {
        throw new BadRequestException(`Error en Auth: ${authError.message}`);
      }

      const authUserId = authData.user.id;

      // PASO 2: Insertar en auth_users
      const { error: authUsersError } = await supabase
        .from('auth_users')
        .insert([{
          id: authUserId,
          role_id: roleData.id,
          status: 'active',
        }]);

      if (authUsersError) {
        throw new BadRequestException(`Error en auth_users: ${authUsersError.message}`);
      }

      // PASO 3: Insertar en technicians
      const { data: technicianData, error: technicianError } = await supabase
        .from(this.table)
        .insert([{
          user_id: authUserId,
          email: email,
          full_name: full_name,
          phone: phone || null,
          zone: zone || null,
          status: 'active',
        }])
        .select()
        .single();

      if (technicianError) {
        throw new BadRequestException(`Error en technicians: ${technicianError.message}`);
      }

      return {
        message: 'Técnico creado exitosamente',
        technician: technicianData,
      };
    } catch (error) {
      this.logger.error(`Error: ${error.message}`);
      throw error;
    }
  }

  /** Lista todos los técnicos desde la tabla technicians. */
  async findAll() {
    const supabase = this.supabaseService.getClient();
    // No usamos .order('created_at') porque la tabla no tiene esa columna
    const { data, error } = await supabase
      .from(this.table)
      .select('*');

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /** Obtiene un técnico por ID. */
  async findOne(id: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from(this.table)
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) throw new NotFoundException('Técnico no encontrado');
    return data;
  }

  /** Obtiene el técnico asociado al user_id de Auth. */
  async findByUserId(userId: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from(this.table)
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) throw new NotFoundException('Perfil no encontrado');
    return data;
  }

  /** Actualiza un técnico por ID con los campos del DTO. */
  async update(id: string, updateTechnicianDto: UpdateTechnicianDto) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from(this.table)
      .update(updateTechnicianDto)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /** Elimina un técnico por ID de la base de datos. */
  async remove(id: string) {
    const supabase = this.supabaseService.getClient();
    const { error } = await supabase
      .from(this.table)
      .delete()
      .eq('id', id);

    if (error) throw new BadRequestException(error.message);
    return { message: 'Técnico eliminado' };
  }
}