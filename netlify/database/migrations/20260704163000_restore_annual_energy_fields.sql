-- Restore annual energy inputs in the manual lead path.
-- Values are explicitly stored rather than inferred from an OCR document.
ALTER TABLE econ_leads ADD COLUMN IF NOT EXISTS declared_annual_kwh NUMERIC(12,2);
ALTER TABLE econ_leads ADD COLUMN IF NOT EXISTS declared_annual_spend NUMERIC(12,2);

CREATE INDEX IF NOT EXISTS idx_econ_leads_declared_annual_kwh
  ON econ_leads (declared_annual_kwh DESC NULLS LAST);
