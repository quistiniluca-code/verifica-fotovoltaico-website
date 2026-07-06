import type { Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";

export const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function requestRejected(request: Request): Response | null {
  if (!isSameOrigin(request)) return json({ message: "Origine della richiesta non consentita." }, 403);
  return null;
}

export function text(value: unknown, max = 500): string {
  return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function normalizedPhone(value: unknown): string {
  const raw = text(value, 40).replace(/[\s().-]/g, "").replace(/^00/, "+");
  if (!/^\+?[0-9]{8,15}$/.test(raw)) throw new Error("Telefono non valido.");
  return raw.startsWith("+") ? raw : `+${raw}`;
}

export function safeNumber(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return Math.round(parsed * 100) / 100;
}

export function safeUuid(value: unknown): string {
  const candidate = text(value, 80);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)) {
    throw new Error("Identificativo non valido.");
  }
  return candidate;
}

export function safeRequestId(value: unknown): string {
  const candidate = text(value, 150);
  if (!/^[a-z0-9][a-z0-9_-]{7,149}$/i.test(candidate)) throw new Error("Identificativo richiesta non valido.");
  return candidate;
}

export function allowedEnum(value: unknown, allowed: readonly string[]): string {
  const candidate = text(value, 80);
  if (!allowed.includes(candidate)) throw new Error("Valore non valido.");
  return candidate;
}

export function getClientIp(context: Context): string | null {
  const ip = context.ip || null;
  return ip && ip.length <= 64 ? ip : null;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Errore tecnico non identificato.";
}

export function econDatabase() {
  return getDatabase({
    connectionString: process.env.NETLIFY_DB_URL || process.env.NETLIFY_AGENT_RUNNER_DB_CONNECTION_STRING
  });
}
