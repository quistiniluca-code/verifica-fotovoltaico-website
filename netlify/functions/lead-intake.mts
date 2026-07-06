import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import {
  errorMessage,
  json,
  normalizedPhone,
  requestRejected,
  safeRequestId,
  text,
  safeNumber
} from "../lib/shared.mjs";

type LeadRow = { id: string };
type IntakeMode = "manual" | "bill_only";

type DocumentSummary = {
  fileSelected: boolean;
  status: string;
  kwh: number | null;
  kwhScope: string;
  amount: number | null;
  annualKwh: number | null;
  annualSpend: number | null;
  periodKwh: number | null;
  periodAmount: number | null;
  pod: string;
  confidence: number | null;
  extractedName: string;
  fullAddress: string;
};

function optionalEmail(value: unknown): string | null {
  const email = text(value, 254).toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email)) throw new Error("Email non valida.");
  return email;
}

function optionalAddress(value: unknown): string | null {
  const address = text(value, 320);
  if (!address) return null;
  if (address.length < 12 || !/[A-Za-zÀ-ÿ]/.test(address) || !/\d/.test(address)) {
    throw new Error("Indirizzo completo non valido.");
  }
  return address;
}

function optionalPhone(value: unknown): string | null {
  const raw = text(value, 40);
  return raw ? normalizedPhone(raw) : null;
}

function declaredEnergy(value: unknown, required: boolean): { annualKwh: number | null; annualSpend: number | null } {
  const energy = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const annualKwh = safeNumber(energy.annualKwh, 300, 1_000_000);
  const annualSpend = safeNumber(energy.annualSpend, 50, 1_000_000);
  if (required && annualKwh === null) throw new Error("Consumo annuale non valido.");
  if (required && annualSpend === null) throw new Error("Spesa annuale non valida.");
  return { annualKwh, annualSpend };
}

function documentSummary(value: unknown): DocumentSummary {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const status = text(source.status, 30);
  const fileSelected = source.fileSelected === true;
  const kwh = safeNumber(source.kwh, 0, 1_000_000);
  const amount = safeNumber(source.amount, 0, 1_000_000);
  const kwhScope = text(source.kwhScope, 40);
  const annualKwh = safeNumber(source.annualKwh, 100, 1_000_000)
    ?? (kwhScope === "annuo" ? kwh : null);
  const annualSpend = safeNumber(source.annualSpend, 25, 1_000_000);
  const periodKwh = safeNumber(source.periodKwh, 1, 1_000_000)
    ?? (kwhScope === "periodo_fattura" ? kwh : null);
  const periodAmount = safeNumber(source.periodAmount, 1, 1_000_000)
    ?? (amount && !annualSpend ? amount : null);

  return {
    fileSelected,
    status,
    kwh,
    kwhScope,
    amount,
    annualKwh,
    annualSpend,
    periodKwh,
    periodAmount,
    pod: text(source.pod, 40),
    confidence: safeNumber(source.confidence, 0, 1000),
    extractedName: text(source.extractedName, 120),
    fullAddress: text(source.fullAddress, 320)
  };
}

function scoreLead(input: { intakeMode: IntakeMode; address: string | null; email: string | null; annualKwh: number | null; annualSpend: number | null; document: DocumentSummary }): number {
  let score = input.intakeMode === "bill_only" ? 55 : 45;
  if (input.address && input.address.length >= 18) score += 10;
  if (input.document.fileSelected) score += 12;
  if (input.document.pod) score += 5;
  if ((input.annualKwh || 0) >= 2500) score += 12;
  if ((input.annualKwh || 0) >= 5000) score += 6;
  if ((input.annualSpend || 0) >= 1200) score += 8;
  if (input.email) score += 5;
  return Math.max(0, Math.min(100, score));
}

