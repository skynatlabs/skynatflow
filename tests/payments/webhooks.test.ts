// The production blocker these cover: a customer who never paid could
// previously mark an invoice paid by loading the checkout-confirm URL.
// Money now only moves on a provider callback whose signature verifies, so
// these assert that forging one fails and that a genuine one is accepted
// exactly once.

import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { createStripeGateway } from "../../src/lib/payments/gateways/stripe";
import { createPaystackGateway } from "../../src/lib/payments/gateways/paystack";
import { createStubGateway } from "../../src/lib/payments/gateways/stub";

const SECRET = "whsec_test_secret_value";

function stripeEvent(body: string, secret = SECRET, at = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secret).update(`${at}.${body}`).digest("hex");
  return { "stripe-signature": `t=${at},v1=${signature}` };
}

const PAID_BODY = JSON.stringify({
  id: "evt_123",
  type: "checkout.session.completed",
  data: { object: { payment_status: "paid", amount_total: 10000, metadata: { checkoutId: "chk_1" } } },
});

describe("Stripe webhook verification", () => {
  const gw = createStripeGateway("sk_test");
  const secrets = { webhookSecret: SECRET, publicKey: null, secretKey: "sk_test" };

  it("accepts a correctly signed completed checkout", async () => {
    const v = await gw.verifyWebhook({ rawBody: PAID_BODY, headers: stripeEvent(PAID_BODY) }, secrets);
    expect(v.ok).toBe(true);
    expect(v.outcome).toBe("paid");
    expect(v.reference).toBe("chk_1");
    expect(v.eventId).toBe("evt_123");
    expect(v.amountCents).toBe(10000);
  });

  it("rejects a body that was tampered with after signing", async () => {
    const headers = stripeEvent(PAID_BODY);
    const tampered = PAID_BODY.replace('"amount_total":10000', '"amount_total":1');
    const v = await gw.verifyWebhook({ rawBody: tampered, headers }, secrets);
    expect(v.ok).toBe(false);
    expect(v.outcome).toBe("ignored");
  });

  it("rejects a signature made with the wrong secret", async () => {
    const headers = stripeEvent(PAID_BODY, "whsec_attacker_guess");
    const v = await gw.verifyWebhook({ rawBody: PAID_BODY, headers }, secrets);
    expect(v.ok).toBe(false);
  });

  it("rejects an unsigned callback outright", async () => {
    const v = await gw.verifyWebhook({ rawBody: PAID_BODY, headers: {} }, secrets);
    expect(v.ok).toBe(false);
  });

  it("rejects a replayed callback that is older than the tolerance window", async () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    const v = await gw.verifyWebhook({ rawBody: PAID_BODY, headers: stripeEvent(PAID_BODY, SECRET, old) }, secrets);
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/tolerance/i);
  });

  it("refuses to verify anything when no signing secret is configured", async () => {
    const v = await gw.verifyWebhook(
      { rawBody: PAID_BODY, headers: stripeEvent(PAID_BODY) },
      { webhookSecret: null, publicKey: null, secretKey: "sk_test" }
    );
    expect(v.ok).toBe(false);
    expect(v.outcome).toBe("ignored");
  });

  it("acknowledges but ignores event types that aren't a completed checkout", async () => {
    const body = JSON.stringify({ id: "evt_9", type: "payment_intent.created", data: { object: {} } });
    const v = await gw.verifyWebhook({ rawBody: body, headers: stripeEvent(body) }, secrets);
    expect(v.ok).toBe(true);
    expect(v.outcome).toBe("ignored");
  });

  it("reports an unpaid session as failed rather than paid", async () => {
    const body = JSON.stringify({
      id: "evt_10",
      type: "checkout.session.completed",
      data: { object: { payment_status: "unpaid", metadata: { checkoutId: "chk_1" } } },
    });
    const v = await gw.verifyWebhook({ rawBody: body, headers: stripeEvent(body) }, secrets);
    expect(v.outcome).toBe("failed");
  });
});

describe("Paystack webhook verification", () => {
  const gw = createPaystackGateway("sk_live_x");
  const secrets = { webhookSecret: null, publicKey: null, secretKey: "sk_live_x" };
  const body = JSON.stringify({
    event: "charge.success",
    data: { status: "success", reference: "chk_2", amount: 5000 },
  });
  const sign = (b: string, key = "sk_live_x") => ({
    "x-paystack-signature": createHmac("sha512", key).update(b).digest("hex"),
  });

  it("accepts a correctly signed successful charge", async () => {
    const v = await gw.verifyWebhook({ rawBody: body, headers: sign(body) }, secrets);
    expect(v.ok).toBe(true);
    expect(v.outcome).toBe("paid");
    expect(v.reference).toBe("chk_2");
    expect(v.amountCents).toBe(5000);
  });

  it("rejects a forged signature", async () => {
    const v = await gw.verifyWebhook({ rawBody: body, headers: sign(body, "wrong_key") }, secrets);
    expect(v.ok).toBe(false);
  });

  it("gives every delivery of one charge the same event id, so retries dedupe", async () => {
    const a = await gw.verifyWebhook({ rawBody: body, headers: sign(body) }, secrets);
    const b = await gw.verifyWebhook({ rawBody: body, headers: sign(body) }, secrets);
    expect(a.eventId).toBe(b.eventId);
    expect(a.eventId).toBeTruthy();
  });
});

describe("gateways with no real integration", () => {
  it("never report a payment as made", async () => {
    const v = await createStubGateway("Ozow").verifyWebhook(
      { rawBody: "{}", headers: {} },
      { webhookSecret: "anything", publicKey: null, secretKey: null }
    );
    expect(v.ok).toBe(false);
    expect(v.outcome).toBe("ignored");
  });
});
