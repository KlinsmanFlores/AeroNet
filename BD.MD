```sql
-- ==========================================
-- SCRIPT DE BASE DE DATOS AERONET (PostgreSQL)
-- Ejecutar en Supabase SQL Editor
-- ==========================================

-- Crear el esquema personalizado
CREATE SCHEMA IF NOT EXISTS aeronet;

-- ==========================================
-- 1. TIPOS ENUMERADOS
-- ==========================================
CREATE TYPE aeronet.ticket_type AS ENUM ('ticket', 'work_order');
CREATE TYPE aeronet.ticket_priority AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE aeronet.ticket_category AS ENUM ('NUEVO_SERVICIO', 'REACTIVACION', 'FACTURACION', 'TRASLADO', 'RECIBO_FISICO', 'RECLAMO', 'SUSPENSION', 'MEJORA_PLAN', 'COBERTURA_WIFI', 'PAUSA_VACACIONES');
CREATE TYPE aeronet.service_status AS ENUM ('pending', 'active', 'suspended');

-- ==========================================
-- 2. TABLAS BASE Y ROLES
-- ==========================================

-- Tabla de Roles
CREATE TABLE aeronet.role (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Semillar Roles requeridos para Auth y Registro
INSERT INTO aeronet.role (name) VALUES
('admin'),
('customer'),
('technician'),
('prospect')
ON CONFLICT (name) DO NOTHING;

-- Tabla de Usuarios (Extensión de auth.users de Supabase)
CREATE TABLE aeronet.auth_users (
    id UUID PRIMARY KEY, -- Referencia manual a auth.users(id) de Supabase
    role_id UUID REFERENCES aeronet.role(id),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 3. MÓDULOS DEL NEGOCIO
-- ==========================================

-- Clientes
CREATE TABLE aeronet.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES aeronet.auth_users(id),
    document_type VARCHAR(20),
    document_number VARCHAR(50),
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(150) NOT NULL,
    billing_document_type VARCHAR(20) DEFAULT 'BOLETA',
    avatar_url TEXT,
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    postal_code VARCHAR(20),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Planes de Internet
CREATE TABLE aeronet.plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    speed_mbps INTEGER NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Servicios (Suscripciones Activas)
CREATE TABLE aeronet.services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES aeronet.customers(id),
    plan_id UUID REFERENCES aeronet.plans(id),
    address_text TEXT NOT NULL,
    latitude DECIMAL(10,6),
    longitude DECIMAL(10,6),
    status aeronet.service_status DEFAULT 'pending',
    billing_day INTEGER CHECK (billing_day >= 1 AND billing_day <= 31),
    monthly_amount DECIMAL(10,2) NOT NULL,
    sync_status VARCHAR(50), -- Requerido por lógica de sincronización e invoices
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Técnicos
CREATE TABLE aeronet.technicians (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES aeronet.auth_users(id),
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(50),
    document_number VARCHAR(50),
    email VARCHAR(150),
    status VARCHAR(20) DEFAULT 'active',
    specialization VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tickets / Órdenes de Trabajo
CREATE TABLE aeronet.tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type aeronet.ticket_type NOT NULL,
    subject VARCHAR(200),
    description TEXT NOT NULL,
    service_id UUID REFERENCES aeronet.services(id),
    customer_id UUID REFERENCES aeronet.customers(id),
    technician_id UUID REFERENCES aeronet.technicians(id),
    category aeronet.ticket_category NOT NULL,
    requested_plan UUID REFERENCES aeronet.plans(id),
    priority aeronet.ticket_priority DEFAULT 'medium',
    requires_maintenance BOOLEAN DEFAULT false,
    status VARCHAR(50) DEFAULT 'open',
    resolution_notes TEXT,
    scheduled_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 4. FACTURACIÓN Y PAGOS (ALINEADO AL BACKEND)
-- ==========================================

-- Facturas / Deudas
CREATE TABLE aeronet.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID REFERENCES aeronet.services(id) NOT NULL,
    period VARCHAR(10) NOT NULL, -- Formato: YYYY-MM
    total DECIMAL(10,2) NOT NULL,
    subtotal DECIMAL(10,2),
    igv DECIMAL(10,2),
    status VARCHAR(50) DEFAULT 'pending',
    due_date DATE NOT NULL,
    payment_link TEXT,
    checkout_id VARCHAR(150), -- Guardar preferencia de Mercado Pago
    qr_code_url TEXT, -- Guardar URL del QR generado
    short_payment_url TEXT, -- Guardar link acortado de Mercado Pago
    mp_qr_code TEXT, -- Guardar código EMVCo del QR de Mercado Pago
    notification_count INTEGER DEFAULT 0,
    last_notification_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Función y Trigger para calcular el IGV automáticamente
CREATE OR REPLACE FUNCTION aeronet.calculate_invoice_igv()
RETURNS trigger AS $$
BEGIN
    NEW.subtotal := NEW.total / 1.18;
    NEW.igv := NEW.total - NEW.subtotal;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_calculate_invoice_igv
BEFORE INSERT OR UPDATE ON aeronet.invoices
FOR EACH ROW EXECUTE FUNCTION aeronet.calculate_invoice_igv();

-- Pagos Realizados
CREATE TABLE aeronet.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES aeronet.customers(id),
    service_id UUID REFERENCES aeronet.services(id),
    amount_received DECIMAL(10,2) NOT NULL,
    payment_method VARCHAR(50), 
    transaction_reference VARCHAR(150) UNIQUE,
    raw_webhook_data JSONB,
    provider VARCHAR(50),
    payment_mode VARCHAR(50),
    checkout_id VARCHAR(150),
    status VARCHAR(50) DEFAULT 'completed',
    payment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Alocaciones de Pago (Reparto FIFO de deudas)
CREATE TABLE aeronet.payment_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID REFERENCES aeronet.payments(id) ON DELETE CASCADE,
    invoice_id UUID REFERENCES aeronet.invoices(id) ON DELETE CASCADE,
    amount_applied DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Comprobantes Electrónicos (Nubefact)
CREATE TABLE aeronet.electronic_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID REFERENCES aeronet.invoices(id) ON DELETE CASCADE,
    payment_id UUID REFERENCES aeronet.payments(id) ON DELETE SET NULL,
    type VARCHAR(50), -- BOLETA o FACTURA
    series VARCHAR(10),
    number INTEGER,
    external_id VARCHAR(150), -- nubefact_id / llave única
    pdf_url TEXT,
    xml_url TEXT,
    sunat_status VARCHAR(50) DEFAULT 'pending',
    response_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 5. LOGS Y COMUNICACIÓN
-- ==========================================

-- Historial de Mensajes WhatsApp Meta
CREATE TABLE aeronet.whatsapp_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(50),
    template_name VARCHAR(100),
    status VARCHAR(50),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```