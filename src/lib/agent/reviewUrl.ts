// "Open it" — where to send someone after the agent made something.
//
// Shared by both command endpoints rather than duplicated in each: two copies
// of this drift, and then the streaming surface links somewhere different
// from the plain one for the same run, which reads as a bug even though both
// links work.

export interface ReviewStep {
  tool: string;
  output: unknown;
}

export function deriveReviewUrl(tenantId: string, steps: ReviewStep[]): string | null {
  const base = `/dashboard/${tenantId}`;
  // Walk backwards: the last thing created is what the user wants to see.
  for (let i = steps.length - 1; i >= 0; i--) {
    const { tool, output } = steps[i];
    const out = (output ?? {}) as Record<string, unknown>;

    if (tool === "createQuote" && typeof out.quoteId === "string") {
      return `${base}/quotes/${out.quoteId}`;
    }
    if (tool === "convertQuoteToInvoice" && typeof out.invoiceId === "string") {
      return `${base}/invoices/${out.invoiceId}`;
    }
    if (tool === "createCustomer" && typeof out.id === "string") {
      return `${base}/customers/${out.id}`;
    }
    if (tool === "createProduct" && typeof out.productId === "string") {
      return `${base}/products/${out.productId}`;
    }
    if (tool === "createJobCard") return `${base}/job-cards`;
    if (tool === "scheduleAppointment") return `${base}/appointments`;
    if (tool === "createTask" || tool === "updateTaskStatus") return `${base}/tasks`;
  }
  return null;
}
