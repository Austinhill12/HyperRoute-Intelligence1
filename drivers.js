const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";

async function loadDrivers() {
  const msg = document.getElementById("driversMessage");
  msg.textContent = "Loading drivers...";

  try {
    await window.CompanyContext?.ready();
    const res = await fetch(
      window.CompanyContext?.scopedUrl("drivers", "select=*&order=created_at.desc") || `${BASE_URL}/rest/v1/drivers?select=*&order=created_at.desc`,
      { headers: { apikey: API_KEY, Authorization: "Bearer " + API_KEY } }
    );

    if (!res.ok) throw new Error(await res.text());

    const drivers = await res.json();
    msg.textContent = "";
    renderDrivers(drivers);

  } catch (err) {
    console.error(err);
    msg.textContent = "Error loading drivers.";
    msg.style.color = "#ef4444";
  }
}

function renderDrivers(drivers) {
  const tbody = document.getElementById("driversTableBody");
  tbody.innerHTML = "";

  if (!drivers.length) {
    tbody.innerHTML = `<tr><td colspan="5">No drivers found.</td></tr>`;
    return;
  }

  drivers.forEach(driver => {
    const row = document.createElement("tr");
    const name = `${driver.first_name || ""} ${driver.last_name || ""}`.trim() || "Unnamed Driver";

    row.innerHTML = `
      <td>${name}</td>
      <td>${driver.phone || "N/A"}</td>
      <td>${driver.email || "N/A"}</td>
      <td>${driver.status || "N/A"}</td>
      <td>
        <a class="view" href="driver-details.html?id=${driver.id}">View</a>
        <a class="view" href="edit-driver.html?id=${driver.id}">Edit</a>
      </td>
    `;

    tbody.appendChild(row);
  });
}

loadDrivers();
