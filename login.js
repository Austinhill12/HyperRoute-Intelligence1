import { supabase } from "../supabaseClient.js";

const form = document.getElementById("loginForm");
const message = document.getElementById("loginMessage");
const submitButton = document.getElementById("loginSubmitBtn");
const pendingSignupKey = "hyperroute_pending_signup";

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  message.textContent = "Logging in...";
  message.style.color = "#334155";
  setLoading(true);

  const { data, error } =
    await supabase.auth.signInWithPassword({
      email,
      password
    });

  if (error) {
    const errorText = String(error.message || "");
    if (errorText.toLowerCase().includes("invalid login credentials")) {
      message.textContent = "Login failed. If this is a new account, confirm the email first. If already confirmed, check the email/password or use password reset.";
    } else if (errorText.toLowerCase().includes("email not confirmed")) {
      message.textContent = "Email is not confirmed yet. Open the confirmation email from HyperRoute/Supabase, then log in again.";
    } else {
      message.textContent = `Login failed: ${error.message}`;
    }
    message.style.color = "#ef4444";
    setLoading(false);
    return;
  }

  message.textContent = "Login successful";
  message.style.color = "#047857";

  const completedSignup = await completePendingSignup();
  if (completedSignup) return;

  const acceptedInvite = await acceptPendingInvite();
  if (acceptedInvite) return;

  location.href = await getPostLoginPage();
});

function setLoading(isLoading) {
  if (!submitButton) return;
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "Opening Workspace..." : "Log In";
}

async function completePendingSignup() {
  const raw = localStorage.getItem(pendingSignupKey);
  const { data: userData } = await supabase.auth.getUser();
  const metadataSignup = userData.user?.user_metadata?.hyperroute_signup;
  if (!raw && !metadataSignup) return false;

  const signupData = raw ? JSON.parse(raw) : metadataSignup;
  message.textContent = "Finishing company workspace setup...";
  message.style.color = "#334155";

  const { data: companyId, error } = await supabase.rpc("create_self_service_company", {
    company_name_input: signupData.company_name,
    legal_name_input: signupData.legal_name,
    phone_input: signupData.phone,
    email_input: signupData.company_email,
    plan_name_input: signupData.plan_name,
    operation_type_input: signupData.operation_type || "carrier"
  });

  if (error) {
    message.textContent = `Workspace setup failed: ${error.message}`;
    message.style.color = "#ef4444";
    setLoading(false);
    return true;
  }

  localStorage.removeItem(pendingSignupKey);
  localStorage.setItem("hyperroute_active_company_id", companyId);
  window.location.href = "onboarding.html";
  return true;
}

async function acceptPendingInvite() {
  message.textContent = "Checking company invitations...";
  message.style.color = "#334155";

  const { data: companyId, error } = await supabase.rpc("accept_pending_company_invite");

  if (error) {
    console.warn("Invite check failed:", error);
    message.textContent = "Login successful";
    message.style.color = "#047857";
    return false;
  }

  if (!companyId) {
    message.textContent = "Login successful";
    message.style.color = "#047857";
    return false;
  }

  localStorage.setItem("hyperroute_active_company_id", companyId);
  message.textContent = "Invite accepted. Opening your company workspace...";
  message.style.color = "#047857";
  window.location.href = await getPostLoginPage();
  return true;
}

async function getPostLoginPage() {
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user?.id) return "dashboard.html";

  const { data: platformRows } = await supabase
    .from("platform_admins")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1);

  if (platformRows?.length) return "platform-admin.html";

  const savedCompanyId = localStorage.getItem("hyperroute_active_company_id");
  const { data: memberships, error } = await supabase
    .from("company_users")
    .select("company_id, role, companies(id, company_name, operation_type, status)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("Could not load company memberships:", error);
    return "dashboard.html";
  }

  const activeMemberships = (memberships || []).filter(row => {
    const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
    return (company?.status || "active") === "active";
  });

  if (!activeMemberships.length) return "onboarding.html";

  const membership = activeMemberships.find(row => String(row.company_id) === String(savedCompanyId)) || activeMemberships[0];
  localStorage.setItem("hyperroute_active_company_id", membership.company_id);

  const role = String(membership.role || "").toLowerCase();
  if (role === "driver") return "driver-portal.html";
  if (role === "accounting") return "invoices.html";
  if (role === "maintenance") return "maintenance.html";
  if (role === "dispatcher") return "dispatch.html";

  return "dashboard.html";
}
