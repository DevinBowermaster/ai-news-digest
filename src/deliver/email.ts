import type { Http } from "../http.js";
import { assertNoActiveHtml } from "../render/html.js";

export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Same key on a retried run means the provider sends it once. */
  idempotencyKey: string;
}

/**
 * Sends through Resend's HTTP API. Runs in the publish job, which holds the
 * mail key but never the model key.
 */
export async function sendEmail(http: Http, apiKey: string, msg: EmailMessage): Promise<string> {
  assertNoActiveHtml(msg.html);
  const res = await http.request("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": msg.idempotencyKey,
    },
    body: JSON.stringify({ from: msg.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Resend returned ${res.status}: ${body.slice(0, 300)}`);
  return body;
}
