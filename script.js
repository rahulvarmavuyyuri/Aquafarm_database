/* =====================================================================
   AquaFarm Management System  -  script.js

   HOW THIS FILE IS ORGANISED (search for the numbered headings):
    1. Small helper functions
    2. Saving and loading data (localStorage)
    3. Messages, pop-up windows and confirmations
    4. Calculations (stock estimate, water-quality limits)
    5. Form validation
    6. Module definitions (which fields each form has)
    7. Forms: add, view, edit, delete
    8. Reusable filter + table component (sorting, CSV download)
    9. Water-quality charts
   10. Pages: dashboard, tanks, modules, tank details
   11. Pages: reports and data backup
   12. Navigation and start-up

   All records are stored in this browser only (localStorage).
   ===================================================================== */
'use strict';

/* =====================================================================
   1. SMALL HELPER FUNCTIONS
   ===================================================================== */
const STORAGE_KEY = 'aquafarm.data.v1';   // name of the saved data in the browser
const BACKUP_VERSION = 1;                  // version number written into backup files
const COLLECTIONS = ['tanks', 'stocking', 'medication', 'feed', 'water', 'mortality', 'harvest'];

const $ = (selector, root) => (root || document).querySelector(selector);

/* Make text safe to show inside HTML (stops typed text being treated as code). */
function esc(value) {
  return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function pad2(n) { return String(n).padStart(2, '0'); }

/* Today's date on this device as YYYY-MM-DD. */
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function currentTimeStr() {
  const d = new Date();
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
function addDays(dateStr, days) {
  const p = dateStr.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2] + days);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const p = s.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2];
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

/* Round to avoid tiny decimal errors such as 0.1 + 0.2 = 0.30000000000000004. */
function round(n, digits) {
  const f = Math.pow(10, digits === undefined ? 3 : digits);
  return Math.round((n + Number.EPSILON) * f) / f;
}
/* Format a number for display (thousands separators, limited decimals). */
function fmt(n, digits) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '–';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: digits === undefined ? 2 : digits });
}
function sumOf(list, fn) {
  return round(list.reduce(function (t, x) { return t + (Number(fn(x)) || 0); }, 0));
}
/* Unique, sorted values of one field (used for dropdown filters and suggestions). */
function distinct(list, key) {
  const set = new Set();
  list.forEach(function (r) { if (r[key] !== undefined && r[key] !== null && r[key] !== '') set.add(r[key]); });
  return Array.from(set).sort(function (a, b) { return String(a).localeCompare(String(b)); });
}
/* Group records and add up values. Returns one row per key. */
function sumBy(list, keyFn, valueFns) {
  const map = new Map();
  list.forEach(function (r) {
    const k = keyFn(r);
    let g = map.get(k);
    if (!g) {
      g = { key: k, entries: 0 };
      Object.keys(valueFns).forEach(function (n) { g[n] = 0; });
      map.set(k, g);
    }
    g.entries += 1;
    Object.keys(valueFns).forEach(function (n) { g[n] += Number(valueFns[n](r)) || 0; });
  });
  return Array.from(map.values()).map(function (g) {
    Object.keys(valueFns).forEach(function (n) { g[n] = round(g[n]); });
    return g;
  }).sort(function (a, b) { return String(a.key).localeCompare(String(b.key), undefined, { numeric: true }); });
}

/* =====================================================================
   2. SAVING AND LOADING DATA (localStorage)
   ===================================================================== */
function emptyDB() {
  return {
    tanks: [], stocking: [], medication: [], feed: [], water: [], mortality: [], harvest: [],
    settings: { limits: { Shrimp: {}, Fish: {} } },   // water-quality warning limits (farm settings)
    meta: { lastBackup: null }
  };
}

/* Make sure loaded data always has the right shape. */
function normalizeDB(raw) {
  const db = emptyDB();
  if (raw && typeof raw === 'object') {
    COLLECTIONS.forEach(function (k) { if (Array.isArray(raw[k])) db[k] = raw[k]; });
    if (raw.settings && raw.settings.limits) {
      db.settings.limits.Shrimp = raw.settings.limits.Shrimp || {};
      db.settings.limits.Fish = raw.settings.limits.Fish || {};
    }
    if (raw.meta && raw.meta.lastBackup) db.meta.lastBackup = raw.meta.lastBackup;
  }
  return db;
}

let storageWorks = true;       // false if the browser blocks saving (e.g. Private Browsing)
let loadProblem = '';          // message shown if saved data could not be read

function loadDB() {
  try {
    localStorage.setItem('aquafarm.test', '1');
    localStorage.removeItem('aquafarm.test');
  } catch (e) {
    storageWorks = false;
    return emptyDB();
  }
  const text = localStorage.getItem(STORAGE_KEY);
  if (!text) return emptyDB();
  try {
    return normalizeDB(JSON.parse(text));
  } catch (e) {
    // Keep a copy of the unreadable data instead of overwriting it.
    try { localStorage.setItem(STORAGE_KEY + '.unreadable', text); } catch (e2) { /* ignore */ }
    loadProblem = 'Your saved data could not be read, so the app started empty. A copy of the unreadable data was kept in this browser.';
    return emptyDB();
  }
}

let DB = loadDB();

/* Save everything. Returns true if it worked. */
function saveDB() {
  if (!storageWorks) {
    if (SYNC.db) { schedulePush(); return true; }
    toast('This browser is not allowing saving, so changes will be lost when you close the page. Download a backup.', 'error');
    return false;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
    schedulePush();
    return true;
  } catch (e) {
    toast('Could not save. Browser storage may be full or blocked. Download a backup now.', 'error');
    return false;
  }
}

/* =====================================================================
   3. MESSAGES, POP-UP WINDOWS AND CONFIRMATIONS
   ===================================================================== */
function toast(message, type, ms) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast toast-' + (type || 'ok');
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = message;
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(function () { el.remove(); }, ms || (type === 'error' || type === 'warn' ? 8000 : 4000));
}

let modalState = null;

