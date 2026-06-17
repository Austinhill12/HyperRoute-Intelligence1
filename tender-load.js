const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const fallbackHeaders = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

const form = document.getElementById("tenderForm");
const msg = document.getElementById("tenderMessage");
const tbody = document.getElementById("tendersTableBody");
const carrierSelect = document.getElementById("carrierSelect");
const cancelButton = document.getElementById("cancelTenderEdit");
const formTitle = document.getElementById("tenderFormTitle");
const saveButton = document.getElementById("saveTenderButton");

let currentLoad = null;
let carriers = [];
let tenders = [];

function getHeaders(extra = {}) {
  return {
    ...(window.CompanyContext?.getHeaders?.() || fallbackHeaders),
    ...extra
  };
}

function getLoadId() {
  return new URLSearchParams(window.location.search).get("id");
}

async function initTenderPage() {
  const loadId = getLoadId();
  if (!loadId) {
    msg.textContent = "No load ID provided.";
    msg.style.color = "#ef4444";
    return;
  }

  try {
    await window.CompanyContext?.ready();
    currentLoad = await fetchLoad(loadId);
    if (!currentLoad) throw new Error("Load not found.");
    document.getElementById("backToLoadLink").href = `load-details.html?id=${currentLoad.id}`;
    document.getElementById("tenderLoadSummary").textContent = `${currentLoad.load_number || currentLoad.id} • ${currentLoad.pickup_location || "Pickup"} to ${currentLoad.delivery_location || currentLoad.dropoff_location || "Delivery"} • Customer rate ${formatCurrency(currentLoad.rate || 0)}`;
    document.getElementById("carrierRate").value = currentLoad.carrier_rate || "";
    document.getElementById("tenderNumber").value = `TND-${currentLoad.load_number || currentLoad.id}`;
    document.getElementById("terms").value = "Carrier must confirm pickup appointment, provide check calls, notify dispatch of delays, and submit POD immediately after delivery.";

    bindEvents();
    await loadCarriers();
    await loadTenders();
  } catch (err) {
    msg.textContent = err.message;
    msg.style.color = "#ef4444";
  }
}

function bindEvents() {
  form.addEventListener("submit", saveTender);
  cancelButton.addEventListener("click", resetForm);
  carrierSelect.addEventListener("change", fillCarrierContact);
}

async function fetchLoad(loadId) {
  const res = await fetch(
    window.CompanyContext?.scopedUrl("loads", `id=eq.${loadId}&select=*`) || `${BASE_URL}/rest/v1/loads?id=eq.${loadId}&select=*`,
    { headers: getHeaders() }
  );
  if (!res.ok) throw new Error(await res.text());
  const rows = await res.json();
  return rows[0] || null;
}

async function loadCarriers() {
  carrierSelect.innerHTML = `<option value="">Select carrier</option>`;
  const url = window.CompanyContext?.scopedUrl("carriers", "select=*&status=eq.active&order=carrier_name.asc") || `${BASE_URL}/rest/v1/carriers?select=*&status=eq.active&order=carrier_name.asc`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(await res.text());
  carriers = await res.json();

  carriers.forEach(carrier => {
    const option = document.createElement("option");
    option.value = carrier.id;
    option.textContent = getCarrierOptionLabel(carrier);
    option.disabled = isCarrierBlockedForTender(carrier);
    carrierSelect.appendChild(option);
  });
}

