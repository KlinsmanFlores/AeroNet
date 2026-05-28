import { Injectable } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

@Injectable()
export class AppService {
  constructor(private readonly supabaseService: SupabaseService) {}

  /** Prueba la conexión a la base AeroNet consultando la tabla role; devuelve estado y roles o error. */
  async testConnection() {
    const client = this.supabaseService.getClient();
    
    // Forzamos el esquema aeronet explícitamente solo para esta prueba de diagnóstico
    const { data, error } = await client
      .schema('aeronet') 
      .from('role')
      .select('*');
      
    if (error) {
      console.error('Error detallado:', error);
      return { status: 'Error', message: error.message, hint: error.hint };
    }
    
    return { status: 'Conectado a AeroNet DB', roles: data };
  }
}