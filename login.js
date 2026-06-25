import { supabase } from "../supabaseClient.js";

const form = document.getElementById("loginForm");
const message = document.getElementById("loginMessage");
const submitButton = document.getElementById("loginSubmitBtn");
const nextPage = new URLSearchParams(window.location.search).get("next") || "dashboard.html";
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
    message.textContent = `Login failed: ${error.message}`;
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

  location.href = nextPage;
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
  window.location.href = nextPage;
  return true;
}
