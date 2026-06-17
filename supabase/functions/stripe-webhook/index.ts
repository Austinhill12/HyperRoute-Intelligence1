import Stripe from "npm:stripe@14.25.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const planPrices: Record<string, number> = {
  starter: 99,
  professional: 199,
  business: 399
};

Deno.serve(async (req) => {
  try {
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2023-10-16" });
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
    const signature = req.headers.get("stripe-signature");
    if (!signature) throw new Error("Missing Stripe signature.");

    const body = await req.text();
    const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const companyId = session.metadata?.company_id || session.client_reference_id;
      const planName = session.metadata?.plan_name || "professional";

      if (companyId) {
        await supabase
          .from("company_subscriptions")
          .upsert({
            company_id: companyId,
            plan_name: planName,
            monthly_price: planPrices[planName] ?? 0,
            billing_status: "active",
            payment_setup_status: "auto_billing_ready",
            payment_provider: "stripe",
            external_customer_id: String(session.customer || ""),
            external_subscription_id: String(session.subscription || ""),
            checkout_session_id: session.id,
            payment_link: session.url,
            renews_at: null,
            updated_at: new Date().toISOString()
          }, { onConflict: "company_id" });

        await supabase
          .from("companies")
          .update({
            lifecycle_stage: "live",
            lifecycle_updated_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("id", companyId);

        await logBillingActivity(supabase, companyId, "payment", "Stripe Checkout completed and subscription activated.", {
          plan_name: planName,
          stripe_session_id: session.id,
          stripe_subscription_id: session.subscription
        });
      }
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const stripeSubscription = event.data.object as Stripe.Subscription;
      const companyId = stripeSubscription.metadata?.company_id;
      if (companyId) {
        const billingStatus = mapStripeSubscriptionStatus(stripeSubscription.status);
        await supabase
          .from("company_subscriptions")
          .update({
            billing_status: billingStatus,
            payment_setup_status: billingStatus === "active" ? "auto_billing_ready" : "not_started",
            external_subscription_id: stripeSubscription.id,
            renews_at: stripeSubscription.current_period_end
              ? new Date(stripeSubscription.current_period_end * 1000).toISOString().slice(0, 10)
              : null,
            updated_at: new Date().toISOString()
          })
          .eq("company_id", companyId);

        await logBillingActivity(supabase, companyId, "update", `Stripe subscription status changed to ${billingStatus}.`, {
          stripe_subscription_id: stripeSubscription.id,
          stripe_status: stripeSubscription.status
        });
      }
    }

    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = String(invoice.subscription || "");
      if (subscriptionId) {
        const { data: row } = await supabase
          .from("company_subscriptions")
          .select("company_id")
          .eq("external_subscription_id", subscriptionId)
          .maybeSingle();

        if (row?.company_id) {
          await supabase
            .from("company_subscriptions")
            .update({
              billing_status: "past_due",
              updated_at: new Date().toISOString()
            })
            .eq("company_id", row.company_id);

          await logBillingActivity(supabase, row.company_id, "payment_failed", "Stripe invoice payment failed.", {
            stripe_invoice_id: invoice.id,
            stripe_subscription_id: subscriptionId
          });
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || "Webhook failed." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }
});

function mapStripeSubscriptionStatus(status: Stripe.Subscription.Status) {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "canceled" || status === "incomplete_expired") return "canceled";
  return "checkout_pending";
}

async function logBillingActivity(supabase: ReturnType<typeof createClient>, companyId: string, action: string, description: string, metadata: Record<string, unknown>) {
  try {
    await supabase.from("activity_logs").insert({
      company_id: companyId,
      actor_role: "stripe",
      action,
      entity_type: "subscription",
      entity_id: companyId,
      description,
      metadata
    });
  } catch (_) {
    // Activity logs should never block billing webhooks.
  }
}
