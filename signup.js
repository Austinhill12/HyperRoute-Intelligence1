import { supabase } from "./supabaseClient.js";

const form = document.getElementById("signupForm");
const message = document.getElementById("signupMessage");
const submitButton = document.getElementById("signupSubmitBtn");

const pendingSignupKey = "hyperroute_pending_signup";
const emailRedirectTo = `${window.location.origin}/login.html?next=onboarding.html`;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "Creating trial account...";
  message.style.color = "#334155";
  setLoading(true);

  const formData = Object.fromEntries(new FormData(form).entries());
  const signupData = {
    company_name: formData.company_name,
    legal_name: formData.legal_name || "",
    phone: formData.phone || "",
    company_email: formData.company_email || formData.email,
    plan_name: formData.plan_name || "professional",
    operation_type: formData.operation_type || "carrier"
  };

  localStorage.setItem(pendingSignupKey, JSON.stringify(signupData));

  const { data, error } = await supabase.auth.signUp({
    email: formData.email,
    password: formData.password,
    options: {
      emailRedirectTo,
      data: {
        hyperroute_signup: signupData
      }
    }
  });

  if (error) {
    message.textContent = `Signup failed: ${error.message}`;
    message.style.color = "#ef4444";
    setLoading(false);
    return;
  }

  if (!data.session) {
    message.textContent = "Account created. Check your email to confirm, then log in to finish your trial workspace.";
    message.style.color = "#047857";
    setTimeout(() => {
      window.location.href = "login.html?next=onboarding.html";
    }, 2200);
    return;
  }

  await completePendingSignup();
});

async function completePendingSignup() {
  const raw = localStorage.getItem(pendingSignupKey);
  if (!raw) {
    window.location.href = "onboarding.html";
    return;
  }

  const signupData = JSON.parse(raw);
  message.textContent = "Creating trial workspace...";
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
    return;
  }

  localStorage.removeItem(pendingSignupKey);
  localStorage.setItem("hyperroute_active_company_id", companyId);
  message.textContent = "Trial workspace created. Opening onboarding...";
  message.style.color = "#047857";

  setTimeout(() => {
    window.location.href = "onboarding.html";
  }, 900);
}

function setLoading(isLoading) {
  if (!submitButton) return;
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "Starting Trial..." : "Start Trial Workspace";
}

document.querySelectorAll(".plan-option input").forEach(input => {
  input.addEventListener("change", () => {
    document.querySelectorAll(".plan-option").forEach(option => option.classList.remove("selected"));
    input.closest(".plan-option")?.classList.add("selected");
  });
});