/* Open a pop-up window. Only one can be open at a time. */
function openModal(options) {
  closeModal();
  const root = document.getElementById('modal-root');
  root.innerHTML =
    '<div class="modal-backdrop">' +
    '<div class="modal' + (options.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">' +
    '<div class="modal-head"><h2 id="modal-title">' + esc(options.title) + '</h2>' +
    '<button type="button" class="icon-btn" data-modal-close aria-label="Close window">✕</button></div>' +
    '<div class="modal-body">' + options.html + '</div></div></div>';
  modalState = { previous: document.activeElement, onClose: null };
  document.body.classList.add('modal-open');
  const first = root.querySelector('.modal-body input:not([disabled]):not([type=hidden]), .modal-body select:not([disabled]), .modal-body textarea');
  const target = options.focus ? root.querySelector(options.focus) : first;
  (target || root.querySelector('.modal')).focus();
  return root;
}

function closeModal() {
  if (!modalState) return;
  const st = modalState;
  modalState = null;
  document.getElementById('modal-root').innerHTML = '';
  document.body.classList.remove('modal-open');
  if (st.onClose) st.onClose();
  if (st.previous && document.contains(st.previous) && st.previous.focus) st.previous.focus({ preventScroll: true });
}

/* Ask "Are you sure?". Returns a Promise that gives true (yes) or false (no).
   If requireText is given, the person must type that word to continue. */
function confirmDialog(options) {
  return new Promise(function (resolve) {
    let done = false;
    function finish(answer) {
      if (done) return;
      done = true;
      closeModal();
      resolve(answer);
    }
    const root = openModal({
      title: options.title,
      focus: '[data-no]',
      html:
        '<p class="confirm-text">' + esc(options.message).replace(/\n/g, '<br>') + '</p>' +
        (options.requireText
          ? '<label class="field"><span>Type <strong>' + esc(options.requireText) + '</strong> to continue</span>' +
            '<input type="text" id="confirm-input" autocomplete="off" autocapitalize="characters"></label>'
          : '') +
        '<div class="form-actions">' +
        '<button type="button" class="btn" data-no>Cancel</button>' +
        '<button type="button" class="btn ' + (options.danger ? 'btn-danger' : 'btn-primary') + '" data-yes' +
        (options.requireText ? ' disabled' : '') + '>' + esc(options.confirmText || 'Confirm') + '</button>' +
        '</div>'
    });
    modalState.onClose = function () { finish(false); };
    const yes = $('[data-yes]', root);
    $('[data-no]', root).addEventListener('click', function () { finish(false); });
    yes.addEventListener('click', function () { finish(true); });
    if (options.requireText) {
      $('#confirm-input', root).addEventListener('input', function (e) {
        yes.disabled = e.target.value.trim().toUpperCase() !== options.requireText.toUpperCase();
      });
    }
  });
}

/* Keyboard: Escape closes pop-ups/menu, Tab stays inside a pop-up. */
document.addEventListener('keydown', function (e) {
  if (!modalState) {
    if (e.key === 'Escape') closeNav();
    return;
  }
  if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
  if (e.key === 'Tab') {
    const modal = $('.modal');
    if (!modal) return;
    const items = Array.from(modal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled])'));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

/* Download a text file (used for CSV reports and JSON backups).
   When the page is published on claude.ai, the viewer is asked to confirm the save.
   Otherwise (a normal website or online editor) the browser downloads it directly. */
function browserDownload(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
}
function downloadFile(filename, text, mime) {
  if (window.claude && typeof window.claude.use === 'function') {
    window.claude.use('downloads').then(function (dl) {
      if (!dl) { browserDownload(filename, text, mime); return; }
      return dl.save({ filename: filename, data: text }).catch(function (err) {
        if (err && err.code === 'declined') return;
        toast('The file could not be saved here. On the Data Backup page, use “Show backup as text” and copy it.', 'error');
      });
    }).catch(function () { browserDownload(filename, text, mime); });
    return;
  }
  browserDownload(filename, text, mime);
}

/* =====================================================================
   4. CALCULATIONS
   ===================================================================== */
function getTank(tankId) { return DB.tanks.find(function (t) { return t.tankId === tankId; }); }
function tankLabel(tankId) {
  const t = getTank(tankId);
  return t ? t.tankId + ' – ' + t.name : tankId + ' (tank not found)';
}
function sortedTanks() {
  return DB.tanks.slice().sort(function (a, b) { return a.tankId.localeCompare(b.tankId, undefined, { numeric: true }); });
}

/* ESTIMATED current stock for one tank:
     total stocked  -  recorded deaths  -  harvested ANIMAL COUNT
   Harvests recorded only by weight (no animal count) are NOT subtracted.
   This is an estimate from your records, not a verified live count.
   asOf (optional, YYYY-MM-DD) ignores records after that date. */
function stockFor(tankId, asOf) {
  function inRange(r) { return !asOf || r.date <= asOf; }
  const stocked = sumOf(DB.stocking.filter(function (r) { return r.tankId === tankId && inRange(r); }), function (r) { return r.quantity; });
  const dead = sumOf(DB.mortality.filter(function (r) { return r.tankId === tankId && inRange(r); }), function (r) { return r.dead; });
  const harvests = DB.harvest.filter(function (r) { return r.tankId === tankId && inRange(r); });
  const harvested = sumOf(harvests.filter(function (r) { return r.count > 0; }), function (r) { return r.count; });
  const weightOnly = harvests.filter(function (r) { return !(r.count > 0); }).length;
  return { stocked: stocked, dead: dead, harvested: harvested, weightOnly: weightOnly, estimated: stocked - dead - harvested };
}

/* Warning text if a tank's estimated stock has gone below zero. */
function stockWarning(tankId) {
  if (!getTank(tankId)) return '';
  if (stockFor(tankId).estimated < 0) {
    return ' Warning: the estimated stock for ' + tankId + ' is now below zero. Please check the stocking, mortality and harvest records.';
  }
  return '';
}

/* Water-quality parameters. Units are shown on forms and tables. */
const WATER_PARAMS = [
  { key: 'ph', label: 'pH', title: 'pH', unit: '', short: 'pH' },
  { key: 'temp', label: 'Temperature', title: 'Temperature (°C)', unit: '°C', short: 'Temperature (°C)' },
  { key: 'dox', label: 'Dissolved oxygen', title: 'Dissolved oxygen (mg/L)', unit: 'mg/L', short: 'Dissolved oxygen (mg/L)' },
  { key: 'salinity', label: 'Salinity', title: 'Salinity (ppt)', unit: 'ppt', short: 'Salinity (ppt)' },
  { key: 'ammonia', label: 'Ammonia', title: 'Ammonia (mg/L)', unit: 'mg/L', short: 'Ammonia (mg/L)' }
];

/* Farm-defined warning limits for a species (empty until the farm sets them). */
function limitsFor(species) { return (DB.settings.limits && DB.settings.limits[species]) || {}; }

/* Returns {dir:'low'|'high', limit} if a value is outside the farm's limits, otherwise null. */
function flagFor(species, key, value) {
  if (value === null || value === undefined || value === '') return null;
  const L = limitsFor(species)[key];
  if (!L) return null;
  if (typeof L.min === 'number' && value < L.min) return { dir: 'low', limit: L.min };
  if (typeof L.max === 'number' && value > L.max) return { dir: 'high', limit: L.max };
  return null;
}

/* Show a reading; adds a coloured marker and text if it is outside the farm limits. */
function flagHtml(species, key, value) {
  if (value === null || value === undefined || value === '') return '<span class="muted">–</span>';
  const f = flagFor(species, key, value);
  const text = esc(fmt(value, 3));
  if (!f) return text;
  return '<span class="flag flag-' + f.dir + '" title="' + (f.dir === 'high' ? 'Above' : 'Below') + ' your farm limit of ' + esc(f.limit) + '">' +
    (f.dir === 'high' ? '▲ ' : '▼ ') + text + '</span>';
}

/* Latest water reading for each tank. */
function latestByTank(readings) {
  const map = new Map();
  readings.forEach(function (r) {
    const cur = map.get(r.tankId);
    if (!cur || r.dateTime > cur.dateTime) map.set(r.tankId, r);
  });
  return Array.from(map.values()).sort(function (a, b) { return a.tankId.localeCompare(b.tankId, undefined, { numeric: true }); });
}

/* =====================================================================
   5. FORM VALIDATION
   One function checks every form (and also checks imported backups).
   ===================================================================== */
function validateForm(fields, raw, ctx) {
  ctx = ctx || {};
  const tanks = ctx.tanks || DB.tanks;
  const errors = {};
  const clean = {};

  fields.forEach(function (f) {
    let v = raw[f.name];
    if (typeof v === 'string') v = v.trim();
    const label = f.short || f.label;
    const empty = v === undefined || v === null || v === '';

    if (empty) {
      if (f.required) errors[f.name] = label + ' is required.';
      clean[f.name] = f.type === 'number' ? null : '';
      return;
    }

    switch (f.type) {
      case 'number': {
        const n = Number(v);
        if (!Number.isFinite(n)) errors[f.name] = 'Enter a valid number.';
        else if (f.integer && !Number.isInteger(n)) errors[f.name] = 'Enter a whole number (no decimals).';
        else if (n < 0) errors[f.name] = 'Cannot be negative.';
        else if (f.positive && n <= 0) errors[f.name] = 'Must be greater than 0.';
        else if (f.max !== undefined && n > f.max) errors[f.name] = 'Must be ' + f.max + ' or less.';
        else clean[f.name] = n;
        break;
      }
      case 'date':
        if (!isValidDate(v)) errors[f.name] = 'Enter a valid date.';
        else if (f.noFuture && !ctx.ignoreFuture && v > todayStr()) errors[f.name] = 'The date cannot be in the future.';
        else clean[f.name] = v;
        break;
      case 'datetime-local': {
        const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(String(v));
        if (!m || !isValidDate(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59) errors[f.name] = 'Enter a valid date and time.';
        else if (f.noFuture && !ctx.ignoreFuture && m[1] > todayStr()) errors[f.name] = 'The date cannot be in the future.';
        else clean[f.name] = m[1] + 'T' + m[2] + ':' + m[3];
        break;
      }
      case 'time': {
        const m = /^(\d{2}):(\d{2})/.exec(String(v));
        if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) errors[f.name] = 'Enter a valid time.';
        else clean[f.name] = m[1] + ':' + m[2];
        break;
      }
      case 'tank':
        if (!tanks.some(function (t) { return t.tankId === v; })) errors[f.name] = 'Choose a tank from the list.';
        else clean[f.name] = v;
        break;
      case 'select':
        if (f.options.indexOf(v) === -1) errors[f.name] = 'Choose one of the options.';
        else clean[f.name] = v;
        break;
      default: { // text and textarea
        const max = f.maxLen || (f.type === 'textarea' ? 1000 : 200);
        const s = String(v);
        if (s.length > max) errors[f.name] = 'Keep this under ' + max + ' characters.';
        else if (f.pattern && !f.pattern.test(s)) errors[f.name] = f.patternMsg || 'This format is not valid.';
        else if (f.unique && tanks.some(function (t) { return t !== ctx.editing && String(t[f.name]).toLowerCase() === s.toLowerCase(); })) {
          errors[f.name] = 'That ' + label + ' is already used. Choose a different one.';
        } else clean[f.name] = s;
      }
    }
  });

  if (ctx.mod && ctx.mod.validate) ctx.mod.validate(clean, errors, ctx);
  return { errors: errors, clean: clean, ok: Object.keys(errors).length === 0 };
}

/* =====================================================================
   6. MODULE DEFINITIONS
   Each module lists its form fields once. The forms, tables, checks and
   CSV files are all built from these lists, so they always match.

   Field options:  required, type, positive (must be > 0), integer,
   max, noFuture (no future dates), suggest (offer past entries),
   short (shorter name used in tables), hint (help text under the field).
   ===================================================================== */
const REASONS = ['Disease', 'Low oxygen', 'Water quality', 'Handling or stress', 'Predation', 'Unknown', 'Other'];
const MED_UNITS = ['kg', 'g', 'liter', 'ml'];

const MODS = {

  /* ---------- Tank Master ---------- */
  tanks: {
    key: 'tanks', store: 'tanks', icon: '🛢️', title: 'Tank Master', single: 'tank',
    lead: 'Create and manage your tanks. Every other record is linked to a Tank ID.',
    fields: [
      { name: 'tankId', label: 'Tank ID', type: 'text', required: true, unique: true, lockOnEdit: true, maxLen: 20,
        pattern: /^[A-Za-z0-9_-]+$/, patternMsg: 'Use letters, numbers, - or _ only (no spaces).',
        hint: 'Must be unique, for example T01. It cannot be changed after saving.' },
      { name: 'name', label: 'Tank name', type: 'text', required: true },
      { name: 'capacity', label: 'Capacity', type: 'number', positive: true, required: true },
      { name: 'capacityUnit', label: 'Capacity unit', type: 'select', options: ['m³', 'liters'], required: true, default: function () { return 'm³'; } },
      { name: 'location', label: 'Location', type: 'text' },
      { name: 'species', label: 'Species', type: 'select', options: ['Shrimp', 'Fish'], required: true },
      { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], required: true, default: function () { return 'Active'; } }
    ]
  },

  /* ---------- Seed Stocking ---------- */
  stocking: {
    key: 'stocking', store: 'stocking', needsTank: true, icon: '🌱', title: 'Seed Stocking', single: 'stocking record',
    route: 'stocking', sortKey: 'date',
    lead: 'Record each time seed (post-larvae, fry or fingerlings) is stocked into a tank.',
    emptyMsg: 'No stocking records yet. Choose “Add stocking record” to enter the first one.',
    selects: [{ name: 'seedType', label: 'Seed type' }],
    fields: [
      { name: 'date', label: 'Date', type: 'date', required: true, noFuture: true, default: todayStr },
      { name: 'tankId', label: 'Tank', type: 'tank', required: true },
      { name: 'seedType', label: 'Seed type', type: 'text', required: true, suggest: true, hint: 'For example: Vannamei PL12, Tilapia fry.' },
      { name: 'quantity', label: 'Quantity stocked (number of animals)', short: 'Quantity (animals)', type: 'number', integer: true, positive: true, required: true },
      { name: 'supplier', label: 'Supplier', type: 'text', suggest: true },
      { name: 'avgSize', label: 'Average size', type: 'text', hint: 'Include the unit, for example 2 g or 3 cm.' },
      { name: 'remarks', label: 'Remarks', type: 'textarea' }
    ],
    summary: function (rows) {
      const by = sumBy(rows, function (r) { return r.tankId; }, { total: function (r) { return r.quantity; } });
      return '<div class="summary-grid">' + miniTable('Total seed stocked by tank', ['Tank', 'Entries', 'Seed stocked'],
        by.map(function (g) { return [esc(tankLabel(g.key)), fmt(g.entries, 0), fmt(g.total, 0)]; })) + '</div>';
    },
    footer: function (rows) {
      return '<strong>Total seed stocked:</strong> ' + fmt(sumOf(rows, function (r) { return r.quantity; }), 0) + ' animals from ' + fmt(rows.length, 0) + ' record(s)';
    }
  },

  /* ---------- Medication / Chemicals ---------- */
  medication: {
    key: 'medication', store: 'medication', needsTank: true, icon: '💊', title: 'Medication / Chemicals', single: 'medication record',
    route: 'medication', sortKey: 'date',
    lead: 'Keep a history of every medication or chemical applied to each tank.',
    emptyMsg: 'No medication or chemical records yet. Choose “Add medication record” to enter the first one.',
    selects: [{ name: 'medName', label: 'Medication' }],
    fields: [
      { name: 'date', label: 'Date', type: 'date', required: true, noFuture: true, default: todayStr },
      { name: 'tankId', label: 'Tank', type: 'tank', required: true },
      { name: 'medName', label: 'Medication or chemical name', short: 'Medication', type: 'text', required: true, suggest: true },
      { name: 'quantity', label: 'Quantity used', type: 'number', positive: true, required: true },
      { name: 'unit', label: 'Unit', type: 'select', options: MED_UNITS, required: true },
      { name: 'purpose', label: 'Purpose', type: 'text', suggest: true },
      { name: 'appliedBy', label: 'Applied by', type: 'text', suggest: true },
      { name: 'remarks', label: 'Remarks', type: 'textarea' }
    ],
    summary: function (rows) {
      const by = sumBy(rows, function (r) { return r.medName + '||' + r.unit; }, { total: function (r) { return r.quantity; } });
      return '<div class="summary-grid">' + miniTable('Total used by medication and unit (units are never mixed)', ['Medication', 'Unit', 'Uses', 'Total'],
        by.map(function (g) { const p = g.key.split('||'); return [esc(p[0]), esc(p[1]), fmt(g.entries, 0), fmt(g.total, 3)]; }), { left: 2 }) + '</div>';
    },
    footer: function (rows) { return fmt(rows.length, 0) + ' record(s) shown. Totals by unit are in the summary above.'; }
  },

  /* ---------- Feed ---------- */
  feed: {
    key: 'feed', store: 'feed', needsTank: true, icon: '🍽️', title: 'Feed Management', single: 'feed entry',
    route: 'feed', sortKey: 'date',
    lead: 'Record feed given to each tank. All feed quantities are in kilograms (kg).',
    emptyMsg: 'No feed entries yet. Choose “Add feed entry” to enter the first one.',
    selects: [{ name: 'feedType', label: 'Feed type' }],
    fields: [
      { name: 'date', label: 'Date', type: 'date', required: true, noFuture: true, default: todayStr },
      { name: 'tankId', label: 'Tank', type: 'tank', required: true },
      { name: 'feedType', label: 'Feed type', type: 'text', required: true, suggest: true },
      { name: 'quantity', label: 'Quantity given (kg)', short: 'Quantity (kg)', type: 'number', positive: true, required: true },
      { name: 'feedTime', label: 'Feeding time', type: 'time', required: true, default: currentTimeStr }
    ],
    summary: function (rows) {
      const val = { total: function (r) { return r.quantity; } };
      return '<div class="summary-grid">' +
        miniTable('Total feed by tank (kg)', ['Tank', 'Entries', 'Total (kg)'],
          sumBy(rows, function (r) { return r.tankId; }, val).map(function (g) { return [esc(tankLabel(g.key)), fmt(g.entries, 0), fmt(g.total, 3)]; })) +
        miniTable('Daily feed (kg)', ['Date', 'Entries', 'Total (kg)'],
          sumBy(rows, function (r) { return r.date; }, val).reverse().map(function (g) { return [esc(g.key), fmt(g.entries, 0), fmt(g.total, 3)]; }), { scroll: true }) +
        miniTable('Monthly feed (kg)', ['Month', 'Entries', 'Total (kg)'],
          sumBy(rows, function (r) { return r.date.slice(0, 7); }, val).reverse().map(function (g) { return [esc(g.key), fmt(g.entries, 0), fmt(g.total, 3)]; }), { scroll: true }) +
        '</div>';
    },
    footer: function (rows) { return '<strong>Total feed:</strong> ' + fmt(sumOf(rows, function (r) { return r.quantity; }), 3) + ' kg from ' + fmt(rows.length, 0) + ' entr' + (rows.length === 1 ? 'y' : 'ies'); }
  },

  /* ---------- Water Quality ---------- */
  water: {
    key: 'water', store: 'water', needsTank: true, icon: '💧', title: 'Water Quality', single: 'water reading',
    route: 'water', sortKey: 'dateTime', dateOf: function (r) { return r.dateTime.slice(0, 10); },
    lead: 'Record water measurements and watch the trends. Units are shown on each field.',
    intro: 'Warning limits are farm settings that you choose yourself. They only highlight readings in this app and are not veterinary advice.',
    emptyMsg: 'No water readings yet. Choose “Add water reading” to enter the first one.',
    fields: [
      { name: 'dateTime', label: 'Date and time', type: 'datetime-local', required: true, noFuture: true, default: function () { return todayStr() + 'T' + currentTimeStr(); } },
      { name: 'tankId', label: 'Tank', type: 'tank', required: true },
      { name: 'ph', label: 'pH', type: 'number', max: 14 },
      { name: 'temp', label: 'Temperature (°C)', type: 'number', max: 60 },
      { name: 'dox', label: 'Dissolved oxygen (mg/L)', short: 'Dissolved oxygen (mg/L)', type: 'number', max: 30 },
      { name: 'salinity', label: 'Salinity (ppt)', type: 'number', max: 100 },
      { name: 'ammonia', label: 'Ammonia (mg/L)', type: 'number', max: 100 }
    ],
    extraCols: [{ key: 'flags', label: 'Outside farm limits', csvOnly: true }],
    validate: function (clean, errors) {
      const any = WATER_PARAMS.some(function (p) { return clean[p.key] !== null && clean[p.key] !== undefined && clean[p.key] !== ''; });
      if (!any && !errors.ph) errors.ph = 'Enter at least one measurement.';
    },
    cell: function (f, r) {
      if (WATER_PARAMS.some(function (p) { return p.key === f.name; })) return flagHtml(r.species, f.name, r[f.name]);
      return defaultCell(f, r);
    },
    top: function (rows, st, fixedTank) {
      // Latest reading per tank (respects the tank choice, but not the date filter)
      const pool = DB.water.filter(function (r) { return (fixedTank ? r.tankId === fixedTank : (!st.tank || r.tankId === st.tank)); });
      return '<section class="card"><h3>Latest reading for each tank</h3>' + latestReadingsTable(pool) + '</section>' +
        '<section class="card"><h3>Trends over time</h3>' + waterChartsHtml(rows) + '</section>';
    },
    footer: function (rows) { return fmt(rows.length, 0) + ' reading(s) shown. ▲ / ▼ marks a value outside your farm limits.'; }
  },

  /* ---------- Mortality ---------- */
  mortality: {
    key: 'mortality', store: 'mortality', needsTank: true, icon: '⚠️', title: 'Mortality', single: 'mortality record',
    route: 'mortality', sortKey: 'date',
    lead: 'Record deaths found in each tank.',
    intro: 'These are recorded deaths only. They are not a live count. Estimated stock (stocked − recorded deaths − harvested animals) appears on the Dashboard and in Report A, and is always labelled as an estimate.',
    emptyMsg: 'No mortality records yet. Choose “Add mortality record” to enter the first one.',
    selects: [{ name: 'reason', label: 'Reason' }],
    fields: [
      { name: 'date', label: 'Date', type: 'date', required: true, noFuture: true, default: todayStr },
      { name: 'tankId', label: 'Tank', type: 'tank', required: true },
      { name: 'dead', label: 'Dead count (number of animals)', short: 'Dead count', type: 'number', integer: true, positive: true, required: true },
      { name: 'reason', label: 'Reason', type: 'select', options: REASONS, required: true },
      { name: 'remarks', label: 'Remarks', type: 'textarea' }
    ],
    summary: function (rows) {
      const val = { total: function (r) { return r.dead; } };
      return '<div class="summary-grid">' +
        miniTable('Recorded deaths by tank', ['Tank', 'Records', 'Recorded deaths'],
          sumBy(rows, function (r) { return r.tankId; }, val).map(function (g) { return [esc(tankLabel(g.key)), fmt(g.entries, 0), fmt(g.total, 0)]; })) +
        miniTable('Recorded deaths per day', ['Date', 'Records', 'Recorded deaths'],
          sumBy(rows, function (r) { return r.date; }, val).reverse().map(function (g) { return [esc(g.key), fmt(g.entries, 0), fmt(g.total, 0)]; }), { scroll: true }) +
        miniTable('Recorded deaths per month', ['Month', 'Records', 'Recorded deaths'],
          sumBy(rows, function (r) { return r.date.slice(0, 7); }, val).reverse().map(function (g) { return [esc(g.key), fmt(g.entries, 0), fmt(g.total, 0)]; }), { scroll: true }) +
        '</div>';
    },
    footer: function (rows) { return '<strong>Total recorded deaths:</strong> ' + fmt(sumOf(rows, function (r) { return r.dead; }), 0) + ' from ' + fmt(rows.length, 0) + ' record(s)'; }
  },

  /* ---------- Harvest ---------- */
  harvest: {
    key: 'harvest', store: 'harvest', needsTank: true, icon: '🎣', title: 'Harvest', single: 'harvest record',
    route: 'harvest', sortKey: 'date',
    lead: 'Record each harvest. Units: quantity = number of animals, average weight = grams per animal, total production = kilograms.',
    intro: 'Enter at least the number of animals or the total production. If you leave one of the three values blank, it is calculated from the other two (production kg = animals × average weight in g ÷ 1000).',
    emptyMsg: 'No harvest records yet. Choose “Add harvest record” to enter the first one.',
    fields: [
      { name: 'date', label: 'Date', type: 'date', required: true, default: todayStr },
      { name: 'tankId', label: 'Tank', type: 'tank', required: true },
      { name: 'count', label: 'Harvest quantity (number of animals)', short: 'Quantity (animals)', type: 'number', integer: true, positive: true,
        hint: 'Only harvests with an animal count reduce the estimated stock.' },
      { name: 'avgWeight', label: 'Average weight (grams per animal)', short: 'Avg weight (g)', type: 'number', positive: true },
      { name: 'production', label: 'Total production (kg)', short: 'Production (kg)', type: 'number', positive: true }
    ],
    extraCols: [{ key: 'calculated', label: 'Calculated field', csvOnly: true }],
    validate: function (clean, errors) {
      if (!errors.count && !errors.production && clean.count === null && clean.production === null) {
        errors.count = 'Enter the number of animals or the total production (kg).';
      }
    },
    /* Fill in a missing value from the other two */
    prepare: function (c) {
      c.calculated = '';
      if (c.production === null && c.count > 0 && c.avgWeight > 0) {
        c.production = round(c.count * c.avgWeight / 1000, 3);
        c.calculated = 'production';
      } else if (c.avgWeight === null && c.count > 0 && c.production > 0) {
        c.avgWeight = round(c.production * 1000 / c.count, 2);
        c.calculated = 'avgWeight';
      }
    },
    cell: function (f, r) {
      const base = defaultCell(f, r);
      return r.calculated === f.name ? base + ' <span class="badge badge-muted" title="Calculated automatically from the other two values">auto</span>' : base;
    },
    summary: function (rows) {
      const val = { count: function (r) { return r.count || 0; }, prod: function (r) { return r.production || 0; } };
      return '<div class="summary-grid">' +
        miniTable('Production by tank', ['Tank', 'Records', 'Animals (counted)', 'Production (kg)'],
          sumBy(rows, function (r) { return r.tankId; }, val).map(function (g) { return [esc(tankLabel(g.key)), fmt(g.entries, 0), fmt(g.count, 0), fmt(g.prod, 3)]; })) +
        miniTable('Daily harvest', ['Date', 'Records', 'Animals (counted)', 'Production (kg)'],
          sumBy(rows, function (r) { return r.date; }, val).reverse().map(function (g) { return [esc(g.key), fmt(g.entries, 0), fmt(g.count, 0), fmt(g.prod, 3)]; }), { scroll: true }) +
        miniTable('Monthly harvest', ['Month', 'Records', 'Animals (counted)', 'Production (kg)'],
          sumBy(rows, function (r) { return r.date.slice(0, 7); }, val).reverse().map(function (g) { return [esc(g.key), fmt(g.entries, 0), fmt(g.count, 0), fmt(g.prod, 3)]; }), { scroll: true }) +
        '</div>';
    },
    footer: function (rows) {
      return '<strong>Overall:</strong> ' + fmt(sumOf(rows, function (r) { return r.count; }), 0) + ' animals (from records that have a count) · ' +
        fmt(sumOf(rows, function (r) { return r.production; }), 3) + ' kg production · ' + fmt(rows.length, 0) + ' record(s)';
    }
  }
};

/* Small summary table used inside module pages. */
function miniTable(title, headers, rows, opts) {
  opts = opts || {};
  if (!rows.length) return '';
  const left = opts.left || 1;
  let h = '<section class="card mini"><h3>' + esc(title) + '</h3><div class="table-wrap' + (opts.scroll ? ' scroll-y' : '') + '"><table><thead><tr>';
  headers.forEach(function (t, i) { h += '<th scope="col"' + (i >= left ? ' class="num"' : '') + '>' + esc(t) + '</th>'; });
  h += '</tr></thead><tbody>';
  rows.forEach(function (r) {
    h += '<tr>';
    r.forEach(function (c, i) { h += '<td' + (i >= left ? ' class="num"' : '') + '>' + c + '</td>'; });
    h += '</tr>';
  });
  return h + '</tbody></table></div></section>';
}

/* =====================================================================
   7. FORMS: ADD, VIEW, EDIT, DELETE
   ===================================================================== */
function findRec(modKey, id) { return DB[MODS[modKey].store].find(function (r) { return r.id === id; }); }

/* Build the HTML for one form field. */
function fieldHtml(f, value, editing) {
  const id = 'f-' + f.name;
  const req = f.required ? ' <span class="req" aria-hidden="true">*</span>' : '';
  const describedBy = 'e-' + f.name + (f.hint ? ' h-' + f.name : '');
  const common = 'id="' + id + '" name="' + f.name + '"' + (f.required ? ' required aria-required="true"' : '') + ' aria-describedby="' + describedBy + '"';
  const v = value === null || value === undefined ? '' : value;
  let control = '';

  if (f.type === 'select' || f.type === 'tank') {
    let options = '<option value="">Choose…</option>';
    if (f.type === 'tank') {
      options += sortedTanks().map(function (t) {
        return '<option value="' + esc(t.tankId) + '"' + (t.tankId === v ? ' selected' : '') + '>' + esc(t.tankId + ' – ' + t.name + (t.status === 'Inactive' ? ' (inactive)' : '')) + '</option>';
      }).join('');
    } else {
      options += f.options.map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('');
    }
    control = '<select ' + common + '>' + options + '</select>';
  } else if (f.type === 'textarea') {
    control = '<textarea ' + common + ' rows="3">' + esc(v) + '</textarea>';
  } else if (f.type === 'number') {
    control = '<input type="number" ' + common + ' value="' + esc(v) + '" min="0" step="' + (f.integer ? '1' : 'any') + '" inputmode="' + (f.integer ? 'numeric' : 'decimal') + '"' + (f.max !== undefined ? ' max="' + f.max + '"' : '') + '>';
  } else {
    const locked = editing && f.lockOnEdit;
    control = '<input type="' + (f.type || 'text') + '" ' + common + ' value="' + esc(v) + '"' + (locked ? ' disabled' : '') +
      (f.suggest ? ' list="dl-' + f.name + '"' : '') + ' autocomplete="off">';
    if (f.suggest) {
      const mod = Object.keys(MODS).map(function (k) { return MODS[k]; }).find(function (m) { return m.fields.indexOf(f) !== -1; });
      const list = mod ? distinct(DB[mod.store], f.name) : [];
      control += '<datalist id="dl-' + f.name + '">' + list.map(function (o) { return '<option value="' + esc(o) + '"></option>'; }).join('') + '</datalist>';
    }
  }
  return '<div class="field' + (f.type === 'textarea' ? ' full' : '') + '"><label for="' + id + '">' + esc(f.label) + req + '</label>' + control +
    (f.hint ? '<p class="hint" id="h-' + f.name + '">' + esc(f.hint) + '</p>' : '') +
    '<p class="field-error" id="e-' + f.name + '" role="alert"></p></div>';
}

/* Open the add/edit form in a pop-up. preset = starting values (for example a tank). */
function openRecordForm(modKey, recId, preset) {
  const mod = MODS[modKey];
  const rec = recId ? findRec(modKey, recId) : null;
  if (recId && !rec) { toast('That record could not be found.', 'error'); return; }
  if (mod.needsTank && DB.tanks.length === 0) {
    toast('Add a tank first. Every record must belong to a tank.', 'warn');
    location.hash = '#/tanks';
    return;
  }
  const values = {};
  mod.fields.forEach(function (f) {
    if (rec) values[f.name] = rec[f.name];
    else if (preset && preset[f.name] !== undefined) values[f.name] = preset[f.name];
    else values[f.name] = f.default ? f.default() : '';
  });
  // A value that was calculated automatically is left blank so it is recalculated.
  if (rec && rec.calculated) values[rec.calculated] = '';

  const title = (rec ? 'Edit ' : 'Add ') + mod.single;
  const root = openModal({
    title: title,
    html: '<form id="record-form" novalidate><div class="form-grid">' +
      mod.fields.map(function (f) { return fieldHtml(f, values[f.name], !!rec); }).join('') +
      '</div><p class="muted small"><span class="req">*</span> required</p>' +
      '<div class="form-actions"><button type="button" class="btn" data-modal-close>Cancel</button>' +
      '<button type="submit" class="btn btn-primary">' + (rec ? 'Save changes' : 'Save ' + esc(mod.single)) + '</button></div></form>'
  });

  const form = $('#record-form', root);
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    const raw = {};
    mod.fields.forEach(function (f) {
      const el = form.elements[f.name];
      raw[f.name] = (rec && f.lockOnEdit) ? rec[f.name] : (el ? el.value : '');
    });
    const result = validateForm(mod.fields, raw, { mod: mod, editing: rec });
    mod.fields.forEach(function (f) {
      const msg = result.errors[f.name] || '';
      $('#e-' + f.name, form).textContent = msg;
      const input = form.elements[f.name];
      if (input) { if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
    });
    if (!result.ok) {
      const firstBad = mod.fields.find(function (f) { return result.errors[f.name]; });
      if (firstBad && form.elements[firstBad.name]) form.elements[firstBad.name].focus();
      toast('Please fix the highlighted fields.', 'error');
      return;
    }
    const data = result.clean;
    if (mod.prepare) mod.prepare(data);
    if (rec) {
      Object.assign(rec, data, { updated: new Date().toISOString() });
    } else {
      DB[mod.store].push(Object.assign({ id: uid(), created: new Date().toISOString() }, data));
    }
    const saved = saveDB();
    closeModal();
    const warning = (modKey === 'stocking' || modKey === 'mortality' || modKey === 'harvest') ? stockWarning(data.tankId) : '';
    if (saved) toast((rec ? 'Changes saved.' : 'Saved: new ' + mod.single + '.') + warning, warning ? 'warn' : 'ok');
    render({ keep: true });
  });
  return root;
}

/* Read-only pop-up showing all details of one record. */
function viewRecord(modKey, id) {
  const mod = MODS[modKey];
  const rec = findRec(modKey, id);
  if (!rec) { toast('That record could not be found.', 'error'); return; }
  const row = decorate(modKey, rec);
  let html = '<dl class="detail-list">';
  mod.fields.forEach(function (f) {
    let val;
    if (f.type === 'tank') val = tankLabel(rec.tankId);
    else if (f.type === 'number') val = rec[f.name] === null || rec[f.name] === '' ? '–' : fmt(rec[f.name], 3);
    else if (f.type === 'datetime-local') val = String(rec[f.name]).replace('T', ' ');
    else val = rec[f.name] === '' || rec[f.name] === undefined ? '–' : rec[f.name];
    html += '<dt>' + esc(f.label) + '</dt><dd>' + esc(val) + (rec.calculated === f.name ? ' (calculated automatically)' : '') + '</dd>';
  });
  if (row.flags) html += '<dt>Outside farm limits</dt><dd>' + esc(row.flags) + '</dd>';
  html += '</dl><div class="form-actions"><button type="button" class="btn" data-modal-close>Close</button>' +
    '<button type="button" class="btn btn-primary" id="view-edit">Edit</button></div>';
  const root = openModal({ title: 'View ' + mod.single, html: html });
  $('#view-edit', root).addEventListener('click', function () { openRecordForm(modKey, id); });
}

async function deleteRecord(modKey, id) {
  const mod = MODS[modKey];
  const rec = findRec(modKey, id);
  if (!rec) return;
  const ok = await confirmDialog({
    title: 'Delete this ' + mod.single + '?',
    message: 'This will permanently remove this ' + mod.single + ' for ' + tankLabel(rec.tankId) + '. This cannot be undone.',
    confirmText: 'Delete', danger: true
  });
  if (!ok) return;
  DB[mod.store] = DB[mod.store].filter(function (r) { return r.id !== id; });
  const saved = saveDB();
  const warning = (modKey === 'stocking' || modKey === 'mortality' || modKey === 'harvest') ? stockWarning(rec.tankId) : '';
  if (saved) toast('Deleted.' + warning, warning ? 'warn' : 'ok');
  render({ keep: true });
}

/* ----- Tank-specific actions ----- */
function toggleTank(id) {
  const t = DB.tanks.find(function (x) { return x.id === id; });
  if (!t) return;
  t.status = t.status === 'Active' ? 'Inactive' : 'Active';
  if (saveDB()) toast(t.tankId + ' is now ' + t.status.toLowerCase() + '.');
  render({ keep: true });
}

async function deleteTank(id) {
  const t = DB.tanks.find(function (x) { return x.id === id; });
  if (!t) return;
  const used = COLLECTIONS.filter(function (c) { return c !== 'tanks'; }).reduce(function (n, c) {
    return n + DB[c].filter(function (r) { return r.tankId === t.tankId; }).length;
  }, 0);
  if (used > 0) {
    toast(t.tankId + ' has ' + used + ' record(s), so it cannot be deleted. Deactivate it instead, or delete its records first.', 'error');
    return;
  }
  const ok = await confirmDialog({ title: 'Delete tank ' + t.tankId + '?', message: 'This tank has no records. Deleting it cannot be undone.', confirmText: 'Delete tank', danger: true });
  if (!ok) return;
  DB.tanks = DB.tanks.filter(function (x) { return x.id !== id; });
  if (saveDB()) toast('Tank deleted.');
  if (location.hash.indexOf('#/tank/') === 0) location.hash = '#/tanks'; else render({ keep: true });
}

/* =====================================================================
   8. REUSABLE FILTER + TABLE COMPONENT
   Used by every module page and every report.
   ===================================================================== */
const UI = {};   // remembers filter choices while the page stays open

function optList(options) {
  return options.map(function (o) { return typeof o === 'object' ? o : { value: o, label: o }; });
}

/* Add tank name and other helper values to a record for tables. */
function decorate(modKey, r) {
  const row = Object.assign({}, r);
  const t = getTank(r.tankId);
  row.tankLabel = tankLabel(r.tankId);
  row.tankName = t ? t.name : '';
  if (modKey === 'water') {
    const sp = t ? t.species : '';
    row.species = sp;
    row.flags = WATER_PARAMS.filter(function (p) { return flagFor(sp, p.key, r[p.key]); }).map(function (p) {
      return p.label + ' ' + flagFor(sp, p.key, r[p.key]).dir;
    }).join('; ');
  }
  return row;
}

/* Apply search, tank, date-range and dropdown filters to a list of records. */
function filterRecords(records, st, opts) {
  opts = opts || {};
  const dateOf = opts.dateOf || function (r) { return r.date; };
  const q = (st.search || '').trim().toLowerCase();
  return records.filter(function (r) {
    if (st.tank && r.tankId !== st.tank) return false;
    if (st.from || st.to) {
      const d = dateOf(r);
      if (st.from && d < st.from) return false;
      if (st.to && d > st.to) return false;
    }
    const sels = opts.selects || [];
    for (let i = 0; i < sels.length; i++) {
      if (st[sels[i].name] && String(r[sels[i].name]) !== st[sels[i].name]) return false;
    }
    if (q) {
      const parts = [r.tankId ? tankLabel(r.tankId) : ''];
      Object.keys(r).forEach(function (k) { if (k !== 'id' && k !== 'created' && k !== 'updated') parts.push(r[k]); });
      if (parts.join(' ').toLowerCase().indexOf(q) === -1) return false;
    }
    return true;
  });
}

function compareValues(a, b, dir) {
  const an = a === null || a === undefined || a === '';
  const bn = b === null || b === undefined || b === '';
  if (an && bn) return 0;
  if (an) return 1;      // empty values always go last
  if (bn) return -1;
  let r;
  if (typeof a === 'number' && typeof b === 'number') r = a - b;
  else r = String(a).localeCompare(String(b), undefined, { numeric: true });
  return dir === 'asc' ? r : -r;
}

function cellText(v) {
  if (v === null || v === undefined || v === '') return '<span class="muted">–</span>';
  if (typeof v === 'number') return esc(fmt(v, 3));
  return esc(v);
}

function defaultCell(f, r) {
  const v = r[f.name];
  if (v === null || v === undefined || v === '') return '<span class="muted">–</span>';
  if (f.type === 'number') return esc(fmt(v, f.integer ? 0 : 3));
  if (f.type === 'datetime-local') return esc(String(v).replace('T', ' '));
  return esc(v);
}

function tableHtml(columns, rows, sortKey, sortDir) {
  const vis = columns.filter(function (c) { return !c.csvOnly; });
  let h = '<div class="table-wrap"><table><thead><tr>';
  vis.forEach(function (c) {
    const cls = c.align === 'right' ? ' class="num"' : '';
    if (c.noSort) {
      h += '<th scope="col"' + cls + '>' + esc(c.label) + '</th>';
    } else {
      const active = c.key === sortKey;
      h += '<th scope="col"' + cls + ' aria-sort="' + (active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none') + '">' +
        '<button type="button" class="th-sort" data-sort="' + esc(c.key) + '">' + esc(c.label) +
        '<span class="sort-mark" aria-hidden="true">' + (active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '') + '</span></button></th>';
    }
  });
  h += '</tr></thead><tbody>';
  rows.forEach(function (r) {
    h += '<tr>';
    vis.forEach(function (c) {
      h += '<td class="' + (c.align === 'right' ? 'num' : '') + (c.clip ? ' clip' : '') + '">' + (c.render ? c.render(r) : cellText(r[c.key])) + '</td>';
    });
    h += '</tr>';
  });
  return h + '</tbody></table></div>';
}

/* CSV text for the rows currently on screen. */
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = "'" + s;   // stops spreadsheet formulas running
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(columns, rows) {
  const cols = columns.filter(function (c) { return !c.noExport; });
  const lines = [cols.map(function (c) { return csvCell(c.csvLabel || c.label); }).join(',')];
  rows.forEach(function (r) {
    lines.push(cols.map(function (c) { return csvCell(c.csv ? c.csv(r) : r[c.key]); }).join(','));
  });
  return '\ufeff' + lines.join('\r\n');
}

/* Draw filters + results into element el.
   cfg = { stateKey, filters:[...], selects:[...], labels:{}, sortKey, sortDir, exportName, build(state) }
   build(state) returns { columns, rows, top, footer, empty, customHtml, defaultSort, exportName } */
function mountTable(el, cfg) {
  const st = UI[cfg.stateKey] || (UI[cfg.stateKey] = { search: '', tank: '', from: '', to: '', sortKey: null, sortDir: 'asc' });
  (cfg.selects || []).forEach(function (s) { if (!(s.name in st)) st[s.name] = s.def !== undefined ? s.def : ''; });
  const labels = cfg.labels || {};
  el.innerHTML = '<div class="filters" role="search"></div><div class="results" aria-live="polite"></div>';
  const filtersEl = $('.filters', el);
  const resultsEl = $('.results', el);
  let current = { rows: [], columns: [], name: cfg.exportName };
  let sort = { key: null, dir: 'asc' };

  function drawFilters() {
    const f = cfg.filters || [];
    let h = '';
    if (f.indexOf('search') !== -1) {
      h += '<div class="field grow"><label for="flt-search">' + esc(labels.search || 'Search') + '</label>' +
        '<input type="search" id="flt-search" data-filter="search" value="' + esc(st.search) + '" placeholder="Type to search" autocomplete="off"></div>';
    }
    if (f.indexOf('tank') !== -1) {
      h += '<div class="field"><label for="flt-tank">Tank</label><select id="flt-tank" data-filter="tank"><option value="">All tanks</option>' +
        sortedTanks().map(function (t) { return '<option value="' + esc(t.tankId) + '"' + (st.tank === t.tankId ? ' selected' : '') + '>' + esc(t.tankId + ' – ' + t.name) + '</option>'; }).join('') + '</select></div>';
    }
    (cfg.selects || []).forEach(function (s) {
      h += '<div class="field"><label for="flt-' + s.name + '">' + esc(s.label) + '</label><select id="flt-' + s.name + '" data-filter="' + s.name + '">' +
        (s.noAll ? '' : '<option value="">All</option>') +
        optList(s.options).map(function (o) { return '<option value="' + esc(o.value) + '"' + (String(st[s.name]) === String(o.value) ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select></div>';
    });
    if (f.indexOf('from') !== -1) {
      h += '<div class="field"><label for="flt-from">' + esc(labels.from || 'From date') + '</label><input type="date" id="flt-from" data-filter="from" value="' + esc(st.from) + '"></div>';
    }
    if (f.indexOf('to') !== -1) {
      h += '<div class="field"><label for="flt-to">' + esc(labels.to || 'To date') + '</label><input type="date" id="flt-to" data-filter="to" value="' + esc(st.to) + '"></div>';
    }
    h += '<div class="filter-buttons"><button type="button" class="btn btn-small" data-clear>Clear filters</button>' +
      (cfg.csv === false ? '' : '<button type="button" class="btn btn-small btn-primary" data-csv>Download CSV</button>') + '</div>';
    filtersEl.innerHTML = h;
  }

  function update() {
    const out = cfg.build(st);
    const sortable = out.columns.filter(function (c) { return !c.noSort && !c.csvOnly; });
    let key = st.sortKey;
    let dir = st.sortDir;
    if (!key || !sortable.some(function (c) { return c.key === key; })) {
      key = out.defaultSort ? out.defaultSort.key : null;
      dir = out.defaultSort ? out.defaultSort.dir : 'asc';
    }
    const rows = out.rows.slice();
    if (key) rows.sort(function (a, b) { return compareValues(a[key], b[key], dir); });
    sort = { key: key, dir: dir };
    current = { rows: rows, columns: out.columns, name: out.exportName || cfg.exportName };

    let html = '';
    if (st.from && st.to && st.from > st.to) html += '<p class="notice warn">The “From” date is after the “To” date, so no records can match.</p>';
    if (out.top) html += out.top;
    if (out.customHtml !== undefined) html += out.customHtml;
    else if (!rows.length) html += '<div class="empty"><p>' + esc(out.empty || 'No records match your filters.') + '</p></div>';
    else html += tableHtml(out.columns, rows, key, dir);
    if (out.footer) html += '<div class="totals">' + out.footer + '</div>';
    if (out.bottom) html += out.bottom;
    resultsEl.innerHTML = html;
  }

  function onFilter(e) {
    const name = e.target.dataset ? e.target.dataset.filter : '';
    if (!name) return;
    st[name] = e.target.value;
    if (name === 'mode') st.sortKey = null;
    update();
  }
  el.addEventListener('input', onFilter);
  el.addEventListener('change', onFilter);
  el.addEventListener('click', function (e) {
    const s = e.target.closest('[data-sort]');
    if (s) {
      const k = s.dataset.sort;
      st.sortDir = sort.key === k ? (sort.dir === 'asc' ? 'desc' : 'asc') : 'asc';
      st.sortKey = k;
      update();
      return;
    }
    if (e.target.closest('[data-clear]')) {
      st.search = ''; st.tank = ''; st.from = ''; st.to = '';
      (cfg.selects || []).forEach(function (sel) { if (!sel.noAll) st[sel.name] = ''; });
      drawFilters();
      update();
      return;
    }
    if (e.target.closest('[data-csv]')) {
      if (!current.rows.length) { toast('There are no rows to download for the current filters.', 'warn'); return; }
      downloadFile('aquafarm-' + (current.name || 'export') + '-' + todayStr() + '.csv', toCsv(current.columns, current.rows), 'text/csv;charset=utf-8');
      toast('CSV file ready (' + current.rows.length + ' row(s)). Confirm the save if asked.');
    }
  });

  drawFilters();
  update();
}

/* Buttons shown at the end of each table row. */
function actionButtons(modKey, id, single) {
  return '<div class="row-actions">' +
    '<button type="button" class="btn btn-small" data-action="view" data-mod="' + modKey + '" data-id="' + esc(id) + '" aria-label="View ' + esc(single) + '">View</button>' +
    '<button type="button" class="btn btn-small" data-action="edit" data-mod="' + modKey + '" data-id="' + esc(id) + '" aria-label="Edit ' + esc(single) + '">Edit</button>' +
    '<button type="button" class="btn btn-small btn-danger-quiet" data-action="delete" data-mod="' + modKey + '" data-id="' + esc(id) + '" aria-label="Delete ' + esc(single) + '">Delete</button></div>';
}

/* Table columns for a module, made from its field list. */
function moduleColumns(mod, withActions) {
  const cols = [];
  mod.fields.forEach(function (f) {
    if (f.type === 'tank') {
      cols.push({ key: 'tankId', label: 'Tank', csvLabel: 'Tank ID', render: function (r) { return esc(r.tankLabel); } });
      cols.push({ key: 'tankName', label: 'Tank name', csvOnly: true });
      return;
    }
    cols.push({
      key: f.name, label: f.short || f.label, align: f.type === 'number' ? 'right' : 'left', clip: f.type === 'textarea',
      render: function (r) { return mod.cell ? mod.cell(f, r) : defaultCell(f, r); }
    });
  });
  (mod.extraCols || []).forEach(function (c) { cols.push(c); });
  if (withActions) {
    cols.push({ key: '_actions', label: 'Actions', noSort: true, noExport: true, render: function (r) { return actionButtons(mod.key, r.id, mod.single); } });
  }
  return cols;
}

/* A module's table: used on its own page, on a tank's page, and in reports. */
function mountModuleTable(el, modKey, fixedTank) {
  const mod = MODS[modKey];
  const selects = (mod.selects || []).map(function (s) {
    return { name: s.name, label: s.label, options: distinct(DB[mod.store], s.name) };
  });
  mountTable(el, {
    stateKey: fixedTank ? 'td:' + fixedTank + ':' + modKey : 'm:' + modKey,
    filters: fixedTank ? ['search', 'from', 'to'] : ['search', 'tank', 'from', 'to'],
    selects: selects,
    exportName: modKey + (fixedTank ? '-' + fixedTank : ''),
    build: function (st) {
      const all = DB[mod.store].filter(function (r) { return !fixedTank || r.tankId === fixedTank; });
      const rows = filterRecords(all, st, { dateOf: mod.dateOf, selects: mod.selects }).map(function (r) { return decorate(modKey, r); });
      return {
        columns: moduleColumns(mod, true),
        rows: rows,
        defaultSort: { key: mod.sortKey, dir: 'desc' },
        top: (mod.top ? mod.top(rows, st, fixedTank) : '') + (mod.summary && rows.length ? mod.summary(rows) : ''),
        footer: rows.length && mod.footer ? mod.footer(rows) : '',
        empty: all.length ? 'No records match your filters.' : mod.emptyMsg
      };
    }
  });
}

/* =====================================================================
   9. WATER-QUALITY CHARTS (drawn as SVG, no libraries needed)
   ===================================================================== */
const CHART_COLORS = ['#0f9aa0', '#1d5fa8', '#c27a1a', '#7a4fb3', '#2e8b57', '#b5446e', '#5a6f7b', '#d1603d'];

function dateLabel(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function waterChartsHtml(readings) {
  if (!readings.length) return '<p class="muted">No readings to chart for the current filters.</p>';
  const tankIds = Array.from(new Set(readings.map(function (r) { return r.tankId; }))).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
  function colorOf(id) { return CHART_COLORS[tankIds.indexOf(id) % CHART_COLORS.length]; }
  const legend = tankIds.map(function (id) { return '<span class="legend-item"><i style="background:' + colorOf(id) + '"></i>' + esc(id) + '</span>'; }).join('');
  const charts = WATER_PARAMS.map(function (p) { return lineChart(p, readings, tankIds, colorOf); }).join('');
  return '<div class="chart-legend" aria-label="Chart colours by tank">' + legend + '<span class="legend-note">Dashed lines = your farm limits. Red rings = outside limits.</span></div>' +
    '<div class="chart-grid">' + charts + '</div>';
}

function lineChart(p, readings, tankIds, colorOf) {
  const pts = readings.filter(function (r) { return typeof r[p.key] === 'number'; }).map(function (r) {
    const t = getTank(r.tankId);
    return { t: new Date(r.dateTime).getTime(), v: r[p.key], tankId: r.tankId, label: r.dateTime.replace('T', ' '), flag: flagFor(t ? t.species : '', p.key, r[p.key]) };
  }).filter(function (q) { return !Number.isNaN(q.t); });
  if (!pts.length) return '<figure class="chart"><figcaption>' + esc(p.title) + '</figcaption><p class="muted">No ' + esc(p.label.toLowerCase()) + ' readings in this selection.</p></figure>';

  // Farm limits to draw as dashed lines (for the species of the tanks shown)
  const limitLines = [];
  Array.from(new Set(tankIds.map(function (id) { const t = getTank(id); return t ? t.species : ''; }))).forEach(function (sp) {
    const L = limitsFor(sp)[p.key];
    if (!L) return;
    if (typeof L.min === 'number') limitLines.push({ v: L.min, label: sp + ' min ' + L.min });
    if (typeof L.max === 'number') limitLines.push({ v: L.max, label: sp + ' max ' + L.max });
  });

  const W = 640, H = 240, mL = 52, mR = 16, mT = 14, mB = 34;
  const dataMin = Math.min.apply(null, pts.map(function (q) { return q.t; }));
  const dataMax = Math.max.apply(null, pts.map(function (q) { return q.t; }));
  let tMin = dataMin, tMax = dataMax;
  if (tMin === tMax) { tMin -= 43200000; tMax += 43200000; }
  const dataVals = pts.map(function (q) { return q.v; });
  const allVals = dataVals.concat(limitLines.map(function (l) { return l.v; }));
  let vMin = Math.min.apply(null, allVals), vMax = Math.max.apply(null, allVals);
  if (vMin === vMax) { vMin -= 1; vMax += 1; }
  const padV = (vMax - vMin) * 0.08;
  vMin -= padV; vMax += padV;
  if (vMin < 0 && Math.min.apply(null, allVals) >= 0) vMin = 0;
  function x(t) { return mL + (t - tMin) / (tMax - tMin) * (W - mL - mR); }
  function y(v) { return mT + (1 - (v - vMin) / (vMax - vMin)) * (H - mT - mB); }

  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(p.title) + ' over time">';
  for (let i = 0; i <= 4; i++) {
    const val = vMin + (vMax - vMin) * i / 4;
    svg += '<line class="grid" x1="' + mL + '" x2="' + (W - mR) + '" y1="' + y(val).toFixed(1) + '" y2="' + y(val).toFixed(1) + '"/>' +
      '<text class="tick" x="' + (mL - 6) + '" y="' + (y(val) + 4).toFixed(1) + '" text-anchor="end">' + esc(String(round(val, 2))) + '</text>';
  }
  svg += '<text class="tick" x="' + mL + '" y="' + (H - 10) + '" text-anchor="start">' + dateLabel(dataMin) + '</text>';
  if (dataMax !== dataMin) svg += '<text class="tick" x="' + (W - mR) + '" y="' + (H - 10) + '" text-anchor="end">' + dateLabel(dataMax) + '</text>';
  limitLines.forEach(function (l) {
    svg += '<line class="limit" x1="' + mL + '" x2="' + (W - mR) + '" y1="' + y(l.v).toFixed(1) + '" y2="' + y(l.v).toFixed(1) + '"/>' +
      '<text class="limit-label" x="' + (W - mR - 2) + '" y="' + (y(l.v) - 4).toFixed(1) + '" text-anchor="end">' + esc(l.label) + '</text>';
  });
  tankIds.forEach(function (id) {
    const mine = pts.filter(function (q) { return q.tankId === id; }).sort(function (a, b) { return a.t - b.t; });
    if (!mine.length) return;
    const color = colorOf(id);
    if (mine.length > 1) {
      svg += '<polyline fill="none" stroke="' + color + '" stroke-width="2" points="' + mine.map(function (q) { return x(q.t).toFixed(1) + ',' + y(q.v).toFixed(1); }).join(' ') + '"/>';
    }
    mine.forEach(function (q) {
      svg += '<circle cx="' + x(q.t).toFixed(1) + '" cy="' + y(q.v).toFixed(1) + '" r="' + (q.flag ? 5 : 3.5) + '" fill="' + color + '"' +
        (q.flag ? ' stroke="#c0392b" stroke-width="2.5"' : '') + '><title>' + esc(q.tankId + ' · ' + q.label + ' · ' + q.v + (p.unit ? ' ' + p.unit : '') + (q.flag ? ' (outside farm limit)' : '')) + '</title></circle>';
    });
  });
  svg += '</svg>';
  return '<figure class="chart"><figcaption>' + esc(p.title) + '</figcaption>' + svg + '</figure>';
}

/* =====================================================================
   10. PAGES: DASHBOARD, TANKS, MODULES, TANK DETAILS
   ===================================================================== */
function statusBadge(status) {
  return '<span class="badge ' + (status === 'Active' ? 'badge-ok' : 'badge-muted') + '">' + esc(status) + '</span>';
}

function statCard(label, value, sub, cls) {
  return '<div class="stat ' + (cls || '') + '"><div class="stat-label">' + esc(label) + '</div><div class="stat-value">' + value + '</div>' +
    (sub ? '<div class="stat-sub">' + sub + '</div>' : '') + '</div>';
}

/* Pictures for the tank tiles (drawn as SVG inside this file, so no image files are needed). */
const SHRIMP_ART = '<svg viewBox="0 0 120 64" focusable="false">' +
  '<path class="art-feeler" d="M24 38C14 32 8 24 6 12M27 34C20 24 20 16 24 6" fill="none" stroke-width="2" stroke-linecap="round"/>' +
  '<path class="art-leg" d="M44 50l-4 8M56 52l-2 8M68 52l1 8M80 50l4 7" fill="none" stroke-width="2.5" stroke-linecap="round"/>' +
  '<path class="art-tail" d="M96 52l16-6-3 12-14 4z"/>' +
  '<path class="art-shrimp" d="M96 50C110 30 90 10 62 12 40 14 26 28 30 44" fill="none" stroke-width="17" stroke-linecap="round"/>' +
  '<path class="art-seg" d="M96 50C110 30 90 10 62 12 40 14 26 28 30 44" fill="none" stroke-width="17" stroke-dasharray="1.6 9"/>' +
  '<circle cx="27" cy="38" r="3.2" fill="#12303d"/></svg>';
const FISH_ART = '<svg viewBox="0 0 120 64" focusable="false">' +
  '<path class="art-fin" d="M46 16C52 4 68 4 74 16z"/>' +
  '<path class="art-fish" d="M10 32C26 8 70 6 92 28L112 14V50L92 36C70 58 26 56 10 32Z"/>' +
  '<path class="art-belly" d="M16 36C34 50 68 50 90 35 70 56 28 56 16 36Z"/>' +
  '<path d="M38 21C33 29 33 37 38 45" fill="none" stroke="#1f5f9e" stroke-width="2" stroke-linecap="round"/>' +
  '<circle cx="26" cy="29" r="3.6" fill="#fff"/><circle cx="26" cy="29" r="1.8" fill="#12303d"/></svg>';

/* A clickable tank tile. Opens the tank's detail page. */
function tankTile(t) {
  return '<button type="button" class="tank-tile species-' + esc(t.species.toLowerCase()) + '" data-action="open-tank" data-id="' + esc(t.tankId) + '">' +
    '<span class="tile-art" aria-hidden="true">' + (t.species === 'Shrimp' ? SHRIMP_ART : FISH_ART) + '</span>' +
    '<span class="tile-top"><span class="tile-id">' + esc(t.tankId) + '</span>' + statusBadge(t.status) + '</span>' +
    '<span class="tile-name">' + esc(t.name) + '</span>' +
    '<span class="tile-meta">' + (t.species === 'Shrimp' ? '🦐' : '🐟') + ' ' + esc(t.species) + '</span>' +
    '<span class="tile-meta">Capacity: ' + esc(fmt(t.capacity, 3)) + ' ' + esc(t.capacityUnit) + '</span></button>';
}

/* Table of the latest water reading for each tank. */
function latestReadingsTable(readings) {
  const latest = latestByTank(readings);
  if (!latest.length) return '<p class="muted">No water readings have been recorded yet.</p>';
  let h = '<div class="table-wrap"><table><thead><tr><th scope="col">Tank</th><th scope="col">Date and time</th>' +
    WATER_PARAMS.map(function (p) { return '<th scope="col" class="num">' + esc(p.short) + '</th>'; }).join('') + '</tr></thead><tbody>';
  latest.forEach(function (r) {
    const t = getTank(r.tankId);
    const sp = t ? t.species : '';
    h += '<tr><td>' + esc(tankLabel(r.tankId)) + '</td><td>' + esc(r.dateTime.replace('T', ' ')) + '</td>' +
      WATER_PARAMS.map(function (p) { return '<td class="num">' + flagHtml(sp, p.key, r[p.key]) + '</td>'; }).join('') + '</tr>';
  });
  return h + '</tbody></table></div>';
}

function newestFirst(list) {
  return list.slice().sort(function (a, b) {
    const ka = (a.date || a.dateTime || '') + (a.created || '');
    const kb = (b.date || b.dateTime || '') + (b.created || '');
    return kb.localeCompare(ka);
  });
}

function pageDashboard(el) {
  const today = todayStr();
  const tanks = sortedTanks();
  const active = tanks.filter(function (t) { return t.status === 'Active'; }).length;
  const totals = tanks.reduce(function (a, t) {
    const s = stockFor(t.tankId);
    a.est += s.estimated; a.stocked += s.stocked; a.dead += s.dead; a.harvested += s.harvested;
    return a;
  }, { est: 0, stocked: 0, dead: 0, harvested: 0 });
  const feedToday = sumOf(DB.feed.filter(function (r) { return r.date === today; }), function (r) { return r.quantity; });
  const deadToday = sumOf(DB.mortality.filter(function (r) { return r.date === today; }), function (r) { return r.dead; });
  const hasRecords = COLLECTIONS.some(function (c) { return c !== 'tanks' && DB[c].length > 0; });

  let notices = '';
  if (!storageWorks) notices += '<div class="notice error"><strong>Saving is blocked.</strong> This browser (for example in Private Browsing) is not letting the app save records. Anything you enter will be lost when you close the page.</div>';
  if (loadProblem) notices += '<div class="notice error">' + esc(loadProblem) + '</div>';
  if (tanks.some(function (t) { return t.demo; })) notices += '<div class="notice">Demo data is loaded (tanks DEMO-01 and DEMO-02). It is not real farm data. <a href="#/backup">Remove it on the Data Backup page</a> before you start real record keeping.</div>';
  const lastBackup = DB.meta.lastBackup ? new Date(DB.meta.lastBackup).getTime() : 0;
  if (hasRecords && Date.now() - lastBackup > 7 * 86400000) {
    notices += '<div class="notice warn"><strong>Back up your records.</strong> ' + (lastBackup ? 'Your last backup was more than a week ago.' : 'You have not downloaded a backup yet.') +
      ' Your data lives only in this browser. <a href="#/backup">Download a backup</a></div>';
  }

  const quick = [['tanks', '+ Add Tank', '🛢️'], ['stocking', 'Seed Stocking', '🌱'], ['feed', 'Record Feed', '🍽️'], ['water', 'Water Quality Entry', '💧'],
    ['medication', 'Medication Entry', '💊'], ['mortality', 'Record Mortality', '⚠️'], ['harvest', 'Record Harvest', '🎣']];

  let h = '<div class="page-head"><div><h1 id="page-title" tabindex="-1">🌊 Dashboard</h1><p class="lead">A summary of your farm, calculated from the records you have saved.</p></div></div>' + notices;

  if (!tanks.length) {
    h += '<section class="card welcome"><h2>Welcome to AquaFarm</h2><p>Start by adding your first tank. Every stocking, feed, water, medication, mortality and harvest record is linked to a tank.</p>' +
      '<button type="button" class="btn btn-primary" data-action="add" data-mod="tanks">+ Add your first tank</button> ' +
      '<a class="btn" href="#/backup">Load optional demo data</a></section>';
  }

  h += '<div class="stat-grid">' +
    statCard('Total tanks', fmt(tanks.length, 0)) +
    statCard('Active tanks', fmt(active, 0)) +
    statCard('Inactive tanks', fmt(tanks.length - active, 0)) +
    statCard('Estimated current stock', fmt(totals.est, 0), 'An estimate: ' + fmt(totals.stocked, 0) + ' stocked − ' + fmt(totals.dead, 0) + ' recorded deaths − ' + fmt(totals.harvested, 0) + ' harvested (counted)', totals.est < 0 ? 'stat-warn' : '') +
    statCard('Feed given today', fmt(feedToday, 3) + ' <small>kg</small>') +
    statCard('Recorded deaths today', fmt(deadToday, 0), 'Recorded deaths, not a live count') +
    '</div>';

  h += '<section aria-labelledby="qa-title"><h2 id="qa-title">Quick actions</h2><div class="quick-actions">' +
    quick.map(function (q) { return '<button type="button" class="btn quick" data-action="add" data-mod="' + q[0] + '"><span aria-hidden="true">' + q[2] + '</span> ' + esc(q[1]) + '</button>'; }).join('') + '</div></section>';

  h += '<section aria-labelledby="tanks-title"><h2 id="tanks-title">Your tanks</h2>' +
    (tanks.length ? '<div class="tank-grid">' + tanks.map(tankTile).join('') + '</div><p class="muted small">Select a tank to see all of its records.</p>' : '<p class="muted">No tanks yet.</p>') + '</section>';

  const meds = newestFirst(DB.medication).slice(0, 5);
  const harvests = newestFirst(DB.harvest).slice(0, 5);
  h += '<div class="dash-grid">' +
    '<section class="card"><h3>Latest water quality readings</h3>' + latestReadingsTable(DB.water) + '</section>' +
    '<section class="card"><h3>Recent medication and chemical applications</h3>' +
    (meds.length ? '<div class="table-wrap"><table><thead><tr><th scope="col">Date</th><th scope="col">Tank</th><th scope="col">Medication</th><th scope="col" class="num">Quantity</th></tr></thead><tbody>' +
      meds.map(function (r) { return '<tr><td>' + esc(r.date) + '</td><td>' + esc(tankLabel(r.tankId)) + '</td><td>' + esc(r.medName) + '</td><td class="num">' + esc(fmt(r.quantity, 3)) + ' ' + esc(r.unit) + '</td></tr>'; }).join('') + '</tbody></table></div>'
      : '<p class="muted">No medication or chemical records yet.</p>') + '</section>' +
    '<section class="card"><h3>Upcoming and recent harvests</h3>' +
    (harvests.length ? '<div class="table-wrap"><table><thead><tr><th scope="col">Date</th><th scope="col">Tank</th><th scope="col" class="num">Animals</th><th scope="col" class="num">Production (kg)</th></tr></thead><tbody>' +
      harvests.map(function (r) { return '<tr><td>' + esc(r.date) + (r.date > today ? ' <span class="badge badge-warn">Upcoming</span>' : '') + '</td><td>' + esc(tankLabel(r.tankId)) + '</td><td class="num">' + esc(fmt(r.count, 0)) + '</td><td class="num">' + esc(fmt(r.production, 3)) + '</td></tr>'; }).join('') + '</tbody></table></div>'
      : '<p class="muted">No harvest records yet.</p>') + '</section>' +
    '</div>';
  el.innerHTML = h;
}

/* ----- Tank Master page ----- */
function pageTanks(el) {
  el.innerHTML = '<div class="page-head"><div><h1 id="page-title" tabindex="-1">🛢️ Tank Master</h1><p class="lead">' + esc(MODS.tanks.lead) + '</p></div>' +
    '<button type="button" class="btn btn-primary" data-action="add" data-mod="tanks">+ Add tank</button></div><div id="tank-table"></div>';
  mountTable($('#tank-table', el), {
    stateKey: 'tanks',
    filters: ['search'],
    selects: [
      { name: 'species', label: 'Species', options: ['Shrimp', 'Fish'] },
      { name: 'status', label: 'Status', options: ['Active', 'Inactive'] },
      { name: 'layout', label: 'Layout', options: ['Table', 'Cards'], noAll: true, def: 'Table' }
    ],
    exportName: 'tanks',
    build: function (st) {
      const rows = filterRecords(DB.tanks, st, { selects: [{ name: 'species' }, { name: 'status' }] });
      const columns = [
        { key: 'tankId', label: 'Tank ID', render: function (r) { return '<button type="button" class="link-btn" data-action="open-tank" data-id="' + esc(r.tankId) + '">' + esc(r.tankId) + '</button>'; } },
        { key: 'name', label: 'Name' },
        { key: 'species', label: 'Species' },
        { key: 'capacity', label: 'Capacity', align: 'right', render: function (r) { return esc(fmt(r.capacity, 3) + ' ' + r.capacityUnit); } },
        { key: 'capacityUnit', label: 'Capacity unit', csvOnly: true },
        { key: 'location', label: 'Location' },
        { key: 'status', label: 'Status', render: function (r) { return statusBadge(r.status); } },
        { key: '_actions', label: 'Actions', noSort: true, noExport: true, render: function (r) {
          return '<div class="row-actions">' +
            '<button type="button" class="btn btn-small" data-action="open-tank" data-id="' + esc(r.tankId) + '" aria-label="View tank ' + esc(r.tankId) + '">View</button>' +
            '<button type="button" class="btn btn-small" data-action="edit" data-mod="tanks" data-id="' + esc(r.id) + '" aria-label="Edit tank ' + esc(r.tankId) + '">Edit</button>' +
            '<button type="button" class="btn btn-small" data-action="tank-toggle" data-id="' + esc(r.id) + '">' + (r.status === 'Active' ? 'Deactivate' : 'Activate') + '</button>' +
            '<button type="button" class="btn btn-small btn-danger-quiet" data-action="tank-delete" data-id="' + esc(r.id) + '" aria-label="Delete tank ' + esc(r.tankId) + '">Delete</button></div>';
        } }
      ];
      const out = {
        columns: columns, rows: rows, defaultSort: { key: 'tankId', dir: 'asc' },
        empty: DB.tanks.length ? 'No tanks match your filters.' : 'No tanks yet. Choose “Add tank” to create your first one.',
        footer: rows.length ? fmt(rows.length, 0) + ' of ' + fmt(DB.tanks.length, 0) + ' tank(s) shown' : ''
      };
      if (st.layout === 'Cards' && rows.length) {
        out.customHtml = '<div class="tank-grid">' + rows.slice().sort(function (a, b) { return a.tankId.localeCompare(b.tankId, undefined, { numeric: true }); }).map(tankTile).join('') + '</div>';
      }
      return out;
    }
  });
}

/* ----- Module pages (Seed Stocking, Medication, Feed, Water, Mortality, Harvest) ----- */
function pageModule(el, modKey) {
  const mod = MODS[modKey];
  el.innerHTML = '<div class="page-head"><div><h1 id="page-title" tabindex="-1">' + mod.icon + ' ' + esc(mod.title) + '</h1><p class="lead">' + esc(mod.lead) + '</p></div>' +
    '<button type="button" class="btn btn-primary" data-action="add" data-mod="' + modKey + '">+ Add ' + esc(mod.single) + '</button></div>' +
    (mod.intro ? '<div class="notice">' + esc(mod.intro) + '</div>' : '') +
    (modKey === 'water' ? limitsPanelHtml() : '') + '<div id="mod-table"></div>';
  if (modKey === 'water') wireLimitsPanel(el);
  mountModuleTable($('#mod-table', el), modKey, null);
}

/* Farm warning limits for water quality (settings panel). */
function limitsPanelHtml() {
  let h = '<details class="card limits"' + (UI.limitsOpen ? ' open' : '') + '><summary>Farm warning limits (optional settings)</summary>' +
    '<p class="muted">Choose your own minimum and maximum for each measurement. Readings outside these limits are highlighted. These are farm settings, not veterinary advice, and different species and growth stages may need different limits. Leave a box empty for no limit.</p>' +
    '<form id="limits-form" novalidate>';
  ['Shrimp', 'Fish'].forEach(function (sp) {
    h += '<fieldset><legend>' + sp + ' tanks</legend><div class="limit-grid">';
    WATER_PARAMS.forEach(function (p) {
      const L = limitsFor(sp)[p.key] || {};
      h += '<div class="limit-row"><span class="limit-name">' + esc(p.title) + '</span>' +
        '<input type="number" inputmode="decimal" step="any" min="0" placeholder="Min" aria-label="' + esc(sp + ' ' + p.label + ' minimum') + '" data-sp="' + sp + '" data-key="' + p.key + '" data-bound="min" value="' + (typeof L.min === 'number' ? L.min : '') + '">' +
        '<input type="number" inputmode="decimal" step="any" min="0" placeholder="Max" aria-label="' + esc(sp + ' ' + p.label + ' maximum') + '" data-sp="' + sp + '" data-key="' + p.key + '" data-bound="max" value="' + (typeof L.max === 'number' ? L.max : '') + '"></div>';
    });
    h += '</div></fieldset>';
  });
  return h + '<p class="field-error" id="limits-error" role="alert"></p>' +
    '<div class="form-actions"><button type="button" class="btn" id="limits-clear">Clear all limits</button><button type="submit" class="btn btn-primary">Save limits</button></div></form></details>';
}

function wireLimitsPanel(el) {
  const details = $('details.limits', el);
  const form = $('#limits-form', el);
  details.addEventListener('toggle', function () { UI.limitsOpen = details.open; });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    const limits = { Shrimp: {}, Fish: {} };
    let error = '';
    Array.from(form.querySelectorAll('input[data-sp]')).forEach(function (inp) {
      const v = inp.value.trim();
      if (v === '') return;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) { error = 'Limits must be numbers that are 0 or higher.'; return; }
      const slot = limits[inp.dataset.sp][inp.dataset.key] || (limits[inp.dataset.sp][inp.dataset.key] = {});
      slot[inp.dataset.bound] = n;
    });
    ['Shrimp', 'Fish'].forEach(function (sp) {
      Object.keys(limits[sp]).forEach(function (k) {
        const L = limits[sp][k];
        if (typeof L.min === 'number' && typeof L.max === 'number' && L.min > L.max) error = 'A minimum limit is higher than its maximum (' + sp + ', ' + k + ').';
      });
    });
    $('#limits-error', form).textContent = error;
    if (error) { toast(error, 'error'); return; }
    DB.settings.limits = limits;
    if (saveDB()) toast('Farm limits saved.');
    render({ keep: true });
  });
  $('#limits-clear', form).addEventListener('click', async function () {
    const ok = await confirmDialog({ title: 'Clear all limits?', message: 'Readings will no longer be highlighted until you set limits again.', confirmText: 'Clear limits' });
    if (!ok) return;
    DB.settings.limits = { Shrimp: {}, Fish: {} };
    if (saveDB()) toast('All limits cleared.');
    render({ keep: true });
  });
}

/* ----- Tank details page ----- */
const TANK_TABS = [
  ['overview', 'Overview'], ['stocking', 'Seed Stocking'], ['medication', 'Medication and Chemicals'],
  ['feed', 'Feed Records'], ['water', 'Water Quality'], ['mortality', 'Mortality'], ['harvest', 'Harvest']
];

function pageTankDetails(el, tankId, tab) {
  const t = getTank(tankId);
  if (!t) {
    el.innerHTML = '<div class="page-head"><div><h1 id="page-title" tabindex="-1">Tank not found</h1></div></div>' +
      '<div class="empty"><p>No tank with the ID “' + esc(tankId) + '” exists.</p><a class="btn btn-primary" href="#/tanks">Back to Tank Master</a></div>';
    return;
  }
  if (!TANK_TABS.some(function (x) { return x[0] === tab; })) tab = 'overview';
  let h = '<p class="crumb"><a href="#/tanks">← All tanks</a></p>' +
    '<div class="page-head"><div><h1 id="page-title" tabindex="-1">' + (t.species === 'Shrimp' ? '🦐' : '🐟') + ' ' + esc(t.tankId) + ' – ' + esc(t.name) + '</h1>' +
    '<p class="lead">' + statusBadge(t.status) + ' ' + esc(t.species) + ' tank</p></div>' +
    '<div class="head-actions"><button type="button" class="btn" data-action="edit" data-mod="tanks" data-id="' + esc(t.id) + '">Edit tank</button>' +
    '<button type="button" class="btn" data-action="tank-toggle" data-id="' + esc(t.id) + '">' + (t.status === 'Active' ? 'Deactivate' : 'Activate') + '</button></div></div>';
  h += '<nav class="tabs" aria-label="Tank sections">' + TANK_TABS.map(function (x) {
    return '<a class="tab" href="#/tank/' + encodeURIComponent(t.tankId) + '/' + x[0] + '"' + (x[0] === tab ? ' aria-current="page"' : '') + '>' + esc(x[1]) + '</a>';
  }).join('') + '</nav><div id="tab-body"></div>';
  el.innerHTML = h;
  const body = $('#tab-body', el);

  if (tab === 'overview') { body.innerHTML = tankOverviewHtml(t); return; }
  const mod = MODS[tab];
  body.innerHTML = '<div class="tab-head"><h2>' + esc(TANK_TABS.filter(function (x) { return x[0] === tab; })[0][1]) + '</h2>' +
    '<button type="button" class="btn btn-primary" data-action="add" data-mod="' + tab + '" data-tank="' + esc(t.tankId) + '">+ Add ' + esc(mod.single) + '</button></div>' +
    (mod.intro ? '<div class="notice">' + esc(mod.intro) + '</div>' : '') +
    (tab === 'water' ? '<p class="muted small">Farm warning limits are set on the <a href="#/water">Water Quality</a> page.</p>' : '') +
    '<div id="tab-table"></div>';
  mountModuleTable($('#tab-table', body), tab, t.tankId);
}

function tankOverviewHtml(t) {
  const s = stockFor(t.tankId);
  const feedKg = sumOf(DB.feed.filter(function (r) { return r.tankId === t.tankId; }), function (r) { return r.quantity; });
  const prodKg = sumOf(DB.harvest.filter(function (r) { return r.tankId === t.tankId; }), function (r) { return r.production; });
  const link = function (tab) { return '#/tank/' + encodeURIComponent(t.tankId) + '/' + tab; };
  const counts = [['stocking', 'Seed stocking'], ['medication', 'Medication and chemicals'], ['feed', 'Feed'], ['water', 'Water quality'], ['mortality', 'Mortality'], ['harvest', 'Harvest']];
  return '<div class="two-col">' +
    '<section class="card"><h3>Tank details</h3><dl class="detail-list">' +
    '<dt>Tank ID</dt><dd>' + esc(t.tankId) + '</dd><dt>Name</dt><dd>' + esc(t.name) + '</dd><dt>Species</dt><dd>' + esc(t.species) + '</dd>' +
    '<dt>Capacity</dt><dd>' + esc(fmt(t.capacity, 3) + ' ' + t.capacityUnit) + '</dd><dt>Location</dt><dd>' + esc(t.location || '–') + '</dd>' +
    '<dt>Status</dt><dd>' + esc(t.status) + '</dd></dl></section>' +
    '<section class="card"><h3>Stock summary</h3><div class="stat-grid compact">' +
    statCard('Seed stocked', fmt(s.stocked, 0)) + statCard('Recorded deaths', fmt(s.dead, 0)) + statCard('Harvested (counted)', fmt(s.harvested, 0)) +
    statCard('Estimated current stock', fmt(s.estimated, 0), 'Estimate, not a verified live count', s.estimated < 0 ? 'stat-warn' : '') +
    statCard('Total feed', fmt(feedKg, 3) + ' <small>kg</small>') + statCard('Total production', fmt(prodKg, 3) + ' <small>kg</small>') + '</div>' +
    (s.weightOnly ? '<p class="muted small">' + s.weightOnly + ' harvest record(s) have no animal count and are not subtracted from the estimate.</p>' : '') + '</section></div>' +
    '<section class="card"><h3>Latest water reading</h3>' + latestReadingsTable(DB.water.filter(function (r) { return r.tankId === t.tankId; })) + '</section>' +
    '<section class="card"><h3>Records for this tank</h3><ul class="count-list">' + counts.map(function (c) {
      const n = DB[c[0]].filter(function (r) { return r.tankId === t.tankId; }).length;
      return '<li><a href="' + link(c[0]) + '">' + esc(c[1]) + '</a><span class="badge badge-muted">' + n + '</span></li>';
    }).join('') + '</ul></section>';
}

/* =====================================================================
   11. PAGES: REPORTS AND DATA BACKUP
   ===================================================================== */
function tankCols() {
  return [
    { key: 'tankId', label: 'Tank', csvLabel: 'Tank ID', render: function (r) { return esc(r.tankLabel); } },
    { key: 'tankName', label: 'Tank name', csvOnly: true }
  ];
}

/* Add up records by period (day / month / all) and tank. */
function aggregate(records, mode, keyFields, valueFns) {
  const map = new Map();
  records.forEach(function (r) {
    const period = mode === 'daily' ? r.date : (mode === 'monthly' ? r.date.slice(0, 7) : 'All dates');
    const key = [period, r.tankId].concat(keyFields.map(function (k) { return r[k]; })).join('||');
    let g = map.get(key);
    if (!g) {
      const t = getTank(r.tankId);
      g = { period: period, tankId: r.tankId, tankLabel: tankLabel(r.tankId), tankName: t ? t.name : '', entries: 0, days: new Set() };
      keyFields.forEach(function (k) { g[k] = r[k]; });
      Object.keys(valueFns).forEach(function (n) { g[n] = 0; });
      map.set(key, g);
    }
    g.entries += 1;
    g.days.add(r.date);
    Object.keys(valueFns).forEach(function (n) { g[n] += Number(valueFns[n](r)) || 0; });
  });
  return Array.from(map.values()).map(function (g) {
    g.days = g.days.size;
    Object.keys(valueFns).forEach(function (n) { g[n] = round(g[n]); });
    return g;
  });
}

const PERIOD_MODES = [
  { value: 'overall', label: 'Total by tank' },
  { value: 'daily', label: 'Daily' },
  { value: 'monthly', label: 'Monthly' }
];
function periodSort(st) { return st.mode === 'overall' ? { key: 'tankId', dir: 'asc' } : { key: 'period', dir: 'desc' }; }
function periodLabel(mode) { return mode === 'daily' ? 'Date' : (mode === 'monthly' ? 'Month' : 'Period'); }

/* Report A: estimated current stock by tank */
function reportA() {
  return {
    stateKey: 'rep:A', filters: ['search', 'tank', 'to'], labels: { to: 'As of date (optional)' },
    selects: [{ name: 'species', label: 'Species', options: ['Shrimp', 'Fish'] }],
    exportName: 'current-seed-count',
    build: function (st) {
      const q = (st.search || '').toLowerCase();
      const rows = DB.tanks.filter(function (t) {
        return (!st.tank || t.tankId === st.tank) && (!st.species || t.species === st.species) &&
          (!q || [t.tankId, t.name, t.species, t.location].join(' ').toLowerCase().indexOf(q) !== -1);
      }).map(function (t) {
        const s = stockFor(t.tankId, st.to || '');
        return { tankId: t.tankId, tankName: t.name, species: t.species, stocked: s.stocked, dead: s.dead, harvested: s.harvested, estimated: s.estimated, weightOnly: s.weightOnly };
      });
      const columns = [
        { key: 'tankId', label: 'Tank ID' }, { key: 'tankName', label: 'Tank name' }, { key: 'species', label: 'Species' },
        { key: 'stocked', label: 'Total seed stocked', align: 'right' },
        { key: 'dead', label: 'Recorded mortality', align: 'right' },
        { key: 'harvested', label: 'Harvest removals (animals counted)', align: 'right' },
        { key: 'estimated', label: 'Estimated current stock (estimate)', align: 'right', render: function (r) {
          return r.estimated < 0 ? '<span class="flag flag-high" title="Below zero: check your records">' + esc(fmt(r.estimated, 0)) + '</span>' : esc(fmt(r.estimated, 0));
        } },
        { key: 'weightOnly', label: 'Harvest records without animal count', align: 'right' }
      ];
      return {
        columns: columns, rows: rows, defaultSort: { key: 'tankId', dir: 'asc' },
        empty: DB.tanks.length ? 'No tanks match your filters.' : 'No tanks yet.',
        footer: rows.length
          ? '<strong>Totals:</strong> stocked ' + fmt(sumOf(rows, function (r) { return r.stocked; }), 0) + ' · recorded deaths ' + fmt(sumOf(rows, function (r) { return r.dead; }), 0) +
            ' · harvested (counted) ' + fmt(sumOf(rows, function (r) { return r.harvested; }), 0) + ' · <strong>estimated stock ' + fmt(sumOf(rows, function (r) { return r.estimated; }), 0) + '</strong>' +
            '<p class="muted small">Estimated current stock = total stocked − recorded mortality − harvested animal count. It is an estimate from your records, not a verified live count. ' +
            'Harvests recorded only by weight (no animal count) are not subtracted.' + (st.to ? ' Records after ' + esc(st.to) + ' are ignored.' : '') + '</p>'
          : ''
      };
    }
  };
}

/* Report B: medication history */
function reportB() {
  const sels = [{ name: 'medName', label: 'Medication', options: distinct(DB.medication, 'medName') }];
  return {
    stateKey: 'rep:B', filters: ['search', 'tank', 'from', 'to'], selects: sels, exportName: 'medication-history',
    build: function (st) {
      const rows = filterRecords(DB.medication, st, { selects: sels }).map(function (r) { return decorate('medication', r); });
      const columns = [{ key: 'date', label: 'Date' }].concat(tankCols(), [
        { key: 'medName', label: 'Medication' }, { key: 'quantity', label: 'Quantity', align: 'right' }, { key: 'unit', label: 'Unit' },
        { key: 'purpose', label: 'Purpose' }, { key: 'appliedBy', label: 'Applied by' }]);
      const totals = sumBy(rows, function (r) { return r.medName + '||' + r.unit; }, { t: function (r) { return r.quantity; } });
      return {
        columns: columns, rows: rows, defaultSort: { key: 'date', dir: 'desc' },
        empty: DB.medication.length ? 'No records match your filters.' : 'No medication or chemical records yet.',
        footer: rows.length ? '<strong>Totals (units are never mixed):</strong> ' + totals.map(function (g) { const p = g.key.split('||'); return esc(p[0]) + ' – ' + fmt(g.t, 3) + ' ' + esc(p[1]); }).join(' · ') : ''
      };
    }
  };
}

/* Report C: feed consumption */
function reportC() {
  const sels = [{ name: 'feedType', label: 'Feed type', options: distinct(DB.feed, 'feedType') },
    { name: 'mode', label: 'Show', options: PERIOD_MODES, noAll: true, def: 'overall' }];
  return {
    stateKey: 'rep:C', filters: ['search', 'tank', 'from', 'to'], selects: sels, exportName: 'feed-consumption',
    build: function (st) {
      const recs = filterRecords(DB.feed, st, { selects: [{ name: 'feedType' }] });
      const rows = aggregate(recs, st.mode, ['feedType'], { total: function (r) { return r.quantity; } }).map(function (g) {
        g.avgPerDay = g.days ? round(g.total / g.days) : 0;
        return g;
      });
      const columns = [{ key: 'period', label: periodLabel(st.mode) }].concat(tankCols(), [
        { key: 'feedType', label: 'Feed type' }, { key: 'total', label: 'Total quantity (kg)', align: 'right' },
        { key: 'entries', label: 'Feedings recorded', align: 'right' }, { key: 'avgPerDay', label: 'Average per feeding day (kg)', align: 'right' }]);
      return {
        columns: columns, rows: rows, defaultSort: periodSort(st), exportName: 'feed-consumption-' + st.mode,
        empty: DB.feed.length ? 'No records match your filters.' : 'No feed entries yet.',
        footer: recs.length ? '<strong>Total feed:</strong> ' + fmt(sumOf(recs, function (r) { return r.quantity; }), 3) + ' kg from ' + fmt(recs.length, 0) + ' entr' + (recs.length === 1 ? 'y' : 'ies') : ''
      };
    }
  };
}

/* Report D: water quality trends */
function reportD() {
  return {
    stateKey: 'rep:D', filters: ['search', 'tank', 'from', 'to'], exportName: 'water-quality',
    build: function (st) {
      const rows = filterRecords(DB.water, st, { dateOf: MODS.water.dateOf }).map(function (r) { return decorate('water', r); });
      return {
        columns: moduleColumns(MODS.water, false), rows: rows, defaultSort: { key: 'dateTime', dir: 'desc' },
        top: rows.length ? '<section class="card"><h3>Trends over time</h3>' + waterChartsHtml(rows) + '</section>' : '',
        empty: DB.water.length ? 'No readings match your filters.' : 'No water readings yet.',
        footer: rows.length ? MODS.water.footer(rows) : ''
      };
    }
  };
}

/* Report E: mortality */
function reportE() {
  const sels = [{ name: 'reason', label: 'Reason', options: distinct(DB.mortality, 'reason') },
    { name: 'mode', label: 'Show', noAll: true, def: 'records', options: [{ value: 'records', label: 'Individual records' }].concat(PERIOD_MODES) }];
  return {
    stateKey: 'rep:E', filters: ['search', 'tank', 'from', 'to'], selects: sels, exportName: 'mortality',
    build: function (st) {
      const recs = filterRecords(DB.mortality, st, { selects: [{ name: 'reason' }] });
      let columns, rows, sortInfo;
      if (st.mode === 'records') {
        rows = recs.map(function (r) { return decorate('mortality', r); });
        columns = tankCols().concat([{ key: 'date', label: 'Date' }, { key: 'dead', label: 'Dead count', align: 'right' }, { key: 'reason', label: 'Reason' }, { key: 'remarks', label: 'Remarks', clip: true }]);
        sortInfo = { key: 'date', dir: 'desc' };
      } else {
        rows = aggregate(recs, st.mode, [], { total: function (r) { return r.dead; } });
        columns = [{ key: 'period', label: periodLabel(st.mode) }].concat(tankCols(), [{ key: 'total', label: 'Total recorded deaths', align: 'right' }, { key: 'entries', label: 'Records', align: 'right' }]);
        sortInfo = periodSort(st);
      }
      return {
        columns: columns, rows: rows, defaultSort: sortInfo, exportName: 'mortality-' + st.mode,
        empty: DB.mortality.length ? 'No records match your filters.' : 'No mortality records yet.',
        footer: recs.length ? '<strong>Total recorded deaths:</strong> ' + fmt(sumOf(recs, function (r) { return r.dead; }), 0) + ' from ' + fmt(recs.length, 0) + ' record(s). These are recorded deaths, not a live count.' : ''
      };
    }
  };
}

/* Report F: harvest summary */
function reportF() {
  const sels = [{ name: 'mode', label: 'Show', noAll: true, def: 'records', options: [{ value: 'records', label: 'Individual records' }].concat(PERIOD_MODES) }];
  return {
    stateKey: 'rep:F', filters: ['search', 'tank', 'from', 'to'], selects: sels, exportName: 'harvest-summary',
    build: function (st) {
      const recs = filterRecords(DB.harvest, st, {});
      let columns, rows, sortInfo;
      if (st.mode === 'records') {
        rows = recs.map(function (r) { return decorate('harvest', r); });
        columns = tankCols().concat([{ key: 'date', label: 'Harvest date' }, { key: 'count', label: 'Harvest quantity (animals)', align: 'right' },
          { key: 'avgWeight', label: 'Average weight (g)', align: 'right' }, { key: 'production', label: 'Total production (kg)', align: 'right' }]);
        sortInfo = { key: 'date', dir: 'desc' };
      } else {
        rows = aggregate(recs, st.mode, [], { count: function (r) { return r.count || 0; }, production: function (r) { return r.production || 0; } });
        columns = [{ key: 'period', label: periodLabel(st.mode) }].concat(tankCols(), [{ key: 'count', label: 'Animals harvested (counted)', align: 'right' },
          { key: 'production', label: 'Total production (kg)', align: 'right' }, { key: 'entries', label: 'Records', align: 'right' }]);
        sortInfo = periodSort(st);
      }
      return {
        columns: columns, rows: rows, defaultSort: sortInfo, exportName: 'harvest-' + st.mode,
        empty: DB.harvest.length ? 'No records match your filters.' : 'No harvest records yet.',
        footer: recs.length ? '<strong>Overall:</strong> ' + fmt(sumOf(recs, function (r) { return r.count; }), 0) + ' animals (records with a count) · ' + fmt(sumOf(recs, function (r) { return r.production; }), 3) + ' kg production · ' + fmt(recs.length, 0) + ' record(s)' : ''
      };
    }
  };
}

const REPORTS = {
  A: { title: 'Current seed count by tank', make: reportA, desc: 'Estimated stock for each tank, with the figures used to calculate it.' },
  B: { title: 'Medication history by tank', make: reportB, desc: 'Every medication or chemical application, with totals for each medication and unit.' },
  C: { title: 'Feed consumption', make: reportC, desc: 'Total feed by tank and feed type. Switch between totals, daily and monthly views.' },
  D: { title: 'Water quality trends', make: reportD, desc: 'Readings and time-series charts. Values outside your farm limits are marked.' },
  E: { title: 'Mortality', make: reportE, desc: 'Recorded deaths by record, tank, day or month.' },
  F: { title: 'Harvest summary', make: reportF, desc: 'Harvest records and production by record, tank, day or month.' }
};

function pageReports(el, letter) {
  if (!REPORTS[letter]) letter = 'A';
  const r = REPORTS[letter];
  el.innerHTML = '<div class="page-head"><div><h1 id="page-title" tabindex="-1">📑 Reports</h1>' +
    '<p class="lead">Filter, sort and download any report as a CSV file. The CSV contains the rows currently shown.</p></div></div>' +
    '<nav class="tabs" aria-label="Reports">' + Object.keys(REPORTS).map(function (k) {
      return '<a class="tab" href="#/reports/' + k + '"' + (k === letter ? ' aria-current="page"' : '') + '>' + k + '. ' + esc(REPORTS[k].title) + '</a>';
    }).join('') + '</nav>' +
    '<h2 class="report-title">Report ' + letter + ': ' + esc(r.title) + '</h2><p class="muted">' + esc(r.desc) + '</p><div id="report-body"></div>';
  mountTable($('#report-body', el), r.make());
}

/* ----- Data Backup page ----- */
function backupPayload() {
  return {
    app: 'AquaFarm', version: BACKUP_VERSION, exportedAt: new Date().toISOString(),
    data: {
      tanks: DB.tanks, stocking: DB.stocking, medication: DB.medication, feed: DB.feed,
      water: DB.water, mortality: DB.mortality, harvest: DB.harvest, settings: DB.settings
    }
  };
}

/* Check an imported backup. Returns { ok, errors, data }. Nothing is changed here. */
function validateBackup(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object' || obj.app !== 'AquaFarm' || !obj.data || typeof obj.data !== 'object') {
    return { ok: false, errors: ['This is not an AquaFarm backup file (the AquaFarm marker is missing).'] };
  }
  if (typeof obj.version !== 'number' || obj.version > BACKUP_VERSION) {
    return { ok: false, errors: ['This backup was made by a different version of AquaFarm and cannot be read.'] };
  }
  const data = obj.data;
  COLLECTIONS.forEach(function (k) {
    if (data[k] !== undefined && !Array.isArray(data[k])) errors.push('“' + k + '” must be a list of records.');
  });
  if (errors.length) return { ok: false, errors: errors };

  const out = emptyDB();
  const tankList = Array.isArray(data.tanks) ? data.tanks : [];
  function note(msg) { if (errors.length < 10) errors.push(msg); }

  COLLECTIONS.forEach(function (key) {
    const mod = MODS[key];
    const list = Array.isArray(data[key]) ? data[key] : [];
    const seen = new Set();
    list.forEach(function (rec, i) {
      const where = mod.title + ', record ' + (i + 1) + ': ';
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) { note(where + 'not a valid record.'); return; }
      const res = validateForm(mod.fields, rec, { tanks: tankList, editing: rec, ignoreFuture: true, mod: mod });
      if (!res.ok) {
        const first = Object.keys(res.errors)[0];
        note(where + res.errors[first]);
        return;
      }
      const fixed = Object.assign({}, res.clean);
      fixed.id = (typeof rec.id === 'string' && rec.id && !seen.has(rec.id)) ? rec.id : uid();
      seen.add(fixed.id);
      fixed.created = typeof rec.created === 'string' ? rec.created : '';
      if (rec.demo === true) fixed.demo = true;
      if (key === 'harvest') fixed.calculated = (rec.calculated === 'production' || rec.calculated === 'avgWeight') ? rec.calculated : '';
      out[key].push(fixed);
    });
  });

  // Farm limits
  const L = data.settings && data.settings.limits;
  if (L && typeof L === 'object') {
    ['Shrimp', 'Fish'].forEach(function (sp) {
      WATER_PARAMS.forEach(function (p) {
        const lim = L[sp] && L[sp][p.key];
        if (!lim) return;
        const min = lim.min, max = lim.max;
        const okNum = function (n) { return n === undefined || n === null || (typeof n === 'number' && Number.isFinite(n) && n >= 0); };
        if (!okNum(min) || !okNum(max) || (typeof min === 'number' && typeof max === 'number' && min > max)) { note('Farm limits for ' + sp + ' ' + p.label + ' are not valid.'); return; }
        const slot = {};
        if (typeof min === 'number') slot.min = min;
        if (typeof max === 'number') slot.max = max;
        out.settings.limits[sp][p.key] = slot;
      });
    });
  }
  return { ok: errors.length === 0, errors: errors, data: out };
}

async function restoreFromText(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { toast('That is not a readable backup. The text is not valid JSON.', 'error'); return; }
  const res = validateBackup(obj);
  if (!res.ok) {
    openModal({
      title: 'Backup cannot be restored',
      html: '<p>Nothing was changed. The backup has these problems:</p><ul class="error-list">' + res.errors.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') +
        '</ul><div class="form-actions"><button type="button" class="btn btn-primary" data-modal-close>Close</button></div>'
    });
    return;
  }
  const incoming = COLLECTIONS.map(function (k) { return res.data[k].length + ' ' + MODS[k].title.toLowerCase(); }).join(', ');
  const current = COLLECTIONS.reduce(function (n, k) { return n + DB[k].length; }, 0);
  const ok = await confirmDialog({
    title: 'Replace all current data?',
    message: 'The backup contains: ' + incoming + '.\n\nYour current data (' + current + ' records in total) will be REPLACED. This cannot be undone. If you are not sure, cancel and download a backup of the current data first.',
    confirmText: 'Replace my data', danger: true
  });
  if (!ok) return;
  res.data.meta.lastBackup = DB.meta.lastBackup;
  DB = res.data;
  if (saveDB()) toast('Backup restored.');
  render();
}

/* Optional demo data. Clearly named “Demo” and removable. */
function loadDemoData() {
  if (getTank('DEMO-01') || getTank('DEMO-02')) { toast('Demo data is already loaded.', 'warn'); return; }
  const d = function (n) { return addDays(todayStr(), -n); };
  const base = function (o) { return Object.assign({ id: uid(), created: new Date().toISOString(), demo: true }, o); };
  DB.tanks.push(base({ tankId: 'DEMO-01', name: 'Demo shrimp tank', capacity: 200, capacityUnit: 'm³', location: 'Demo area', species: 'Shrimp', status: 'Active' }));
  DB.tanks.push(base({ tankId: 'DEMO-02', name: 'Demo fish tank', capacity: 150, capacityUnit: 'm³', location: 'Demo area', species: 'Fish', status: 'Active' }));
  DB.stocking.push(base({ date: d(12), tankId: 'DEMO-01', seedType: 'Demo PL12', quantity: 100000, supplier: 'Demo supplier', avgSize: '2 g', remarks: 'Demo record' }));
  DB.stocking.push(base({ date: d(12), tankId: 'DEMO-02', seedType: 'Demo fingerlings', quantity: 5000, supplier: 'Demo supplier', avgSize: '5 g', remarks: 'Demo record' }));
  for (let i = 4; i >= 0; i--) {
    DB.feed.push(base({ date: d(i), tankId: 'DEMO-01', feedType: 'Demo starter feed', quantity: 8 + (4 - i), feedTime: '08:00' }));
    DB.feed.push(base({ date: d(i), tankId: 'DEMO-02', feedType: 'Demo grower feed', quantity: 12 + (4 - i), feedTime: '09:00' }));
    DB.water.push(base({ dateTime: d(i) + 'T07:30', tankId: 'DEMO-01', ph: round(7.8 + i * 0.1, 2), temp: 28 + (i % 2), dox: round(5.5 - i * 0.2, 1), salinity: 15, ammonia: round(0.1 + i * 0.05, 2) }));
    DB.water.push(base({ dateTime: d(i) + 'T07:45', tankId: 'DEMO-02', ph: round(7.2 + i * 0.1, 2), temp: 26 + (i % 2), dox: round(6.5 - i * 0.2, 1), salinity: 0.5, ammonia: round(0.05 + i * 0.02, 2) }));
  }
  DB.medication.push(base({ date: d(4), tankId: 'DEMO-01', medName: 'Demo probiotic', quantity: 2, unit: 'kg', purpose: 'Demo entry', appliedBy: 'Demo user', remarks: '' }));
  DB.mortality.push(base({ date: d(3), tankId: 'DEMO-01', dead: 150, reason: 'Unknown', remarks: 'Demo record' }));
  DB.mortality.push(base({ date: d(2), tankId: 'DEMO-02', dead: 20, reason: 'Handling or stress', remarks: 'Demo record' }));
  DB.harvest.push(base({ date: d(1), tankId: 'DEMO-02', count: 200, avgWeight: 450, production: 90, calculated: '' }));
  if (saveDB()) toast('Demo data loaded. Remove it before you enter real records.');
  render({ keep: true });
}

async function removeDemoData() {
  const demoTanks = DB.tanks.filter(function (t) { return t.demo; }).map(function (t) { return t.tankId; });
  if (!demoTanks.length && !COLLECTIONS.some(function (c) { return DB[c].some(function (r) { return r.demo; }); })) { toast('There is no demo data to remove.', 'warn'); return; }
  const ok = await confirmDialog({
    title: 'Remove demo data?',
    message: 'This deletes the demo tanks and every record marked as demo, plus any records you added to the demo tanks (' + demoTanks.join(', ') + '). Your other records are not touched.',
    confirmText: 'Remove demo data', danger: true
  });
  if (!ok) return;
  COLLECTIONS.forEach(function (c) {
    DB[c] = DB[c].filter(function (r) { return !r.demo && demoTanks.indexOf(r.tankId) === -1; });
  });
  if (saveDB()) toast('Demo data removed.');
  render({ keep: true });
}

function pageBackup(el) {
  const kb = (JSON.stringify(DB).length / 1024).toFixed(1);
  const last = DB.meta.lastBackup ? new Date(DB.meta.lastBackup).toLocaleString() : 'Never';
  const hasDemo = DB.tanks.some(function (t) { return t.demo; });
  el.innerHTML = '<div class="page-head"><div><h1 id="page-title" tabindex="-1">💾 Data Backup</h1><p class="lead">Download, restore and manage your saved records.</p></div></div>' +
    storageNotice() +
    '<section class="card"><h2>What is saved here</h2><div class="table-wrap"><table><thead><tr><th scope="col">Records</th><th scope="col" class="num">Count</th></tr></thead><tbody>' +
    COLLECTIONS.map(function (k) { return '<tr><td>' + esc(MODS[k].title) + '</td><td class="num">' + fmt(DB[k].length, 0) + '</td></tr>'; }).join('') +
    '</tbody></table></div><p class="muted small">Approximate size: ' + kb + ' KB · Last backup downloaded: ' + esc(last) + '</p></section>' +
    '<section class="card"><h2>Download a backup</h2><p>Saves all tanks, records and farm limits as one JSON file.</p>' +
    '<div class="form-actions left"><button type="button" class="btn btn-primary" id="bk-download">Download backup file</button>' +
    '<button type="button" class="btn" id="bk-show">Show backup as text</button></div>' +
    '<p class="muted small">If your coding site blocks downloads, use “Show backup as text”, then copy the text and keep it in a Notes or Files app.</p>' +
    '<div id="bk-text-wrap" hidden><label for="bk-text" class="sr-only">Backup text</label><textarea id="bk-text" rows="6" readonly></textarea></div></section>' +
    '<section class="card"><h2>Restore from a backup</h2><p>Choose a backup file, or paste backup text. The backup is checked first, and you must confirm before your current data is replaced.</p>' +
    '<div class="field"><label for="bk-file">Backup file (.json)</label><input type="file" id="bk-file" accept=".json,application/json"></div>' +
    '<div class="field"><label for="bk-paste">Or paste backup text</label><textarea id="bk-paste" rows="4" placeholder="Paste the backup text here"></textarea></div>' +
    '<div class="form-actions left"><button type="button" class="btn btn-primary" id="bk-restore">Check and restore</button></div></section>' +
    '<section class="card"><h2>Sync between devices</h2><p id="sync-detail">' + (SYNC.db
      ? 'Status: <strong>' + esc(SYNC.state === 'synced' ? 'connected and synced' : SYNC.state === 'saving' ? 'connecting or saving…' : 'connected, with a problem') + '</strong>. The shared database holds ' + fmt(SYNC.remote.size, 0) + ' group(s) of records.'
      : (firebaseConfigured()
        ? 'Status: <strong>not connected</strong>. Open the menu and tap <strong>Sign in to sync</strong>.'
        : 'Status: <strong>not connected</strong>. To share records, either open AquaFarm from your Claude link while signed in to Claude, or set up Firebase (see FIREBASE-SETUP.md). This copy saves on this device only.')) + '</p>' +
    '<div class="form-actions left"><button type="button" class="btn" id="bk-sync-up"' + (SYNC.db ? '' : ' disabled') + '>Upload this device’s records now</button>' +
    '<button type="button" class="btn" id="bk-sync-down"' + (SYNC.db ? '' : ' disabled') + '>Load shared records onto this device</button></div></section>' +
    '<section class="card"><h2>Optional demo data</h2><p>Add two clearly labelled demo tanks (DEMO-01 and DEMO-02) with sample records, so you can try every page. ' +
    'Demo data is not real. Remove it before real record keeping.</p><div class="form-actions left">' +
    '<button type="button" class="btn" id="bk-demo">Load demo data</button>' + (hasDemo ? '<button type="button" class="btn" id="bk-demo-remove">Remove demo data</button>' : '') + '</div></section>' +
    '<section class="card danger-zone"><h2>Erase all data</h2><p>Deletes every tank, record and setting from this browser. Download a backup first.</p>' +
    '<div class="form-actions left"><button type="button" class="btn btn-danger" id="bk-erase">Erase all data</button></div></section>';

  $('#bk-download', el).addEventListener('click', function () {
    downloadFile('aquafarm-backup-' + todayStr() + '.json', JSON.stringify(backupPayload(), null, 2), 'application/json');
    DB.meta.lastBackup = new Date().toISOString();
    saveDB();
    toast('Backup file ready. Confirm the save if asked, and keep it somewhere safe.');
    render({ keep: true });
  });
  $('#bk-show', el).addEventListener('click', function () {
    const box = $('#bk-text', el);
    box.value = JSON.stringify(backupPayload(), null, 2);
    $('#bk-text-wrap', el).hidden = false;
    box.focus();
    box.select();
    DB.meta.lastBackup = new Date().toISOString();
    saveDB();
  });
  $('#bk-restore', el).addEventListener('click', function () {
    const file = $('#bk-file', el).files[0];
    const pasted = $('#bk-paste', el).value.trim();
    if (file) {
      const reader = new FileReader();
      reader.onload = function () { restoreFromText(String(reader.result)); };
      reader.onerror = function () { toast('The file could not be read.', 'error'); };
      reader.readAsText(file);
    } else if (pasted) {
      restoreFromText(pasted);
    } else {
      toast('Choose a backup file or paste backup text first.', 'warn');
    }
  });
  $('#bk-sync-up', el).addEventListener('click', async function () {
    const ok = await confirmDialog({ title: 'Upload this device’s records?', message: 'The shared database will be made to match the records on this device. Records that exist only in the shared database will be deleted.', confirmText: 'Upload', danger: true });
    if (!ok) return;
    SYNC.ready = true;
    await pushNow();
    toast(SYNC.state === 'synced' ? 'Uploaded. Other devices will now show these records.' : 'Upload did not finish. See the message above.', SYNC.state === 'synced' ? 'ok' : 'error');
    render({ keep: true });
  });
  $('#bk-sync-down', el).addEventListener('click', async function () {
    if (!SYNC.remote.size) { toast('The shared database is empty, so there is nothing to load.', 'warn'); return; }
    const ok = await confirmDialog({ title: 'Load shared records?', message: 'Records on this device will be replaced by the records in the shared database.', confirmText: 'Load shared records', danger: true });
    if (!ok) return;
    SYNC.ready = true;
    applyRemote(SYNC.remote);
    toast('Shared records loaded onto this device.');
  });
  $('#bk-demo', el).addEventListener('click', loadDemoData);
  if (hasDemo) $('#bk-demo-remove', el).addEventListener('click', removeDemoData);
  $('#bk-erase', el).addEventListener('click', async function () {
    const ok = await confirmDialog({
      title: 'Erase all data?', message: 'Every tank, record and setting in this browser will be permanently deleted. This cannot be undone.',
      confirmText: 'Erase everything', danger: true, requireText: 'ERASE'
    });
    if (!ok) return;
    DB = emptyDB();
    if (saveDB()) toast('All data erased.');
    render();
  });
}

/* =====================================================================
   12. NAVIGATION AND START-UP
   Pages change by changing the part of the address after # (no reload).
   ===================================================================== */
/* ---------- Theme: Auto (follows the device), Light or Dark ---------- */
const THEME_KEY = 'aquafarm.theme';
const hostTheme = document.documentElement.getAttribute('data-theme');   // set by the page hosting the app, if any

function getSavedTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch (e) { return 'auto'; }
}

