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
            // PASO 1: Registro en Supabase Auth
            const { data: authData, error: authError } = await supabase.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
                user_metadata: { full_name }
            });

            if (authError || !authData?.user) {
                throw new BadRequestException(`Error en Auth: ${authError?.message}`);
            }

            const authUserId = authData.user.id;

            // PASO 2: Upsert en auth_users sin rol específico aún (role_id = null)
            const { error: roleLinkError } = await supabase
                .from('auth_users')
                .upsert({
                    id: authUserId,
                    role_id: null,
                    status: 'active'
                });

            if (roleLinkError) {
                this.logger.error(`Error en auth_users: ${roleLinkError.message}`);
                // No lanzamos error para no bloquear si ya se creó en auth
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

            const { data: authData, error: authError } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });

            if (authError || !authData?.user) throw new BadRequestException(authError?.message);

            const { error: profileError } = await supabase
                .from('auth_users') 
                .upsert({
                    id: authData.user.id,
                    role_id: roleData.id,
                    status: 'active',
                });

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

            let roleName = 'prospect'; // Rol por defecto si no tiene rol asignado en la BD

            // Obtener el perfil del usuario para ver su rol
            const { data: userProfile } = await supabase
                .from('auth_users')
                .select('role_id')
                .eq('id', authData.user.id)
                .single();

            if (userProfile && userProfile.role_id) {
                const { data: roleData } = await supabase
                    .from('role')
                    .select('name')
                    .eq('id', userProfile.role_id)
                    .single();
                
                if (roleData) {
                    roleName = roleData.name;
                }
            }

            // Generar Payload y Token
            const payload = { 
                email: authData.user.email, 
                sub: authData.user.id, 
                role: roleName 
            };

            return {
                access_token: this.jwtServices.sign(payload),
                user: {
                    id: authData.user.id,
                    email: authData.user.email,
                    role: roleName
                }
            };

        } catch (err) {
            this.logger.error('Error en Login:', err.message);
            throw err; 
        }
    }
}