import type { Context } from "@netlify/edge-functions";

/**
 * Injects the bill parser enhancement without duplicating the landing HTML.
 * It runs only on the homepage and preserves the original static response.
 */
export default async (_request: Request, context: Context) => {
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  const html = await response.text();
  if (html.includes("/assets/bill-enrichment.js")) return new Response(html, response);

  const enhanced = html.replace(
    "</body>",
    '<script defer src="/assets/bill-enrichment.js"></script>\n</body>'
  );

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(enhanced, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};