function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'auto') {
    if (hostTheme) root.setAttribute('data-theme', hostTheme); else root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', mode);
  }
  document.querySelectorAll('[data-theme-choice]').forEach(function (b) {
    b.setAttribute('aria-pressed', String(b.dataset.themeChoice === mode));
  });
  const deviceDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const dark = mode === 'dark' || (mode === 'auto' && (hostTheme ? hostTheme === 'dark' : deviceDark));
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#071f30' : '#0a2e45');
}

function setTheme(mode) {
  try {
    if (mode === 'auto') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, mode);
  } catch (e) { /* the theme still changes for this visit */ }
  applyTheme(mode);
}

function openNav() {
  document.body.classList.add('nav-open');
  const b = $('.menu-btn');
  if (b) b.setAttribute('aria-expanded', 'true');
}
function closeNav() {
  document.body.classList.remove('nav-open');
  const b = $('.menu-btn');
  if (b) b.setAttribute('aria-expanded', 'false');
}

function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

/* Draw the page for the current address. opts.keep = stay at the same scroll position. */
function render(opts) {
  opts = opts || {};
  const view = $('#view');
  const parts = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/').map(safeDecode);
  const scrollY = window.scrollY;
  let navKey = parts[0];
  try {
    if (parts[0] === 'tank') { pageTankDetails(view, parts[1] || '', parts[2] || 'overview'); navKey = 'tanks'; }
    else if (parts[0] === 'reports') pageReports(view, parts[1]);
    else if (parts[0] === 'backup') pageBackup(view);
    else if (parts[0] === 'tanks') pageTanks(view);
    else if (MODS[parts[0]] && MODS[parts[0]].route) pageModule(view, parts[0]);
    else { navKey = 'dashboard'; pageDashboard(view); }
  } catch (err) {
    console.error(err);
    view.innerHTML = '<div class="card"><h1 id="page-title" tabindex="-1">Something went wrong</h1><p>This page could not be shown (' + esc(err.message) + '). Your saved data has not been changed.</p><a class="btn btn-primary" href="#/dashboard">Go to Dashboard</a></div>';
  }
  document.querySelectorAll('.nav a').forEach(function (a) {
    if (a.dataset.route === navKey) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const h1 = $('#page-title');
  document.title = (h1 ? h1.textContent.trim() : 'AquaFarm') + ' – AquaFarm';
  if (opts.keep) window.scrollTo(0, scrollY);
  else { window.scrollTo(0, 0); if (h1) h1.focus({ preventScroll: true }); }
}

/* One click handler for every button that has a data-action. */
document.addEventListener('click', function (e) {
  if (e.target.closest('[data-modal-close]')) { closeModal(); return; }
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const id = t.dataset.id;
  const mod = t.dataset.mod;
  switch (t.dataset.action) {
    case 'nav-toggle': if (document.body.classList.contains('nav-open')) closeNav(); else openNav(); break;
    case 'nav-close': closeNav(); break;
    case 'theme': setTheme(t.dataset.mode); break;
    case 'fb-login': showLogin(); break;
    case 'fb-signout': signOutFirebase(); break;
    case 'add': openRecordForm(mod, null, t.dataset.tank ? { tankId: t.dataset.tank } : {}); break;
    case 'view': viewRecord(mod, id); break;
    case 'edit': openRecordForm(mod, id); break;
    case 'delete': deleteRecord(mod, id); break;
    case 'open-tank': location.hash = '#/tank/' + encodeURIComponent(id); break;
    case 'tank-toggle': toggleTank(id); break;
    case 'tank-delete': deleteTank(id); break;
  }
});

window.addEventListener('hashchange', function () { closeModal(); closeNav(); render(); });

/* =====================================================================
   13. SYNC (shared database)
   When this page is opened from its Claude link, records are also kept in a
   shared database, so every device you sign in on sees the same data.
   Anywhere else (a normal website, an online editor) this stays switched
   off and records are saved on this device only.
   Records are grouped into small "shards" (one per table, tank and month)
   so each stored document stays well under the size limit.
   ===================================================================== */
const SYNC = { unsub: null, db: null, ready: false, pushing: false, again: false, pushTimer: null, remote: new Map(), state: 'off' };

function setSyncStatus(state, text) {
  SYNC.state = state;
  const el = document.getElementById('sync-status');
  if (el) { el.textContent = text; el.setAttribute('data-state', state); }
}

function storageNotice() {
  if (SYNC.db && FB.user) {
    return '<div class="notice"><strong>Sync is on</strong> (signed in as ' + esc(FB.user.email) + '). Your records are kept in the shared online database and also on this device. Everyone on the farm’s member list sees the same records and can change them. A backup is still a good idea.</div>';
  }
  if (SYNC.db) {
    return '<div class="notice"><strong>Sync is on.</strong> Your records are kept in the shared AquaFarm database and also on this device, so they appear on every device where you open this page signed in to Claude. Only you, and people you invite as editors, can change them. A backup is still a good idea.</div>';
  }
  return '<div class="notice warn"><strong>Please read:</strong> this version saves records only in this browser, on this device (browser storage called localStorage). ' +
    'It is not a shared database, it does not sync between devices, and it does not support several users. Records can be lost if you clear website data, use Private Browsing, or switch browser or device. ' +
    'Download a backup regularly.</div>';
}

/* Same text every time, whatever order the keys came back in. */
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  return JSON.stringify(v);
}

/* Split all records into shards: id -> text. Empty groups are left out. */
function shardsOf(data) {
  const groups = new Map();
  COLLECTIONS.forEach(function (c) {
    (data[c] || []).forEach(function (r) {
      const id = c === 'tanks' ? 'tanks' : c + ':' + r.tankId + ':' + String(r.date || r.dateTime || 'none').slice(0, 7);
      if (!groups.has(id)) groups.set(id, { c: c, items: [] });
      groups.get(id).items.push(r);
    });
  });
  const out = new Map();
  groups.forEach(function (g, id) { out.set(id, canon(g)); });
  const L = data.settings && data.settings.limits;
  if (L && (Object.keys(L.Shrimp || {}).length || Object.keys(L.Fish || {}).length)) out.set('settings', canon({ c: 'settings', limits: L }));
  return out;
}

function sameShards(a, b) {
  if (a.size !== b.size) return false;
  let same = true;
  a.forEach(function (v, k) { if (b.get(k) !== v) same = false; });
  return same;
}

function dbFromShards(remote) {
  const db = emptyDB();
  remote.forEach(function (json) {
    const d = JSON.parse(json);
    if (d.c === 'settings' && d.limits) db.settings.limits = { Shrimp: d.limits.Shrimp || {}, Fish: d.limits.Fish || {} };
    else if (COLLECTIONS.indexOf(d.c) !== -1 && Array.isArray(d.items)) db[d.c] = db[d.c].concat(d.items);
  });
  db.meta = DB.meta;
  return db;
}

/* Save changes to the shared database a moment after the last edit. */
function schedulePush() {
  if (!SYNC.db || !SYNC.ready) return;
  setSyncStatus('saving', '☁️ Saving…');
  clearTimeout(SYNC.pushTimer);
  SYNC.pushTimer = setTimeout(pushNow, 500);
}

async function pushNow() {
  SYNC.pushTimer = null;
  if (SYNC.pushing) { SYNC.again = true; return; }
  SYNC.pushing = true;
  try {
    do {
      SYNC.again = false;
      const local = shardsOf(DB);
      const col = SYNC.db.collection('farm');
      for (const entry of Array.from(local.entries())) {
        if (SYNC.remote.get(entry[0]) !== entry[1]) { await col.doc(entry[0]).set(JSON.parse(entry[1])); SYNC.remote.set(entry[0], entry[1]); }
      }
      for (const id of Array.from(SYNC.remote.keys())) {
        if (!local.has(id)) { await col.doc(id).delete(); SYNC.remote.delete(id); }
      }
    } while (SYNC.again);
    setSyncStatus('synced', '☁️ Synced');
  } catch (e) {
    setSyncStatus('error', '⚠️ Not synced');
    toast(e && e.code === 'quota_exceeded'
      ? 'The shared database is full, so the latest change is saved on this device only. Download a backup.'
      : 'Could not reach the shared database. Your change is saved on this device and will sync on the next save.', 'error');
  } finally {
    SYNC.pushing = false;
  }
}

function applyRemote(remote) {
  DB = dbFromShards(remote);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(DB)); } catch (e) { /* ignore */ }
  render({ keep: true });
}

