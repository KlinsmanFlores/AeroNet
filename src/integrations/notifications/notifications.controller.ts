import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { NotificationService } from './notification.service';

export class SendAccessMessageDto {
    phone: string;
    clientName: string;
    email: string;
    password: string;
}

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
    /** Inyecta NotificationService para envío de WhatsApp y correo. */
    constructor(private readonly notificationService: NotificationService) {}

    /** POST send-access-message: envía por WhatsApp credenciales y mensaje de validación al cliente (solo admin). */
    @Post('send-access-message')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('admin')
    @ApiOperation({ summary: 'Envía por WhatsApp credenciales y mensaje de validación de correo al cliente' })
    async sendAccessMessage(@Body() dto: SendAccessMessageDto) {
        const sent = await this.notificationService.sendAccessMessage(
            dto.phone,
            dto.clientName,
            dto.email,
            dto.password,
        );
        return { success: sent, message: sent ? 'Mensaje enviado' : 'Error al enviar WhatsApp' };
    }
}
