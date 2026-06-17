const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const headers = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

const form = document.getElementById("editCustomerForm");
const msg = document.getElementById("editCustomerMessage");
const header = document.getElementById("customerHeader");

function getCustomerId() {
  return new URLSearchParams(window.location.search).get("id");
}

async function loadCustomer() {
  const id = getCustomerId();
  if (!id) {
    header.textContent = "No customer ID provided.";
    return;
  }

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/customers?id=eq.${id}&select=*`, { headers });
    if (!res.ok) throw new Error(await res.text());

    const [customer] = await res.json();
    if (!customer) {
      header.textContent = "Customer not found.";
      return;
    }

    header.textContent = customer.company_name;
    document.getElementById("companyName").value = customer.company_name || "";
    document.getElementById("customerType").value = customer.customer_type || "shipper";
    document.getElementById("contactName").value = customer.contact_name || "";
    document.getElementById("phone").value = customer.phone || "";
    document.getElementById("email").value = customer.email || "";
    document.getElementById("paymentTerms").value = customer.payment_terms || "Net 30";
    document.getElementById("status").value = customer.status || "active";
    document.getElementById("billingAddress").value = customer.billing_address || "";
    document.getElementById("notes").value = customer.notes || "";
  } catch (err) {
    console.error(err);
    header.textContent = "Error loading customer.";
    msg.textContent = err.message;
    msg.style.color = "#ef4444";
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = getCustomerId();
  if (!id) return;

  const data = Object.fromEntries(new FormData(form).entries());
  Object.keys(data).forEach(key => {
    if (data[key] === "") data[key] = null;
  });

  msg.textContent = "Saving customer...";
  msg.style.color = "";

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/customers?id=eq.${id}`, {
      method: "PATCH",
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
    header.textContent = customer.company_name;
    msg.textContent = "Customer updated.";
    msg.style.color = "#047857";
  } catch (err) {
    console.error(err);
    msg.textContent = `Error updating customer: ${err.message}`;
    msg.style.color = "#ef4444";
  }
});

loadCustomer();
