const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";

const form = document.getElementById("customerForm");
const msg = document.getElementById("customerMessage");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "Saving customer...";
  msg.style.color = "";

  await window.CompanyContext?.ready();
  const data = window.CompanyContext?.withCompanyId(Object.fromEntries(new FormData(form).entries())) || Object.fromEntries(new FormData(form).entries());
  Object.keys(data).forEach(key => {
    if (data[key] === "") data[key] = null;
  });

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/customers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: API_KEY,
        Authorization: "Bearer " + API_KEY,
        Prefer: "return=representation"
      },
      body: JSON.stringify(data)
    });

    const result = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(result));

    const customer = Array.isArray(result) ? result[0] : result;
    msg.textContent = `Customer saved. ID: ${customer.id}`;
    msg.style.color = "#047857";
    form.reset();
  } catch (err) {
    console.error(err);
    msg.textContent = `Error saving customer: ${err.message}`;
    msg.style.color = "#ef4444";
  }
});
