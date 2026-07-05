import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";

type ExpiredDocument = { id: string; blob_key: string };

/**
 * Privacy retention job.
 *
 * The blob is deleted before its database metadata. If deletion fails, the row remains
 * eligible for the next scheduled run: this prevents an orphaned bill from surviving
 * indefinitely without a database reference.
 */
export default async (_request: Request, _context: Context) => {
  const db = getDatabase();
  const store = getStore({ name: "econ-private-documents", consistency: "strong" });
  const expired = await db.sql<ExpiredDocument>`
    SELECT id, blob_key
    FROM econ_documents
    WHERE retention_until < NOW()
    ORDER BY retention_until ASC
    LIMIT 250
  `;

  let deleted = 0;
  let failed = 0;

  for (const document of expired) {
    try {
      await store.delete(document.blob_key);
      await db.sql`DELETE FROM econ_documents WHERE id = ${document.id} AND retention_until < NOW()`;
      deleted += 1;
    } catch (error) {
      failed += 1;
      console.error("document-retention failed", { documentId: document.id, message: error instanceof Error ? error.message : "unknown" });
    }
  }

  return Response.json({ scanned: expired.length, deleted, failed }, {
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
};

export const config: Config = {
  schedule: "0 2 * * 0"
};
