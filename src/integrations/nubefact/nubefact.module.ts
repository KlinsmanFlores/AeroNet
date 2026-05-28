import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NubefactService } from './nubefact.service';
import { nubefactConfig } from './nubefact.config';

@Module({
  imports: [ConfigModule.forFeature(nubefactConfig)],
  providers: [NubefactService],
  exports: [NubefactService],
})
export class NubefactIntegrationModule {}