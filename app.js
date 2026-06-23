/* Disciplinary Action Dashboard
   Pulls live data from a monday.com board via the monday GraphQL API.
   Configured by default for the "Disciplinary Action Tracker" board. */

const DEFAULT_BOARD_ID = "18418855689";
// Calls go through the same-origin proxy in server.js, since monday.com's
// API does not allow direct browser (CORS) requests.
const API_URL = "/api/monday";
const STORAGE_KEYS = {
  boardId: "da_dashboard_board_id",
  cache: "da_dashboard_cache",
};

// Column id map -> friendly keys (from the Disciplinary Action Tracker board)
const COLUMNS = {
  actionType: "color_mm4jfxxr",
  manager: "multiple_person_mm4j6qhp",
  branch: "text_mm4jkfm4",
  region: "text_mm4jy96z",
  employeeId: "text_mm4jsvkz",
  incidentDate: "date_mm4j13zv",
  writeUpDate: "date_mm4jf655",
  repeatOffense: "boolean_mm4j9ade",
  priorWriteUp: "board_relation_mm4j13ea",
  pdfAttachment: "file_mm4j9vyx",
  description: "long_text_mm4j986c",
  violationCategory: "dropdown_mm4j3cpq",
  managerRole: "dropdown_mm4j3vra",
  status: "color_mm4jy3a1",
};

const KNOWN_ACTION_TYPES = [
  "Verbal Warning",
  "Written Warning",
  "Final Written Warning",
  "Suspension",
  "Termination",
];
const KNOWN_STATUSES = ["Draft", "Pending Signature", "Acknowledged", "Escalated", "Closed"];
const KNOWN_CATEGORIES = [
  "Attendance/Tardiness",
  "Policy Violation",
  "Performance",
  "Safety",
  "Insubordination",
  "Conduct",
  "Other",
];

const BADGE_COLORS = {
  "Verbal Warning": "#2e6f9e",
  "Written Warning": "#c08a2e",
  "Final Written Warning": "#c8102e",
  "Suspension": "#a3081f",
  "Termination": "#7a0a1e",
  "Draft": "#2e6f9e",
  "Pending Signature": "#c08a2e",
  "Acknowledged": "#1f7a3d",
  "Escalated": "#c8102e",
  "Closed": "#757575",
  "Repeat Offense": "#101010",
};

let allRecords = [];
let filteredRecords = [];

// ---------- Storage helpers ----------
function getBoardId() { return localStorage.getItem(STORAGE_KEYS.boardId) || DEFAULT_BOARD_ID; }
function saveSettings(boardId) {
  localStorage.setItem(STORAGE_KEYS.boardId, boardId || DEFAULT_BOARD_ID);
}
function cacheRecords(records) {
  localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify({ records, syncedAt: Date.now() }));
}
function loadCachedRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.cache);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

// ---------- monday.com API ----------
async function mondayQuery(query, variables) {
  // No Authorization header is sent from the browser -- the server-side
  // proxy (api/monday.js or server.js) injects the token itself from the
  // MONDAY_API_TOKEN environment variable.
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "API-Version": "2024-10",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(json.errors[0]?.message || "monday.com API error");
  }
  return json.data;
}

async function fetchAllItems(boardId) {
  const colIds = JSON.stringify(Object.values(COLUMNS));
  let items = [];
  let cursor = null;
  let first = true;

  while (first || cursor) {
    let data;
    if (first) {
      const query = `
        query ($boardId: [ID!]) {
          boards(ids: $boardId) {
            items_page(limit: 100) {
              cursor
              items {
                id
                name
                url
                column_values(ids: ${colIds}) { id text value }
              }
            }
          }
        }`;
      data = await mondayQuery(query, { boardId: [boardId] });
      const page = data.boards?.[0]?.items_page;
      items = items.concat(page?.items || []);
      cursor = page?.cursor || null;
      first = false;
    } else {
      const query = `
        query ($cursor: String!) {
          next_items_page(limit: 100, cursor: $cursor) {
            cursor
            items {
              id
              name
              url
              column_values(ids: ${colIds}) { id text value }
            }
          }
        }`;
      data = await mondayQuery(query, { cursor });
      const page = data.next_items_page;
      items = items.concat(page?.items || []);
      cursor = page?.cursor || null;
    }
  }
  return items;
}

