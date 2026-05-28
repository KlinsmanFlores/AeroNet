import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class WhatsappBaileysService {
  private readonly logger = new Logger(WhatsappBaileysService.name);

  /**
   * Normaliza teléfono peruano: elimina no dígitos y agrega prefijo 51.
   * En Baileys generalmente se añade '@s.whatsapp.net' al final.
   */
  private normalizePhone(phone: string): string {
    const digits = String(phone ?? '').replace(/\D/g, '');
    const number = digits.startsWith('51') ? digits : `51${digits}`;
    // return `${number}@s.whatsapp.net`; // Se usará cuando se integre Baileys
    return number;
  }

  /**
   * Envía un mensaje de texto simple.
   */
  async sendTextMessage(to: string, text: string): Promise<boolean> {
    const finalPhone = this.normalizePhone(to);
    
    // --- STUB PARA BAILEYS ---
    this.logger.log(`[BAILEYS-STUB] Texto simulado a ${finalPhone}: ${text.replace(/\n/g, ' ')}`);
    
    // Aquí irá el código real de envío:
    // await this.baileysSock.sendMessage(finalPhone + '@s.whatsapp.net', { text });
    
    return true; // Fingimos éxito
  }

  /**
   * Envía un mensaje con imagen adjunta.
   */
  async sendMediaMessage(to: string, imageUrl: string, caption: string): Promise<boolean> {
    const finalPhone = this.normalizePhone(to);
    
    // --- STUB PARA BAILEYS ---
    this.logger.log(`[BAILEYS-STUB] Media simulada a ${finalPhone} | URL: ${imageUrl} | Caption: ${caption.replace(/\n/g, ' ')}`);
    
    // Aquí irá el código real de envío:
    // await this.baileysSock.sendMessage(finalPhone + '@s.whatsapp.net', { image: { url: imageUrl }, caption });
    
    return true; // Fingimos éxito
  }
}
