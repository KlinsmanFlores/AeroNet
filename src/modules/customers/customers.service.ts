import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';


@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);
  private readonly table = 'customers';

  /** Inyecta SupabaseService para clientes. */
  constructor(
    private readonly supabaseService: SupabaseService,
  ) { }

  /** Crea un perfil de cliente en la tabla customers. */
  async create(createCustomerDto: CreateCustomerDto) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from(this.table)
      .insert([createCustomerDto])
      .select()
      .single();

    if (error) throw new BadRequestException(`Error en AeroNet: ${error.message}`);
    return data;
  }

  /** Convierte a un usuario prospecto en cliente fijo, actualizando su rol y creándolo en la tabla customers. */
  async convertProspectToCustomer(userId: string, createCustomerDto: CreateCustomerDto) {
    const supabase = this.supabaseService.getClient();

    // 1. Obtener el ID del rol 'customer'
    const { data: roleData } = await supabase
      .from('role')
      .select('id')
      .eq('name', 'customer')
      .single();

    if (!roleData) throw new BadRequestException('El rol customer no existe en la base de datos');

    // 2. Actualizar el rol en auth_users
    const { error: roleError } = await supabase
      .from('auth_users')
      .update({ role_id: roleData.id })
      .eq('id', userId);

    if (roleError) throw new BadRequestException(`Error al actualizar rol del usuario: ${roleError.message}`);

    // 3. Crear el registro en customers
    const { data, error: customerError } = await supabase
      .from(this.table)
      .insert([{
        ...createCustomerDto,
        user_id: userId
      }])
      .select()
      .single();

    if (customerError) throw new BadRequestException(`Error creando cliente: ${customerError.message}`);

    return { message: 'Prospecto convertido a cliente exitosamente', data };
  }

  /** Lista todos los clientes ordenados por fecha de creación descendente. */
  async findAll() {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from(this.table)
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /** Obtiene un cliente por ID. */
  async findOne(id: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from(this.table)
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) throw new NotFoundException('Cliente no encontrado');
    return data;
  }

  /** Obtiene el cliente asociado al user_id de Auth. */
  async findByUserId(userId: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from(this.table)
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) throw new NotFoundException('Perfil de cliente no encontrado');
    return data;
  }

  /** Actualiza un cliente por ID (excluye user_id y email del DTO). */
  async update(id: string, updateCustomerDto: UpdateCustomerDto) {
    const supabase = this.supabaseService.getClient();
    const { user_id, email, ...dataToUpdate } = updateCustomerDto as any;

    const { data, error } = await supabase
      .from(this.table)
      .update(dataToUpdate)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new BadRequestException(`Error al actualizar: ${error.message}`);
    return data;
  }

  /**
   * Subir foto de perfil: guarda en Storage (bucket avatars) y actualiza avatar_url del cliente.
   * Si la tabla customers no tiene columna avatar_url, hay que añadirla en Supabase.
   */
  async uploadAvatar(userId: string, file: Express.Multer.File) {
    const supabase = this.supabaseService.getClient();
    const customer = await this.findByUserId(userId);
    const ext = file.originalname?.split('.').pop() || 'jpg';
    const fileName = `avatar-${customer.id}-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype || 'image/jpeg',
        upsert: true,
      });

    if (uploadError) {
      this.logger.error(`Storage upload failed: ${uploadError.message}`);
      throw new BadRequestException(`Error al subir la imagen: ${uploadError.message}`);
    }

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(fileName);
    const { data, error } = await supabase
      .from(this.table)
      .update({ avatar_url: publicUrl })
      .eq('id', customer.id)
      .select()
      .single();

    if (error) {
      this.logger.warn(`avatar_url actualizado en Storage pero fallo al guardar en customers: ${error.message}`);
      return { ...customer, avatar_url: publicUrl };
    }
    return data;
  }

  async remove(id: string) {
    const supabase = this.supabaseService.getClient();
    const { error } = await supabase.from(this.table).delete().eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }


}