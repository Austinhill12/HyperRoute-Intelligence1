const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const fallbackHeaders = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

function getHeaders(extra = {}) {
  return {
    ...(window.CompanyContext?.getHeaders?.() || fallbackHeaders),
    ...extra
  };
}

async function loadVehicles() {
  const msg = document.getElementById("vehiclesMessage");
  msg.textContent = "Loading trucks...";

  try {
    await window.CompanyContext?.ready();
    const res = await fetch(
      window.CompanyContext?.scopedUrl("trucks", "select=*") || `${BASE_URL}/rest/v1/trucks?select=*`,
      { headers: getHeaders() }
    );

    if (!res.ok) throw new Error(await res.text());

    const trucks = await res.json();
    msg.textContent = "";
    renderVehicles(trucks);

  } catch (err) {
    console.error(err);
    msg.textContent = "Error loading trucks.";
    msg.style.color = "#ef4444";
  }
}

function renderVehicles(trucks) {
  const tbody = document.getElementById("vehiclesTableBody");
  tbody.innerHTML = "";

  if (!trucks.length) {
    tbody.innerHTML = `<tr><td colspan="4">No trucks found.</td></tr>`;
    return;
  }

  trucks.forEach(truck => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${truck.truck_number || "N/A"}</td>
      <td>${truck.vin || "N/A"}</td>
      <td>${truck.created_at ? new Date(truck.created_at).toLocaleDateString() : "N/A"}</td>
      <td>
        <a class="view" href="vehicle-details.html?id=${truck.id}">View</a>
        <button class="view" data-edit="${truck.id}">Edit</button>
        <button class="delete" data-delete="${truck.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });

  tbody.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      window.location.href = `edit-vehicle.html?id=${btn.dataset.edit}`;
    });
  });

  tbody.querySelectorAll("[data-delete]").forEach(btn => {
    btn.addEventListener("click", () => deleteVehicle(btn.dataset.delete));
  });
}

async function deleteVehicle(id) {
  if (!confirm("Delete this truck and its related assignments, maintenance records, and alerts?")) return;

  try {
    const headers = getHeaders();

    await deleteRelatedRows("assignments", "truck_id", id, headers);
    await deleteRelatedRows("maintenance_logs", "truck_id", id, headers);
    await deleteRelatedRows("maintenance_schedules", "truck_id", id, headers);
    await deleteRelatedRows("alerts", "truck_id", id, headers);

    const res = await fetch(
      `${BASE_URL}/rest/v1/trucks?id=eq.${id}`,
      {
        method: "DELETE",
        headers
      }
    );

    if (!res.ok) throw new Error(await res.text());

    loadVehicles();
  } catch (err) {
    console.error(err);
    alert(`Error deleting truck: ${err.message}`);
  }
}

async function deleteRelatedRows(tableName, columnName, id, headers) {
  const res = await fetch(
    `${BASE_URL}/rest/v1/${tableName}?${columnName}=eq.${id}`,
    {
      method: "DELETE",
      headers
    }
  );

  if (!res.ok) throw new Error(await res.text());
}

loadVehicles();
