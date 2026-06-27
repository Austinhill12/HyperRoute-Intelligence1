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
    pages.push(rebuildPdfLines(content.items));
  }

  return normalizeText(pages.join("\n"));
}

function parseRateConfirmation(text) {
  const lower = text.toLowerCase();
  const lines = getUsefulLines(text);
  const pickup = extractPickupStop(lines, text);
  const delivery = extractDeliveryStop(lines, text);
  const rateDetails = extractRateDetails(lines, text);
  const rate = rateDetails.total ?? rateDetails.lineHaul ?? extractBestRate(text, lines);
  const fuel = rateDetails.fuelSurcharge;
  const accessorial = extractAccessorialPay(lines, text);
  const loadNumber = reliableIdentifier(firstValueFromLines(lines, [
    /^load\s*(?:number|#)\s*[:#-]?\s*([A-Z0-9-]*\d[A-Z0-9-]*)/i,
    /^load\s+([A-Z0-9-]*\d[A-Z0-9-]*)/i,
    /^pro\s*#\s*[:#-]?\s*([A-Z0-9-]*\d[A-Z0-9-]*)/i,
    /^reference\s*#\s*[:#-]?\s*([A-Z0-9-]*\d[A-Z0-9-]*)/i
  ]) || valueAfterLabel(lines, ["Load Number", "Load #", "PRO #"]) || firstValue(text, [
    /load\s*(?:number|#)\s*[:#-]?\s*([A-Z0-9-]*\d[A-Z0-9-]*)/i,
    /load\s+([A-Z0-9-]*\d[A-Z0-9-]*)/i,
    /pro\s*#\s*[:#-]?\s*([A-Z0-9-]*\d[A-Z0-9-]*)/i,
    /reference\s*#\s*[:#-]?\s*([A-Z0-9-]*\d[A-Z0-9-]*)/i
  ])) || inferTopLoadNumber(lines);
  const rateConNumber = firstValueFromLines(lines, [
    /^rate\s*confirmation\s*(?:number|#)?\s*[:#-]?\s*([A-Z0-9-]+)/i,
    /^confirmation\s*(?:number|#)\s*[:#-]?\s*([A-Z0-9-]+)/i,
    /^document\s*id\s*[:#-]?\s*([A-Z0-9-]+)/i
  ]) || firstValue(text, [
    /rate\s*confirmation\s*(?:number|#)?\s*[:#-]?\s*([A-Z0-9-]+)/i,
    /confirmation\s*(?:number|#)\s*[:#-]?\s*([A-Z0-9-]+)/i,
    /document\s*id\s*[:#-]?\s*([A-Z0-9-]+)/i
  ]) || loadNumber;
  const customerRef = firstValueFromLines(lines, [
    /^customer\s*ref(?:erence)?\s*(?:number|#)?\s*[:#-]?\s*([A-Z0-9-]+)/i,
    /^customerrefnumber\s*[:#-]?\s*([A-Z0-9-]+)/i,
    /^ref\s*#\s*[:#-]?\s*([A-Z0-9-]+)/i,
    /^pick\s*#\s*[:#-]?\s*([A-Z0-9-]+)/i
  ]) || valueAfterLabel(lines, ["CustomerRefNumber", "Customer Reference", "Reference #", "Ref #", "Pick#"]) || firstValue(text, [
    /customer\s*ref(?:erence)?\s*(?:number|#)?\s*[:#-]?\s*([A-Z0-9-]+)/i,
    /customerrefnumber\s*[:#-]?\s*([A-Z0-9-]+)/i,
    /ref\s*#\s*[:#-]?\s*([A-Z0-9-]+)/i,
    /pick\s*#\s*[:#-]?\s*([A-Z0-9-]+)/i
  ]);

  const equipment = valueAfterLabel(lines, ["Equipment", "Size & Type"]) || firstValue(text, [
    /equipment\s*[:#-]?\s*([^|]+?)(?=\s+(?:miles|commodity|pickup|delivery|load details|mode)\b|$)/i,
    /size\s*&\s*type\s*[:#-]?\s*([^|]+?)(?=\s+(?:description|miles|pieces|weight)\b|$)/i
  ]) || extractAddisonEquipment(lines);
  const trailerType = inferTrailerType(`${equipment || ""} ${text}`);
  const appointmentDates = extractAppointments(text);
  const pickupDateTime = hasDateTime(pickup.date) ? pickup.date : appointmentDates[0] || {};
  const deliveryDateTime = hasDateTime(delivery.date) ? delivery.date : appointmentDates[1] || {};

  const requiredDocs = inferRequiredDocuments(lower);
  const trackingRequired = /tracking is required|electronic tracking|required for all loads|track and trace/i.test(text);
  const hazmatRequired = /hazmat|hazardous|un\d{4}/i.test(text);

  return cleanExtraction({
    broker_name: extractBrokerName(text, lines),
    broker_contact: extractBrokerContact(text, lines),
    broker_mc_number: extractBrokerMcNumber(text, lines),
    rate_confirmation_number: rateConNumber,
    load_number: loadNumber || rateConNumber,
    customer_reference_number: customerRef,
    customer_name: extractCustomerName(text, lines),
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
    loaded_miles: valueAfterLabelNumber(lines, ["Miles"]) || extractAddisonMiles(lines),
    commodity: valueAfterLabel(lines, ["Commodity"]) || extractAddisonCommodity(lines) || firstValue(text, [/commodity\s*[:#-]?\s*([^|]+?)(?=\s+(?:do not|pickup|delivery|load instructions|rate details|pcs|weight)\b|$)/i, /description\s*[:#-]?\s*([^|]+?)(?=\s+(?:miles|pieces|weight|charges)\b|$)/i]),
    weight: valueAfterLabelNumber(lines, ["Weight"]) || extractLoadDetailsWeight(lines),
    trailer_type: trailerType,
    equipment_requirements: equipment,
    hazmat_required: hazmatRequired,
    temperature_requirements: extractTemperature(text),
    tracking_required: trackingRequired,
    required_documents: requiredDocs.join(", "),
    lumper_information: extractLumperInformation(text),
    detention_policy: extractDetentionPolicy(text, lines),
    notes: buildNotes(text, rateDetails)
  });
}

function fillReviewForm(data) {
  Array.from(form.elements).forEach(input => {
    if (!input.name) return;
    input.value = input.tagName === "SELECT" ? input.options[0]?.value || "" : "";
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
    .replace(/[\u0001-\u001f]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n");
}

function rebuildPdfLines(items) {
  const rows = new Map();

  items.forEach(item => {
    const text = String(item.str || "").trim();
    if (!text) return;
    const y = Math.round((item.transform?.[5] || 0) / 3) * 3;
    const x = item.transform?.[4] || 0;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push({ x, text });
  });

  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, parts]) => parts.sort((a, b) => a.x - b.x).map(part => part.text).join(" ").trim())
    .filter(Boolean)
    .join("\n");
}

function getUsefulLines(text) {
  return String(text || "")
    .split(/\n+/)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(line => line && !/^\/\d+(?:\/\d+|\s|i255)+$/i.test(line));
}

function valueAfterLabel(lines, labels) {
  const normalizedLabels = labels.map(label => label.toLowerCase());
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lower = line.toLowerCase();
    const label = normalizedLabels.find(item => lower === item.toLowerCase() || lower.startsWith(`${item.toLowerCase()}:`));
    if (!label) continue;

    const inlineValue = line.slice(line.indexOf(":") + 1).trim();
    if (line.includes(":") && inlineValue) return inlineValue;

    for (let j = i + 1; j < Math.min(lines.length, i + 5); j += 1) {
      if (isLikelyLabel(lines[j])) continue;
      return lines[j];
    }
  }
  return "";
}

function scopedValueAfterLabel(lines, startIndex, labels, range = 12) {
  if (startIndex < 0) return "";
  const windowLines = lines.slice(startIndex, startIndex + range);
  return valueAfterLabel(windowLines, labels);
}

function valueAfterLabelNumber(lines, labels) {
  const value = valueAfterLabel(lines, labels);
  const match = String(value || "").match(/[\d,]+(?:\.\d+)?/);
  return match ? Number(match[0].replace(/,/g, "")) : null;
}

function firstValueFromLines(lines, patterns) {
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
  }
  return "";
}

function inferTopLoadNumber(lines) {
  const candidate = lines.slice(0, 6).find(line => /^\d{5,}$/.test(line));
  return candidate || "";
}

function reliableIdentifier(value) {
  const text = String(value || "").trim();
  return /\d/.test(text) ? text : "";
}

function extractPickupStop(lines, text) {
  const addressStops = extractAddressStops(lines, text);
  const stop = extractNamedStop(lines, ["PICKUP", "PICKUP - 1", "PICK 1"], text, "pickup");
  if (addressStops[0]?.location) return mergeStopDate(addressStops[0], stop);
  if (isUsableLocation(stop.location)) return stop;
  return { location: "", date: stop.date || {} };
}

function extractDeliveryStop(lines, text) {
  const addressStops = extractAddressStops(lines, text);
  const stop = extractNamedStop(lines, ["DELIVERY", "DELIVERY - 1", "STOP 1"], text, "delivery");
  if (addressStops[1]?.location) return mergeStopDate(addressStops[1], stop);
  if (isUsableLocation(stop.location)) return stop;
  return { location: "", date: stop.date || {} };
}

function isUsableLocation(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/\b[A-Z]{2}\s+\d{5}\b/i.test(text)) return true;
  if (/\d+\s+[A-Z0-9 .'-]+,\s*[A-Z][A-Z .'-]+,\s*[A-Z]{2}/i.test(text)) return true;
  if (/[A-Z][A-Z .'-]+,\s*[A-Z]{2}\b/i.test(text) && !/load number|carrier rate|picking up|shipment/i.test(text)) return true;
  return false;
}

function mergeStopDate(addressStop, dateStop) {
  if (!addressStop?.location) return null;
  return {
    location: addressStop.location,
    date: hasDateTime(addressStop.date) ? addressStop.date : dateStop?.date || {}
  };
}

function extractNamedStop(lines, labels, text, kind) {
  if (/facility name/i.test(text)) {
    const stops = extractFacilityStops(lines, text);
    const facilityStop = kind === "pickup" ? stops[0] : stops[1];
    if (facilityStop?.location) return facilityStop;
  }

  const index = lines.findIndex(line => labels.some(label => line.toLowerCase().startsWith(label.toLowerCase())));
  if (index >= 0) {
    const windowLines = lines.slice(index, index + 12);
    const simpleLocation = windowLines.slice(1, 4).find(line => /,\s*[A-Z]{2}\b/i.test(line) && !isLikelyLabel(line));
    const addressLine = windowLines.find(line => /\b[A-Z]{2},?\s*(?:USA,?\s*)?\d{5}\b/i.test(line) || /\b[A-Z]{2}\s+\d{5}\b/.test(line));
    const previousAddressLine = addressLine ? windowLines[Math.max(0, windowLines.indexOf(addressLine) - 1)] : "";
    const location = locationFromAddress(previousAddressLine, addressLine) || cleanLocationLine(simpleLocation);
    const dateTime = extractDateTime(windowLines.join(" "));
    return { location, date: dateTime };
  }

  return { location: "", date: {} };
}

function extractFacilityStops(lines, text = "") {
  const stops = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^facility name:?$/i.test(lines[i])) continue;
    const name = lines[i + 1] || "";
    const addressIndex = lines.findIndex((line, index) => index > i && index < i + 8 && /^address:?$/i.test(line));
    const addressLine = addressIndex >= 0 ? lines[addressIndex + 1] : "";
    const cityLine = addressIndex >= 0 ? lines[addressIndex + 2] : "";
    const appointment = findNextAppointment(lines, i);
    const location = locationFromAddress(addressLine, cityLine) || name;
    stops.push({ location, date: appointment });
  }
  return stops.length ? stops : extractFacilityStopsFromText(text);
}

function extractFacilityStopsFromText(text) {
  const stops = [];
  const compact = String(text || "").replace(/\s+/g, " ");
  const regex = /Facility Name:?\s*([^:]+?)\s+Address:?\s*([^:]+?)\s+([A-Z][A-Z .'-]+),\s*([A-Z]{2}),?\s*(?:USA,?\s*)?(\d{5})/gi;
  let match;
  while ((match = regex.exec(compact)) !== null) {
    stops.push({
      location: `${titleCase(match[2])}, ${titleCase(match[3])}, ${match[4].toUpperCase()} ${match[5]}`,
      date: {}
    });
  }
  return stops;
}

function extractAddressStops(lines, text = "") {
  const stops = [];
  const lineBlockStops = extractFacilityAddressBlocksFromLines(lines);
  if (lineBlockStops.length >= 2) return lineBlockStops;

  const blockStops = extractAddressBlocksFromText(text);
  if (blockStops.length >= 2) return blockStops;

  const sourceLines = [
    ...lines,
    ...String(text || "").split(/\n+/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean)
  ];

  for (let i = 0; i < sourceLines.length; i += 1) {
    const cityLine = sourceLines[i];
    if (!/[A-Z][A-Z .'-]+,\s*[A-Z]{2},?\s*(?:USA,?\s*)?\d{5}/i.test(cityLine)) continue;

    const street = findPreviousStreetLine(sourceLines, i);
    const location = fullAddressFromLines(street, cityLine) || cleanLocationLine(cityLine);
    if (location && !stops.some(stop => stop.location === location)) {
      stops.push({ location, date: {} });
    }
  }

  if (stops.length >= 2) return stops;
  return stops.length ? stops : blockStops.length ? blockStops : extractFacilityStopsFromText(text);
}

function extractFacilityAddressBlocksFromLines(lines) {
  const stops = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || "").trim();
    if (!/^facility name:?$/i.test(line) && !/^facility name:/i.test(line)) continue;

    const addressIndex = findNextLineIndex(lines, i + 1, 10, value => /^address:?$/i.test(value) || /^address:/i.test(value));
    if (addressIndex < 0) continue;

    const street = valueAfterInlineLabel(lines[addressIndex], "Address") || findNextStreetLine(lines, addressIndex + 1, 6);
    const cityIndex = findNextLineIndex(lines, addressIndex + 1, 8, value => /[A-Z][A-Z .'-]+,\s*[A-Z]{2},?\s*(?:USA,?\s*)?\d{5}/i.test(value));
    const cityLine = cityIndex >= 0 ? lines[cityIndex] : "";
    const location = fullAddressFromLines(street, cityLine);

    if (location && !stops.some(stop => stop.location === location)) {
      stops.push({ location, date: findNextAppointment(lines, i) });
    }
  }

  return stops;
}

function findNextLineIndex(lines, startIndex, range, predicate) {
  for (let i = startIndex; i < Math.min(lines.length, startIndex + range); i += 1) {
    if (predicate(String(lines[i] || "").trim())) return i;
  }
  return -1;
}

function valueAfterInlineLabel(line, label) {
  const regex = new RegExp(`^${label}\\s*:?\\s*(.+)$`, "i");
  const match = String(line || "").trim().match(regex);
  return match?.[1]?.trim() || "";
}

function findNextStreetLine(lines, startIndex, range) {
  for (let i = startIndex; i < Math.min(lines.length, startIndex + range); i += 1) {
    const line = String(lines[i] || "").trim();
    if (/\d+\s+[A-Z0-9 .'-]+/i.test(line)) return line;
  }
  return "";
}

function findPreviousStreetLine(lines, startIndex) {
  for (let i = startIndex - 1; i >= Math.max(0, startIndex - 6); i -= 1) {
    const line = String(lines[i] || "").trim();
    if (!line || isLikelyLabel(line) || /^facility name:?$/i.test(line) || /^address:?$/i.test(line)) continue;
    if (/\d+\s+[A-Z0-9 .'-]+/i.test(line)) return line;
  }
  return "";
}

function extractAddressBlocksFromText(text) {
  const stops = [];
  const compact = String(text || "").replace(/\s+/g, " ");
  const streetSuffix = "(?:RD|ROAD|ST|STREET|AVE|AVENUE|BLVD|BOULEVARD|DR|DRIVE|LN|LANE|CT|COURT|HWY|HIGHWAY|PKWY|PARKWAY|WAY|PL|PLACE|CIR|CIRCLE|TRL|TRAIL)";
  const patterns = [
    new RegExp(`Address:?\\s*([0-9][A-Z0-9 .'-]{2,80}?\\b${streetSuffix})\\s+([A-Z][A-Z .'-]+),\\s*([A-Z]{2}),?\\s*(?:USA,?\\s*)?(\\d{5})`, "gi"),
    new RegExp(`\\b([0-9][A-Z0-9 .'-]{2,80}?\\b${streetSuffix})\\s+([A-Z][A-Z .'-]+),\\s*([A-Z]{2}),?\\s*(?:USA,?\\s*)?(\\d{5})`, "gi")
  ];

  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(compact)) !== null) {
      const street = cleanStreet(match[1]);
      const location = `${titleCase(street)}, ${titleCase(match[2])}, ${match[3].toUpperCase()} ${match[4]}`;
      if (!stops.some(stop => stop.location === location)) stops.push({ location, date: {} });
    }
  });

  return stops.filter(stop => isUsableLocation(stop.location));
}

function cleanStreet(value) {
  return String(value || "")
    .replace(/\b(?:Facility Name|Address|Relay|APPT|Appointment)\b:?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findNextAppointment(lines, startIndex) {
  for (let i = startIndex; i < Math.min(lines.length, startIndex + 20); i += 1) {
    if (/appointment|appt/i.test(lines[i])) {
      const sameLine = extractDateTime(lines[i]);
      const nextLine = extractDateTime(`${lines[i + 1] || ""} ${lines[i + 2] || ""}`);
      return sameLine.date || sameLine.time ? sameLine : nextLine;
    }
  }
  return {};
}

function locationFromAddress(line1, line2) {
  const fullAddress = fullAddressFromLines(line1, line2);
  if (fullAddress) return fullAddress;

  const line2Location = cleanLocationLine(line2);
  if (line2Location) return line2Location;

  const combined = [line1, line2].filter(Boolean).join(" ");
  const commaMatch = combined.match(/([A-Z][A-Z .'-]+),\s*([A-Z]{2})(?:,\s*USA)?(?:,\s*\d{5})?/i);
  if (commaMatch) return `${titleCase(commaMatch[1])}, ${commaMatch[2].toUpperCase()}`;

  const zipMatch = combined.match(/([A-Z][A-Z .'-]+)\s+([A-Z]{2})\s+\d{5}/i);
  if (zipMatch) return `${titleCase(zipMatch[1])}, ${zipMatch[2].toUpperCase()}`;

  return "";
}

function fullAddressFromLines(line1, line2) {
  const street = String(line1 || "").replace(/\s+/g, " ").trim();
  const cityLine = String(line2 || "").replace(/\s+/g, " ").trim();
  if (!street || !cityLine) return "";
  if (!/\d/.test(street)) return "";

  const match = cityLine.match(/([A-Z][A-Z .'-]+),\s*([A-Z]{2}),?\s*(?:USA,?\s*)?(\d{5})/i);
  if (!match) return "";

  return `${titleCase(street)}, ${titleCase(match[1])}, ${match[2].toUpperCase()} ${match[3]}`;
}

function cleanLocationLine(line) {
  if (!line) return "";
  const match = String(line).match(/([A-Z][A-Z .'-]+),\s*([A-Z]{2})/i);
  return match ? `${titleCase(match[1])}, ${match[2].toUpperCase()}` : "";
}

function extractRateDetails(lines, text) {
  const lineHaul = moneyNearLabel(lines, ["Line Haul Charges", "Line Haul Rate", "Linehaul"]);
  const fuelSurcharge = moneyNearLabel(lines, ["Fuel Surcharge", "FSC"]);
  const total = moneyNearLabel(lines, ["Total Rate", "Total"]);

  return {
    lineHaul: lineHaul ?? firstMoneyAfter(text, ["line haul charges", "line haul rate", "linehaul"]),
    fuelSurcharge,
    total: total ?? firstMoneyAfter(text, ["total rate", "total"])
  };
}

function moneyNearLabel(lines, labels) {
  const normalizedLabels = labels.map(label => label.toLowerCase());
  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || "");
    const lower = line.toLowerCase().replace(/:$/, "");
    const label = normalizedLabels.find(item => lower === item || lower.startsWith(`${item}:`) || lower.startsWith(`${item} `));
    if (!label) continue;

    const sameLine = moneyFromText(line.slice(label.length));
    if (sameLine !== null) return sameLine;

    for (let j = i + 1; j < Math.min(lines.length, i + 5); j += 1) {
      const candidate = String(lines[j] || "").trim();
      if (!candidate || candidate === "-") continue;
      if (isLikelyLabel(candidate) || isRateDetailLabel(candidate)) break;
      const value = moneyFromText(candidate);
      if (value !== null) return value;
    }
  }
  return null;
}

function isRateDetailLabel(value) {
  return /^(line haul charges|line haul rate|linehaul|fuel surcharge|fsc|total rate|total)$/i.test(String(value || "").replace(":", "").trim());
}

function moneyFromText(value) {
  const match = String(value || "").match(/\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.\d{2})|[0-9]+(?:\.\d{2}))/);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

function extractAccessorialPay(lines, text) {
  const explicit = moneyNearLabel(lines, ["Accessorial Pay", "Approved Accessorial", "Accessorial Amount"]);
  if (explicit !== null) return explicit;
  return firstMoneyAfter(text, ["accessorial pay", "approved accessorial", "accessorial amount"]);
}

function extractBestRate(text, lines) {
  const totalLineIndex = lines.findIndex(line => /^total(?: rate)?$/i.test(line) || /^total\s*\$?[\d,]+/i.test(line));
  if (totalLineIndex >= 0) {
    const sameLine = lines[totalLineIndex].match(/\$?([\d,]+\.\d{2})/);
    if (sameLine) return Number(sameLine[1].replace(/,/g, ""));
    for (let i = totalLineIndex + 1; i < Math.min(lines.length, totalLineIndex + 5); i += 1) {
      const match = lines[i].match(/\$?([\d,]+\.\d{2})/);
      if (match) return Number(match[1].replace(/,/g, ""));
    }
  }

  return firstMoneyAfter(text, ["customer rate", "total rate", "total", "line haul charges", "line haul rate", "carrier rate"]);
}

function extractAddisonEquipment(lines) {
  const headerIndex = lines.findIndex(line => /size\s*&\s*type/i.test(line) && /description/i.test(line) && /miles/i.test(line));
  if (headerIndex < 0) return "";
  const values = firstAddisonValueLine(lines, headerIndex);
  const match = values.match(/^(.+?)\s+[A-Z0-9 ,'-]+\s+\d{2,6}$/i);
  return match ? match[1].trim() : values;
}

function extractAddisonCommodity(lines) {
  const headerIndex = lines.findIndex(line => /size\s*&\s*type/i.test(line) && /description/i.test(line) && /miles/i.test(line));
  if (headerIndex < 0) return "";
  const values = firstAddisonValueLine(lines, headerIndex);
  const match = values.match(/^(?:53'? ?VAN|REEFER|FLATBED|DRY VAN)?\s*(HAZMAT\s+)?(.+?)\s+\d{2,6}$/i);
  return match ? `${match[1] || ""}${match[2] || ""}`.trim() : "";
}

function extractAddisonMiles(lines) {
  const headerIndex = lines.findIndex(line => /size\s*&\s*type/i.test(line) && /description/i.test(line) && /miles/i.test(line));
  if (headerIndex < 0) return null;
  const values = firstAddisonValueLine(lines, headerIndex);
  const match = values.match(/(\d{2,6})$/);
  return match ? Number(match[1]) : null;
}

function firstAddisonValueLine(lines, headerIndex) {
  for (let i = headerIndex + 1; i < Math.min(lines.length, headerIndex + 6); i += 1) {
    const line = lines[i] || "";
    if (/pieces|weight|charges/i.test(line)) continue;
    if (/\d{2,6}$/.test(line)) return line;
  }
  return "";
}

function extractLoadDetailsWeight(lines) {
  const weightLabelIndex = lines.findIndex(line => /^weight:?$/i.test(line));
  if (weightLabelIndex >= 0) {
    for (let i = weightLabelIndex + 1; i < Math.min(lines.length, weightLabelIndex + 8); i += 1) {
      const match = lines[i].match(/[\d,]{4,}/);
      if (match) return Number(match[0].replace(/,/g, ""));
    }
  }

  const addisonHeaderIndex = lines.findIndex(line => /pieces:\s*weight/i.test(line) || /^pieces:\s*weight:?$/i.test(line));
  if (addisonHeaderIndex >= 0) {
    const match = (lines[addisonHeaderIndex + 1] || "").match(/(\d{4,})$/);
    if (match) return Number(match[1]);
  }

  return null;
}

function isLikelyLabel(line) {
  return /^(phone|email|address|carrier|driver|equipment|miles|commodity|pickup|delivery|appointment|notes|live|relay|rate details|load details|status|pay)$/i.test(String(line || "").replace(":", ""));
}

function hasDateTime(value) {
  return Boolean(value && (value.date || value.time));
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

function extractBrokerName(text, lines = []) {
  const knownBroker = firstValue(text, [
    /(ADDISON TRANSPORTATION|TRANSPORTATION ONE|TQL|TOTAL QUALITY LOGISTICS|C\.?H\.?\s*ROBINSON|COYOTE LOGISTICS)/i
  ]);
  if (knownBroker) return knownBroker;

  const bookedWith = valueAfterLabel(lines, ["Booked With"]);
  if (bookedWith) return bookedWith;

  const bookedWithText = firstValue(text, [/booked\s*with\s*[:#-]?\s*([A-Z][A-Za-z .'-]+)/i]);
  if (bookedWithText) return bookedWithText;

  const email = lines.find(line => /@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(line));
  const emailIndex = email ? lines.indexOf(email) : -1;
  return emailIndex > 0 ? lines[emailIndex - 1] : "";
}

function extractBrokerContact(text, lines = []) {
  const bookedIndex = lines.findIndex(line => /^booked with:?$/i.test(line));
  const name = scopedValueAfterLabel(lines, bookedIndex, ["Booked With"], 8) || firstValue(text, [/booked\s*with\s*[:#-]?\s*([A-Z][A-Za-z .'-]+)/i]);
  const phone = scopedValueAfterLabel(lines, bookedIndex, ["Phone"], 14) || valueAfterLabel(lines, ["Phone"]) || firstValue(text, [/phone\s*[:#-]?\s*([()+\-\d xX. ]{7,})/i]);
  const email = scopedValueAfterLabel(lines, bookedIndex, ["Email"], 14) || valueAfterLabel(lines, ["Email"]) || firstValue(text, [/email\s*[:#-]?\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i]);
  return [name, phone, email].filter(Boolean).join(" / ");
}

function extractBrokerMcNumber(text, lines = []) {
  const scopedIndex = lines.findIndex(line => /broker|transportation one|addison transportation|tql|total quality logistics/i.test(line));
  const scopedLines = scopedIndex >= 0 ? lines.slice(scopedIndex, scopedIndex + 20).join(" ") : "";
  return firstValue(scopedLines, [
    /broker\s*mc\s*#?\s*[:#-]?\s*(\d{4,8})/i,
    /\bmc\s*#?\s*[:#-]?\s*(\d{4,8})/i,
    /broker\s*dot\s*#?\s*[:#-]?\s*(\d{4,8})/i
  ]) || firstValue(text, [
    /broker\s*mc\s*#?\s*[:#-]?\s*(\d{4,8})/i,
    /broker\s*dot\s*#?\s*[:#-]?\s*(\d{4,8})/i
  ]);
}

function extractCustomerName(text, lines = []) {
  const facilityName = valueAfterLabel(lines, ["Facility Name"]);
  if (facilityName) return facilityName;

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
  if (lower.includes("signed rate confirmation")) docs.push("Signed Rate Confirmation");
  if (lower.includes("invoice")) docs.push("Invoice");
  if (lower.includes("bol") || lower.includes("bill of lading")) docs.push("BOL");
  if (lower.includes("pod") || lower.includes("proof of delivery")) docs.push("POD");
  if (lower.includes("receipt")) docs.push("Receipts");
  if (lower.includes("lumper")) docs.push("Lumper Receipts");
  if (lower.includes("accessorial")) docs.push("Accessorial Receipts");
  if (lower.includes("scale ticket")) docs.push("Scale Tickets");
  return [...new Set(docs)];
}

function firstSentenceContaining(text, keywords) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences.find(sentence => keywords.some(keyword => sentence.toLowerCase().includes(keyword)))?.slice(0, 220) || "";
}

function extractLumperInformation(text) {
  if (/lumper\s+fee/i.test(text) && /valid\s+receipt/i.test(text)) {
    return "Lumper fee reimbursed in full with valid receipt.";
  }
  return firstSentenceContaining(text, ["lumper"]);
}

function extractDetentionPolicy(text, lines = []) {
  const direct = text.match(/detention\s*:\s*\$?\s*([0-9]+(?:\.\d{2})?)/i);
  const lineAmount = moneyNearLabel(lines, ["Detention"]);
  const explicit = text.match(/detention[\s\S]{0,160}?\$?\s*([0-9]+(?:\.\d{2})?)[\s\S]{0,120}?(?:after\s*2\s*free\s*hours|2\s*free\s*hours)/i);
  const amount = direct?.[1] ? Number(direct[1]) : lineAmount ?? (explicit?.[1] ? Number(explicit[1]) : firstMoneyAfter(text, ["detention"]));
  if ((/free time is 2 hours/i.test(text) || /2\s*free\s*hours/i.test(text)) && amount) {
    return `Detention: $${amount} per hour after 2 free hours. Tracking must be accepted and maintained for detention approval when required.`;
  }
  if (/free time is 2 hours/i.test(text)) {
    return "Detention: free time is 2 hours per facility.";
  }
  return firstSentenceContaining(text, ["detention", "free time"]);
}

function buildNotes(text, rateDetails = {}) {
  const notes = [];
  if (rateDetails.lineHaul || rateDetails.fuelSurcharge || rateDetails.total) {
    notes.push(`Rate details: line haul ${formatMoney(rateDetails.lineHaul)}, fuel surcharge ${formatMoney(rateDetails.fuelSurcharge)}, total ${formatMoney(rateDetails.total)}.`);
  }

  if (/accessorial requests[\s\S]{0,520}48 hours/i.test(text)) {
    notes.push("Accessorial requests and required documents must be submitted within 48 hours of delivery when required by the rate confirmation.");
  }
  if (/\$50[\s\S]{0,120}rate reduction/i.test(text) || /rate reduction[\s\S]{0,120}\$50/i.test(text)) {
    notes.push("Missing required paperwork may cause a $50 rate reduction.");
  }
  if (/paperwork[\s\S]{0,360}30 days/i.test(text)) {
    notes.push("Paperwork not received within 30 days may forfeit the right to collect charges.");
  }
  if (/electronic tracking is required/i.test(text)) {
    notes.push("Electronic tracking is required for this load.");
  }
  if (/pod[\s\S]{0,120}24 hours/i.test(text)) {
    notes.push("POD must be provided within 24 hours of delivery.");
  }
  if (/hazmat|hazardous|un\d{4}/i.test(text)) {
    notes.push("Hazmat appears on the rate confirmation; verify driver endorsement, placards, and shipment paperwork before dispatch.");
  }
  if (/reefer|refrigerated|temperature/i.test(text)) {
    notes.push("Temperature-controlled requirements appear on the rate confirmation; verify reefer set point and download requirements.");
  }
  return [...new Set(notes)].join("\n");
}

function formatMoney(value) {
  return value === null || value === undefined || Number.isNaN(Number(value)) ? "N/A" : `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
