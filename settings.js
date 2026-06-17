const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const headers = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

const form = document.getElementById("settingsForm");
const msg = document.getElementById("settingsMessage");

async function loadSettings() {
  msg.textContent = "Loading settings...";
  msg.style.color = "";

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/company_settings?id=eq.1&select=*`, { headers });

    if (!res.ok) {
      throw new Error(getSettingsTableMessage(await res.text()));
    }

    const [settings] = await res.json();
    fillForm(settings || getDefaultSettings());
    msg.textContent = settings ? "" : "No settings saved yet. Add your company details and save.";
  } catch (err) {
    console.error(err);
    fillForm(getDefaultSettings());
    msg.textContent = err.message;
    msg.style.color = "#ef4444";
  }
}

function fillForm(settings) {
  Object.entries(settings).forEach(([key, value]) => {
    const field = form.elements[key];
    if (field) field.value = value ?? "";
  });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const data = Object.fromEntries(new FormData(form).entries());
  Object.keys(data).forEach(key => {
    if (data[key] === "") data[key] = null;
  });

  data.id = 1;
  data.payment_terms_days = data.payment_terms_days ? Number(data.payment_terms_days) : 30;

  msg.textContent = "Saving settings...";
  msg.style.color = "";

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/company_settings?on_conflict=id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: API_KEY,
        Authorization: "Bearer " + API_KEY,
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(data)
    });

    const result = await res.json();
    if (!res.ok) throw new Error(getSettingsTableMessage(JSON.stringify(result)));

    fillForm(Array.isArray(result) ? result[0] : result);
    msg.textContent = "Company settings saved.";
    msg.style.color = "#047857";
  } catch (err) {
    console.error(err);
    msg.textContent = err.message;
    msg.style.color = "#ef4444";
  }
});

function getDefaultSettings() {
  return {
    company_name: "HyperRoute Intelligence",
    invoice_prefix: "INV-",
    payment_terms_days: 30
  };
}

function getSettingsTableMessage(rawMessage) {
  if (rawMessage.includes("company_settings")) {
    return "Company settings table is not ready. Run the company_settings SQL first, then reload this page.";
  }
  return rawMessage;
}

loadSettings();
