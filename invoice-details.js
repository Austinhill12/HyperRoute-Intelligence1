const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const headers = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

let currentInvoice = null;
let companySettings = null;

function getInvoiceId() {
  return new URLSearchParams(window.location.search).get("id");
}

async function loadInvoiceDetails() {
  const id = getInvoiceId();
  const msg = document.getElementById("invoiceDetailsMessage");

  if (!id) {
    document.getElementById("invoiceTitle").textContent = "No invoice ID provided.";
    return;
  }

  try {
    companySettings = await fetchCompanySettings();
    renderCompanyHeader(companySettings);

    const res = await fetch(`${BASE_URL}/rest/v1/invoices?id=eq.${id}&select=*`, { headers });
    if (!res.ok) throw new Error(await res.text());

    const [invoice] = await res.json();
    if (!invoice) {
      document.getElementById("invoiceTitle").textContent = "Invoice not found.";
      return;
    }

    currentInvoice = invoice;
    renderInvoice(invoice);
  } catch (err) {
    console.error(err);
    msg.textContent = `Error loading invoice: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

async function fetchCompanySettings() {
  try {
    const res = await fetch(`${BASE_URL}/rest/v1/company_settings?id=eq.1&select=*`, { headers });
    if (!res.ok) return null;
    const [settings] = await res.json();
    return settings || null;
  } catch (err) {
    console.warn("Company settings unavailable:", err);
    return null;
  }
}

function renderCompanyHeader(settings) {
  const companyName = document.getElementById("companyNameText");
  const address = document.getElementById("companyAddressText");
  const contact = document.getElementById("companyContactText");
  const authority = document.getElementById("companyAuthorityText");
  const logo = document.getElementById("companyLogoPreview");

  const data = settings || {};
  companyName.textContent = data.company_name || "HyperRoute Intelligence";
  address.textContent = [
    data.address_line_1,
    data.address_line_2,
    [data.city, data.state, data.zip].filter(Boolean).join(", ")
  ].filter(Boolean).join(" | ");
  contact.textContent = [data.phone, data.email, data.website].filter(Boolean).join(" | ");
  authority.textContent = [data.mc_number ? `MC ${data.mc_number}` : "", data.dot_number ? `DOT ${data.dot_number}` : ""].filter(Boolean).join(" | ");

  if (data.logo_url) {
    logo.src = data.logo_url;
    logo.style.display = "block";
  } else {
    logo.style.display = "none";
  }
}

function renderInvoice(invoice) {
  document.getElementById("invoiceTitle").textContent = `Invoice ${invoice.invoice_number || invoice.id}`;
  document.getElementById("invoiceLoad").textContent = invoice.load_id || "N/A";
  document.getElementById("invoiceCustomer").textContent = invoice.customer_name || "N/A";
  document.getElementById("invoiceStatusText").textContent = formatStatus(invoice.status);
  document.getElementById("invoiceDateText").textContent = formatDate(invoice.invoice_date);
  document.getElementById("dueDateText").textContent = formatDate(invoice.due_date);
  document.getElementById("paidDateText").textContent = formatDate(invoice.paid_date);
  document.getElementById("linehaulAmountText").textContent = formatCurrency(invoice.linehaul_amount);
  document.getElementById("accessorialAmountText").textContent = formatCurrency(invoice.accessorial_amount);
  document.getElementById("totalAmountText").textContent = formatCurrency(invoice.total_amount);
  document.getElementById("totalAmountTextDuplicate").textContent = formatCurrency(invoice.total_amount);
  document.getElementById("invoiceNotesText").textContent = invoice.notes || "N/A";

  document.getElementById("invoiceStatus").value = invoice.status || "draft";
  document.getElementById("invoiceNumber").value = invoice.invoice_number || "";
  document.getElementById("invoiceDate").value = invoice.invoice_date || "";
  document.getElementById("dueDate").value = invoice.due_date || "";
  document.getElementById("paidDate").value = invoice.paid_date || "";
  document.getElementById("linehaulAmount").value = invoice.linehaul_amount || 0;
  document.getElementById("accessorialAmount").value = invoice.accessorial_amount || 0;
  document.getElementById("invoiceNotes").value = invoice.notes || "";
}

document.getElementById("invoiceUpdateForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const id = getInvoiceId();
  const msg = document.getElementById("invoiceDetailsMessage");
  const data = Object.fromEntries(new FormData(e.target).entries());

  Object.keys(data).forEach(key => {
    if (data[key] === "") data[key] = null;
  });

  if (data.linehaul_amount) data.linehaul_amount = Number(data.linehaul_amount);
  if (data.accessorial_amount) data.accessorial_amount = Number(data.accessorial_amount);

  msg.textContent = "Saving invoice...";
  msg.style.color = "";

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/invoices?id=eq.${id}`, {
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

    currentInvoice = Array.isArray(result) ? result[0] : result;
    renderInvoice(currentInvoice);
    msg.textContent = "Invoice saved.";
    msg.style.color = "#047857";
  } catch (err) {
    console.error(err);
    msg.textContent = `Error saving invoice: ${err.message}`;
    msg.style.color = "#ef4444";
  }
});

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : "N/A";
}

function formatCurrency(value) {
  return value ? `$${Number(value).toLocaleString()}` : "$0";
}

function formatStatus(value) {
  return (value || "draft").replaceAll("_", " ");
}

document.getElementById("printInvoiceBtn")?.addEventListener("click", () => window.print());
loadInvoiceDetails();
