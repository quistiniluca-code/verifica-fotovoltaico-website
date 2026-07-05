import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";
import { errorMessage, json, requestRejected, safeRequestId, safeUuid, text } from "../lib/shared.mjs";

const MAX_FILE_BYTES = 7 * 1024 * 1024;
const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const ALLOWED_SOURCE = new Set(["initial_report_upload", "post_report_upload"]);

type DocumentRow = { id: string; blob_key: string; sha256: string };

function boundedNumber(value: unknown, min = 0, max = 1_000_000): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return 0;
  return Math.round(parsed * 100) / 100;
}

async function detectMime(file: File): Promise<string | null> {
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const starts = (...bytes: number[]) => bytes.every((byte, index) => header[index] === byte);
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0x52, 0x49, 0x46, 0x46) && header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50) return "image/webp";
  return null;
}

async function sha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function assessmentSummary(raw: FormDataEntryValue | null): Record<string, unknown> {
  if (typeof raw !== "string" || raw.length > 3500) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      status: text(parsed.status, 40),
      kwh: boundedNumber(parsed.kwh),
      kwhScope: text(parsed.kwhScope, 40),
      amount: boundedNumber(parsed.amount),
      annualKwh: boundedNumber(parsed.annualKwh),
      annualSpend: boundedNumber(parsed.annualSpend),
      periodKwh: boundedNumber(parsed.periodKwh),
      periodAmount: boundedNumber(parsed.periodAmount),
      pod: text(parsed.pod, 40),
      confidence: boundedNumber(parsed.confidence, 0, 1000),
      isBill: Boolean(parsed.isBill),
      source: text(parsed.source, 60)
    };
  } catch {
    return {};
  }
}

export default async (request: Request, _context: Context) => {
  if (request.method !== "POST") return json({ message: "Metodo non consentito." }, 405);
  const rejected = requestRejected(request);
  if (rejected) return rejected;

  let writtenBlobKey: string | null = null;
  try {
    const form = await request.formData();
    const leadId = safeUuid(form.get("lead_id"));
    const requestId = safeRequestId(form.get("request_id"));
    const source = text(form.get("source"), 80);
    const document = form.get("document");
    const assessment = assessmentSummary(form.get("assessment"));

    if (!ALLOWED_SOURCE.has(source)) return json({ message: "Origine documento non consentita." }, 422);
    if (!(document instanceof File)) return json({ message: "Documento mancante." }, 422);
    if (!document.name || document.size <= 0 || document.size > MAX_FILE_BYTES) {
      return json({ message: "Il documento deve essere valido e sotto 7 MB." }, 422);
    }

    const detectedMime = await detectMime(document);
    if (!detectedMime || !ALLOWED_MIME.has(detectedMime)) {
      return json({ message: "Formato documento non riconosciuto." }, 422);
    }
    if (document.type && !ALLOWED_MIME.has(document.type)) {
      return json({ message: "Tipo MIME dichiarato non consentito." }, 422);
    }

    const hash = await sha256(document);
    const db = getDatabase();
    const existing = await db.sql<DocumentRow>`SELECT id, blob_key, sha256 FROM econ_documents WHERE lead_id = ${leadId} AND sha256 = ${hash} LIMIT 1`;
    if (existing[0]) {
      await db.sql`INSERT INTO econ_lead_events (id, lead_id, event_type, client_event_id, payload, created_at)
        VALUES (${crypto.randomUUID()}, ${leadId}, 'document_uploaded', ${requestId}, ${JSON.stringify({ documentId: existing[0].id, duplicate: true, source })}::jsonb, NOW())
        ON CONFLICT (client_event_id) DO NOTHING`;
      return json({ accepted: true, duplicate: true, documentId: existing[0].id });
    }

    const documentId = crypto.randomUUID();
    const extension = detectedMime === "application/pdf" ? "pdf" : detectedMime === "image/jpeg" ? "jpg" : detectedMime === "image/png" ? "png" : "webp";
    writtenBlobKey = `leads/${leadId}/${documentId}.${extension}`;
    const uploads = getStore("econ-private-documents");
    await uploads.set(writtenBlobKey, document, {
      metadata: {
        leadId,
        documentId,
        sha256: hash,
        contentType: detectedMime,
        expiresAt: String(Date.now() + 1000 * 60 * 60 * 24 * 180)
      }
    });

    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      const lead = await client.query<{ id: string }>("SELECT id FROM econ_leads WHERE id = $1 FOR UPDATE", [leadId]);
      if (!lead.rows[0]) throw new Error("Lead non disponibile.");

      const concurrent = await client.query<DocumentRow>(
        "SELECT id, blob_key, sha256 FROM econ_documents WHERE lead_id = $1 AND sha256 = $2 LIMIT 1 FOR UPDATE",
        [leadId, hash]
      );
      if (concurrent.rows[0]) {
        await client.query("COMMIT");
        await uploads.delete(writtenBlobKey);
        writtenBlobKey = null;
        return json({ accepted: true, duplicate: true, documentId: concurrent.rows[0].id });
      }

      await client.query(
        `INSERT INTO econ_documents (
          id, lead_id, blob_key, original_filename, mime_type, size_bytes, sha256,
          source, assessment, status, uploaded_at, retention_until
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9::jsonb, 'received', NOW(), NOW() + INTERVAL '180 days'
        )`,
        [documentId, leadId, writtenBlobKey, text(document.name, 180), detectedMime, document.size, hash, source, JSON.stringify(assessment)]
      );
      await client.query(
        `INSERT INTO econ_lead_events (id, lead_id, event_type, client_event_id, payload, created_at)
         VALUES ($1, $2, 'document_uploaded', $3, $4::jsonb, NOW())
         ON CONFLICT (client_event_id) DO NOTHING`,
        [crypto.randomUUID(), leadId, requestId, JSON.stringify({ documentId, source, mimeType: detectedMime, bytes: document.size, assessment })]
      );
      await client.query("UPDATE econ_leads SET last_activity_at = NOW(), updated_at = NOW() WHERE id = $1", [leadId]);
      await client.query("COMMIT");
      return json({ accepted: true, duplicate: false, documentId });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (writtenBlobKey) {
      try { await getStore("econ-private-documents").delete(writtenBlobKey); } catch { /* best effort orphan cleanup */ }
    }
    console.error("document-upload failed", { message: errorMessage(error) });
    return json({ message: "Non è stato possibile acquisire il documento. Riprova." }, 500);
  }
};

export const config: Config = {
  path: "/.netlify/functions/document-upload",
  method: "POST",
  rateLimit: { action: "rate_limit", aggregateBy: ["ip"], windowSize: 60, windowLimit: 6 }
};