export default async (request: Request, _context: Context) => {
  if (request.method !== "POST") return json({ message: "Metodo non consentito." }, 405);
  const rejected = requestRejected(request);
  if (rejected) return rejected;

  try {
    const body = await request.json() as Record<string, unknown>;
    const requestId = safeRequestId(body.requestId);
    if (text(body.botField, 100)) return json({ accepted: true });

    const contact = (body.contact || {}) as Record<string, unknown>;
    const intakeMode: IntakeMode = text(contact.intakeMode, 30) === "bill_only" ? "bill_only" : "manual";
    const document = documentSummary(contact.document);
    const fullName = text(contact.fullName, 120) || document.extractedName || null;
    const phone = optionalPhone(contact.phone);
    const email = optionalEmail(contact.email);
    const address = optionalAddress(contact.fullAddress || document.fullAddress);
    const energy = declaredEnergy(contact.energy, intakeMode === "manual");
    const privacyAccepted = contact.privacyAccepted === true;
    const privacyNoticeVersion = text(contact.privacyNoticeVersion, 100);
    const attribution = contact.attribution && typeof contact.attribution === "object" ? contact.attribution : {};
    const formVersion = text(contact.formVersion, 100);
    const clientSessionId = text(contact.clientSessionId, 150);

    if (!privacyAccepted || !privacyNoticeVersion) {
      return json({ message: "La presa visione dell’informativa privacy non è valida." }, 422);
    }
    if (intakeMode === "manual") {
      if (!fullName || fullName.length < 5 || !phone || !email || !address || energy.annualKwh === null || energy.annualSpend === null) {
        return json({ message: "I dati obbligatori del percorso manuale non sono validi." }, 422);
      }
    } else if (!document.fileSelected) {
      return json({ message: "Carica una bolletta prima di usare il percorso diretto." }, 422);
    }

    // Only explicitly annual values are allowed to populate annual energy and commercial score.
    // A single invoice total remains a period reference and is never annualised server-side.
    const scoredKwh = energy.annualKwh ?? document.annualKwh;
    const scoredSpend = energy.annualSpend ?? document.annualSpend;
    const score = scoreLead({ intakeMode, address, email, annualKwh: scoredKwh, annualSpend: scoredSpend, document });

    const db = getDatabase();
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      const previousEvent = await client.query<{ lead_id: string }>(
        "SELECT lead_id FROM econ_lead_events WHERE client_event_id = $1 LIMIT 1",
        [requestId]
      );
      if (previousEvent.rows[0]?.lead_id) {
        await client.query("COMMIT");
        return json({ leadId: previousEvent.rows[0].lead_id, duplicate: true });
      }

      let existing: LeadRow | null = null;
      if (phone) {
        const result = await client.query<LeadRow>(
          "SELECT id FROM econ_leads WHERE phone_normalized = $1 FOR UPDATE",
          [phone]
        );
        existing = result.rows[0] || null;
      }

      let leadId: string;
      let created = false;
      if (existing) {
        leadId = existing.id;
        await client.query(
          `UPDATE econ_leads
             SET full_name = COALESCE($2, full_name),
                 email = COALESCE($3, email),
                 full_address = COALESCE($4, full_address),
                 consumption_mode = CASE WHEN $5 = 'manual' THEN 'annual_kwh_and_spend' ELSE COALESCE(consumption_mode, 'bill_ocr') END,
                 consumption_value = COALESCE($6, consumption_value),
                 declared_annual_kwh = COALESCE($6, declared_annual_kwh),
                 declared_annual_spend = COALESCE($7, declared_annual_spend),
                 estimated_annual_kwh = COALESCE($6, estimated_annual_kwh),
                 estimated_monthly_spend = CASE WHEN $7 IS NULL THEN estimated_monthly_spend ELSE ROUND(($7 / 12.0)::numeric, 2) END,
                 intake_mode = $5,
                 bill_pod = COALESCE(NULLIF($8, ''), bill_pod),
                 privacy_notice_version = $9,
                 privacy_seen_at = NOW(),
                 attribution = $10::jsonb,
                 form_version = $11,
                 client_session_id = $12,
                 lead_score = GREATEST(lead_score, $13),
                 status = CASE WHEN status IN ('new', 'document_only') THEN $14 ELSE status END,
                 updated_at = NOW(),
                 last_activity_at = NOW()
           WHERE id = $1`,
          [leadId, fullName, email, address, intakeMode, scoredKwh, scoredSpend, document.pod, privacyNoticeVersion, JSON.stringify(attribution), formVersion, clientSessionId, score, intakeMode === "bill_only" ? "document_only" : "new"]
        );
      } else {
        leadId = crypto.randomUUID();
        created = true;
        await client.query(
          `INSERT INTO econ_leads (
             id, full_name, phone_normalized, email, full_address,
             consumption_mode, consumption_value, declared_annual_kwh, declared_annual_spend,
             estimated_annual_kwh, estimated_monthly_spend, intake_mode, bill_pod,
             privacy_notice_version, privacy_seen_at, attribution, form_version, client_session_id,
             lead_score, status, created_at, updated_at, last_activity_at
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $7, $8,
             $7, CASE WHEN $8 IS NULL THEN NULL ELSE ROUND(($8 / 12.0)::numeric, 2) END, $9, NULLIF($10, ''),
             $11, NOW(), $12::jsonb, $13, $14,
             $15, $16, NOW(), NOW(), NOW()
           )`,
          [leadId, fullName, phone, email, address, intakeMode === "manual" ? "annual_kwh_and_spend" : "bill_ocr", scoredKwh, scoredSpend, intakeMode, document.pod, privacyNoticeVersion, JSON.stringify(attribution), formVersion, clientSessionId, score, intakeMode === "bill_only" ? "document_only" : "new"]
        );
      }

      await client.query(
        `INSERT INTO econ_lead_events (id, lead_id, event_type, client_event_id, payload, created_at)
         VALUES ($1, $2, 'lead_requested', $3, $4::jsonb, NOW())`,
        [crypto.randomUUID(), leadId, requestId, JSON.stringify({
          created,
          score,
          intakeMode,
          source: "landing",
          addressProvided: !!address,
          emailProvided: !!email,
          phoneProvided: !!phone,
          declaredAnnualKwh: energy.annualKwh,
          declaredAnnualSpend: energy.annualSpend,
          document: {
            fileSelected: document.fileSelected,
            status: document.status,
            annualKwh: document.annualKwh,
            annualSpend: document.annualSpend,
            periodKwh: document.periodKwh,
            periodAmount: document.periodAmount,
            pod: document.pod,
            confidence: document.confidence
          }
        })]
      );
      await client.query("COMMIT");
      return json({ leadId, created, duplicate: false, intakeMode });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const message = errorMessage(error);
    if (/Telefono non valido|Email non valida|Indirizzo completo non valido|Consumo annuale non valido|Spesa annuale non valida/i.test(message)) {
      return json({ message }, 422);
    }
    console.error("lead-intake failed", { message });
    return json({ message: "Non è stato possibile acquisire la richiesta. Verifica la connessione e riprova." }, 500);
  }
};

export const config: Config = {
  path: "/.netlify/functions/lead-intake",
  method: "POST",
  rateLimit: { action: "rate_limit", aggregateBy: ["ip"], windowSize: 60, windowLimit: 8 }
};
