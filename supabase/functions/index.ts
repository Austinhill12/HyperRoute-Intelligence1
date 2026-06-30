import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

type OcrRequest = {
  file_name?: string;
  failure_reason?: string;
  images?: string[];
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    const openAiModel = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";

    if (!openAiKey) throw new Error("OPENAI_API_KEY is not configured in Supabase Edge Function secrets.");

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) throw new Error("Login required before OCR rate con import.");

    const body = await req.json() as OcrRequest;
    const images = Array.isArray(body.images) ? body.images.filter(Boolean).slice(0, 4) : [];
    if (!images.length) throw new Error("No rendered PDF page images were provided for OCR.");

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openAiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: openAiModel,
        input: [{
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildPrompt(body.file_name || "rate-confirmation.pdf", body.failure_reason || "")
            },
            ...images.map((image) => ({
              type: "input_image",
              image_url: image
            }))
          ]
        }]
      })
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.error?.message || "OpenAI OCR request failed.");
    }

    const outputText = extractOutputText(result);
    const extraction = parseJsonObject(outputText);

    return json({ extraction });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 400);
  }
});

function buildPrompt(fileName: string, failureReason: string) {
  return `
You are HyperRoute Intelligence's rate confirmation OCR engine.

The browser could not extract reliable text from this PDF.
File: ${fileName}
Reason: ${failureReason || "Browser PDF text extraction failed."}

Read the attached rate confirmation page images and return ONLY valid JSON.
Do not include markdown, comments, or explanatory text.

Extract as many of these fields as possible:
{
  "broker_name": "",
  "broker_contact": "",
  "broker_mc_number": "",
  "rate_confirmation_number": "",
  "load_number": "",
  "customer_reference_number": "",
  "customer_name": "",
  "status": "booked",
  "pickup_location": "",
  "pickup_date": "",
  "pickup_time": "",
  "delivery_location": "",
  "delivery_date": "",
  "delivery_time": "",
  "rate": "",
  "fuel_surcharge": "",
  "accessorial_pay": "",
  "loaded_miles": "",
  "commodity": "",
  "weight": "",
  "trailer_type": "",
  "equipment_requirements": "",
  "hazmat_required": false,
  "temperature_requirements": "",
  "tracking_required": false,
  "required_documents": "",
  "lumper_information": "",
  "detention_policy": "",
  "notes": ""
}

Rules:
- Use the complete pickup and delivery street/city/state/zip when visible.
- Do not put page headers, generic legal text, or entire paragraphs into location fields.
- If multiple stops exist, use the first pickup and final delivery.
- Dates should be YYYY-MM-DD when you can infer the year.
- Times should be HH:MM 24-hour format when possible.
- Rate, fuel surcharge, accessorial pay, miles, and weight should be numbers without currency symbols or commas.
- If a field is not visible, return an empty string instead of guessing.
- Put driver instructions, appointment notes, tracking requirements, and special handling notes in notes.
`.trim();
}

function extractOutputText(result: any) {
  if (typeof result.output_text === "string") return result.output_text;
  const chunks: string[] = [];
  for (const item of result.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function parseJsonObject(text: string) {
  const cleaned = String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("OCR response did not include a JSON object.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
