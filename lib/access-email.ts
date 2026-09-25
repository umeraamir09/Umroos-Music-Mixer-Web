import type { Id } from "@/convex/_generated/dataModel";

type EmailContent = { to: string; subject: string; text: string; html: string; idempotencyKey: string };

export function accessEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM_EMAIL?.trim() && process.env.ACCESS_REQUEST_TO_EMAIL?.trim());
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function emailFrame({ preheader, label, title, body, detail }: { preheader: string; label: string; title: string; body: string; detail: string }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f7f3ec;color:#3c2d31;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;font-size:1px;line-height:1px;color:#f7f3ec;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f7f3ec;"><tr><td align="center" style="padding:32px 16px 48px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;background:#fffdf9;border:1px solid #e8dedb;">
      <tr><td style="padding:28px 36px 24px;border-top:7px solid #f386a1;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
          <td style="font-size:15px;font-weight:800;letter-spacing:2px;line-height:21px;">UMROO'S<br><span style="color:#d85e80;">MUSIC MIXER</span></td>
          <td align="right" valign="middle" style="font-size:11px;font-weight:700;letter-spacing:2px;color:#75696b;">THE INVITE LIST&nbsp; / &nbsp;01</td>
        </tr></table>
      </td></tr>
      <tr><td style="background:#3c2d31;padding:38px 36px 42px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
          <td valign="top">
            <p style="margin:0 0 18px;color:#f386a1;font-size:11px;font-weight:700;letter-spacing:2.5px;line-height:18px;">${label}</p>
            <h1 style="margin:0;color:#fff7f3;font-size:38px;font-weight:700;letter-spacing:-1.5px;line-height:1.12;">${title}</h1>
          </td>
          <td width="88" align="right" valign="top" style="padding-left:12px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="72" height="72" style="width:72px;height:72px;border:2px solid #f386a1;border-radius:50%;"><tr><td align="center" valign="middle">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="42" height="42" style="width:42px;height:42px;border:1px solid #c8babc;border-radius:50%;"><tr><td align="center" valign="middle" style="color:#f386a1;font-size:22px;line-height:22px;">●</td></tr></table>
            </td></tr></table>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:38px 36px 12px;font-size:16px;line-height:1.7;color:#3c2d31;">${body}</td></tr>
      <tr><td style="padding:12px 36px 38px;">${detail}</td></tr>
      <tr><td style="padding:25px 36px;border-top:1px solid #eadfe0;background:#fce8ec;color:#75696b;font-size:12px;line-height:1.6;">
        Made for the moments that need a soundtrack.<br><strong style="color:#3c2d31;">Umroo's Music Mixer</strong>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

async function sendEmail({ to, subject, text, html, idempotencyKey }: EmailContent) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) throw new Error("Access request email is not configured");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`Resend rejected access request email (${response.status})`);
  const result = await response.json() as { id?: unknown };
  if (typeof result.id !== "string" || !result.id) throw new Error("Resend returned no email ID");
}

export async function sendOwnerAccessEmail(email: string, requestId: Id<"accessRequests">) {
  const to = process.env.ACCESS_REQUEST_TO_EMAIL?.trim();
  if (!to) throw new Error("Access request owner email is not configured");
  const safeEmail = escapeHtml(email);
  await sendEmail({
    to,
    subject: "A new listener requested Spotify access",
    text: `A visitor requested Spotify access to Umroo's Music Mixer.\n\nEmail: ${email}\n\nReview the request in Convex before adding anyone to Spotify's invite list.`,
    html: emailFrame({
      preheader: "A new Spotify access request is ready for your review.",
      label: "NEW ACCESS REQUEST",
      title: "Someone wants in.",
      body: '<p style="margin:0;">A new listener has asked for a spot on the Spotify invite list. Review their request before adding them to the Spotify Developer Dashboard.</p>',
      detail: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f7f3ec;border-left:4px solid #f386a1;"><tr><td style="padding:19px 22px;"><span style="display:block;margin-bottom:8px;color:#75696b;font-size:10px;font-weight:700;letter-spacing:2px;">REQUESTED ADDRESS</span><span style="font-size:18px;font-weight:700;line-height:1.4;word-break:break-word;">${safeEmail}</span></td></tr></table>`,
    }),
    idempotencyKey: `access-request/${requestId}`,
  });
}

export async function sendRequesterAccessEmail(email: string, requestId: Id<"accessRequests">) {
  await sendEmail({
    to: email,
    subject: "We received your Spotify access request",
    text: `Thanks for requesting Spotify access to Umroo's Music Mixer.\n\nYour request has been received and is waiting for review. If a spot becomes available, we'll contact you at this address. Requesting access does not automatically add you to Spotify's invite list.\n\nIn the meantime, you can try the public demo.\n\nUmroo's Music Mixer`,
    html: emailFrame({
      preheader: "Thank you for reaching out. Your Spotify access request is in.",
      label: "REQUEST RECEIVED",
      title: "You're in the queue.",
      body: '<p style="margin:0 0 18px;font-size:19px;font-weight:700;line-height:1.5;">Thanks for reaching out.</p><p style="margin:0;">We received your request for Spotify access to Umroo&#39;s Music Mixer. It is waiting for review. If a spot becomes available, we&#39;ll get in touch at this email address.</p>',
      detail: '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f7f3ec;border-left:4px solid #f386a1;"><tr><td style="padding:19px 22px;"><span style="display:block;margin-bottom:8px;color:#75696b;font-size:10px;font-weight:700;letter-spacing:2px;">WHILE YOU WAIT</span><span style="font-size:15px;line-height:1.6;">The public demo is ready whenever you want to make a mix. Your request does not grant Spotify access automatically.</span></td></tr></table>',
    }),
    idempotencyKey: `access-confirmation/${requestId}`,
  });
}
