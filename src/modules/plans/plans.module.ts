import { Module } from '@nestjs/common';
import { PlansService } from './plans.service';
import { PlansController } from './plans.controller';
import { SupabaseModule } from '../../supabase.module';


@Module({
  imports: [
    SupabaseModule,
  ],
  controllers: [PlansController],
  providers: [PlansService],
})
export class PlansModule { }
