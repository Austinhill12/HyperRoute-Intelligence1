import { supabase } from "./supabaseClient.js";

const form = document.getElementById("forgotPasswordForm");
const message = document.getElementById("forgotPasswordMessage");
const submitButton = document.getElementById("forgotPasswordSubmitBtn");

form.addEventListener("submit", async event => {
  event.preventDefault();

  const email = document.getElementById("resetEmail").value.trim();
  if (!email) return;

  setLoading(true);
  message.textContent = "Sending reset link...";
  message.style.color = "#334155";

  const redirectTo = `${window.location.origin}/reset-password.html`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo
  });

  if (error) {
    message.textContent = `Reset failed: ${error.message}`;
    message.style.color = "#ef4444";
    setLoading(false);
    return;
  }

  message.textContent = "Password reset link sent. Check the email inbox and spam folder.";
  message.style.color = "#047857";
  setLoading(false);
});

function setLoading(isLoading) {
  if (!submitButton) return;
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "Sending..." : "Send Reset Link";
}
