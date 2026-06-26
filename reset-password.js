import { supabase } from "./supabaseClient.js";

const form = document.getElementById("resetPasswordForm");
const message = document.getElementById("resetPasswordMessage");
const submitButton = document.getElementById("resetPasswordSubmitBtn");

document.addEventListener("DOMContentLoaded", async () => {
  message.textContent = "Checking reset link...";
  message.style.color = "#334155";

  const { data } = await supabase.auth.getSession();
  if (data.session) {
    message.textContent = "Enter a new password below.";
    message.style.color = "#334155";
    return;
  }

  message.textContent = "If this page opened from a reset email, enter the new password. If saving fails, request a fresh reset link.";
  message.style.color = "#92400e";
});

form.addEventListener("submit", async event => {
  event.preventDefault();

  const password = document.getElementById("newPassword").value;
  const confirmPassword = document.getElementById("confirmPassword").value;

  if (password !== confirmPassword) {
    message.textContent = "Passwords do not match.";
    message.style.color = "#ef4444";
    return;
  }

  setLoading(true);
  message.textContent = "Saving new password...";
  message.style.color = "#334155";

  const { error } = await supabase.auth.updateUser({
    password
  });

  if (error) {
    message.textContent = `Password reset failed: ${error.message}. Request a fresh reset link if this link expired.`;
    message.style.color = "#ef4444";
    setLoading(false);
    return;
  }

  message.textContent = "Password updated. Redirecting to login...";
  message.style.color = "#047857";

  await supabase.auth.signOut();
  setTimeout(() => {
    window.location.href = "login.html";
  }, 1200);
});

function setLoading(isLoading) {
  if (!submitButton) return;
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "Saving..." : "Save New Password";
}
