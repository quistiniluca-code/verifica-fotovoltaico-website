-- Bill-first flow: a recognised bill can start a lead without manual contact fields.
-- Manual leads remain fully qualified; document-only leads are explicitly marked for follow-up.
ALTER TABLE econ_leads ALTER COLUMN full_name DROP NOT NULL;
ALTER TABLE econ_leads ALTER COLUMN phone_normalized DROP NOT NULL;
ALTER TABLE econ_leads ALTER COLUMN email DROP NOT NULL;
ALTER TABLE econ_leads ALTER COLUMN full_address DROP NOT NULL;

ALTER TABLE econ_leads ADD COLUMN IF NOT EXISTS intake_mode VARCHAR(30) NOT NULL DEFAULT 'manual';
ALTER TABLE econ_leads ADD COLUMN IF NOT EXISTS bill_pod VARCHAR(40);

CREATE INDEX IF NOT EXISTS idx_econ_leads_intake_mode_activity
  ON econ_leads (intake_mode, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_econ_leads_bill_pod
  ON econ_leads (bill_pod) WHERE bill_pod IS NOT NULL;
