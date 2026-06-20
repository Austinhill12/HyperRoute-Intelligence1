const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const fallbackHeaders = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

const form = document.getElementById("loadForm");
const msg = document.getElementById("loadMessage");

function getHeaders(extra = {}) {
  return {
    ...(window.CompanyContext?.getHeaders?.() || fallbackHeaders),
    ...extra
  };
}

async function loadDropdowns() {
  await window.CompanyContext?.ready();
  await Promise.all([
    fillCustomers(),
    fillCarriers(),
    fillDrivers(),
    fillTrucks()
  ]);
}

async function fillCustomers(selectedName = "") {
  const select = document.getElementById("customerSelect");
  select.innerHTML = `<option value="">Manual / Unlisted Customer</option>`;

  const url = window.CompanyContext?.scopedUrl("customers", "select=company_name,status&order=company_name.asc") || `${BASE_URL}/rest/v1/customers?select=company_name,status&order=company_name.asc`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(await res.text());

  const customers = await res.json();
  customers
    .filter(customer => (customer.status || "active") === "active")
    .forEach(customer => {
      const option = document.createElement("option");
      option.value = customer.company_name;
      option.textContent = customer.company_name;
      option.selected = customer.company_name === selectedName;
      select.appendChild(option);
    });
}

async function fillDrivers(selectedId = "") {
  const select = document.getElementById("driverSelect");
  select.innerHTML = `<option value="">Unassigned</option>`;

  const url = window.CompanyContext?.scopedUrl("drivers", "select=id,first_name,last_name&order=last_name.asc") || `${BASE_URL}/rest/v1/drivers?select=id,first_name,last_name&order=last_name.asc`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(await res.text());

  const drivers = await res.json();
  drivers.forEach(driver => {
    const option = document.createElement("option");
    option.value = driver.id;
    option.textContent = `${driver.first_name || ""} ${driver.last_name || ""}`.trim() || `Driver ${driver.id}`;
    option.selected = String(driver.id) === String(selectedId);
    select.appendChild(option);
  });
}

async function fillCarriers(selectedId = "") {
  const select = document.getElementById("carrierSelect");
  if (!select) return;
  select.innerHTML = `<option value="">Internal fleet / no carrier</option>`;

  const carrierSelect = "select=id,carrier_name,status,insurance_expiration,w9_status,safety_rating,last_reviewed_at&order=carrier_name.asc";
  const url = window.CompanyContext?.scopedUrl("carriers", carrierSelect) || `${BASE_URL}/rest/v1/carriers?${carrierSelect}`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) return;

  const carriers = await res.json();
  carriers
    .filter(carrier => (carrier.status || "active") === "active")
    .forEach(carrier => {
      const option = document.createElement("option");
      option.value = carrier.id;
      option.textContent = getCarrierOptionLabel(carrier);
      option.disabled = isCarrierRisky(carrier);
      option.selected = String(carrier.id) === String(selectedId);
      select.appendChild(option);
    });
}

function getCarrierOptionLabel(carrier) {
  const warnings = [];
  if (carrier.w9_status === "missing") warnings.push("W-9 missing");
  if (carrier.safety_rating === "conditional") warnings.push("conditional safety");
  if (carrier.safety_rating === "unsatisfactory") warnings.push("unsatisfactory safety");
  if (!carrier.last_reviewed_at) warnings.push("packet not reviewed");
  const insuranceDate = carrier.insurance_expiration ? new Date(`${carrier.insurance_expiration}T00:00:00`) : null;
  if (!insuranceDate || Number.isNaN(insuranceDate.getTime())) warnings.push("insurance missing");
  else if (insuranceDate < new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) warnings.push("insurance expired");
  return warnings.length ? `${carrier.carrier_name} (${warnings.join(", ")})` : carrier.carrier_name;
}

function isCarrierRisky(carrier) {
  if (["blocked", "inactive"].includes(carrier.status)) return true;
  if (carrier.safety_rating === "unsatisfactory") return true;
  const insuranceDate = carrier.insurance_expiration ? new Date(`${carrier.insurance_expiration}T00:00:00`) : null;
  return !insuranceDate || Number.isNaN(insuranceDate.getTime()) || insuranceDate < new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
}

