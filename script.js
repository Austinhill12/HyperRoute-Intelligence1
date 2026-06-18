(function () {
  const SUPABASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
  const SUPABASE_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
  const form = document.getElementById("createDriverForm");
  const output = document.getElementById("createDriverMessage");

  if (!form || form.dataset.rpcDriverBound === "true") return;
  form.dataset.rpcDriverBound = "true";

  function setMessage(message, color = "#334155") {
    if (!output) return;
    output.textContent = message;
    output.style.color = color;
  }

  async function callCreateDriverRpc(payload) {
    const accessToken = getStoredAccessToken();
    const headers = accessToken ? {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken}`
    } : (window.CompanyContext?.getHeaders?.() || {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`
    });

    if (!headers.Authorization || headers.Authorization === `Bearer ${SUPABASE_KEY}`) {
      throw new Error("No Supabase login token found. Log out, log back in, then try again.");
    }

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_driver_secure_v8`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    const result = text ? JSON.parse(text) : null;

    if (!response.ok) {
      throw new Error(result?.message || result?.error || text || "Driver save failed");
    }

    return result;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!form.first_name.value.trim() || !form.last_name.value.trim()) {
      setMessage("First and last name are required.", "#ef4444");
      return;
    }

    setMessage("Saving driver through secure driver RPC v8...");

    try {
      await window.CompanyContext?.ready();
      const companyId = window.CompanyContext?.getCompanyId?.();

      if (!companyId) {
        throw new Error("No active company selected.");
      }

      await callCreateDriverRpc({
        p_company_id: companyId,
        p_first_name: form.first_name.value.trim(),
        p_last_name: form.last_name.value.trim(),
        p_phone: form.phone.value.trim() || null,
        p_email: form.email.value.trim() || null,
        p_license_number: form.license_number.value.trim() || null,
        p_license_expiration: form.license_expiration.value || null,
        p_photo_url: form.photo_url.value.trim() || null
      });

      setMessage("Driver created successfully.", "#047857");
      form.reset();
    } catch (error) {
      console.error("Create driver error:", error);
      setMessage(`Error creating driver: ${error.message || error}`, "#ef4444");
    }
  });

  function getStoredAccessToken() {
    const exact = localStorage.getItem("sb-ygrikxlbfmtkovktwhdp-auth-token");
    const exactToken = readAccessToken(exact);
    if (exactToken) return exactToken;

    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const token = readAccessToken(localStorage.getItem(key));
      if (token) return token;
    }

    return null;
  }

  function readAccessToken(rawValue) {
    if (!rawValue) return null;
    try {
      const parsed = JSON.parse(rawValue);
      return parsed?.access_token
        || parsed?.currentSession?.access_token
        || parsed?.session?.access_token
        || parsed?.state?.session?.access_token
        || null;
    } catch (_) {
      return null;
    }
  }
})();
