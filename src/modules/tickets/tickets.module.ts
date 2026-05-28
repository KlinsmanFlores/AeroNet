import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { SupabaseModule } from '../../supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [TicketsController],
  providers: [TicketsService],
})
export class TicketsModule {}