async function firstSync(remote) {
  const local = shardsOf(DB);
  SYNC.remote = remote;
  if (remote.size === 0 && local.size > 0) {
    SYNC.ready = true;
    await pushNow();
    toast('Your records from this device were uploaded to the shared database.');
  } else if (remote.size > 0 && local.size === 0) {
    SYNC.ready = true;
    applyRemote(remote);
    setSyncStatus('synced', '☁️ Synced');
  } else if (remote.size > 0 && !sameShards(local, remote)) {
    const useShared = await confirmDialog({
      title: 'Two different sets of records found',
      message: 'The shared database already has records, and this device has different records.\n\nUse the shared records? Records on this device will be replaced.',
      confirmText: 'Use shared records'
    });
    if (useShared) {
      SYNC.ready = true;
      applyRemote(remote);
      setSyncStatus('synced', '☁️ Synced');
    } else {
      const overwrite = await confirmDialog({
        title: 'Replace the shared records?',
        message: 'This will delete the shared records and replace them with the records on this device.',
        confirmText: 'Replace shared records', danger: true
      });
      if (overwrite) { SYNC.ready = true; await pushNow(); }
      else { SYNC.db = null; setSyncStatus('off', '💾 Sync paused – saved on this device only'); }
    }
  } else {
    SYNC.ready = true;
    setSyncStatus('synced', '☁️ Synced');
  }
}

