import Stripe from "npm:stripe@14.25.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const planPrices: Record<string, { amount: number; env: string }> = {
  starter: { amount: 99, env: "STRIPE_PRICE_STARTER" },
  professional: { amount: 199, env: "STRIPE_PRICE_PROFESSIONAL" },
  business: { amount: 399, env: "STRIPE_PRICE_BUSINESS" }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")!;
    const appUrl = Deno.env.get("APP_URL") || req.headers.get("origin") || "http://localhost:8080";

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) throw new Error("Login required before checkout.");

    const { company_id, plan_name } = await req.json();
    const plan = String(plan_name || "").toLowerCase();
    if (!company_id) throw new Error("Company ID is required.");
    if (!planPrices[plan]) throw new Error("Invalid checkout plan.");

    const { data: membership } = await adminClient
      .from("company_users")
      .select("id, role")
      .eq("company_id", company_id)
      .eq("user_id", userData.user.id)
      .eq("status", "active")
      .maybeSingle();

    const { data: platformAdmin } = await adminClient
      .from("platform_admins")
      .select("id")
      .eq("user_id", userData.user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!membership && !platformAdmin) {
      throw new Error("You do not have permission to manage this subscription.");
    }

    const { data: company, error: companyError } = await adminClient
      .from("companies")
      .select("id, company_name, email")
      .eq("id", company_id)
      .single();
    if (companyError || !company) throw new Error("Company not found.");

    const priceId = Deno.env.get(planPrices[plan].env);
    if (!priceId) throw new Error(`${planPrices[plan].env} is not configured in Supabase secrets.`);

    const { data: existingSubscription } = await adminClient
      .from("company_subscriptions")
      .select("*")
      .eq("company_id", company_id)
      .maybeSingle();

    let customerId = existingSubscription?.external_customer_id || null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userData.user.email || company.email || undefined,
        name: company.company_name || undefined,
        metadata: {
          company_id,
          supabase_user_id: userData.user.id
        }
      });
      customerId = customer.id;
    }

    await adminClient
      .from("company_subscriptions")
      .upsert({
        company_id,
        plan_name: plan,
        monthly_price: planPrices[plan].amount,
        billing_status: "checkout_pending",
        payment_setup_status: "payment_link_sent",
        billing_email: userData.user.email || company.email || null,
        payment_provider: "stripe",
        external_customer_id: customerId,
        updated_at: new Date().toISOString()
      }, { onConflict: "company_id" });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/subscription.html?checkout=success`,
      cancel_url: `${appUrl}/subscription.html?checkout=cancel`,
      client_reference_id: company_id,
      metadata: {
        company_id,
        plan_name: plan,
        supabase_user_id: userData.user.id
      },
      subscription_data: {
        metadata: {
          company_id,
          plan_name: plan,
          supabase_user_id: userData.user.id
        }
      }
    });

    await adminClient
      .from("company_subscriptions")
      .update({
        checkout_session_id: session.id,
        payment_link: session.url,
        updated_at: new Date().toISOString()
      })
      .eq("company_id", company_id);

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || "Checkout failed." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
