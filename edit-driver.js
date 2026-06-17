const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";

const form = document.getElementById("editDriverForm");
const msg = document.getElementById("editDriverMessage");
const header = document.getElementById("driverNameHeader");

function getDriverId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    first_name: parts.shift() || "",
    last_name: parts.join(" ") || ""
  };
}

async function loadDriverForEdit() {
  const id = getDriverId();

  if (!id) {
    header.textContent = "No driver ID provided.";
    msg.textContent = "Go back to Drivers and choose Edit for a specific driver.";
    msg.style.color = "#ef4444";
    return;
  }

  try {
    const res = await fetch(
      `${BASE_URL}/rest/v1/drivers?id=eq.${id}&select=*`,
      { headers: { apikey: API_KEY, Authorization: "Bearer " + API_KEY } }
    );

    if (!res.ok) throw new Error(await res.text());

    const [driver] = await res.json();

    if (!driver) {
      header.textContent = "Driver not found.";
      return;
    }

    const fullName = `${driver.first_name || ""} ${driver.last_name || ""}`.trim();
    header.textContent = fullName || "Edit Driver";

    document.getElementById("driverName").value = fullName;
    document.getElementById("driverPhone").value = driver.phone || "";
    document.getElementById("driverEmail").value = driver.email || "";
    document.getElementById("driverLicense").value = driver.license_number || "";
    document.getElementById("driverLicenseExp").value = driver.license_expiration || "";
    document.getElementById("driverStatus").value = driver.status || "active";
    document.getElementById("driverPhoto").value = driver.photo_url || "";
    document.getElementById("driverFile").value = driver.file_url || "";

  } catch (err) {
    console.error(err);
    header.textContent = "Error loading driver.";
    msg.textContent = "Error loading driver.";
    msg.style.color = "#ef4444";
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const id = getDriverId();
  if (!id) return;

  msg.textContent = "Saving changes...";
  msg.style.color = "";

  const nameParts = splitName(document.getElementById("driverName").value);
  const updatedData = {
    ...nameParts,
    phone: document.getElementById("driverPhone").value || null,
    email: document.getElementById("driverEmail").value || null,
    license_number: document.getElementById("driverLicense").value || null,
    license_expiration: document.getElementById("driverLicenseExp").value || null,
    status: document.getElementById("driverStatus").value,
    photo_url: document.getElementById("driverPhoto").value || null,
    file_url: document.getElementById("driverFile").value || null
  };

  try {
    const res = await fetch(
      `${BASE_URL}/rest/v1/drivers?id=eq.${id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: API_KEY,
          Authorization: "Bearer " + API_KEY,
          Prefer: "return=representation"
        },
        body: JSON.stringify(updatedData)
      }
    );

    if (!res.ok) throw new Error(await res.text());

    msg.textContent = "Driver updated successfully.";
    msg.style.color = "#047857";
    header.textContent = `${updatedData.first_name} ${updatedData.last_name}`.trim() || "Edit Driver";

  } catch (err) {
    console.error(err);
    msg.textContent = "Error updating driver.";
    msg.style.color = "#ef4444";
  }
});

loadDriverForEdit();
