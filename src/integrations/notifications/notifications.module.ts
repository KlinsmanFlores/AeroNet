import { Module, Global } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';
import { SupabaseModule } from '../../supabase.module';
import { WhatsappBaileysService } from './whatsapp-baileys.service';

@Global()
@Module({
    imports: [SupabaseModule],
    controllers: [NotificationsController],
    providers: [NotificationService, WhatsappBaileysService],
    exports: [NotificationService, WhatsappBaileysService],
})
export class NotificationModule {}