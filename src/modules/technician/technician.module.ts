import { Module } from '@nestjs/common';
import { TechnicianService } from './technician.service';
import { TechnicianController } from './technician.controller';
import { SupabaseModule } from '../../supabase.module';

@Module({
  imports: [
    SupabaseModule, // 👈 acceso al cliente Supabase
  ],
  controllers: [TechnicianController],
  providers: [TechnicianService],
  exports: [TechnicianService],
})
export class TechnicianModule {}
