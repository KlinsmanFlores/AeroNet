import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * RolesGuard: Protector de rutas encargado de la autorización.
 * Verifica si el usuario autenticado posee los privilegios necesarios
 * definidos mediante el decorador @Roles.
 */
@Injectable()
export class RolesGuard implements CanActivate {
    /** Inyecta Reflector para leer los roles definidos con @Roles en el handler. */
    constructor(private reflector: Reflector) {}

    /**
     * Método de activación que determina si la petición puede continuar.
     * @param context Proporciona detalles sobre la ejecución actual (Request/Response).
     * @returns boolean: true si tiene acceso, false de lo contrario.
     */
    canActivate(context: ExecutionContext): boolean {
        const roles = this.reflector.get<string[]>('roles', context.getHandler());
        if (!roles) {
            return true;
        }

        const request = context.switchToHttp().getRequest();
        const user = request.user; 
    
        return roles.includes(user?.role);
    }
}