import { Controller, Get} from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** GET /test-db: prueba la conexión a la base de datos AeroNet. */
  @Get('test-db')
  getTest() {
    return this.appService.testConnection();
  }

  /** GET /health: responde estado ok para comprobar que el backend está en marcha. */
  @Get('health')
  health() {
    return { status: 'ok', service: 'aeronet-backend' };
    }
  }
