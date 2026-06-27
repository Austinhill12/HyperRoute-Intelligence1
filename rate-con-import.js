const API_KEY = "sb_publishable_vw7voiBA2V5_attC2dkUqw_PuOx468W";
const BASE_URL = "https://ygrikxlbfmtkovktwhdp.supabase.co";
const DOCUMENT_BUCKET = "company-documents";
const fallbackHeaders = { apikey: API_KEY, Authorization: "Bearer " + API_KEY };

const fileInput = document.getElementById("rateConFile");
const dropZone = document.getElementById("rateConDropZone");
const extractButton = document.getElementById("extractRateConButton");
const clearButton = document.getElementById("clearRateConButton");
const form = document.getElementById("rateConReviewForm");
const msg = document.getElementById("rateConMessage");
const confidenceBadge = document.getElementById("rateConConfidence");
const checklist = document.getElementById("rateConChecklist");

let selectedFile = null;
let extractedText = "";
let currentExtraction = null;
let currentImportId = null;

function getHeaders(extra = {}) {
  return {
    ...(window.CompanyContext?.getHeaders?.() || fallbackHeaders),
    ...extra
  };
}

async function initRateConImport() {
  await window.CompanyContext?.ready();
  bindEvents();
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
  renderChecklist({});
}

function bindEvents() {
  fileInput.addEventListener("change", () => setSelectedFile(fileInput.files[0]));
  extractButton.addEventListener("click", extractRateCon);
  clearButton.addEventListener("click", resetImport);
  form.addEventListener("submit", createLoadFromRateCon);

  ["dragenter", "dragover"].forEach(eventName => {
    dropZone.addEventListener(eventName, event => {
      event.preventDefault();
      dropZone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach(eventName => {
    dropZone.addEventListener(eventName, event => {
      event.preventDefault();
      dropZone.classList.remove("is-dragging");
    });
  });

  dropZone.addEventListener("drop", event => {
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      fileInput.files = event.dataTransfer.files;
      setSelectedFile(file);
    }
  });
}

function setSelectedFile(file) {
  selectedFile = file || null;
  msg.textContent = selectedFile ? `Ready to extract: ${selectedFile.name}` : "";
  msg.style.color = "";
}

async function extractRateCon() {
  if (!selectedFile) {
    setMessage("Choose a rate confirmation PDF first.", "#ef4444");
    return;
  }

  if (!window.pdfjsLib) {
    setMessage("PDF reader did not load. Refresh the page and try again.", "#ef4444");
    return;
  }

  try {
    setMessage("Reading PDF and extracting load details...", "");
    extractedText = await extractPdfText(selectedFile);
    if (!extractedText.trim()) {
      throw new Error("No readable text found. This may be a scanned PDF and will need OCR.");
    }

    currentExtraction = parseRateConfirmation(extractedText);
    fillReviewForm(currentExtraction);
    renderChecklist(currentExtraction);
    updateConfidence(currentExtraction);
    currentImportId = await saveImportDraft(currentExtraction);
    setMessage("Review the extracted fields, correct anything needed, then create the load.", "#047857");
  } catch (err) {
    console.error(err);
    setMessage(`Rate con import failed: ${err.message}`, "#ef4444");
  }
}

async function extractPdfText(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(" ");
    pages.push(pageText);
  }

  return normalizeText(pages.join("\n"));
}

function parseRateConfirmation(text) {
  const lower = text.toLowerCase();
  const pickup = extractStop(text, ["pickup", "pick 1", "origin", "shipper", "facility name"]);
  const delivery = extractStop(text, ["delivery", "stop 1", "destination", "consignee"]);
  const rate = firstMoneyAfter(text, ["total", "total rate", "line haul charges", "line haul rate", "carrier rate"]);
  const fuel = firstMoneyAfter(text, ["fuel surcharge", "fsc"]);
  const accessorial = firstMoneyAfter(text, ["accessorial"]);
  const loadNumber = firstValue(text, [
    /load\s*(?:number|#)\s*[:#-]?\s*([A-Z0-9-]+)/i,
    /pro\s*#\s*[:#-]?\s*([A-Z0-9-]+)/i,
    /reference\s*#\s*[:#-]?\s*([A-Z0-9-]+)/i
  ]);
  const rateConNumber = firstValue(text, [
    /rate\s*confirmation\s*(?:number|#)?\s*[:#-]?\s*([A-Z0-9-]+)/i,
    /confirmation\s*(?:number|#)\s*[:#-]?\s*([A-Z0-9-]+)/i,
    /document\s*id\s*[:#-]?\s*([A-Z0-9-]+)/i
  ]) || loadNumber;
  const customerRef = firstValue(text, [
    /customer\s*ref(?:erence)?\s*(?:number|#)?\s*[:#-]?\s*([A-Z0-9-]+)/i,
    /ref\s*#\s*[:#-]?\s*([A-Z0-9-]+)/i,
    /pick\s*#\s*[:#-]?\s*([A-Z0-9-]+)/i
  ]);

  const equipment = firstValue(text, [
    /equipment\s*[:#-]?\s*([^|]+?)(?=\s+(?:miles|commodity|pickup|delivery|load details|mode)\b|$)/i,
    /size\s*&\s*type\s*[:#-]?\s*([^|]+?)(?=\s+(?:description|miles|pieces|weight)\b|$)/i
  ]);
  const trailerType = inferTrailerType(`${equipment || ""} ${text}`);
  const appointmentDates = extractAppointments(text);
  const pickupDateTime = pickup.date || appointmentDates[0] || {};
  const deliveryDateTime = delivery.date || appointmentDates[1] || {};

  const requiredDocs = inferRequiredDocuments(lower);
  const trackingRequired = /tracking is required|electronic tracking|required for all loads|track and trace/i.test(text);
  const hazmatRequired = /hazmat|hazardous|un\d{4}/i.test(text);

  return cleanExtraction({
    broker_name: extractBrokerName(text),
    broker_contact: extractBrokerContact(text),
    broker_mc_number: firstValue(text, [/broker\s*mc\s*#?\s*[:#-]?\s*(\d+)/i, /mc\s*#?\s*[:#-]?\s*(\d+)/i]),
    rate_confirmation_number: rateConNumber,
    load_number: loadNumber || rateConNumber,
    customer_reference_number: customerRef,
    customer_name: extractCustomerName(text),
    status: "booked",
    pickup_location: pickup.location,
    pickup_date: pickupDateTime.date || "",
    pickup_time: pickupDateTime.time || "",
    delivery_location: delivery.location,
    delivery_date: deliveryDateTime.date || "",
    delivery_time: deliveryDateTime.time || "",
    rate,
    fuel_surcharge: fuel,
    accessorial_pay: accessorial,
    loaded_miles: firstNumberAfter(text, ["miles"]),
    commodity: firstValue(text, [/commodity\s*[:#-]?\s*([^|]+?)(?=\s+(?:do not|pickup|delivery|load instructions|rate details|pcs|weight)\b|$)/i, /description\s*[:#-]?\s*([^|]+?)(?=\s+(?:miles|pieces|weight|charges)\b|$)/i]),
    weight: firstNumberAfter(text, ["weight"]),
    trailer_type: trailerType,
    equipment_requirements: equipment,
    hazmat_required: hazmatRequired,
    temperature_requirements: extractTemperature(text),
    tracking_required: trackingRequired,
    required_documents: requiredDocs.join(", "),
    lumper_information: firstSentenceContaining(text, ["lumper"]),
    detention_policy: firstSentenceContaining(text, ["detention", "free time"]),
    notes: buildNotes(text)
  });
}

function fillReviewForm(data) {
  Array.from(form.elements).forEach(input => {
    if (!input.name) return;
    const value = data[input.name];
    if (value === undefined || value === null) return;
    input.value = String(value);
  });
}

async function createLoadFromRateCon(event) {
  event.preventDefault();

  if (!selectedFile) {
    setMessage("Choose the original rate confirmation PDF before creating the load.", "#ef4444");
    return;
  }

  const companyId = window.CompanyContext?.getCompanyId();
  if (!companyId) {
    setMessage("No company selected. Select a company first.", "#ef4444");
    return;
  }

  const reviewData = normalizeReviewData(Object.fromEntries(new FormData(form).entries()));
  const loadPayload = window.CompanyContext.withCompanyId({
    ...reviewData,
    customer: reviewData.customer_name || null,
    dropoff_location: reviewData.delivery_location || null,
    dropoff_date: reviewData.delivery_date || null,
    import_source: "rate_con_import",
    rate_con_import_id: currentImportId || null
  });

  try {
    setMessage("Creating load from rate confirmation...", "");
    const load = await insertLoad(loadPayload);
    await createInitialLoadEvent(load);
    await uploadAndAttachRateCon(load, selectedFile, reviewData);
    if (currentImportId) await markImportCreated(currentImportId, load.id, reviewData);
    setMessage(`Load created from rate con. Load ID: ${load.id}`, "#047857");
    window.location.href = `load-details.html?id=${encodeURIComponent(load.id)}`;
  } catch (err) {
    console.error(err);
    setMessage(`Error creating load: ${friendlyError(err.message)}`, "#ef4444");
  }
}

async function insertLoad(payload) {
  const res = await fetch(`${BASE_URL}/rest/v1/loads`, {
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify(payload)
  });

  const result = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(result));
  return Array.isArray(result) ? result[0] : result;
}

async function createInitialLoadEvent(load) {
  const eventData = window.CompanyContext.withCompanyId({
    load_id: Number(load.id),
    event_type: "booked",
    event_time: new Date().toISOString(),
    location: load.pickup_location || null,
    notes: "Load created from rate confirmation import."
  });

  const res = await fetch(`${BASE_URL}/rest/v1/load_events`, {
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify(eventData)
  });

  if (!res.ok) console.warn("Could not create rate con load event:", await res.text());
}

async function uploadAndAttachRateCon(load, file, reviewData) {
  const companyId = window.CompanyContext.getCompanyId();
  const filePath = buildStoragePath(companyId, "load", load.id, file.name);
  const uploadRes = await fetch(`${BASE_URL}/storage/v1/object/${DOCUMENT_BUCKET}/${filePath}`, {
    method: "POST",
    headers: getHeaders({
      "Content-Type": file.type || "application/pdf",
      "x-upsert": "true"
    }),
    body: file
  });

  if (!uploadRes.ok) throw new Error(await uploadRes.text());

  const documentRecord = window.CompanyContext.withCompanyId({
    entity_type: "load",
    entity_id: String(load.id),
    document_type: "rate_confirmation",
    file_name: file.name,
    file_path: filePath,
    file_size: file.size,
    mime_type: file.type || "application/pdf",
    notes: `Imported rate con ${reviewData.rate_confirmation_number || reviewData.load_number || ""}`.trim()
  });

  const docRes = await fetch(`${BASE_URL}/rest/v1/documents`, {
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify(documentRecord)
  });

  const result = await docRes.json();
  if (!docRes.ok) throw new Error(JSON.stringify(result));
  return Array.isArray(result) ? result[0] : result;
}

async function saveImportDraft(extraction) {
  const payload = window.CompanyContext.withCompanyId({
    file_name: selectedFile.name,
    file_size: selectedFile.size,
    mime_type: selectedFile.type || "application/pdf",
    status: "review",
    extracted_text: extractedText.slice(0, 50000),
    extracted_data: extraction,
    confidence_score: calculateConfidence(extraction).score,
    notes: "Dispatcher review required before creating load."
  });

  const res = await fetch(`${BASE_URL}/rest/v1/rate_con_imports`, {
    method: "POST",
    headers: getHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify(payload)
  });

  const result = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(result));
  const row = Array.isArray(result) ? result[0] : result;
  return row?.id || null;
}

async function markImportCreated(importId, loadId, reviewData) {
  const res = await fetch(`${BASE_URL}/rest/v1/rate_con_imports?id=eq.${encodeURIComponent(importId)}`, {
    method: "PATCH",
    headers: getHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({
      status: "load_created",
      load_id: Number(loadId),
      reviewed_data: reviewData,
      reviewed_at: new Date().toISOString()
    })
  });

  if (!res.ok) console.warn("Could not update rate con import:", await res.text());
}

function renderChecklist(data) {
  const confidence = calculateConfidence(data);
  checklist.innerHTML = confidence.items.map(item => `
    <div class="rate-con-check ${item.ok ? "pass" : "warning"}">
      <span>${item.ok ? "OK" : "!"}</span>
      <strong>${escapeHtml(item.label)}</strong>
    </div>
  `).join("");
}

function updateConfidence(data) {
  const confidence = calculateConfidence(data);
  confidenceBadge.textContent = `${confidence.score}% extracted`;
  confidenceBadge.className = `status-pill ${confidence.score >= 80 ? "success" : confidence.score >= 55 ? "caution" : "warning"}`;
}

function calculateConfidence(data = {}) {
  const required = [
    ["load_number", "Load #"],
    ["pickup_location", "Pickup"],
    ["delivery_location", "Delivery"],
    ["pickup_date", "Pickup date"],
    ["delivery_date", "Delivery date"],
    ["rate", "Rate"],
    ["commodity", "Commodity"],
    ["loaded_miles", "Miles"]
  ];
  const items = required.map(([key, label]) => ({ key, label, ok: Boolean(data[key]) }));
  const score = Math.round((items.filter(item => item.ok).length / items.length) * 100);
  return { score, items };
}

function normalizeReviewData(data) {
  Object.keys(data).forEach(key => {
    if (typeof data[key] === "string") data[key] = data[key].trim();
    if (data[key] === "") data[key] = null;
  });

  ["rate", "fuel_surcharge", "accessorial_pay", "loaded_miles", "weight"].forEach(key => {
    if (data[key] !== null && data[key] !== undefined) data[key] = Number(data[key]);
  });
  ["hazmat_required", "tracking_required"].forEach(key => {
    data[key] = data[key] === true || data[key] === "true";
  });

  if (data.rate || data.fuel_surcharge || data.accessorial_pay) {
    data.rate = Number(data.rate || 0) + Number(data.fuel_surcharge || 0) + Number(data.accessorial_pay || 0);
  }
  delete data.fuel_surcharge;

  return data;
}

function cleanExtraction(data) {
  Object.keys(data).forEach(key => {
    if (typeof data[key] === "string") {
      data[key] = data[key].replace(/\s+/g, " ").trim();
      if (!data[key]) data[key] = "";
    }
  });
  return data;
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\u0000/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n");
}

function extractStop(text, labels) {
  const compact = text.replace(/\n/g, " ");
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`${escaped}\\s*(?:-|:)?\\s*(?:\\d)?\\s*(?:appointment\\s*)?(?:date\\s*)?[:#-]?\\s*([\\s\\S]{0,280})`, "i");
    const match = compact.match(regex);
    if (match) {
      const segment = match[1];
      const location = extractLocation(segment);
      const date = extractDateTime(segment);
      if (location || date.date) return { location, date };
    }
  }
  return { location: "", date: {} };
}

function extractLocation(segment) {
  const cityState = segment.match(/([A-Z][A-Z .'-]+,\s*[A-Z]{2}(?:,\s*USA)?(?:,\s*\d{5})?)/);
  if (cityState) return cityState[1].replace(",USA", "").trim();
  const zipLine = segment.match(/([A-Z][A-Z .'-]+)\s+([A-Z]{2})\s+\d{5}/);
  if (zipLine) return `${titleCase(zipLine[1])}, ${zipLine[2]}`;
  return "";
}

function extractAppointments(text) {
  const matches = [...text.matchAll(/(?:appointment|appt)\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})(?:\s*@?\s*(\d{1,2}:?\d{0,2})\s*(?:CT|EST|AM|PM)?)?/gi)];
  return matches.map(match => ({
    date: parseDate(match[1]),
    time: parseTime(match[2])
  })).filter(item => item.date || item.time);
}

function extractDateTime(segment) {
  const dateMatch = segment.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  const timeMatch = segment.match(/(?:@|\s)(\d{1,2}:?\d{0,2})\s*(?:CT|EST|AM|PM)?/i);
  return {
    date: dateMatch ? parseDate(dateMatch[1]) : "",
    time: timeMatch ? parseTime(timeMatch[1]) : ""
  };
}

function firstMoneyAfter(text, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`${escaped}[\\s\\S]{0,80}?\\$?([0-9]{1,3}(?:,[0-9]{3})*(?:\\.\\d{2})|[0-9]+(?:\\.\\d{2}))`, "i");
    const match = text.match(regex);
    if (match) return Number(match[1].replace(/,/g, ""));
  }
  return null;
}

function firstNumberAfter(text, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`${escaped}[\\s\\S]{0,80}?([0-9]{2,6}(?:\\.[0-9]+)?)`, "i");
    const match = text.match(regex);
    if (match) return Number(match[1].replace(/,/g, ""));
  }
  return null;
}

function firstValue(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function extractBrokerName(text) {
  return firstValue(text, [
    /booked\s*with\s*[:#-]?\s*([A-Z][A-Za-z .'-]+)/i,
    /(ADDISON TRANSPORTATION|TRANSPORTATION ONE|TQL|TOTAL QUALITY LOGISTICS|C\.?H\.?\s*ROBINSON|COYOTE LOGISTICS)/i
  ]);
}

function extractBrokerContact(text) {
  const name = firstValue(text, [/booked\s*with\s*[:#-]?\s*([A-Z][A-Za-z .'-]+)/i]);
  const phone = firstValue(text, [/phone\s*[:#-]?\s*([()+\-\d xX. ]{7,})/i]);
  const email = firstValue(text, [/email\s*[:#-]?\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i]);
  return [name, phone, email].filter(Boolean).join(" / ");
}

function extractCustomerName(text) {
  return firstValue(text, [
    /customer\s*[:#-]?\s*([A-Z][A-Za-z0-9 &'.,-]+?)(?=\s+(?:carrier|facility|address|load|pickup|delivery)\b|$)/i,
    /facility\s*name\s*[:#-]?\s*([A-Z][A-Za-z0-9 &'.,-]+)/i
  ]);
}

function inferTrailerType(text) {
  if (/reefer|refrigerated/i.test(text)) return "Reefer";
  if (/flatbed/i.test(text)) return "Flatbed";
  if (/step\s*deck/i.test(text)) return "Step Deck";
  if (/53'? ?van|dry\s*van|van/i.test(text)) return "Dry Van";
  return "";
}

function extractTemperature(text) {
  const temp = firstValue(text, [
    /(?:maintained|temperature|temp)[\s\S]{0,80}?(-?\d{1,3}\s*(?:deg\s*)?F?\s*(?:to|-)\s*-?\d{1,3}\s*(?:deg\s*)?F?)/i
  ]);
  return temp || (/reefer|refrigerated/i.test(text) ? "Reefer temperature required" : "");
}

function inferRequiredDocuments(lower) {
  const docs = ["Rate Confirmation"];
  if (lower.includes("bol") || lower.includes("bill of lading")) docs.push("BOL");
  if (lower.includes("pod") || lower.includes("proof of delivery")) docs.push("POD");
  if (lower.includes("receipt")) docs.push("Receipts");
  if (lower.includes("scale ticket")) docs.push("Scale Tickets");
  return [...new Set(docs)];
}

function firstSentenceContaining(text, keywords) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences.find(sentence => keywords.some(keyword => sentence.toLowerCase().includes(keyword)))?.slice(0, 220) || "";
}

function buildNotes(text) {
  const notes = [];
  ["tracking", "pod", "hazmat", "detention", "lumper", "rate reduction", "temperature", "reefer"].forEach(keyword => {
    const sentence = firstSentenceContaining(text, [keyword]);
    if (sentence) notes.push(sentence);
  });
  return [...new Set(notes)].join("\n");
}

function parseDate(value) {
  const match = String(value || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return "";
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function parseTime(value) {
  const raw = String(value || "").replace(/[^\d:]/g, "");
  if (!raw) return "";
  if (raw.includes(":")) {
    const [hour, minute = "00"] = raw.split(":");
    return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  }
  if (raw.length <= 2) return `${raw.padStart(2, "0")}:00`;
  return `${raw.slice(0, -2).padStart(2, "0")}:${raw.slice(-2)}`;
}

function titleCase(value) {
  return String(value || "").toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
}

function buildStoragePath(companyId, entityType, entityId, fileName) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = String(fileName || "rate-con.pdf").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `${companyId}/${entityType}/${entityId}/${timestamp}-${safeName}`;
}

function resetImport() {
  form.reset();
  fileInput.value = "";
  selectedFile = null;
  extractedText = "";
  currentExtraction = null;
  currentImportId = null;
  confidenceBadge.textContent = "Waiting for PDF";
  confidenceBadge.className = "status-pill caution";
  renderChecklist({});
  setMessage("", "");
}

function friendlyError(message) {
  if (message.includes("rate_con_imports") || message.includes("import_source") || message.includes("rate_confirmation_number")) {
    return "Run rate-con-import.sql in Supabase first, then reload this page.";
  }
  if (message.includes("company-documents") || message.includes("Bucket")) {
    return "Document storage is not ready. Run documents-storage.sql first.";
  }
  return message;
}

function setMessage(text, color) {
  msg.textContent = text;
  msg.style.color = color || "";
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

initRateConImport().catch(err => {
  console.error(err);
  setMessage("Rate Con Import could not start. Confirm you are logged in and have a company selected.", "#ef4444");
});
