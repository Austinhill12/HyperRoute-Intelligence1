const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const fallbackHeaders = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

const form = document.getElementById("vehicleForm");
const msg = document.getElementById("vehicleMessage");

function getHeaders(extra = {}) {
  return {
    ...(window.CompanyContext?.getHeaders?.() || fallbackHeaders),
    ...extra
  };
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "Creating truck...";
  msg.style.color = "#334155";

  await window.CompanyContext?.ready();
  const companyId = window.CompanyContext?.getCompanyId();

  if (!companyId) {
    msg.textContent = "No company selected. Select or create a company before adding trucks.";
    msg.style.color = "#ef4444";
    return;
  }

  const data = window.CompanyContext.withCompanyId(Object.fromEntries(new FormData(form).entries()));

  Object.keys(data).forEach(key => {
    if (data[key] === "") data[key] = null;
  });

  try {
    const res = await fetch(
      `${BASE_URL}/rest/v1/trucks`,
      {
        method: "POST",
        headers: getHeaders({
          "Content-Type": "application/json",
          Prefer: "return=representation"
        }),
        body: JSON.stringify(data)
      }
    );

    const resultText = await res.text();
    if (!res.ok) throw new Error(resultText);

    msg.textContent = "Truck created successfully.";
    msg.style.color = "#047857";
    form.reset();
  } catch (err) {
    console.error(err);
    msg.textContent = `Error creating truck: ${getTruckErrorMessage(err.message)}`;
    msg.style.color = "#ef4444";
  }
});

function getTruckErrorMessage(message) {
  if (message.includes("row-level security") || message.includes("violates row-level security")) {
    return "Supabase blocked the save. Run the truck access SQL, then try again.";
  }

  if (message.includes("company_id")) {
    return "Truck company access is not ready. Confirm multi-company SQL was run and a company is selected.";
  }

  if (message.includes("schema cache")) {
    return "Supabase schema cache does not match the app yet. Refresh Supabase schema or rerun the truck SQL.";
  }

  return message || "Unknown Supabase error.";
}