function onRemote(snap) {
  const remote = new Map();
  snap.docs.forEach(function (d) { if (d.exists) remote.set(d.id, canon(d.data())); });
  if (!SYNC.ready) {
    if (snap.metadata.fromCache) return;   // wait for the definitive answer from the server
    if (SYNC.starting) return;
    SYNC.starting = true;
    firstSync(remote).then(function () { SYNC.starting = false; });
    return;
  }
  if (snap.metadata.hasPendingWrites || SYNC.pushing || SYNC.pushTimer) return;   // our own change is still being saved
  SYNC.remote = remote;
  if (!sameShards(shardsOf(DB), remote)) applyRemote(remote);
  setSyncStatus('synced', '☁️ Synced');
}

function startSync() {
  if (typeof window === 'undefined' || !window.claude || typeof window.claude.use !== 'function') {
    if (firebaseConfigured()) { startFirebase(); return; }
    setSyncStatus('off', '💾 Saved on this device only');
    return;
  }
  setSyncStatus('saving', '☁️ Connecting…');
  window.claude.use('db').then(function (db) {
    if (!db) { setSyncStatus('error', '⚠️ Sync unavailable. Sign in to Claude and open your Claude link.'); return; }
    SYNC.db = db;
    SYNC.unsub = db.collection('farm').onSnapshot(onRemote, function () {
      SYNC.db = null;
      setSyncStatus('error', '⚠️ Sync stopped – saved on this device');
    });
  }).catch(function () { setSyncStatus('error', '⚠️ Sync unavailable on this device'); });
}

