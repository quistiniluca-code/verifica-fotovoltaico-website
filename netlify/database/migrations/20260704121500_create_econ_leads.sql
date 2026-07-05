CREATE TABLE IF NOT EXISTS econ_leads (
  id UUID PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  phone_normalized VARCHAR(20) NOT NULL UNIQUE,
  email VARCHAR(254) NOT NULL,
  full_address VARCHAR(320) NOT NULL,
  city VARCHAR(120),
  property_type VARCHAR(30),
  roof_availability VARCHAR(30),
  consumption_mode VARCHAR(30),
  consumption_value NUMERIC(12,2),
  estimated_annual_kwh NUMERIC(12,2),
  estimated_monthly_spend NUMERIC(12,2),
  privacy_notice_version VARCHAR(100) NOT NULL,
  privacy_seen_at TIMESTAMPTZ NOT NULL,
  attribution JSONB NOT NULL DEFAULT '{}'::jsonb,
  form_version VARCHAR(100),
  client_session_id VARCHAR(150),
  lead_score SMALLINT NOT NULL DEFAULT 0 CHECK (lead_score BETWEEN 0 AND 100),
  status VARCHAR(30) NOT NULL DEFAULT 'new',
  assigned_to VARCHAR(120),
  last_report JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_econ_leads_status_activity
  ON econ_leads (status, last_activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_econ_leads_city
  ON econ_leads (city);

CREATE TABLE IF NOT EXISTS econ_lead_events (
  id UUID PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES econ_leads(id) ON DELETE CASCADE,
  event_type VARCHAR(80) NOT NULL,
  client_event_id VARCHAR(150) NOT NULL UNIQUE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_econ_lead_events_lead_created
  ON econ_lead_events (lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS econ_documents (
  id UUID PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES econ_leads(id) ON DELETE CASCADE,
  blob_key TEXT NOT NULL UNIQUE,
  original_filename VARCHAR(180) NOT NULL,
  mime_type VARCHAR(80) NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 7340032),
  sha256 CHAR(64) NOT NULL,
  source VARCHAR(80) NOT NULL,
  assessment JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(40) NOT NULL DEFAULT 'received',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retention_until TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_econ_documents_lead_hash
  ON econ_documents (lead_id, sha256);

CREATE INDEX IF NOT EXISTS idx_econ_documents_retention
  ON econ_documents (retention_until);