async function loadTenders() {
  tbody.innerHTML = `<tr><td colspan="6">Loading tenders...</td></tr>`;
  const query = `load_id=eq.${currentLoad.id}&select=*&order=created_at.desc`;
  const res = await fetch(
    window.CompanyContext?.scopedUrl("load_tenders", query) || `${BASE_URL}/rest/v1/load_tenders?${query}`,
    { headers: getHeaders() }
  );
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="6">Run carrier-tenders.sql in Supabase first.</td></tr>`;
    return;
  }
  tenders = await res.json();
  renderTenders();
}

function renderTenders() {
  if (!tenders.length) {
    tbody.innerHTML = `<tr><td colspan="6">No carrier tenders created.</td></tr>`;
    return;
  }

  tbody.innerHTML = tenders.map(tender => {
    const carrier = carriers.find(item => String(item.id) === String(tender.carrier_id));
    return `
      <tr>
        <td><strong>${escapeHtml(carrier?.carrier_name || "Carrier")}</strong><span class="muted-line">${escapeHtml(tender.tender_number || "")}</span></td>
        <td><span class="status-pill ${getTenderStatusClass(tender.status)}">${escapeHtml(formatStatus(tender.status))}</span></td>
        <td>${formatCurrency(tender.carrier_rate)}</td>
        <td>${formatTimestamp(tender.expires_at)}</td>
        <td>${escapeHtml([tender.contact_name, tender.contact_phone, tender.contact_email].filter(Boolean).join(" / ") || "N/A")}</td>
        <td>
          <button class="view" type="button" data-edit-tender="${escapeHtml(tender.id)}">Edit</button>
          ${tender.status !== "accepted" ? `<button class="view" type="button" data-accept-tender="${escapeHtml(tender.id)}">Accept</button>` : ""}
          ${!["rejected", "cancelled"].includes(tender.status) ? `<button class="delete" type="button" data-status-tender="${escapeHtml(tender.id)}" data-status="rejected">Reject</button>` : ""}
          <a class="view secondary-action" href="rate-confirmation.html?id=${currentLoad.id}&tender_id=${escapeHtml(tender.id)}">Rate Conf</a>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("[data-edit-tender]").forEach(button => button.addEventListener("click", () => editTender(button.dataset.editTender)));
  tbody.querySelectorAll("[data-accept-tender]").forEach(button => button.addEventListener("click", () => acceptTender(button.dataset.acceptTender)));
  tbody.querySelectorAll("[data-status-tender]").forEach(button => button.addEventListener("click", () => updateTenderStatus(button.dataset.statusTender, button.dataset.status)));
}

