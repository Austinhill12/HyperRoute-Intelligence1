const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const fallbackHeaders = { apikey: API_KEY, Authorization: `Bearer ${API_KEY}` };

const quoteForm = document.getElementById("quoteForm");
const quoteMessage = document.getElementById("quoteMessage");
let quotes = [];

function getHeaders(extra = {}) {
  return {
    ...(window.CompanyContext?.getHeaders?.() || fallbackHeaders),
    ...extra
  };
}

async function initQuotes() {
  quoteMessage.textContent = "Loading quotes...";
  quoteMessage.style.color = "";

  try {
    await window.CompanyContext?.ready();
    await fillCustomers();
    await loadQuotes();
    quoteMessage.textContent = "";
  } catch (err) {
    console.error(err);
    quoteMessage.textContent = getQuoteError(err.message);
    quoteMessage.style.color = "#ef4444";
  }
}

async function fillCustomers() {
  const select = document.getElementById("quoteCustomerSelect");
  select.innerHTML = `<option value="">Manual / Unlisted Customer</option>`;

  const res = await fetch(
    window.CompanyContext?.scopedUrl("customers", "select=company_name,status&order=company_name.asc") || `${BASE_URL}/rest/v1/customers?select=company_name,status&order=company_name.asc`,
    { headers: getHeaders() }
  );

  if (!res.ok) return;
  const customers = await res.json();
  customers
    .filter(customer => (customer.status || "active") === "active")
    .forEach(customer => {
      const option = document.createElement("option");
      option.value = customer.company_name;
      option.textContent = customer.company_name;
      select.appendChild(option);
    });
}

async function loadQuotes() {
  const tbody = document.getElementById("quotesTableBody");
  tbody.innerHTML = `<tr><td colspan="7">Loading quotes...</td></tr>`;

  const res = await fetch(
    window.CompanyContext?.scopedUrl("quotes", "select=*&order=created_at.desc") || `${BASE_URL}/rest/v1/quotes?select=*&order=created_at.desc`,
    { headers: getHeaders() }
  );

  if (!res.ok) throw new Error(await res.text());
  quotes = await res.json();
  renderQuotes();
  renderQuoteKpis();
}

function renderQuotes() {
  const tbody = document.getElementById("quotesTableBody");
  tbody.innerHTML = "";

  if (!quotes.length) {
    tbody.innerHTML = `<tr><td colspan="7">No quotes found.</td></tr>`;
    return;
  }

  quotes.forEach(quote => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(quote.quote_number || quote.id)}</td>
      <td>${escapeHtml(quote.customer_name || "N/A")}</td>
      <td>${escapeHtml(quote.pickup_location || "-")} to ${escapeHtml(quote.delivery_location || "-")}</td>
      <td>${formatDate(quote.pickup_date)}</td>
      <td>
        <select class="table-select" data-status="${quote.id}">
          ${["draft", "sent", "accepted", "rejected", "expired"].map(status => (
            `<option value="${status}" ${status === quote.status ? "selected" : ""}>${formatStatus(status)}</option>`
          )).join("")}
        </select>
      </td>
      <td>${formatCurrency(quote.quoted_rate)}</td>
      <td>
        <button class="view" type="button" data-copy-quote="${quote.id}">Copy</button>
        <button class="view secondary-action" type="button" data-convert-quote="${quote.id}" ${quote.load_id ? "disabled" : ""}>${quote.load_id ? "Converted" : "Convert"}</button>
        <button class="delete" type="button" data-delete-quote="${quote.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });

  tbody.querySelectorAll("[data-status]").forEach(select => {
    select.addEventListener("change", () => updateQuoteStatus(select.dataset.status, select.value));
  });

  tbody.querySelectorAll("[data-copy-quote]").forEach(button => {
    button.addEventListener("click", () => copyQuoteMessage(button.dataset.copyQuote));
  });

  tbody.querySelectorAll("[data-convert-quote]").forEach(button => {
    button.addEventListener("click", () => convertQuoteToLoad(button.dataset.convertQuote));
  });

  tbody.querySelectorAll("[data-delete-quote]").forEach(button => {
    button.addEventListener("click", () => deleteQuote(button.dataset.deleteQuote));
  });
}

function renderQuoteKpis() {
  const total = quotes.length;
  const open = quotes.filter(quote => ["draft", "sent"].includes(quote.status)).length;
  const accepted = quotes.filter(quote => quote.status === "accepted").length;
  const decided = quotes.filter(quote => ["accepted", "rejected"].includes(quote.status)).length;
  const winRate = decided ? Math.round((accepted / decided) * 100) : 0;

  document.getElementById("quoteTotal").textContent = total;
  document.getElementById("quoteOpen").textContent = open;
  document.getElementById("quoteAccepted").textContent = accepted;
  document.getElementById("quoteWinRate").textContent = `${winRate}%`;
}

quoteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  quoteMessage.textContent = "Saving quote...";
  quoteMessage.style.color = "";

  const data = normalizeQuoteData(Object.fromEntries(new FormData(quoteForm).entries()));
  if (data.manual_customer_name) data.customer_name = data.manual_customer_name;
  delete data.manual_customer_name;

  const quoteData = window.CompanyContext?.withCompanyId(data) || data;

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/quotes`, {
      method: "POST",
      headers: getHeaders({
        "Content-Type": "application/json",
        Prefer: "return=representation"
      }),
      body: JSON.stringify(quoteData)
    });

    const result = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(result));

    quoteMessage.textContent = "Quote saved.";
    quoteMessage.style.color = "#047857";
    quoteForm.reset();
    await loadQuotes();
  } catch (err) {
    console.error(err);
    quoteMessage.textContent = getQuoteError(err.message);
    quoteMessage.style.color = "#ef4444";
  }
});

async function updateQuoteStatus(id, status) {
  try {
    const res = await fetch(`${BASE_URL}/rest/v1/quotes?id=eq.${id}`, {
      method: "PATCH",
      headers: getHeaders({
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      }),
      body: JSON.stringify({ status, updated_at: new Date().toISOString() })
    });

    if (!res.ok) throw new Error(await res.text());
    await loadQuotes();
  } catch (err) {
    console.error(err);
    alert(`Error updating quote: ${err.message}`);
  }
}

async function convertQuoteToLoad(id) {
  const quote = quotes.find(row => String(row.id) === String(id));
  if (!quote) return;
  if (quote.load_id) return;
  if (!confirm("Convert this quote into a booked load?")) return;

  const baseLoadData = {
    load_number: `LD-${quote.quote_number || quote.id}`,
    customer_name: quote.customer_name,
    customer: quote.customer_name,
    pickup_location: quote.pickup_location,
    delivery_location: quote.delivery_location,
    dropoff_location: quote.delivery_location,
    pickup_date: quote.pickup_date,
    delivery_date: quote.delivery_date,
    dropoff_date: quote.delivery_date,
    commodity: quote.commodity,
    trailer_type: quote.equipment_type,
    rate: quote.quoted_rate,
    weight: quote.weight,
    status: "booked",
    notes: quote.notes ? `Converted from quote ${quote.quote_number || quote.id}. ${quote.notes}` : `Converted from quote ${quote.quote_number || quote.id}.`
  };
  const loadData = window.CompanyContext?.withCompanyId(baseLoadData) || baseLoadData;

  try {
    const loadRes = await fetch(`${BASE_URL}/rest/v1/loads`, {
      method: "POST",
      headers: getHeaders({
        "Content-Type": "application/json",
        Prefer: "return=representation"
      }),
      body: JSON.stringify(loadData)
    });

    const loadResult = await loadRes.json();
    if (!loadRes.ok) throw new Error(JSON.stringify(loadResult));
    const load = Array.isArray(loadResult) ? loadResult[0] : loadResult;

    await fetch(`${BASE_URL}/rest/v1/quotes?id=eq.${id}`, {
      method: "PATCH",
      headers: getHeaders({
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      }),
      body: JSON.stringify({
        status: "accepted",
        load_id: load.id,
        converted_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    });

    await createLoadEvent(load, quote);
    quoteMessage.textContent = `Quote converted to Load ${load.load_number || load.id}.`;
    quoteMessage.style.color = "#047857";
    await loadQuotes();
  } catch (err) {
    console.error(err);
    quoteMessage.textContent = `Error converting quote: ${err.message}`;
    quoteMessage.style.color = "#ef4444";
  }
}

async function createLoadEvent(load, quote) {
  const eventData = window.CompanyContext?.withCompanyId({
    load_id: Number(load.id),
    event_type: "booked",
    event_time: new Date().toISOString(),
    location: load.pickup_location || null,
    notes: `Load converted from quote ${quote.quote_number || quote.id}.`
  }) || null;

  if (!eventData) return;

  const res = await fetch(`${BASE_URL}/rest/v1/load_events`, {
    method: "POST",
    headers: getHeaders({
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    }),
    body: JSON.stringify(eventData)
  });

  if (!res.ok) console.warn("Could not create quote conversion event:", await res.text());
}

async function copyQuoteMessage(id) {
  const quote = quotes.find(row => String(row.id) === String(id));
  if (!quote) return;

  const message = [
    `Quote ${quote.quote_number || quote.id}`,
    `Customer: ${quote.customer_name || "N/A"}`,
    `Lane: ${quote.pickup_location || "-"} to ${quote.delivery_location || "-"}`,
    `Pickup: ${formatDate(quote.pickup_date)}`,
    `Equipment: ${quote.equipment_type || "N/A"}`,
    `Rate: ${formatCurrency(quote.quoted_rate)}`,
    ``,
    `Powered by HyperRoute Intelligence`
  ].join("\n");

  await copyText(message);
  quoteMessage.textContent = "Quote message copied.";
  quoteMessage.style.color = "#047857";
}

async function deleteQuote(id) {
  if (!confirm("Delete this quote?")) return;

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/quotes?id=eq.${id}`, {
      method: "DELETE",
      headers: getHeaders()
    });

    if (!res.ok) throw new Error(await res.text());
    await loadQuotes();
  } catch (err) {
    console.error(err);
    alert(`Error deleting quote: ${err.message}`);
  }
}

function normalizeQuoteData(data) {
  Object.keys(data).forEach(key => {
    if (data[key] === "") data[key] = null;
  });

  if (data.estimated_miles) data.estimated_miles = Number(data.estimated_miles);
  if (data.quoted_rate) data.quoted_rate = Number(data.quoted_rate);
  return data;
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function formatDate(value) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString() : "N/A";
}

function formatCurrency(value) {
  return value ? `$${Number(value).toLocaleString()}` : "N/A";
}

function formatStatus(value) {
  return String(value || "N/A").replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase());
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function getQuoteError(message) {
  if (message.includes("quotes") || message.includes("schema cache")) {
    return "Quotes are not ready. Run the quotes SQL in Supabase, then refresh this page.";
  }
  return `Error loading quotes: ${message}`;
}

initQuotes();