async function fetchAssetUrl(assetId) {
  const query = `query ($ids: [ID!]) { assets(ids: $ids) { public_url } }`;
  const data = await mondayQuery(query, { ids: [assetId] });
  return data.assets?.[0]?.public_url || null;
}

// ---------- Parsing ----------
function colText(item, key) {
  const cv = item.column_values.find((c) => c.id === COLUMNS[key]);
  return cv ? cv.text : "";
}
function colValue(item, key) {
  const cv = item.column_values.find((c) => c.id === COLUMNS[key]);
  if (!cv || !cv.value) return null;
  try { return JSON.parse(cv.value); } catch (e) { return null; }
}

// The board doesn't have a dedicated "Employee Name" column today -- the
// item title is formatted like "Employee Name — Action Type (Manager)".
// We derive the employee name from the title, falling back to Employee ID.
function deriveEmployeeName(item) {
  const name = item.name || "";
  const dashSplit = name.split(/—|--|-(?!\w)/)[0];
  const cleaned = dashSplit.trim();
  if (cleaned) return cleaned;
  const empId = colText(item, "employeeId");
  return empId ? `Employee ${empId}` : "Unknown employee";
}

function parseItem(item) {
  const fileVal = colValue(item, "pdfAttachment");
  const files = (fileVal && fileVal.files) || [];
  return {
    id: item.id,
    title: item.name,
    url: item.url || "",
    employee: deriveEmployeeName(item),
    employeeId: colText(item, "employeeId"),
    actionType: colText(item, "actionType"),
    manager: colText(item, "manager"),
    branch: colText(item, "branch"),
    region: colText(item, "region"),
    incidentDate: colText(item, "incidentDate"),
    writeUpDate: colText(item, "writeUpDate"),
    repeatOffense: !!(colValue(item, "repeatOffense") || {}).checked,
    description: colText(item, "description"),
    violationCategory: colText(item, "violationCategory"),
    managerRole: colText(item, "managerRole"),
    status: colText(item, "status"),
    attachmentName: colText(item, "pdfAttachment"),
    attachmentAssetId: files[0]?.assetId || null,
  };
}

// ---------- Rendering ----------
function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function populateSelect(selectEl, values, placeholder) {
  const current = selectEl.value;
  selectEl.innerHTML = `<option value="">${placeholder}</option>`;
  values.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  });
  if (values.includes(current)) selectEl.value = current;
}

function refreshFilterOptions() {
  populateSelect(document.getElementById("filterBranch"), uniqueSorted(allRecords.map((r) => r.branch)), "All branches");
  populateSelect(document.getElementById("filterRegion"), uniqueSorted(allRecords.map((r) => r.region)), "All regions");
  populateSelect(document.getElementById("filterManager"), uniqueSorted(allRecords.map((r) => r.manager)), "All managers");
  populateSelect(document.getElementById("filterType"), KNOWN_ACTION_TYPES, "All types");
  populateSelect(document.getElementById("filterStatus"), KNOWN_STATUSES, "All statuses");
  populateSelect(document.getElementById("filterCategory"), KNOWN_CATEGORIES, "All categories");
}

function badge(text) {
  const color = BADGE_COLORS[text] || "#707070";
  return `<span class="badge" style="color:${color};background:${color}1a">${text || "—"}</span>`;
}

function renderStats() {
  const total = filteredRecords.length;
  const byStage = {};
  KNOWN_STATUSES.forEach((s) => (byStage[s] = 0));
  filteredRecords.forEach((r) => { if (r.status) byStage[r.status] = (byStage[r.status] || 0) + 1; });

  const cards = [
    `<div class="stat-card accent"><div class="stat-value">${total}</div><div class="stat-label">Total shown</div></div>`,
    ...Object.entries(byStage).map(
      ([label, count]) => `<div class="stat-card"><div class="stat-value">${count}</div><div class="stat-label">${label}</div></div>`
    ),
  ];
  document.getElementById("statsRow").innerHTML = cards.join("");
}

function applySort(records, sortBy) {
  const sorted = [...records];
  const byDate = (key, dir) => (a, b) => {
    const da = a[key] ? new Date(a[key]).getTime() : 0;
    const db = b[key] ? new Date(b[key]).getTime() : 0;
    return dir === "asc" ? da - db : db - da;
  };
  switch (sortBy) {
    case "write_up_date_asc": return sorted.sort(byDate("writeUpDate", "asc"));
    case "incident_date_desc": return sorted.sort(byDate("incidentDate", "desc"));
    case "employee_asc": return sorted.sort((a, b) => a.employee.localeCompare(b.employee));
    case "branch_asc": return sorted.sort((a, b) => (a.branch || "").localeCompare(b.branch || ""));
    default: return sorted.sort(byDate("writeUpDate", "desc"));
  }
}

