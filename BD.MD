-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE aeronet.role (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name character varying NOT NULL UNIQUE,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT role_pkey PRIMARY KEY (id)
);
CREATE TABLE aeronet.auth_users (
  id uuid NOT NULL,
  role_id uuid,
  status character varying DEFAULT 'active'::character varying,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT auth_users_pkey PRIMARY KEY (id),
  CONSTRAINT auth_users_role_id_fkey FOREIGN KEY (role_id) REFERENCES aeronet.role(id)
);
CREATE TABLE aeronet.customers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  document_type character varying,
  document_number character varying,
  full_name character varying NOT NULL,
  phone character varying,
  email character varying NOT NULL,
  billing_document_type character varying DEFAULT 'BOLETA'::character varying,
  avatar_url text,
  address text,
  city character varying,
  state character varying,
  postal_code character varying,
  status character varying DEFAULT 'active'::character varying,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT customers_pkey PRIMARY KEY (id),
  CONSTRAINT customers_user_id_fkey FOREIGN KEY (user_id) REFERENCES aeronet.auth_users(id)
);
CREATE TABLE aeronet.plans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name character varying NOT NULL,
  speed_mbps integer NOT NULL,
  price numeric NOT NULL,
  description text,
  status character varying DEFAULT 'active'::character varying,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT plans_pkey PRIMARY KEY (id)
);
CREATE TABLE aeronet.services (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id uuid,
  plan_id uuid,
  address_text text NOT NULL,
  latitude numeric,
  longitude numeric,
  status USER-DEFINED DEFAULT 'pending'::aeronet.service_status,
  billing_day integer CHECK (billing_day >= 1 AND billing_day <= 31),
  monthly_amount numeric NOT NULL,
  sync_status character varying,
  installation_date timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT services_pkey PRIMARY KEY (id),
  CONSTRAINT services_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES aeronet.customers(id),
  CONSTRAINT services_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES aeronet.plans(id)
);
CREATE TABLE aeronet.technicians (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  full_name character varying NOT NULL,
  phone character varying,
  document_number character varying,
  email character varying,
  status character varying DEFAULT 'active'::character varying,
  specialization character varying,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT technicians_pkey PRIMARY KEY (id),
  CONSTRAINT technicians_user_id_fkey FOREIGN KEY (user_id) REFERENCES aeronet.auth_users(id)
);
CREATE TABLE aeronet.tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  type USER-DEFINED NOT NULL,
  subject character varying,
  description text NOT NULL,
  service_id uuid,
  customer_id uuid,
  technician_id uuid,
  category USER-DEFINED NOT NULL,
  requested_plan uuid,
  priority USER-DEFINED DEFAULT 'medium'::aeronet.ticket_priority,
  requires_maintenance boolean DEFAULT false,
  status character varying DEFAULT 'open'::character varying,
  resolution_notes text,
  scheduled_date timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT tickets_pkey PRIMARY KEY (id),
  CONSTRAINT tickets_service_id_fkey FOREIGN KEY (service_id) REFERENCES aeronet.services(id),
  CONSTRAINT tickets_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES aeronet.customers(id),
  CONSTRAINT tickets_technician_id_fkey FOREIGN KEY (technician_id) REFERENCES aeronet.technicians(id),
  CONSTRAINT tickets_requested_plan_fkey FOREIGN KEY (requested_plan) REFERENCES aeronet.plans(id)
);
CREATE TABLE aeronet.invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL,
  period character varying NOT NULL,
  total numeric NOT NULL,
  subtotal numeric,
  igv numeric,
  status character varying DEFAULT 'pending'::character varying,
  due_date date NOT NULL,
  payment_link text,
  checkout_id character varying,
  qr_code_url text,
  short_payment_url text,
  mp_qr_code text,
  notification_count integer DEFAULT 0,
  last_notification_date timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT invoices_pkey PRIMARY KEY (id),
  CONSTRAINT invoices_service_id_fkey FOREIGN KEY (service_id) REFERENCES aeronet.services(id)
);
CREATE TABLE aeronet.payments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id uuid,
  service_id uuid,
  amount_received numeric NOT NULL,
  payment_method character varying,
  transaction_reference character varying UNIQUE,
  raw_webhook_data jsonb,
  provider character varying,
  payment_mode character varying,
  checkout_id character varying,
  status character varying DEFAULT 'completed'::character varying,
  payment_date timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT payments_pkey PRIMARY KEY (id),
  CONSTRAINT payments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES aeronet.customers(id),
  CONSTRAINT payments_service_id_fkey FOREIGN KEY (service_id) REFERENCES aeronet.services(id)
);
CREATE TABLE aeronet.payment_allocations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  payment_id uuid,
  invoice_id uuid,
  amount_applied numeric NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT payment_allocations_pkey PRIMARY KEY (id),
  CONSTRAINT payment_allocations_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES aeronet.payments(id),
  CONSTRAINT payment_allocations_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES aeronet.invoices(id)
);
CREATE TABLE aeronet.electronic_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id uuid,
  payment_id uuid,
  type character varying,
  series character varying,
  number integer,
  external_id character varying,
  pdf_url text,
  xml_url text,
  sunat_status character varying DEFAULT 'pending'::character varying,
  response_data jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT electronic_documents_pkey PRIMARY KEY (id),
  CONSTRAINT electronic_documents_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES aeronet.invoices(id),
  CONSTRAINT electronic_documents_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES aeronet.payments(id)
);
CREATE TABLE aeronet.whatsapp_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  phone character varying,
  template_name character varying,
  status character varying,
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT whatsapp_logs_pkey PRIMARY KEY (id)
);