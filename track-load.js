const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const headers = {
  apikey: API_KEY,
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json"
};

let form;
let message;
let resultPanel;
let submitButton;

document.addEventListener("DOMContentLoaded", () => {
  form = document.getElementById("trackingForm");
  message = document.getElementById("trackingMessage");
  resultPanel = document.getElementById("trackingResult");
  submitButton = form?.querySelector("button[type='submit']");

  if (!form || !message || !resultPanel) {
    console.error("Tracking page is missing required page elements.");
    return;
  }

  form.addEventListener("submit", handleTrackingSubmit);

  const preset = new URLSearchParams(window.location.search).get("q");
  if (preset) {
    document.getElementById("trackingInput").value = preset;
    handleTrackingSubmit(new Event("submit"));
  }
});

async function handleTrackingSubmit(event) {
  event.preventDefault();
  const trackingInput = document.getElementById("trackingInput").value.trim();
  if (!trackingInput) return;

  message.textContent = "Searching load...";
  message.style.color = "#334155";
  resultPanel.hidden = true;
  setLoading(true);

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/rpc/get_public_load_tracking`, {
      method: "POST",
      headers,
      body: JSON.stringify({ search_input: trackingInput })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));

    if (!data || data.found === false) {
      message.textContent = "No load found for that tracking code or load number.";
      message.style.color = "#ef4444";
      setLoading(false);
      return;
    }

    renderTrackingResult(data);
    message.textContent = "";
  } catch (err) {
    console.error(err);
    message.textContent = getTrackingError(err.message);
    message.style.color = "#ef4444";
  } finally {
    setLoading(false);
  }
}

function setLoading(isLoading) {
  if (!submitButton) return;
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "Searching..." : "Track Load";
}

function renderTrackingResult(data) {
  const companyName = data.company_name || "Transportation Company";
  const timeline = Array.isArray(data.timeline) ? data.timeline : [];

  document.getElementById("companyName").textContent = companyName;
  document.getElementById("publicCompanyHeading").textContent = `${companyName} Load Tracking`;
  document.getElementById("companyInitials").textContent = getInitials(companyName);
  document.getElementById("loadTitle").textContent = `Load ${data.load_number || data.load_id}`;
  document.getElementById("customerName").textContent = data.customer_name || "Customer load";
  document.getElementById("trackingCode").textContent = data.tracking_code ? `Tracking code: ${data.tracking_code}` : "";
  document.getElementById("loadStatus").textContent = formatStatus(data.status);
  document.getElementById("pickupLocation").textContent = data.pickup_location || "Pending";
  document.getElementById("pickupTime").textContent = formatDateTime(data.pickup_date, data.pickup_time);
  document.getElementById("deliveryLocation").textContent = data.delivery_location || "Pending";
  document.getElementById("deliveryTime").textContent = formatDateTime(data.delivery_date, data.delivery_time);
  document.getElementById("podStatus").textContent = data.pod_available ? "POD available" : "POD not available yet";
  document.getElementById("invoiceStatus").textContent = data.invoice_status ? `Invoice: ${formatStatus(data.invoice_status)}` : "Invoice not available";
  document.getElementById("shipperName").textContent = data.shipper_name || "Pending";
  document.getElementById("shipperContact").textContent = data.shipper_contact || "Contact not listed";
  document.getElementById("consigneeName").textContent = data.consignee_name || "Pending";
  document.getElementById("consigneeContact").textContent = data.consignee_contact || "Contact not listed";
  document.getElementById("dispatcherContact").textContent = formatCompanyContact(data);
  document.getElementById("lastUpdated").textContent = `Last updated: ${getLastUpdated(data, timeline)}`;

  renderTimeline(timeline, data.status);
  resultPanel.hidden = false;
}

function renderTimeline(events, currentStatus) {
  const list = document.getElementById("timelineList");

  if (!events.length) {
    list.innerHTML = buildDefaultTimeline(currentStatus).map(item => `
      <li class="${item.complete ? "complete" : ""}">
        <strong>${escapeHtml(item.label)}</strong>
        <span>${item.complete ? "Current status reached" : "Pending update"}</span>
      </li>
    `).join("");
    return;
  }

  list.innerHTML = events.map(event => `
    <li class="complete">
      <strong>${escapeHtml(formatStatus(event.event_type))}</strong>
      <span>${escapeHtml(formatTimestamp(event.event_time))}${event.location ? ` - ${escapeHtml(event.location)}` : ""}</span>
      ${event.notes ? `<p>${escapeHtml(event.notes)}</p>` : ""}
    </li>
  `).join("");
}

function formatStatus(value) {
  return String(value || "Pending")
    .replaceAll("_", " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}

function formatDateTime(date, time) {
  if (!date && !time) return "Pending";
  return `${date ? formatDate(date) : ""}${time ? ` ${String(time).slice(0, 5)}` : ""}`.trim();
}

function formatDate(value) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString() : "";
}

function formatTimestamp(value) {
  return value ? new Date(value).toLocaleString() : "Pending";
}

function formatCompanyContact(data) {
  const phone = data.company_phone || "";
  const email = data.company_email || "";
  if (phone && email) return `${phone} | ${email}`;
  return phone || email || "Contact carrier for updates";
}

function getLastUpdated(data, timeline) {
  const latestEvent = timeline
    .map(event => event.event_time)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0];
  return formatTimestamp(latestEvent || data.last_updated || data.created_at);
}

function buildDefaultTimeline(currentStatus) {
  const order = ["booked", "assigned", "dispatched", "picked_up", "in_transit", "delivered"];
  const currentIndex = Math.max(0, order.indexOf(String(currentStatus || "").toLowerCase()));
  return order.map((status, index) => ({
    label: formatStatus(status),
    complete: index <= currentIndex
  }));
}

function getInitials(value) {
  const words = String(value || "HR").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map(word => word[0]).join("").toUpperCase() || "HR";
}

function getTrackingError(messageText) {
  if (messageText.includes("get_public_load_tracking") || messageText.includes("schema cache")) {
    return "Tracking is not ready. Run the customer tracking SQL, then refresh this page.";
  }
  return "Unable to load tracking right now.";
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
