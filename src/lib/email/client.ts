// Email — the fallback/complement channel to WhatsApp. Where WhatsApp is
// the primary customer-facing channel (quotes, follow-ups, daily briefing),
// email covers what WhatsApp doesn't fit well: staff invites, formal
// invoice/receipt copies some customers expect in their inbox, and any
// notification for a contact who hasn't given a WhatsApp number.
//
// Uses Resend — same "stub safely if no key" pattern as
// src/lib/whatsapp/client.ts, so nothing breaks in local dev without an
// account. RESEND_API_KEY is settable at /admin/api-keys (checked first)
// or as an env var; EMAIL_FROM stays env-only (a sender address, not a
// secret).

import { Resend } from "resend";
import { getPlatformSecret } from "@/lib/platform/apiKeys";

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailParams) {
  const apiKey = await getPlatformSecret("RESEND_API_KEY");
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.warn(
      `[email:stub] would send "${subject}" to ${to} (RESEND_API_KEY/EMAIL_FROM not set)`
    );
    return { stub: true, to, subject };
  }

  const resend = new Resend(apiKey);
  const result = await resend.emails.send({ from, to, subject, html });

  if (result.error) {
    throw new Error(`Email send failed: ${result.error.message}`);
  }

  return result;
}

export function staffInviteEmail(params: {
  tenantName: string;
  inviterName?: string;
  role: string;
}) {
  const inviter = params.inviterName ? `${params.inviterName} has` : "You've been";
  return {
    subject: `You've been added to ${params.tenantName}`,
    html: `
      <p>${inviter} added you to <strong>${params.tenantName}</strong> on flow as <strong>${params.role}</strong>.</p>
      <p>Sign in with this email address to get started.</p>
    `,
  };
}

export function quoteEmail(params: { businessName: string; amountFormatted: string }) {
  return {
    subject: `Quote from ${params.businessName}`,
    html: `
      <p>Thanks for your interest! ${params.businessName} has sent you a quote for <strong>${params.amountFormatted}</strong>.</p>
      <p>Reply to this email or reach out on WhatsApp with any questions.</p>
    `,
  };
}
