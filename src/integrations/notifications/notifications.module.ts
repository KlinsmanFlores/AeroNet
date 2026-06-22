import { Module, Global } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';
import { SupabaseModule } from '../../supabase.module';

@Global()
@Module({
    imports: [SupabaseModule],
    controllers: [NotificationsController],
    providers: [NotificationService],
    exports: [NotificationService],
})
export class NotificationModule {}