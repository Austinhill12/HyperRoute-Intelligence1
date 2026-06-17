const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";

document.getElementById("createDriverForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const form = e.target;
  const output = document.getElementById("createDriverMessage");

  output.textContent = "Saving driver...";
  output.style.color = "#334155";

  if (!form.first_name.value || !form.last_name.value) {
    output.textContent = "First and last name are required.";
    output.style.color = "#ef4444";
    return;
  }

  const formData = {
    first_name: form.first_name.value,
    last_name: form.last_name.value,
    phone: form.phone.value,
    email: form.email.value,
    license_number: form.license_number.value,
    license_expiration: form.license_expiration.value,
    status: "active",
    photo_url: form.photo_url.value || null,
    file_url: form.file_url.value || null
  };

  await window.CompanyContext?.ready();
  const companyId = window.CompanyContext?.getCompanyId();
  if (companyId) formData.company_id = companyId;

  try {
    const res = await fetch(`${BASE_URL}/functions/v1/create-driver`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: API_KEY,
        Authorization: "Bearer " + API_KEY
      },
      body: JSON.stringify(formData)
    });

    const result = await res.json();

    console.log("CREATE DRIVER STATUS:", res.status);
    console.log("CREATE DRIVER RESULT:", result);

    if (!res.ok) {
      throw new Error(result.error || "Failed to create driver");
    }

    output.textContent = "Driver created successfully!";
    output.style.color = "#047857";

    form.reset();

  } catch (err) {
    console.error("Create driver error:", err);
    output.textContent = "Error creating driver: " + err.message;
    output.style.color = "#ef4444";
  }
});
