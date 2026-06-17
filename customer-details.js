const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const headers = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

let currentCustomer = null;

function getCustomerId() {
  return new URLSearchParams(window.location.search).get("id");
}

async function loadCustomerDetails() {
  const id = getCustomerId();
  const msg = document.getElementById("customerDetailsMessage");

  if (!id) {
    document.getElementById("customerTitle").textContent = "No customer ID provided.";
    return;
  }

  try {
    await window.CompanyContext?.ready();
    const res = await fetch(`${BASE_URL}/rest/v1/customers?id=eq.${id}&select=*`, { headers });
    if (!res.ok) throw new Error(await res.text());

    const [customer] = await res.json();
    if (!customer) {
      document.getElementById("customerTitle").textContent = "Customer not found.";
      return;
    }

    currentCustomer = customer;
    renderCustomer(customer);
    await Promise.all([
      loadCustomerLoads(customer.company_name),
      loadCustomerInvoices(customer.company_name)
    ]);
  } catch (err) {
    console.error(err);
    msg.textContent = `Error loading customer: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

function renderCustomer(customer) {
  document.getElementById("customerTitle").textContent = customer.company_name;
  document.getElementById("customerType").textContent = formatStatus(customer.customer_type);
  document.getElementById("contactName").textContent = customer.contact_name || "N/A";
  document.getElementById("phone").textContent = customer.phone || "N/A";
  document.getElementById("email").textContent = customer.email || "N/A";
  document.getElementById("paymentTerms").textContent = customer.payment_terms || "N/A";
  document.getElementById("status").textContent = formatStatus(customer.status);
  document.getElementById("billingAddress").textContent = customer.billing_address || "N/A";
  document.getElementById("notes").textContent = customer.notes || "N/A";
  document.getElementById("editCustomerLink").href = `edit-customer.html?id=${customer.id}`;
}

async function loadCustomerLoads(companyName) {
  const tbody = document.getElementById("customerLoadsTableBody");
  tbody.innerHTML = `<tr><td colspan="5">Loading loads...</td></tr>`;

  const encoded = encodeURIComponent(`"${companyName.replaceAll('"', '\\"')}"`);
  const query = `or=(customer_name.eq.${encoded},customer.eq.${encoded})&select=*&order=created_at.desc`;
  const res = await fetch(
    window.CompanyContext?.scopedUrl("loads", query) || `${BASE_URL}/rest/v1/loads?${query}`,
    { headers }
  );

  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="5">Error loading loads.</td></tr>`;
    return;
  }

  const loads = await res.json();
  tbody.innerHTML = "";

  if (!loads.length) {
    tbody.innerHTML = `<tr><td colspan="5">No loads found for this customer.</td></tr>`;
    return;
  }

  loads.forEach(load => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${load.load_number || load.id}</td>
      <td>${load.pickup_location || "-"} to ${load.delivery_location || load.dropoff_location || "-"}</td>
      <td>${formatStatus(load.status)}</td>
      <td>${formatCurrency(load.rate)}</td>
      <td><a class="view" href="load-details.html?id=${load.id}">View</a></td>
    `;
    tbody.appendChild(row);
  });
}

async function loadCustomerInvoices(companyName) {
  const tbody = document.getElementById("customerInvoicesTableBody");
  tbody.innerHTML = `<tr><td colspan="5">Loading invoices...</td></tr>`;

  const encoded = encodeURIComponent(`"${companyName.replaceAll('"', '\\"')}"`);
  const query = `customer_name=eq.${encoded}&select=*&order=created_at.desc`;
  const res = await fetch(
    window.CompanyContext?.scopedUrl("invoices", query) || `${BASE_URL}/rest/v1/invoices?${query}`,
    { headers }
  );

  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="5">Error loading invoices.</td></tr>`;
    return;
  }

  const invoices = await res.json();
  tbody.innerHTML = "";

  if (!invoices.length) {
    tbody.innerHTML = `<tr><td colspan="5">No invoices found for this customer.</td></tr>`;
    return;
  }

  invoices.forEach(invoice => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${invoice.invoice_number || invoice.id}</td>
      <td>${formatStatus(invoice.status)}</td>
      <td>${invoice.due_date || "N/A"}</td>
      <td>${formatCurrency(invoice.total_amount)}</td>
      <td><a class="view" href="invoice-details.html?id=${invoice.id}">View</a></td>
    `;
    tbody.appendChild(row);
  });
}

function formatCurrency(value) {
  return value ? `$${Number(value).toLocaleString()}` : "$0";
}

function formatStatus(value) {
  return (value || "N/A").replaceAll("_", " ");
}

loadCustomerDetails();
