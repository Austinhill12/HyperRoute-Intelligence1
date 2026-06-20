const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const fallbackHeaders = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

const form = document.getElementById("editLoadForm");
const msg = document.getElementById("editLoadMessage");
const header = document.getElementById("loadHeader");

function getLoadId() {
  return new URLSearchParams(window.location.search).get("id");
}

function getHeaders(extra = {}) {
  return {
    ...(window.CompanyContext?.getHeaders?.() || fallbackHeaders),
    ...extra
  };
}

async function init() {
  const id = getLoadId();
  if (!id) {
    header.textContent = "No load ID provided.";
    return;
  }

  try {
    await window.CompanyContext?.ready();
    await Promise.all([fillCustomers(), fillCarriers(), fillDrivers(), fillTrucks()]);

    const res = await fetch(
      window.CompanyContext?.scopedUrl("loads", `id=eq.${id}&select=*`) || `${BASE_URL}/rest/v1/loads?id=eq.${id}&select=*`,
      { headers: getHeaders() }
    );
    if (!res.ok) throw new Error(await res.text());

    const [load] = await res.json();
    if (!load) {
      header.textContent = "Load not found.";
      return;
    }

    header.textContent = `Load ${load.load_number || load.id}`;
    const assignment = await getLoadAssignment(id);
    fillForm(load, assignment);
  } catch (err) {
    console.error(err);
    header.textContent = "Error loading load.";
    msg.textContent = err.message;
    msg.style.color = "#ef4444";
  }
}

function fillForm(load, assignment) {
  document.getElementById("loadNumber").value = load.load_number || "";
  document.getElementById("loadStatus").value = load.status || "booked";
  setCustomerValue(load.customer_name || load.customer || "");
  document.getElementById("commodity").value = load.commodity || "";
  document.getElementById("pickupLocation").value = load.pickup_location || "";
  document.getElementById("deliveryLocation").value = load.delivery_location || load.dropoff_location || "";
  document.getElementById("pickupDate").value = load.pickup_date || "";
  document.getElementById("pickupTime").value = load.pickup_time || "";
  document.getElementById("deliveryDate").value = load.delivery_date || load.dropoff_date || "";
  document.getElementById("deliveryTime").value = load.delivery_time || "";
  document.getElementById("rate").value = load.rate || "";
  const carrierSelect = document.getElementById("carrierSelect");
  if (carrierSelect) carrierSelect.value = load.carrier_id || "";
  const carrierRate = document.getElementById("carrierRate");
  if (carrierRate) carrierRate.value = load.carrier_rate || "";
  setValue("loadedMiles", load.loaded_miles);
  setValue("emptyMiles", load.empty_miles);
  setValue("fuelCost", load.fuel_cost);
  setValue("tollCost", load.toll_cost);
  setValue("detentionBilled", load.detention_billed);
  setValue("detentionPaid", load.detention_paid);
  setValue("lumperCost", load.lumper_cost);
  setValue("accessorialBilled", load.accessorial_billed);
  setValue("otherCosts", load.other_costs);
  document.getElementById("weight").value = load.weight || "";
  document.getElementById("trailerType").value = load.trailer_type || "";
  document.getElementById("trailerLength").value = load.trailer_length || "";
  document.getElementById("driverSelect").value = load.driver_id || "";
  document.getElementById("truckSelect").value = assignment?.truck_id || "";
  document.getElementById("notes").value = load.notes || "";
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? "";
}

async function fillDrivers() {
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
    select.appendChild(option);
  });
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

function setCustomerValue(customerName) {
  const select = document.getElementById("customerSelect");
  const manual = document.getElementById("manualCustomerName");

  if ([...select.options].some(option => option.value === customerName)) {
    select.value = customerName;
    manual.value = "";
  } else {
    select.value = "";
    manual.value = customerName || "";
  }
}

async function fillTrucks() {
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
    select.appendChild(option);
  });
}

async function fillCarriers() {
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

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = getLoadId();
  if (!id) return;

  msg.textContent = "Saving changes...";
  msg.style.color = "";

  const data = normalizeLoadData(Object.fromEntries(new FormData(form).entries()));
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
    const res = await fetch(`${BASE_URL}/rest/v1/loads?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...getHeaders(),
        Prefer: "return=representation"
      },
      body: JSON.stringify(data)
    });

    const result = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(result));

    await replaceAssignment(id, assignment);

    msg.textContent = "Load updated successfully.";
    msg.style.color = "#047857";
    header.textContent = `Load ${data.load_number || id}`;
  } catch (err) {
    console.error(err);
    msg.textContent = `Error updating load: ${err.message}`;
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

async function getLoadAssignment(loadId) {
  const res = await fetch(
    window.CompanyContext?.scopedUrl("assignments", `load_id=eq.${loadId}&status=eq.active&select=*`) || `${BASE_URL}/rest/v1/assignments?load_id=eq.${loadId}&status=eq.active&select=*`,
    { headers: getHeaders() }
  );

  if (!res.ok) return null;

  const [assignment] = await res.json();
  return assignment || null;
}

async function replaceAssignment(loadId, assignment) {
  const deleteRes = await fetch(`${BASE_URL}/rest/v1/assignments?load_id=eq.${loadId}`, {
    method: "DELETE",
    headers: getHeaders()
  });

  if (!deleteRes.ok) throw new Error(await deleteRes.text());
  if (!assignment.driver_id || !assignment.truck_id) return;

  const assignmentData = window.CompanyContext?.withCompanyId({
    driver_id: assignment.driver_id,
    truck_id: assignment.truck_id,
    load_id: Number(loadId),
    status: "active"
  }) || {
    driver_id: assignment.driver_id,
    truck_id: assignment.truck_id,
    load_id: Number(loadId),
    status: "active"
  };

  const insertRes = await fetch(`${BASE_URL}/rest/v1/assignments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getHeaders(),
      Prefer: "return=representation"
    },
    body: JSON.stringify(assignmentData)
  });

  if (!insertRes.ok) throw new Error(await insertRes.text());
}

init();
