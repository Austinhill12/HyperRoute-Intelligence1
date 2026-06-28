const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const fallbackHeaders = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

function getHeaders(extra = {}) {
  return {
    ...(window.CompanyContext?.getHeaders?.() || fallbackHeaders),
    ...extra
  };
}

async function loadLoads() {
  const msg = document.getElementById("loadsMessage");
  msg.textContent = "Loading loads...";

  try {
    await window.CompanyContext?.ready();
    const [res, driverMap, truckMap] = await Promise.all([
      fetch(window.CompanyContext?.scopedUrl("loads", "select=*&order=created_at.desc") || `${BASE_URL}/rest/v1/loads?select=*&order=created_at.desc`, { headers: getHeaders() }),
      fetchDriverMap(),
      fetchTruckMap()
    ]);

    if (!res.ok) throw new Error(await res.text());

    const loads = await res.json();
    msg.textContent = "";
    renderLoads(loads, driverMap, truckMap);
  } catch (err) {
    console.error(err);
    msg.textContent = "Error loading loads.";
    msg.style.color = "#ef4444";
  }
}

function renderLoads(loads, driverMap, truckMap) {
  const tbody = document.getElementById("loadsTableBody");
  tbody.innerHTML = "";

  if (!loads.length) {
    tbody.innerHTML = `<tr><td colspan="9">No loads found.</td></tr>`;
    return;
  }

  loads.forEach(load => {
    const row = document.createElement("tr");
    const pickup = load.pickup_location || "-";
    const delivery = load.delivery_location || load.dropoff_location || "-";
    const trackingUrl = buildTrackingUrl(load);

    row.innerHTML = `
      <td>${load.load_number || load.id}</td>
      <td>${load.customer_name || load.customer || "N/A"}</td>
      <td>${pickup} to ${delivery}</td>
      <td>${formatDate(load.pickup_date)}</td>
      <td>${formatDate(load.delivery_date || load.dropoff_date)}</td>
      <td>${formatStatus(load.status)}</td>
      <td>${formatCurrency(load.rate)}</td>
      <td>${formatMargin(load)}</td>
      <td>
        <div class="load-row-actions">
          <a class="view" href="load-details.html?id=${load.id}">View</a>
          <a class="view" href="edit-load.html?id=${load.id}">Edit</a>
          <a class="view secondary-action" href="dispatch-packet.html?id=${load.id}">Packet</a>
          <button class="view secondary-action" type="button" data-duplicate-load="${load.id}">Duplicate</button>
          <a class="view secondary-action" href="${trackingUrl}" target="_blank" rel="noopener">Tracking</a>
          <button class="view secondary-action" type="button" data-copy-tracking="${load.id}">Copy Link</button>
          <button class="delete" data-delete="${load.id}">Delete</button>
        </div>
      </td>
    `;

    row.dataset.trackingUrl = trackingUrl;
    tbody.appendChild(row);
  });

  tbody.querySelectorAll("[data-copy-tracking]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("tr");
      const trackingUrl = row?.dataset.trackingUrl;
      if (!trackingUrl) {
        alert("Tracking code is missing. Run the customer tracking SQL first.");
        return;
      }

      await copyText(trackingUrl);
      btn.textContent = "Copied";
      setTimeout(() => {
        btn.textContent = "Copy Link";
      }, 1400);
    });
  });

  tbody.querySelectorAll("[data-duplicate-load]").forEach(btn => {
    btn.addEventListener("click", () => duplicateLoad(btn.dataset.duplicateLoad, loads));
  });

  tbody.querySelectorAll("[data-delete]").forEach(btn => {
    btn.addEventListener("click", () => deleteLoad(btn.dataset.delete));
  });
}

function formatMargin(load) {
  if (load.carrier_rate === null || load.carrier_rate === undefined) return "N/A";
  const margin = Number(load.margin_amount ?? (Number(load.rate || 0) - Number(load.carrier_rate || 0)));
  const rate = Number(load.rate || 0);
  const percent = rate ? ` (${Math.round((margin / rate) * 100)}%)` : "";
  return `${formatCurrency(margin)}${percent}`;
}

