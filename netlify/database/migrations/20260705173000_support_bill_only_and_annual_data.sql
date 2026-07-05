-- v9: direct bill route may create a document-only record before a contact method is provided.
-- Keep the original manual-flow columns, but allow them to be completed later through WhatsApp or a follow-up form.
ALTER TABLE econ_leads
  ALTER COLUMN full_name DROP NOT NULL,
  ALTER COLUMN phone_normalized DROP NOT NULL,
  ALTER COLUMN email DROP NOT NULL,
  ALTER COLUMN full_address DROP NOT NULL;

-- Structured annual values must remain distinct from period invoice values.
ALTER TABLE econ_leads
  ADD COLUMN IF NOT EXISTS declared_annual_kwh NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS declared_annual_spend NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS intake_mode VARCHAR(30),
  ADD COLUMN IF NOT EXISTS bill_pod VARCHAR(40);

CREATE INDEX IF NOT EXISTS idx_econ_leads_intake_activity
  ON econ_leads (intake_mode, last_activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_econ_leads_bill_pod
  ON econ_leads (bill_pod)
  WHERE bill_pod IS NOT NULL;