async function fillTrucks(selectedId = "") {
  const select = document.getElementById("truckSelect");
  select.innerHTML = `<option value="">Unassigned</option>`;

  const url = window.CompanyContext?.scopedUrl("trucks", "select=id,truck_number,vin&order=truck_number.asc") || `${BASE_URL}/rest/v1/trucks?select=id,truck_number,vin&order=truck_number.asc`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(await res.text());

  const trucks = await res.json();
  trucks.forEach(truck => {
    const option = document.createElement("option");
    option.value = truck.id;
    option.textContent = truck.truck_number || truck.vin || `Truck ${truck.id}`;
    option.selected = String(truck.id) === String(selectedId);
    select.appendChild(option);
  });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "Saving load...";
  msg.style.color = "";

  await window.CompanyContext?.ready();
  const data = window.CompanyContext?.withCompanyId(normalizeLoadData(Object.fromEntries(new FormData(form).entries()))) || normalizeLoadData(Object.fromEntries(new FormData(form).entries()));
  if (data.manual_customer_name) data.customer_name = data.manual_customer_name;
  delete data.manual_customer_name;

  const assignment = {
    driver_id: data.driver_id,
    truck_id: data.truck_id
  };
  delete data.truck_id;

  data.customer = data.customer_name;
  data.dropoff_location = data.delivery_location;
  data.dropoff_date = data.delivery_date;

  try {
    const res = await fetch(`${BASE_URL}/rest/v1/loads`, {
      method: "POST",
      headers: getHeaders({
        "Content-Type": "application/json",
        Prefer: "return=representation"
      }),
      body: JSON.stringify(data)
    });

    const result = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(result));

    const saved = Array.isArray(result) ? result[0] : result;
    await saveAssignment(saved.id, assignment);
    await createInitialLoadEvent(saved);

    msg.textContent = `Load saved. Load ID: ${saved.id}`;
    msg.style.color = "#047857";
    form.reset();
  } catch (err) {
    console.error(err);
    msg.textContent = `Error saving load: ${err.message}`;
    msg.style.color = "#ef4444";
  }
});

function normalizeLoadData(data) {
  Object.keys(data).forEach(key => {
    if (data[key] === "") data[key] = null;
  });

  if (data.weight) data.weight = Number(data.weight);
  if (data.rate) data.rate = Number(data.rate);
  if (data.carrier_rate) data.carrier_rate = Number(data.carrier_rate);
  [
    "loaded_miles",
    "empty_miles",
    "fuel_cost",
    "toll_cost",
    "detention_billed",
    "detention_paid",
    "lumper_cost",
    "accessorial_billed",
    "other_costs"
  ].forEach(key => {
    if (data[key]) data[key] = Number(data[key]);
  });
  if (data.driver_id) data.driver_id = Number(data.driver_id);
  if (data.truck_id) data.truck_id = Number(data.truck_id);

  return data;
}

async function saveAssignment(loadId, assignment) {
  if (!assignment.driver_id || !assignment.truck_id) return;
  const assignmentData = window.CompanyContext?.withCompanyId({
    driver_id: assignment.driver_id,
    truck_id: assignment.truck_id,
    load_id: loadId,
    status: "active"
  }) || {
    driver_id: assignment.driver_id,
    truck_id: assignment.truck_id,
    load_id: loadId,
    status: "active"
  };

  const res = await fetch(`${BASE_URL}/rest/v1/assignments`, {
    method: "POST",
    headers: getHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify(assignmentData)
  });

  if (!res.ok) throw new Error(await res.text());
}

async function createInitialLoadEvent(load) {
  if (!load?.id) return;

  const eventType = (load.status || "booked").toLowerCase().replaceAll(" ", "_");
  const eventData = window.CompanyContext?.withCompanyId({
    load_id: Number(load.id),
    event_type: eventType,
    event_time: new Date().toISOString(),
    location: load.pickup_location || null,
    notes: `Load created with status ${eventType.replaceAll("_", " ")}.`
  }) || {
    load_id: Number(load.id),
    event_type: eventType,
    event_time: new Date().toISOString(),
    location: load.pickup_location || null,
    notes: `Load created with status ${eventType.replaceAll("_", " ")}.`
  };

  const res = await fetch(`${BASE_URL}/rest/v1/load_events`, {
    method: "POST",
    headers: getHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify(eventData)
  });

  if (!res.ok) {
    console.warn("Could not create initial load event:", await res.text());
  }
}

loadDropdowns().catch(err => {
  console.error(err);
  msg.textContent = "Error loading drivers or trucks.";
  msg.style.color = "#ef4444";
});
