import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    /** Configura la estrategia JWT: extrae el token del header Bearer y usa JWT_SECRET. */
    constructor() {
        const jwtSecret = process.env.JWT_SECRET;

        if (!jwtSecret) {
        console.error('ALERTA: JWT_SECRET no llegó a la Estrategia en Docker');
        }

        super({
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        ignoreExpiration: false,
        secretOrKey: jwtSecret as string,
        });
    }

    /** Devuelve el usuario que se adjunta a request.user (userId, email, role). */
    async validate(payload: any) {
        return { 
        userId: payload.sub, 
        email: payload.email, 
        role: payload.role 
        };
    }
}