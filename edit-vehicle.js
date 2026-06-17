const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";

function getIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

async function loadVehicleForEdit() {
  const id = getIdFromQuery();
  if (!id) return;

  try {
    const res = await fetch(
      `${BASE_URL}/rest/v1/trucks?id=eq.${id}&select=*`,
      { headers: { apikey: API_KEY, Authorization: "Bearer " + API_KEY } }
    );

    if (!res.ok) throw new Error("Failed to load vehicle");

    const [v] = await res.json();
    if (!v) return;

    document.getElementById("vehicleHeader").textContent = v.truck_number || "Edit Truck";
    document.getElementById("truckNumber").value = v.truck_number || "";
    document.getElementById("vehicleVin").value = v.vin || "";

  } catch (err) {
    console.error(err);
    alert("Error loading vehicle.");
  }
}

const form = document.getElementById("editVehicleForm");
const msg = document.getElementById("editVehicleMessage");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = getIdFromQuery();
  if (!id) return;

  msg.textContent = "Saving changes...";

  const data = {
    truck_number: document.getElementById("truckNumber").value,
    vin: document.getElementById("vehicleVin").value || null
  };

  try {
    const res = await fetch(
      `${BASE_URL}/rest/v1/trucks?id=eq.${id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: API_KEY,
          Authorization: "Bearer " + API_KEY,
          Prefer: "return=representation"
        },
        body: JSON.stringify(data)
      }
    );

    if (!res.ok) throw new Error(await res.text());

    msg.textContent = "Vehicle updated successfully.";
    msg.style.color = "#047857";
  } catch (err) {
    console.error(err);
    msg.textContent = "Error updating vehicle.";
    msg.style.color = "#ef4444";
  }
});

loadVehicleForEdit();
