import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private supabase: SupabaseClient<any, "aeronet">;
  private readonly logger = new Logger('SupabaseService');

  /** Inicializa el cliente de Supabase con URL y clave del entorno (esquema aeronet). */
  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;

    if (!url || !key) {
      throw new Error('Faltan las variables SUPABASE_URL o SUPABASE_KEY');
    }

    this.supabase = createClient<any, "aeronet">(url, key, {
      db: { schema: 'aeronet' },
    });
  }

  /** Se ejecuta al iniciar el servidor: verifica conexión a la base AeroNet (tabla role). */
  async onModuleInit() {
    try {
      // Intentamos una consulta rápida a la tabla role
      const { data, error } = await this.supabase
        .from('role')
        .select('name')
        .limit(1);

      if (error) {
        this.logger.error(`Error de conexión a AeroNet DB: ${error.message}`);
      } else {
        // Este mensaje aparecerá en tu CMD al hacer 'docker-compose up'
        this.logger.log('✅ Conectado exitosamente al esquema AERONET de Supabase');
      }
    } catch (err) {
      this.logger.error('Fallo crítico al conectar con Supabase');
    }
  }

  /** Devuelve el cliente de Supabase para ejecutar consultas en el esquema aeronet. */
  getClient() {
    return this.supabase;
  }
}