/* ---------- Firebase (optional): shared online database with logins ----------
   Switched on only when firebase-config.js has real values (see FIREBASE-SETUP.md). */
const FB = { user: null, auth: null, authMod: null, adapter: null, started: false };
const FIREBASE_VERSION = '10.14.1';

function firebaseConfigured() {
  const c = typeof window !== 'undefined' ? window.AQUAFARM_FIREBASE : null;
  return !!(c && c.apiKey && c.projectId && !/^PASTE/.test(c.apiKey) && !/^PASTE/.test(c.projectId));
}

/* Makes Firestore look like the small database interface used by the sync code above. */
function makeFirestoreAdapter(fs, fdb) {
  return {
    collection: function (name) {
      const col = fs.collection(fdb, name);
      return {
        onSnapshot: function (next, error) {
          return fs.onSnapshot(col, { includeMetadataChanges: true }, function (snap) {
            next({
              docs: snap.docs.map(function (d) { return { id: d.id, exists: true, data: function () { return d.data(); } }; }),
              metadata: { fromCache: snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites }
            });
          }, error);
        },
        doc: function (id) {
          const ref = fs.doc(fdb, name, id);
          return { set: function (d) { return fs.setDoc(ref, d); }, delete: function () { return fs.deleteDoc(ref); } };
        }
      };
    }
  };
}