async function duplicateLoad(id, loads) {
  const original = loads.find(load => String(load.id) === String(id));
  if (!original) {
    alert("Could not find that load on this page.");
    return;
  }

  if (!confirm(`Duplicate load ${original.load_number || original.id}?`)) return;

  try {
    const payload = buildDuplicatePayload(original);
    const res = await fetch(`${BASE_URL}/rest/v1/loads`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(result));

    const newLoad = Array.isArray(result) ? result[0] : result;
    await createDuplicateEvent(newLoad, original);
    window.location.href = `edit-load.html?id=${encodeURIComponent(newLoad.id)}`;
  } catch (err) {
    console.error(err);
    alert(`Error duplicating load: ${friendlyError(err.message)}`);
  }
}

function buildDuplicatePayload(load) {
  const copy = { ...load };
  [
    "id",
    "created_at",
    "updated_at",
    "margin_amount",
    "tracking_code",
    "rate_con_import_id"
  ].forEach(key => delete copy[key]);

  copy.load_number = nextCopyLoadNumber(load.load_number || load.id);
  copy.status = "available";
  copy.driver_id = null;
  copy.vehicle_id = null;
  copy.truck_id = null;
  copy.carrier_id = null;
  copy.carrier_rate = null;
  copy.notes = [load.notes, `Duplicated from load ${load.load_number || load.id}.`].filter(Boolean).join("\n");
  return window.CompanyContext?.withCompanyId(copy) || copy;
}

function nextCopyLoadNumber(value) {
  const base = String(value || "LOAD").replace(/\s+/g, "-");
  const stamp = new Date().toISOString().slice(2, 10).replaceAll("-", "");
  return `${base}-COPY-${stamp}`;
}

async function createDuplicateEvent(newLoad, originalLoad) {
  if (!newLoad?.id) return;
  const payload = window.CompanyContext?.withCompanyId({
    load_id: Number(newLoad.id),
    event_type: "created",
    event_time: new Date().toISOString(),
    location: newLoad.pickup_location || null,
    notes: `Duplicated from load ${originalLoad.load_number || originalLoad.id}.`
  });
  if (!payload) return;

  const res = await fetch(`${BASE_URL}/rest/v1/load_events`, {
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) console.warn("Could not create duplicate load event:", await res.text());
}

function buildTrackingUrl(load) {
  const lookupValue = load?.tracking_code || load?.load_number || load?.id;
  if (!lookupValue) return "";
  const url = new URL("track-load.html", window.location.href);
  url.searchParams.set("q", lookupValue);
  return url.href;
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

async function fetchDriverMap() {
  const url = window.CompanyContext?.scopedUrl("drivers", "select=id,first_name,last_name") || `${BASE_URL}/rest/v1/drivers?select=id,first_name,last_name`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) return new Map();
  const drivers = await res.json();
  return new Map(drivers.map(driver => [
    driver.id,
    `${driver.first_name || ""} ${driver.last_name || ""}`.trim()
  ]));
}

async function fetchTruckMap() {
  const url = window.CompanyContext?.scopedUrl("trucks", "select=id,truck_number,vin") || `${BASE_URL}/rest/v1/trucks?select=id,truck_number,vin`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) return new Map();
  const trucks = await res.json();
  return new Map(trucks.map(truck => [
    truck.id,
    truck.truck_number || truck.vin || `Truck ${truck.id}`
  ]));
}

async function deleteLoad(id) {
  if (!confirm("Delete this load and related assignments/alerts?")) return;

  try {
    await deleteRelatedRows("assignments", "load_id", id);
    await deleteRelatedRows("alerts", "load_id", id);

    const res = await fetch(`${BASE_URL}/rest/v1/loads?id=eq.${id}`, {
      method: "DELETE",
      headers: getHeaders()
    });

    if (!res.ok) throw new Error(await res.text());
    loadLoads();
  } catch (err) {
    console.error(err);
    alert(`Error deleting load: ${err.message}`);
  }
}

async function deleteRelatedRows(tableName, columnName, id) {
  const res = await fetch(`${BASE_URL}/rest/v1/${tableName}?${columnName}=eq.${id}`, {
    method: "DELETE",
    headers: getHeaders()
  });

  if (!res.ok) throw new Error(await res.text());
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : "N/A";
}

function formatCurrency(value) {
  return value ? `$${Number(value).toLocaleString()}` : "N/A";
}

function formatStatus(value) {
  return (value || "unknown").replaceAll("_", " ");
}

function friendlyError(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed.message || parsed.details || value;
  } catch {
    return value;
  }
}

loadLoads();
