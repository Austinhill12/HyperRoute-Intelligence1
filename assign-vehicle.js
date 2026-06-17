const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";

async function loadDropdowns() {
  await window.CompanyContext?.ready();
  const driverSelect = document.getElementById("driverSelect");
  const vehicleSelect = document.getElementById("vehicleSelect");
  const loadSelect = document.getElementById("loadSelect");

  const headers = {
    apikey: API_KEY,
    Authorization: "Bearer " + API_KEY
  };

  // Load Drivers
  const driverRes = await fetch(
    window.CompanyContext?.scopedUrl("drivers", "select=id,first_name,last_name") || `${BASE_URL}/rest/v1/drivers?select=id,first_name,last_name`,
    { headers }
  );

  if (!driverRes.ok) throw new Error(await driverRes.text());

  const drivers = await driverRes.json();

  drivers.forEach(driver => {
    const opt = document.createElement("option");
    opt.value = driver.id;
    opt.textContent = `${driver.first_name} ${driver.last_name}`;
    driverSelect.appendChild(opt);
  });

  // Load Trucks
  const truckRes = await fetch(
    window.CompanyContext?.scopedUrl("trucks", "select=id,truck_number,vin") || `${BASE_URL}/rest/v1/trucks?select=id,truck_number,vin`,
    { headers }
  );

  if (!truckRes.ok) throw new Error(await truckRes.text());

  const trucks = await truckRes.json();

  trucks.forEach(truck => {
    const opt = document.createElement("option");
    opt.value = truck.id;
    opt.textContent =
      truck.truck_number ||
      truck.vin ||
      `Truck ${truck.id}`;

    vehicleSelect.appendChild(opt);
  });

  // Load Loads
  const loadRes = await fetch(
    window.CompanyContext?.scopedUrl("loads", "select=id,load_number,customer_name,customer") || `${BASE_URL}/rest/v1/loads?select=id,load_number,customer_name,customer`,
    { headers }
  );

  if (!loadRes.ok) throw new Error(await loadRes.text());

  const loads = await loadRes.json();

  loadSelect.innerHTML =
    `<option value="">No load assigned</option>`;

  loads.forEach(load => {
    const opt = document.createElement("option");
    opt.value = load.id;
    opt.textContent =
      load.load_number ||
      load.customer_name ||
      load.customer ||
      `Load ${load.id}`;

    loadSelect.appendChild(opt);
  });
}

async function assignVehicle(e) {
  e.preventDefault();

  const msg = document.getElementById("assignMessage");

  const headers = {
    apikey: API_KEY,
    Authorization: "Bearer " + API_KEY
  };

  const data = Object.fromEntries(
    new FormData(e.target).entries()
  );

  try {

    const activeRes = await fetch(
      window.CompanyContext?.scopedUrl("assignments", `truck_id=eq.${data.truck_id}&status=eq.active`) || `${BASE_URL}/rest/v1/assignments?truck_id=eq.${data.truck_id}&status=eq.active`,
      { headers }
    );

    if (!activeRes.ok)
      throw new Error(await activeRes.text());

    const active = await activeRes.json();

    if (active.length > 0) {
      msg.textContent =
        "This truck is already assigned.";
      msg.style.color = "#ef4444";
      return;
    }

    const assignment = window.CompanyContext?.withCompanyId({
      driver_id: Number(data.driver_id),
      truck_id: Number(data.truck_id),
      load_id: data.load_id ? Number(data.load_id) : null,
      status: "active"
    }) || {
      driver_id: Number(data.driver_id),
      truck_id: Number(data.truck_id),
      load_id: data.load_id ? Number(data.load_id) : null,
      status: "active"
    };

    console.log("ASSIGNMENT:", assignment);

    const res = await fetch(
      `${BASE_URL}/rest/v1/assignments`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: API_KEY,
          Authorization: "Bearer " + API_KEY,
          Prefer: "return=representation"
        },
        body: JSON.stringify(assignment)
      }
    );

    const result = await res.json();

    console.log("STATUS:", res.status);
    console.log("RESULT:", result);

    if (!res.ok) {
      throw new Error(JSON.stringify(result));
    }

    msg.textContent =
      "Truck assigned successfully!";
    msg.style.color = "#047857";

    e.target.reset();

  } catch (err) {

    console.error(err);

    msg.textContent =
      "Error assigning truck.";

    msg.style.color = "#ef4444";

  }
}

document
  .getElementById("assignForm")
  .addEventListener("submit", assignVehicle);

loadDropdowns().catch(err => {
  console.error(err);

  const msg =
    document.getElementById("assignMessage");

  msg.textContent =
    "Error loading assignment data.";

  msg.style.color = "#ef4444";
});
