import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JwtAuthGuard: Interceptor de seguridad de nivel de transporte.
 * Extiende la funcionalidad de @nestjs/passport para validar tokens JWT
 * (JSON Web Tokens) en las peticiones entrantes.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
    /**
     * El constructor y la lógica base son manejados por AuthGuard.
     * Al pasarle la cadena 'jwt', el guard busca automáticamente 
     * la estrategia 'jwt' definida en el módulo de autenticación.
     */
}