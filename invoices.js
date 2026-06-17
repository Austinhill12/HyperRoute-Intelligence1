const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const headers = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

async function loadInvoices() {
  const msg = document.getElementById("invoicesMessage");
  msg.textContent = "Loading invoices...";

  try {
    await window.CompanyContext?.ready();
    const [invoiceRes, loadMap] = await Promise.all([
      fetch(window.CompanyContext?.scopedUrl("invoices", "select=*&order=created_at.desc") || `${BASE_URL}/rest/v1/invoices?select=*&order=created_at.desc`, { headers }),
      fetchLoadMap()
    ]);

    if (!invoiceRes.ok) throw new Error(await invoiceRes.text());

    const invoices = await invoiceRes.json();
    msg.textContent = "";
    renderInvoices(invoices, loadMap);
  } catch (err) {
    console.error(err);
    msg.textContent = `Error loading invoices: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

function renderInvoices(invoices, loadMap) {
  const tbody = document.getElementById("invoicesTableBody");
  tbody.innerHTML = "";

  if (!invoices.length) {
    tbody.innerHTML = `<tr><td colspan="8">No invoices found.</td></tr>`;
    return;
  }

  invoices.forEach(invoice => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${invoice.invoice_number || invoice.id}</td>
      <td>${loadMap.get(invoice.load_id) || invoice.load_id}</td>
      <td>${invoice.customer_name || "N/A"}</td>
      <td>${formatStatus(invoice.status)}</td>
      <td>${formatDate(invoice.invoice_date)}</td>
      <td>${formatDate(invoice.due_date)}</td>
      <td>${formatCurrency(invoice.total_amount)}</td>
      <td>
        <a class="view" href="invoice-details.html?id=${invoice.id}">View</a>
        <a class="view" href="edit-invoice.html?id=${invoice.id}">Edit</a>
        <button class="delete" data-delete="${invoice.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });

  tbody.querySelectorAll("[data-delete]").forEach(btn => {
    btn.addEventListener("click", () => deleteInvoice(btn.dataset.delete));
  });
}

async function fetchLoadMap() {
  const url = window.CompanyContext?.scopedUrl("loads", "select=id,load_number") || `${BASE_URL}/rest/v1/loads?select=id,load_number`;
  const res = await fetch(url, { headers });
  if (!res.ok) return new Map();
  const loads = await res.json();
  return new Map(loads.map(load => [load.id, load.load_number || `Load ${load.id}`]));
}

async function deleteInvoice(id) {
  if (!confirm("Delete this invoice?")) return;

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/invoices?id=eq.${id}`, {
      method: "DELETE",
      headers
    });

    if (!res.ok) throw new Error(await res.text());
    loadInvoices();
  } catch (err) {
    console.error(err);
    alert(`Error deleting invoice: ${err.message}`);
  }
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : "N/A";
}

function formatCurrency(value) {
  return value ? `$${Number(value).toLocaleString()}` : "$0";
}

function formatStatus(value) {
  return (value || "draft").replaceAll("_", " ");
}

loadInvoices();