function renderList() {
  const listEl = document.getElementById("cardList");
  const emptyEl = document.getElementById("emptyState");
  document.getElementById("resultsCount").textContent =
    `${filteredRecords.length} record${filteredRecords.length === 1 ? "" : "s"}`;

  if (filteredRecords.length === 0) {
    listEl.innerHTML = "";
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  listEl.innerHTML = filteredRecords
    .map(
      (r) => `
      <article class="record-card" data-id="${r.id}">
        <div class="record-card-top">
          <span class="record-employee">${r.employee} &middot; ${r.branch || "Unknown branch"} &middot; ${r.manager || "—"}</span>
          <span class="record-date">${r.writeUpDate || "—"}</span>
        </div>
        <div class="badge-row">${badge(r.actionType)}${badge(r.status)}${r.repeatOffense ? badge("Repeat Offense") : ""}</div>
        <div class="record-meta">
          Incident: <strong>${r.incidentDate || "—"}</strong>
          ${r.region ? "&nbsp;|&nbsp; Region: <strong>" + r.region + "</strong>" : ""}
          ${r.violationCategory ? "&nbsp;|&nbsp; <strong>" + r.violationCategory + "</strong>" : ""}
        </div>
        ${r.url ? `<a class="monday-link" href="${r.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Open in monday &rarr;</a>` : ""}
      </article>`
    )
    .join("");

  listEl.querySelectorAll(".record-card").forEach((card) => {
    card.addEventListener("click", () => openDetail(card.dataset.id));
  });
}

function openDetail(id) {
  const r = allRecords.find((rec) => rec.id === id);
  if (!r) return;
  const content = document.getElementById("detailContent");
  content.innerHTML = `
    <h2>${r.employee}</h2>
    <div class="badge-row" style="margin-bottom:1rem">${badge(r.actionType)}${badge(r.status)}</div>
    <div class="detail-row"><span class="label">Branch / Region</span>${r.branch || "—"} ${r.region ? "(" + r.region + ")" : ""}</div>
    <div class="detail-row"><span class="label">Submitting Manager</span>${r.manager || "—"} ${r.managerRole ? "(" + r.managerRole + ")" : ""}</div>
    <div class="detail-row"><span class="label">Violation Category</span>${r.violationCategory || "—"}</div>
    <div class="detail-row"><span class="label">Incident Date</span>${r.incidentDate || "—"}</div>
    <div class="detail-row"><span class="label">Write-up Date</span>${r.writeUpDate || "—"}</div>
    <div class="detail-row"><span class="label">Repeat Offense</span>${r.repeatOffense ? "Yes" : "No"}</div>
    <div class="detail-row"><span class="label">Description</span><div class="detail-description">${r.description || "No description provided."}</div></div>
    <div class="detail-row" id="attachmentRow"><span class="label">Attachment</span>${r.attachmentName ? "Loading link..." : "None"}</div>
    ${r.url ? `<a class="monday-link" href="${r.url}" target="_blank" rel="noopener">Open in monday &rarr;</a>` : ""}
  `;
  document.getElementById("detailOverlay").hidden = false;

  if (r.attachmentAssetId) {
    fetchAssetUrl(r.attachmentAssetId)
      .then((url) => {
        const row = document.getElementById("attachmentRow");
        if (row) {
          row.innerHTML = url
            ? `<span class="label">Attachment</span><a class="detail-link" href="${url}" target="_blank" rel="noopener">${r.attachmentName}</a>`
            : `<span class="label">Attachment</span>${r.attachmentName}`;
        }
      })
      .catch(() => {});
  }
}

// ---------- Filtering ----------
function applyFilters() {
  const branch = document.getElementById("filterBranch").value;
  const region = document.getElementById("filterRegion").value;
  const manager = document.getElementById("filterManager").value;
  const type = document.getElementById("filterType").value;
  const status = document.getElementById("filterStatus").value;
  const category = document.getElementById("filterCategory").value;
  const employee = document.getElementById("filterEmployee").value.trim().toLowerCase();
  const dateFrom = document.getElementById("filterDateFrom").value;
  const dateTo = document.getElementById("filterDateTo").value;
  const repeatOnly = document.getElementById("filterRepeat").checked;
  const sortBy = document.getElementById("sortBy").value;

  filteredRecords = allRecords.filter((r) => {
    if (branch && r.branch !== branch) return false;
    if (region && r.region !== region) return false;
    if (manager && r.manager !== manager) return false;
    if (type && r.actionType !== type) return false;
    if (status && r.status !== status) return false;
    if (category && r.violationCategory !== category) return false;
    if (employee && !r.employee.toLowerCase().includes(employee)) return false;
    if (repeatOnly && !r.repeatOffense) return false;
    if (dateFrom && r.incidentDate && r.incidentDate < dateFrom) return false;
    if (dateTo && r.incidentDate && r.incidentDate > dateTo) return false;
    return true;
  });

  filteredRecords = applySort(filteredRecords, sortBy);
  renderStats();
  renderList();
}

// ---------- Sync ----------
async function syncData(showSpinner = true) {
  const statusEl = document.getElementById("syncStatus");
  if (showSpinner) statusEl.textContent = "Syncing...";
  try {
    const items = await fetchAllItems(getBoardId());
    allRecords = items.map(parseItem);
    cacheRecords(allRecords);
    refreshFilterOptions();
    applyFilters();
    statusEl.textContent = `Synced ${new Date().toLocaleString()}`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = `Sync failed: ${err.message}`;
  }
}

// ---------- Init ----------
function loadFromCache() {
  const cached = loadCachedRecords();
  if (cached && cached.records) {
    allRecords = cached.records;
    refreshFilterOptions();
    applyFilters();
    document.getElementById("syncStatus").textContent =
      `Last synced ${new Date(cached.syncedAt).toLocaleString()}`;
  }
}

function wireEvents() {
  [
    "filterBranch", "filterRegion", "filterManager", "filterType",
    "filterStatus", "filterCategory", "filterRepeat", "sortBy",
  ].forEach((id) => document.getElementById(id).addEventListener("change", applyFilters));
  document.getElementById("filterEmployee").addEventListener("input", applyFilters);
  document.getElementById("filterDateFrom").addEventListener("change", applyFilters);
  document.getElementById("filterDateTo").addEventListener("change", applyFilters);

  document.getElementById("clearFiltersBtn").addEventListener("click", () => {
    document.querySelectorAll(".filter-field select").forEach((el) => (el.value = ""));
    document.getElementById("filterEmployee").value = "";
    document.getElementById("filterDateFrom").value = "";
    document.getElementById("filterDateTo").value = "";
    document.getElementById("filterRepeat").checked = false;
    applyFilters();
  });

  document.getElementById("refreshBtn").addEventListener("click", () => syncData(true));
  document.getElementById("settingsBtn").addEventListener("click", () => {
    document.getElementById("boardIdInput").value = getBoardId();
    document.getElementById("settingsOverlay").hidden = false;
  });
  document.getElementById("settingsClose").addEventListener("click", () => {
    document.getElementById("settingsOverlay").hidden = true;
  });
  document.getElementById("settingsOverlay").addEventListener("click", (e) => {
    if (e.target.id === "settingsOverlay") document.getElementById("settingsOverlay").hidden = true;
  });
  document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
    const boardId = document.getElementById("boardIdInput").value.trim() || DEFAULT_BOARD_ID;
    saveSettings(boardId);
    document.getElementById("settingsOverlay").hidden = true;
    await syncData(true);
  });

  document.getElementById("detailClose").addEventListener("click", () => {
    document.getElementById("detailOverlay").hidden = true;
  });
  document.getElementById("detailOverlay").addEventListener("click", (e) => {
    if (e.target.id === "detailOverlay") document.getElementById("detailOverlay").hidden = true;
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document.getElementById("settingsOverlay").hidden = true;
    document.getElementById("detailOverlay").hidden = true;
  });

  // PWA install prompt
  let deferredPrompt;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById("installBtn").hidden = false;
  });
  document.getElementById("installBtn").addEventListener("click", async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      document.getElementById("installBtn").hidden = true;
    }
  });
}

window.addEventListener("DOMContentLoaded", () => {
  wireEvents();
  refreshFilterOptions();
  loadFromCache();
  syncData(false);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
});
