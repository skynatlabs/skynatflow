// Builds a wa.me click-to-chat link — the one WhatsApp deep-link format
// that reliably opens the right destination on every platform: the native
// app on a phone/tablet, and WhatsApp Web (or the WhatsApp Desktop app, if
// installed and registered as the handler) on a computer, no separate
// "mobile vs desktop" branching needed on our side.
//
// WhatsApp's click-to-chat API cannot pre-attach a file — that's a
// deliberate WhatsApp platform restriction, not something we can work
// around from a URL. The correct, standard pattern (used by every real
// invoicing product) is a pre-filled message containing a direct link the
// customer taps to view/download the document online, which is what this
// builds.
export function buildWhatsAppShareLink(phone: string | null | undefined, message: string): string | null {
  if (!phone) return null;
  const digitsOnly = phone.replace(/[^0-9]/g, "");
  if (!digitsOnly) return null;
  return `https://wa.me/${digitsOnly}?text=${encodeURIComponent(message)}`;
}

export function quoteWhatsAppMessage(opts: {
  tenantName: string;
  customerName: string;
  amountLabel: string;
  viewUrl: string;
}): string {
  return (
    `Hi ${opts.customerName}, here's your quote from ${opts.tenantName} for ${opts.amountLabel}.\n\n` +
    `View and accept it here: ${opts.viewUrl}`
  );
}

export function invoiceWhatsAppMessage(opts: {
  tenantName: string;
  customerName: string;
  amountLabel: string;
  viewUrl: string;
}): string {
  return (
    `Hi ${opts.customerName}, here's your invoice from ${opts.tenantName} for ${opts.amountLabel}.\n\n` +
    `View and pay here: ${opts.viewUrl}`
  );
}
