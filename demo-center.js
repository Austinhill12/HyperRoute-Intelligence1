import { supabase } from "./supabaseClient.js";

const msg = document.getElementById("demoCenterMessage");
const demoCards = document.getElementById("demoCards");
const universalPitch = document.getElementById("universalPitch");

const DEMO_PROFILES = {
  carrier: {
    label: "Carrier / Fleet Demo",
    target: "Asset-based trucking companies",
    pages: [
      ["Dashboard", "dashboard.html"],
      ["Dispatch Board", "dispatch.html"],
      ["Drivers", "drivers.html"],
      ["Vehicles", "vehicles.html"],
      ["Maintenance", "maintenance.html"],
      ["Reports", "reports.html"]
    ],
    script: [
      "Start with Fleet Operations Intelligence and show what needs attention today.",
      "Show active loads, available trucks, driver compliance, maintenance due, documents, and open receivables.",
      "Open Dispatch Board to show daily movement.",
      "Open a load and show documents, customer tracking, invoice flow, and timeline.",
      "Close by explaining that HyperRoute replaces spreadsheets and scattered paperwork with one operating command center."
    ]
  },
  broker_3pl: {
    label: "Broker / 3PL Demo",
    target: "3PLs, brokers, and logistics coordinators",
    pages: [
      ["Dashboard", "dashboard.html"],
      ["Quotes", "quotes.html"],
      ["Loads", "loads.html"],
      ["Carriers", "carriers.html"],
      ["Invoices", "invoices.html"],
      ["Reports", "reports.html"]
    ],
    script: [
      "Start with Brokerage Operations Intelligence and show active loads, quotes, margin, receivables, and risks.",
      "Open Quotes to show sales pipeline and conversion into booked loads.",
      "Open Carriers to show carrier network, compliance, and tendering readiness.",
      "Open a load and show customer tracking, communication log, documents, claims/issues, invoice flow, and profitability.",
      "Close by positioning HyperRoute as a universal operating layer for 3PL visibility and customer service."
    ]
  },
  dispatcher: {
    label: "Dispatch Service Demo",
    target: "Dispatchers coordinating loads for carriers",
    pages: [
      ["Dashboard", "dashboard.html"],
      ["Dispatch Board", "dispatch.html"],
      ["Loads", "loads.html"],
      ["Drivers", "drivers.html"],
      ["Documents", "documents.html"],
      ["Alerts", "alerts.html"]
    ],
    script: [
      "Start with dispatch activity and what needs attention today.",
      "Show active loads, customer updates, driver/truck assignment, and documents.",
      "Open Dispatch Board and explain it as the daily coordination view.",
      "Open customer tracking to show how outside customers can see load progress.",
      "Close by emphasizing cleaner execution and fewer calls/texts/spreadsheets."
    ]
  },
  hybrid: {
    label: "Hybrid Demo",
    target: "Companies running fleet plus brokerage workflows",
    pages: [
      ["Dashboard", "dashboard.html"],
      ["Loads", "loads.html"],
      ["Quotes", "quotes.html"],
      ["Carriers", "carriers.html"],
      ["Vehicles", "vehicles.html"],
      ["Reports", "reports.html"]
    ],
    script: [
      "Start with the full Transportation Operations Intelligence dashboard.",
      "Show how fleet, brokerage, billing, compliance, documents, and alerts all connect.",
      "Open Loads and explain lifecycle from quote or dispatch through invoice.",
      "Show both carrier network and vehicle/driver tools.",
      "Close by framing HyperRoute as a universal system that adapts to the transportation company type."
    ]
  }
};

async function initDemoCenter() {
  msg.textContent = "Loading demo center...";
  msg.style.color = "";

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    window.location.href = "login.html?next=demo-center.html";
    return;
  }

  await window.CompanyContext?.ready();
  if (!window.CompanyContext?.isPlatformAdmin?.()) {
    msg.textContent = "Demo Center is only available to platform admins.";
    msg.style.color = "#ef4444";
    return;
  }

  const companies = window.CompanyContext?.getCompanies?.() || [];
  const demos = companies.filter(company =>
    company.account_type === "demo" || /demo/i.test(company.company_name || "")
  );

  document.getElementById("demoCompanyCount").textContent = demos.length;
  renderUniversalPitch();
  renderDemoCards(demos);
  bindGlobalActions();
  msg.textContent = "";
}

