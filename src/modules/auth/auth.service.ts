import { BadRequestException, Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase.service'; 
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    /** Inyecta SupabaseService y JwtService para Auth y generación de tokens. */
    constructor(
        private readonly supabaseService: SupabaseService,
        private readonly jwtServices: JwtService, 
    ) {}

    /** Registra un cliente: Supabase Auth, auth_users (rol customer) y tabla customers. */
    async clientRegister(registerDto: Omit<RegisterDto, 'role_name'> & { full_name: string }) {
        const { email, password, full_name } = registerDto;
        const supabase = this.supabaseService.getClient();

        try {
            // PASO 0: Obtener el ID del rol 'prospect' (necesario para auth_users)
            const { data: roleData } = await supabase
                .from('role')
                .select('id')
                .eq('name', 'prospect')
                .single();

            if (!roleData) throw new BadRequestException('El rol prospect no existe');

            // PASO 1: Registro en Supabase Auth
            // Al NO haber Trigger, esto NO dará el error "Database error saving new user"
            const { data: authData, error: authError } = await supabase.auth.signUp({
                email,
                password,
                options: { data: { full_name } }
            });

            if (authError || !authData?.user) {
                throw new BadRequestException(`Error en Auth: ${authError?.message}`);
            }

            const authUserId = authData.user.id;

            // PASO 2: Insertar en auth_users (Esquema AeroNet)
            // Vinculamos el UUID de Auth con el rol y el estado
            const { error: roleLinkError } = await supabase
                .from('auth_users')
                .insert([{
                    id: authUserId,
                    role_id: roleData.id,
                    status: 'active'
                }]);

            if (roleLinkError) {
                this.logger.error(`Error vinculando rol: ${roleLinkError.message}`);
            }

            return { 
                message: 'Registro de prospecto exitoso', 
                user_id: authUserId 
            };

        } catch (error) {
            this.logger.error(`Fallo total: ${error.message}`);
            throw error;
        }
    }

    /**
     * Registro Administrativo (Solo Staff)
     */
    async register(registerDto: RegisterDto) {
        const { email, password, role_name } = registerDto;
        const supabase = this.supabaseService.getClient();

        try {
            const { data: roleData, error: roleError } = await supabase
                .from('role') 
                .select('id')
                .eq('name', role_name)
                .single();

            if (roleError || !roleData) throw new BadRequestException(`El rol "${role_name}" no existe`);

            const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });

            if (authError || !authData?.user) throw new BadRequestException(authError?.message);

            const { error: profileError } = await supabase
                .from('auth_users') 
                .insert([{
                    id: authData.user.id,
                    role_id: roleData.id,
                    status: 'active',
                }]);

            if (profileError) throw new BadRequestException('Error al crear el perfil administrativo');

            return { 
                message: `Usuario ${email} creado correctamente como ${role_name}`,
                user_id: authData.user.id 
            };
        } catch (error) {
            throw error; 
        }
    }

    /**
     * Login: Valida credenciales y genera token JWT
     */
    async login(loginDto: LoginDto) {
        const { email, password } = loginDto;
        const supabase = this.supabaseService.getClient();

        try {
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email,
                password
            });

            if (authError || !authData?.user) {
                throw new UnauthorizedException('Correo o contraseña incorrectos');
            }

            // Obtener perfil y rol del usuario
            const { data: userProfile, error: profileError } = await supabase
                .from('auth_users')
                .select('role_id')
                .eq('id', authData.user.id)
                .single();

            if (profileError || !userProfile) {
                throw new BadRequestException('El usuario no tiene un perfil asignado');
            }

            const { data: roleData, error: roleError } = await supabase
                .from('role')
                .select('name')
                .eq('id', userProfile.role_id)
                .single();

            if (roleError || !roleData) {
                throw new BadRequestException('No se pudo identificar el rol del usuario');
            }

            // Generar Payload y Token
            const payload = { 
                email: authData.user.email, 
                sub: authData.user.id, 
                role: roleData.name 
            };

            return {
                access_token: this.jwtServices.sign(payload),
                user: {
                    id: authData.user.id,
                    email: authData.user.email,
                    role: roleData.name
                }
            };

        } catch (err) {
            this.logger.error('Error en Login:', err.message);
            throw err; 
        }
    }
}