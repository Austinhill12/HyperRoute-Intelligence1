const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const fallbackHeaders = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

let currentLoad = null;
let currentCarrier = null;
let currentTender = null;

function getHeaders(extra = {}) {
  return {
    ...(window.CompanyContext?.getHeaders?.() || fallbackHeaders),
    ...extra
  };
}

function getLoadId() {
  return new URLSearchParams(window.location.search).get("id");
}

function getTenderId() {
  return new URLSearchParams(window.location.search).get("tender_id");
}

async function initRateConfirmation() {
  const msg = document.getElementById("rateConfirmationMessage");
  const loadId = getLoadId();
  if (!loadId) {
    msg.textContent = "No load ID provided.";
    msg.style.color = "#ef4444";
    return;
  }

  try {
    await window.CompanyContext?.ready();
    const company = window.CompanyContext?.getCompany?.() || {};
    const load = await fetchLoad(loadId);
    if (!load) {
      msg.textContent = "Load not found.";
      msg.style.color = "#ef4444";
      return;
    }

    currentLoad = load;
    currentTender = getTenderId() ? await fetchTender(getTenderId()) : null;
    currentCarrier = currentTender?.carrier_id ? await fetchCarrier(currentTender.carrier_id) : load.carrier_id ? await fetchCarrier(load.carrier_id) : null;
    renderRateConfirmation(company, load, currentCarrier, currentTender);
    bindActions();
    msg.textContent = "";
  } catch (err) {
    msg.textContent = err.message;
    msg.style.color = "#ef4444";
  }
}

async function fetchTender(tenderId) {
  const res = await fetch(
    window.CompanyContext?.scopedUrl("load_tenders", `id=eq.${tenderId}&select=*`) || `${BASE_URL}/rest/v1/load_tenders?id=eq.${tenderId}&select=*`,
    { headers: getHeaders() }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
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

async function fetchCarrier(carrierId) {
  const res = await fetch(
    window.CompanyContext?.scopedUrl("carriers", `id=eq.${carrierId}&select=*`) || `${BASE_URL}/rest/v1/carriers?id=eq.${carrierId}&select=*`,
    { headers: getHeaders() }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

function renderRateConfirmation(company, load, carrier, tender) {
  document.getElementById("backToLoadLink").href = `load-details.html?id=${load.id}`;
  document.getElementById("rateCompanyName").textContent = company.company_name || "HyperRoute Intelligence";
  document.getElementById("rateCompanyDetails").textContent = [company.phone, company.email, company.mc_number ? `MC ${company.mc_number}` : "", company.dot_number ? `DOT ${company.dot_number}` : ""].filter(Boolean).join(" | ");
  document.getElementById("rateLoadNumber").textContent = `Load ${load.load_number || load.id}`;
  document.getElementById("rateStatus").textContent = tender ? `Tender ${formatStatus(tender.status)}` : formatStatus(load.status);

  document.getElementById("carrierName").textContent = carrier?.carrier_name || "No carrier selected";
  document.getElementById("carrierContact").textContent = [carrier?.phone, carrier?.email].filter(Boolean).join(" | ");
  document.getElementById("carrierAuthority").textContent = [carrier?.mc_number ? `MC ${carrier.mc_number}` : "", carrier?.dot_number ? `DOT ${carrier.dot_number}` : ""].filter(Boolean).join(" | ");

  const carrierRate = Number(tender?.carrier_rate || load.carrier_rate || 0);
  const customerRate = Number(load.rate || 0);
  const margin = customerRate - carrierRate;
  document.getElementById("carrierRate").textContent = formatCurrency(carrierRate);
  document.getElementById("customerRate").textContent = formatCurrency(customerRate);
  document.getElementById("loadMargin").textContent = formatCurrency(margin);

  document.getElementById("pickupLocation").textContent = load.pickup_location || "N/A";
  document.getElementById("pickupDateTime").textContent = formatDateTime(load.pickup_date, load.pickup_time);
  document.getElementById("shipperInfo").textContent = [load.shipper_name, load.shipper_contact].filter(Boolean).join(" | ");
  document.getElementById("deliveryLocation").textContent = load.delivery_location || load.dropoff_location || "N/A";
  document.getElementById("deliveryDateTime").textContent = formatDateTime(load.delivery_date || load.dropoff_date, load.delivery_time);
  document.getElementById("consigneeInfo").textContent = [load.consignee_name, load.consignee_contact].filter(Boolean).join(" | ");
  document.getElementById("commodity").textContent = load.commodity || "N/A";
  document.getElementById("weight").textContent = load.weight ? Number(load.weight).toLocaleString() : "N/A";
  document.getElementById("trailer").textContent = [load.trailer_type, load.trailer_length].filter(Boolean).join(" / ") || "N/A";
  document.getElementById("notes").textContent = tender?.terms || tender?.notes || load.notes || "No special instructions.";
}

function bindActions() {
  document.getElementById("printRateConfirmationBtn").addEventListener("click", () => window.print());
  document.getElementById("copyRateConfirmationBtn").addEventListener("click", async () => {
    await copyText(buildSummary());
    const msg = document.getElementById("rateConfirmationMessage");
    msg.textContent = "Rate confirmation summary copied.";
    msg.style.color = "#047857";
  });
}

function buildSummary() {
  return [
    `Rate Confirmation - Load ${currentLoad.load_number || currentLoad.id}`,
    `Carrier: ${currentCarrier?.carrier_name || "No carrier selected"}`,
    `Pickup: ${currentLoad.pickup_location || "N/A"} ${formatDateTime(currentLoad.pickup_date, currentLoad.pickup_time)}`,
    `Delivery: ${currentLoad.delivery_location || currentLoad.dropoff_location || "N/A"} ${formatDateTime(currentLoad.delivery_date || currentLoad.dropoff_date, currentLoad.delivery_time)}`,
    `Carrier Rate: ${formatCurrency(currentTender?.carrier_rate || currentLoad.carrier_rate || 0)}`,
    `Commodity: ${currentLoad.commodity || "N/A"}`,
    `Notes: ${currentTender?.terms || currentTender?.notes || currentLoad.notes || "No special instructions."}`
  ].join("\n");
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function formatDateTime(date, time) {
  return [date ? new Date(`${date}T00:00:00`).toLocaleDateString() : "", time || ""].filter(Boolean).join(" ");
}

function formatCurrency(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatStatus(value) {
  return String(value || "N/A").replaceAll("_", " ");
}

initRateConfirmation();
