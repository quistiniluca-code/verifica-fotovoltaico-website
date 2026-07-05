import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { errorMessage, json, requestRejected, safeRequestId, safeUuid, text } from "../lib/shared.mjs";

const EVENT_TYPES = new Set([
  "report_generated",
  "report_viewed_without_bill",
  "whatsapp_opened"
]);

function payloadWithinLimit(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const encoded = JSON.stringify(value);
  if (encoded.length > 16000) throw new Error("Payload evento troppo esteso.");
  return value as Record<string, unknown>;
}

export default async (request: Request, _context: Context) => {
  if (request.method !== "POST") return json({ message: "Metodo non consentito." }, 405);
  const rejected = requestRejected(request);
  if (rejected) return rejected;

  try {
    const body = await request.json() as Record<string, unknown>;
    const requestId = safeRequestId(body.requestId);
    const leadId = safeUuid(body.leadId);
    const eventType = text(body.eventType, 80);
    const payload = payloadWithinLimit(body.payload);

    if (!EVENT_TYPES.has(eventType)) return json({ message: "Tipo evento non consentito." }, 422);

    const db = getDatabase();
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      const lead = await client.query<{ id: string }>("SELECT id FROM econ_leads WHERE id = $1 FOR UPDATE", [leadId]);
      if (!lead.rows[0]) {
        await client.query("ROLLBACK");
        return json({ message: "Lead non disponibile." }, 404);
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO econ_lead_events (id, lead_id, event_type, client_event_id, payload, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
         ON CONFLICT (client_event_id) DO NOTHING
         RETURNING id`,
        [crypto.randomUUID(), leadId, eventType, requestId, JSON.stringify(payload)]
      );

      if (eventType === "report_generated" && inserted.rows[0]) {
        await client.query(
          "UPDATE econ_leads SET last_report = $2::jsonb, last_activity_at = NOW(), updated_at = NOW() WHERE id = $1",
          [leadId, JSON.stringify(payload)]
        );
      } else if (inserted.rows[0]) {
        await client.query("UPDATE econ_leads SET last_activity_at = NOW(), updated_at = NOW() WHERE id = $1", [leadId]);
      }
      await client.query("COMMIT");
      return json({ accepted: true, duplicate: !inserted.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("lead-event failed", { message: errorMessage(error) });
    return json({ message: "Non è stato possibile registrare l’evento." }, 500);
  }
};

export const config: Config = {
  path: "/.netlify/functions/lead-event",
  method: "POST",
  rateLimit: { action: "rate_limit", aggregateBy: ["ip"], windowSize: 60, windowLimit: 20 }
};