async function startFirebase() {
  if (FB.started) return;
  FB.started = true;
  setSyncStatus('saving', '☁️ Connecting…');
  try {
    const base = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VERSION + '/';
    const appMod = await import(base + 'firebase-app.js');
    const authMod = await import(base + 'firebase-auth.js');
    const fsMod = await import(base + 'firebase-firestore.js');
    const app = appMod.initializeApp(window.AQUAFARM_FIREBASE);
    FB.authMod = authMod;
    FB.auth = authMod.getAuth(app);
    let fdb;
    try { fdb = fsMod.initializeFirestore(app, { localCache: fsMod.persistentLocalCache() }); }
    catch (e) { fdb = fsMod.getFirestore(app); }
    FB.adapter = makeFirestoreAdapter(fsMod, fdb);
    authMod.onAuthStateChanged(FB.auth, onFirebaseUser);
  } catch (e) {
    FB.started = false;
    setSyncStatus('error', '⚠️ Could not connect. Check your internet.');
  }
}

function renderAccount() {
  const el = document.getElementById('sync-account');
  if (!el || !firebaseConfigured()) return;
  el.innerHTML = FB.user
    ? 'Signed in as ' + esc(FB.user.email) + '<br><button type="button" data-action="fb-signout">Sign out</button>'
    : '<button type="button" data-action="fb-login">Sign in to sync</button>';
}