function renderDemoCards(demos) {
  if (!demos.length) {
    demoCards.innerHTML = `<div class="empty-state">No demo companies found. Create one company with account type Demo/Test.</div>`;
    return;
  }

  demoCards.innerHTML = demos.map(company => {
    const type = company.operation_type || "carrier";
    const profile = DEMO_PROFILES[type] || DEMO_PROFILES.carrier;
    return `
      <article class="card demo-center-card">
        <div class="demo-center-card-header">
          <div>
            <p class="section-eyebrow">${escapeHtml(profile.label)}</p>
            <h2>${escapeHtml(company.company_name || "Demo Company")}</h2>
            <p>${escapeHtml(profile.target)}</p>
          </div>
          <span>${escapeHtml(formatStatus(company.status || "active"))}</span>
        </div>

        <div class="demo-page-actions">
          ${profile.pages.map(([label, href]) => `
            <button class="view secondary-action" type="button" data-open-demo-page="${escapeHtml(company.id)}" data-demo-page="${escapeHtml(href)}">${escapeHtml(label)}</button>
          `).join("")}
        </div>

        <div class="demo-script-box">
          ${profile.script.map((line, index) => `<p><strong>${index + 1}.</strong> ${escapeHtml(line)}</p>`).join("")}
        </div>

        <div class="quick-actions">
          <button class="view" type="button" data-open-demo-page="${escapeHtml(company.id)}" data-demo-page="dashboard.html">Start Demo</button>
          <button class="view secondary-action" type="button" data-copy-demo-script="${escapeHtml(type)}">Copy Script</button>
          <button class="view secondary-action" type="button" data-copy-reset-note="${escapeHtml(company.company_name || "Demo Company")}">Copy Reset Note</button>
        </div>
      </article>
    `;
  }).join("");

  demoCards.querySelectorAll("[data-open-demo-page]").forEach(button => {
    button.addEventListener("click", () => openDemoPage(button.dataset.openDemoPage, button.dataset.demoPage));
  });

  demoCards.querySelectorAll("[data-copy-demo-script]").forEach(button => {
    button.addEventListener("click", () => copyDemoScript(button.dataset.copyDemoScript));
  });

  demoCards.querySelectorAll("[data-copy-reset-note]").forEach(button => {
    button.addEventListener("click", () => copyResetNote(button.dataset.copyResetNote));
  });
}

function renderUniversalPitch() {
  const pitch = getUniversalPitch();
  universalPitch.innerHTML = pitch.map(line => `<p>${escapeHtml(line)}</p>`).join("");
}

function bindGlobalActions() {
  document.getElementById("copyUniversalPitchBtn")?.addEventListener("click", async () => {
    await copyText(getUniversalPitch().join("\n"));
    showMessage("Universal pitch copied.");
  });
}

function openDemoPage(companyId, page) {
  window.CompanyContext?.setCompanyId(companyId);
  window.location.href = page || "dashboard.html";
}

async function copyDemoScript(type) {
  const profile = DEMO_PROFILES[type] || DEMO_PROFILES.carrier;
  await copyText([profile.label, "", ...profile.script].join("\n"));
  showMessage("Demo script copied.");
}

async function copyResetNote(companyName) {
  await copyText([
    `${companyName} demo reset note`,
    "",
    "Before a sales walkthrough, confirm the demo company has active loads, at least one alert, sample documents, invoices/receivables, and clean customer-facing tracking.",
    "After a walkthrough, remove any accidental test entries that distract from the story."
  ].join("\n"));
  showMessage("Demo reset note copied.");
}

function getUniversalPitch() {
  return [
    "HyperRoute Intelligence is a transportation operations command center for logistics companies.",
    "It helps owners, dispatchers, brokers, 3PLs, and carriers see what is moving, what is risky, what is owed, and what needs action today.",
    "The platform adapts by company type so each customer sees the tools they actually use without extra clutter.",
    "The goal is to replace spreadsheet chaos, scattered paperwork, missed compliance, poor visibility, and disconnected customer updates."
  ];
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function showMessage(text) {
  msg.textContent = text;
  msg.style.color = "#047857";
}

function formatStatus(value) {
  return String(value || "N/A").replaceAll("_", " ");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

initDemoCenter().catch(error => {
  console.error(error);
  msg.textContent = error.message || "Error loading Demo Center.";
  msg.style.color = "#ef4444";
});