async function saveTender(event) {
  event.preventDefault();
  msg.textContent = "Saving tender...";
  msg.style.color = "";

  const data = normalizeTenderData(Object.fromEntries(new FormData(form).entries()));
  const id = data.id;
  delete data.id;

  data.load_id = Number(currentLoad.id);
  if (data.status === "sent" && !data.sent_at) data.sent_at = new Date().toISOString();
  if (["accepted", "rejected"].includes(data.status)) data.responded_at = new Date().toISOString();

  const payload = id ? data : (window.CompanyContext?.withCompanyId(data) || data);
  const url = id ? `${BASE_URL}/rest/v1/load_tenders?id=eq.${encodeURIComponent(id)}` : `${BASE_URL}/rest/v1/load_tenders`;

  try {
    const res = await fetch(url, {
      method: id ? "PATCH" : "POST",
      headers: getHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(result));

    const savedTender = Array.isArray(result) ? result[0] : result;
    if (savedTender.status === "accepted") await applyAcceptedTender(savedTender);
    await recordTenderEvent(savedTender, id ? "Tender updated." : "Tender created.");

    msg.textContent = savedTender.status === "accepted" ? "Tender accepted and load updated." : "Tender saved.";
    msg.style.color = "#047857";
    resetForm();
    await loadTenders();
  } catch (err) {
    msg.textContent = err.message.includes("load_tenders")
      ? "Run carrier-tenders.sql in Supabase first, then try again."
      : `Error saving tender: ${err.message}`;
    msg.style.color = "#ef4444";
  }
}

function normalizeTenderData(data) {
  Object.keys(data).forEach(key => {
    if (typeof data[key] === "string") data[key] = data[key].trim();
    if (data[key] === "") data[key] = null;
  });
  if (data.carrier_rate) data.carrier_rate = Number(data.carrier_rate);
  if (data.expires_at) data.expires_at = new Date(data.expires_at).toISOString();
  return data;
}

function editTender(id) {
  const tender = tenders.find(item => String(item.id) === String(id));
  if (!tender) return;
  Array.from(form.elements).forEach(input => {
    if (!input.name) return;
    if (input.type === "datetime-local") input.value = toLocalDateTimeValue(tender[input.name]);
    else input.value = tender[input.name] ?? "";
  });
  formTitle.textContent = "Edit Tender";
  saveButton.textContent = "Update Tender";
  cancelButton.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetForm() {
  form.reset();
  document.getElementById("tenderId").value = "";
  document.getElementById("carrierRate").value = currentLoad?.carrier_rate || "";
  document.getElementById("tenderNumber").value = `TND-${currentLoad?.load_number || currentLoad?.id || ""}`;
  document.getElementById("terms").value = "Carrier must confirm pickup appointment, provide check calls, notify dispatch of delays, and submit POD immediately after delivery.";
  formTitle.textContent = "Create Tender";
  saveButton.textContent = "Save Tender";
  cancelButton.classList.add("hidden");
}

async function acceptTender(id) {
  const tender = tenders.find(item => String(item.id) === String(id));
  if (!tender || !confirm("Accept this carrier tender and update the load carrier/rate?")) return;
  await updateTenderStatus(id, "accepted");
}

async function updateTenderStatus(id, status) {
  const tender = tenders.find(item => String(item.id) === String(id));
  const payload = {
    status,
    responded_at: ["accepted", "rejected"].includes(status) ? new Date().toISOString() : null,
    sent_at: status === "sent" ? new Date().toISOString() : tender?.sent_at || null
  };

  const res = await fetch(`${BASE_URL}/rest/v1/load_tenders?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: getHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify(payload)
  });
  const result = await res.json();
  if (!res.ok) {
    alert(`Error updating tender: ${JSON.stringify(result)}`);
    return;
  }

  const savedTender = Array.isArray(result) ? result[0] : result;
  if (status === "accepted") await applyAcceptedTender(savedTender);
  await recordTenderEvent(savedTender, `Tender ${formatStatus(status)}.`);
  await loadTenders();
}

async function applyAcceptedTender(tender) {
  const res = await fetch(`${BASE_URL}/rest/v1/loads?id=eq.${currentLoad.id}`, {
    method: "PATCH",
    headers: getHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify({
      carrier_id: tender.carrier_id,
      carrier_rate: tender.carrier_rate,
      status: ["booked", "draft"].includes(currentLoad.status) ? "dispatched" : currentLoad.status
    })
  });
  const result = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(result));
  currentLoad = Array.isArray(result) ? result[0] : result;
}

async function recordTenderEvent(tender, note) {
  const carrier = carriers.find(item => String(item.id) === String(tender.carrier_id));
  const eventData = window.CompanyContext?.withCompanyId({
    load_id: Number(currentLoad.id),
    event_type: "carrier_tender",
    event_time: new Date().toISOString(),
    location: null,
    notes: `${note} Carrier: ${carrier?.carrier_name || "Carrier"}. Rate: ${formatCurrency(tender.carrier_rate)}.`
  }) || {
    load_id: Number(currentLoad.id),
    event_type: "carrier_tender",
    event_time: new Date().toISOString(),
    location: null,
    notes: `${note} Carrier: ${carrier?.carrier_name || "Carrier"}. Rate: ${formatCurrency(tender.carrier_rate)}.`
  };

  const res = await fetch(`${BASE_URL}/rest/v1/load_events`, {
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify(eventData)
  });
  if (!res.ok) console.warn("Could not record tender event:", await res.text());
}

function fillCarrierContact() {
  const carrier = carriers.find(item => String(item.id) === String(carrierSelect.value));
  if (!carrier) return;
  document.getElementById("contactName").value = carrier.contact_name || "";
  document.getElementById("contactEmail").value = carrier.email || "";
  document.getElementById("contactPhone").value = carrier.phone || "";
}

function getCarrierOptionLabel(carrier) {
  const warnings = [];
  if (!carrier.insurance_expiration) warnings.push("insurance missing");
  if (isInsuranceExpired(carrier.insurance_expiration)) warnings.push("insurance expired");
  if ((carrier.w9_status || "missing") === "missing") warnings.push("W-9 missing");
  if (carrier.safety_rating === "unsatisfactory") warnings.push("unsatisfactory safety");
  return warnings.length ? `${carrier.carrier_name} (${warnings.join(", ")})` : carrier.carrier_name;
}

function isCarrierBlockedForTender(carrier) {
  return carrier.status !== "active" || carrier.safety_rating === "unsatisfactory" || isInsuranceExpired(carrier.insurance_expiration);
}

function isInsuranceExpired(value) {
  if (!value) return false;
  return new Date(`${value}T00:00:00`) < new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
}

function getTenderStatusClass(status) {
  if (status === "accepted") return "success";
  if (["rejected", "cancelled"].includes(status)) return "warning";
  if (status === "sent") return "caution";
  return "success";
}

function toLocalDateTimeValue(value) {
  if (!value) return "";
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function formatTimestamp(value) {
  return value ? new Date(value).toLocaleString() : "N/A";
}

function formatCurrency(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatStatus(value) {
  return String(value || "N/A").replaceAll("_", " ");
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

initTenderPage();
