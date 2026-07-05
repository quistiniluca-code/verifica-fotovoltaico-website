-- Address-first intake: preserve historic lead data while making legacy qualification fields optional.
ALTER TABLE econ_leads ADD COLUMN IF NOT EXISTS email VARCHAR(254);
ALTER TABLE econ_leads ADD COLUMN IF NOT EXISTS full_address VARCHAR(320);
ALTER TABLE econ_leads ALTER COLUMN city DROP NOT NULL;
ALTER TABLE econ_leads ALTER COLUMN property_type DROP NOT NULL;
ALTER TABLE econ_leads ALTER COLUMN roof_availability DROP NOT NULL;
ALTER TABLE econ_leads ALTER COLUMN consumption_mode DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_econ_leads_email ON econ_leads (email);