function onFirebaseUser(user) {
  FB.user = user;
  renderAccount();
  if (SYNC.unsub) { try { SYNC.unsub(); } catch (e) { /* ignore */ } SYNC.unsub = null; }
  SYNC.ready = false; SYNC.starting = false; SYNC.remote = new Map();
  if (!user) {
    SYNC.db = null;
    setSyncStatus('off', '🔒 Signed out – saved on this device only');
    showLogin();
    return;
  }
  closeModal();
  SYNC.db = FB.adapter;
  setSyncStatus('saving', '☁️ Connecting…');
  SYNC.unsub = SYNC.db.collection('farm').onSnapshot(onRemote, function (e) {
    SYNC.db = null;
    if (e && e.code === 'permission-denied') {
      setSyncStatus('error', '⚠️ Not allowed – your email is not on the member list');
      toast('This email is not on the farm’s member list. Ask the owner to add it (see FIREBASE-SETUP.md).', 'error');
    } else {
      setSyncStatus('error', '⚠️ Sync stopped – saved on this device');
    }
  });
}

function signInMessage(e) {
  const code = e && e.code ? e.code : '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(code)) return 'The email or password is not correct.';
  if (code === 'auth/invalid-email') return 'Enter a valid email address.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a few minutes and try again.';
  if (code === 'auth/network-request-failed') return 'No internet connection. Try again when you are online.';
  return 'Could not sign in (' + (code || 'unknown error') + ').';
}

function showLogin() {
  if (!FB.authMod) return;
  const root = openModal({
    title: 'Sign in to sync',
    html: '<p class="muted">Use the email and password the farm owner created for you. Your records keep working on this device if you skip this.</p>' +
      '<div class="field"><label for="fb-email">Email</label><input type="email" id="fb-email" autocomplete="username" autocapitalize="none" autocorrect="off" inputmode="email"></div>' +
      '<div class="field"><label for="fb-pass">Password</label><input type="password" id="fb-pass" autocomplete="current-password"></div>' +
      '<p class="field-error" id="fb-error" role="alert"></p>' +
      '<div class="form-actions"><button type="button" class="btn" data-modal-close>Not now</button><button type="button" class="btn btn-primary" id="fb-signin">Sign in</button></div>'
  });
  async function go() {
    const email = $('#fb-email', root).value.trim();
    const pass = $('#fb-pass', root).value;
    const err = $('#fb-error', root);
    if (!email || !pass) { err.textContent = 'Enter your email and password.'; return; }
    err.textContent = '';
    $('#fb-signin', root).disabled = true;
    try { await FB.authMod.signInWithEmailAndPassword(FB.auth, email, pass); }
    catch (e) { err.textContent = signInMessage(e); const b = $('#fb-signin', root); if (b) b.disabled = false; }
  }
  $('#fb-signin', root).addEventListener('click', go);
  $('#fb-pass', root).addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
}

function signOutFirebase() {
  if (FB.authMod && FB.auth) FB.authMod.signOut(FB.auth);
}

/* Start the app. */
applyTheme(getSavedTheme());
render();
startSync();
if (!storageWorks) toast('This browser is not allowing saving (Private Browsing?). Records will be lost when you close the page.', 'error');
if (loadProblem) toast(loadProblem, 'error');

/* Offline support: when the app is hosted on a website (https), save it so it opens without internet. */
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol || '')) {
  window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* not available here */ }); });
}
