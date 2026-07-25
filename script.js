// =============================================================
// MedLookup — script.js
// Fetches drug label data from the openFDA Drug Label API,
// renders a filterable list of matches, and shows a detailed
// "label card" for whichever drug the user selects.
// =============================================================

// --- Grab references to the DOM elements we'll be updating ---
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const statusEl = document.getElementById('status');

const resultsSection = document.getElementById('results-section');
const resultsList = document.getElementById('results-list');
const resultsCount = document.getElementById('results-count');
const filterInput = document.getElementById('filter-input');
const sortSelect = document.getElementById('sort-select');

const detailSection = document.getElementById('detail-section');

// Keep the last set of fetched results in memory so the filter box
// can re-render the list instantly without hitting the API again.
let currentResults = [];
// How many pages of the (filtered, sorted) list have been revealed so
// far — resets to 1 on every new search.
let currentPage = 1;
const PAGE_SIZE = 15;

// --- Base URL for the openFDA Drug Label endpoint ---
// No API key is required for openFDA at low request volumes, which
// keeps this app simple and avoids exposing any secret in the frontend.
const OPENFDA_URL = 'https://api.fda.gov/drug/label.json';

// Some networks can't reach api.fda.gov directly (regional restrictions
// on U.S. federal API endpoints are a known issue for some countries).
// As a fallback, this proxy fetches the URL server-side and returns the
// raw response, which routes around a block that only applies to the
// browser's own network path.
const CORS_PROXY = 'https://corsproxy.io/?url=';

// Attempts a direct fetch first; if that fails for any reason (network
// error, timeout, blocked request), retries once through the proxy
// before giving up. Returns the parsed Response object either way.
async function fetchWithFallback(url) {
  try {
    const direct = await fetch(url);
    // A 404 is a valid "no results" response from openFDA, not a
    // failure — only retry on network-level errors or 5xx/other status.
    if (direct.ok || direct.status === 404) return direct;
    throw new Error(`Direct request failed with status ${direct.status}`);
  } catch (directErr) {
    console.warn('Direct openFDA request failed, retrying via proxy:', directErr.message);
    const proxied = await fetch(CORS_PROXY + encodeURIComponent(url));
    return proxied;
  }
}

// =============================================================
// SEARCH — triggered when the form is submitted
// =============================================================
searchForm.addEventListener('submit', async (event) => {
  event.preventDefault(); // stop the page from reloading
  const term = searchInput.value.trim();
  if (!term) return;
  await searchDrugs(term);
});

async function searchDrugs(term) {
  // Reset UI state before starting a new search
  detailSection.classList.add('hidden');
  resultsSection.classList.add('hidden');
  filterInput.value = '';
  setStatus(`Searching for "${term}"…`);

  // openFDA uses a Lucene-style query syntax. We search both the brand
  // name and generic name fields, with a wildcard so partial matches
  // like "ibup" still find "ibuprofen".
  const query = `(openfda.brand_name:${term}* OR openfda.generic_name:${term}*)`;
  const url = `${OPENFDA_URL}?search=${encodeURIComponent(query)}&limit=15`;

  try {
    const response = await fetchWithFallback(url);

    // openFDA returns a 404 (not a JSON error body) when there are
    // zero matches, so we handle that status explicitly.
    if (response.status === 404) {
      currentResults = [];
      setStatus(`No results found for "${term}". Try a different spelling or a generic name.`);
      return;
    }

    if (!response.ok) {
      // Any other non-2xx status (rate limit, server error, etc.)
      throw new Error(`openFDA returned status ${response.status}`);
    }

    const data = await response.json();
    currentResults = data.results || [];

    if (currentResults.length === 0) {
      setStatus(`No results found for "${term}".`);
      return;
    }

    clearStatus();
    sortSelect.value = 'az'; // reset to default sort on every new search
    currentPage = 1;
    applyFilterAndSort();
  } catch (err) {
    // Covers network failures (offline, DNS, CORS) and the thrown
    // error above for bad HTTP statuses.
    console.error('MedLookup search failed:', err);
    setStatus('Could not reach the FDA database directly or via the fallback proxy. Please check your connection and try again.', true);
  }
}

// =============================================================
// STATUS MESSAGES (loading / error / empty states)
// =============================================================
function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}
function clearStatus() {
  statusEl.textContent = '';
  statusEl.classList.remove('error');
}

// =============================================================
// RESULTS LIST — clickable matches, filterable by typing
// =============================================================
function renderResultsList(results) {
  resultsSection.classList.remove('hidden');
  resultsCount.textContent = `${results.length} result${results.length === 1 ? '' : 's'}`;

  // Slice to however many pages the user has revealed so far.
  const visibleCount = PAGE_SIZE * currentPage;
  const visible = results.slice(0, visibleCount);

  resultsList.innerHTML = '';
  visible.forEach((drug) => {
    const brand = firstOrFallback(drug.openfda?.brand_name, null);
    const generic = firstOrFallback(drug.openfda?.generic_name, null);
    const name = displayName(drug);
    const subLabel = brand && generic && brand.toLowerCase() !== generic.toLowerCase()
      ? `generic: ${generic}`
      : (drug.openfda?.manufacturer_name?.[0] || '');

    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'result-item';
    item.innerHTML = `
      <div class="name">${escapeHtml(name)}</div>
      <div class="meta">${escapeHtml(subLabel)}</div>
    `;
    item.addEventListener('click', () => renderDetail(drug));
    resultsList.appendChild(item);
  });

  // "Show more" only appears if there's another page's worth left.
  if (results.length > visible.length) {
    const showMoreBtn = document.createElement('button');
    showMoreBtn.type = 'button';
    showMoreBtn.className = 'show-more-button';
    showMoreBtn.textContent = `Show more (${results.length - visible.length} remaining)`;
    showMoreBtn.addEventListener('click', () => {
      currentPage += 1;
      renderResultsList(results);
    });
    resultsList.appendChild(showMoreBtn);
  }
}

// Filtering and sorting both happen entirely client-side against the
// results already in memory — these are the "search/filter/sort the
// returned data" interaction requirements, layered on top of the
// initial API search. Both controls funnel through this one function
// so they always compose correctly (e.g. filter, then sort what's left).
function applyFilterAndSort() {
  const query = filterInput.value.trim().toLowerCase();

  let list = currentResults;
  if (query) {
    list = list.filter((drug) => {
      const brand = (drug.openfda?.brand_name || []).join(' ').toLowerCase();
      const generic = (drug.openfda?.generic_name || []).join(' ').toLowerCase();
      return brand.includes(query) || generic.includes(query);
    });
  }

  // Copy before sorting so we never mutate currentResults itself.
  list = [...list].sort((a, b) => {
    const nameA = displayName(a).toLowerCase();
    const nameB = displayName(b).toLowerCase();
    const cmp = nameA.localeCompare(nameB);
    return sortSelect.value === 'za' ? -cmp : cmp;
  });

  renderResultsList(list);
}

filterInput.addEventListener('input', () => { currentPage = 1; applyFilterAndSort(); });
sortSelect.addEventListener('change', () => { currentPage = 1; applyFilterAndSort(); });

// Shared logic for picking a drug's display name — used by both the
// sort comparator and the results list renderer, so they never disagree.
function displayName(drug) {
  const brand = firstOrFallback(drug.openfda?.brand_name, null);
  const generic = firstOrFallback(drug.openfda?.generic_name, null);
  return brand || generic || 'Unknown medicine';
}

// =============================================================
// DETAIL VIEW — the "label card" for one selected drug
// =============================================================
function renderDetail(drug) {
  resultsSection.classList.add('hidden');
  detailSection.classList.remove('hidden');

  const brand = firstOrFallback(drug.openfda?.brand_name, 'Unknown medicine');
  const generic = firstOrFallback(drug.openfda?.generic_name, null);
  const name = displayName(drug);

  // OTC labels and prescription labels use different field names for
  // largely the same information, so each field below tries the OTC
  // name first and falls back to the prescription-label equivalent.
  const purpose = firstOrFallback(drug.purpose, null) || firstOrFallback(drug.indications_and_usage, null);
  const dosage = firstOrFallback(drug.dosage_and_administration, null);
  const warnings = firstOrFallback(drug.warnings, null) || firstOrFallback(drug.warnings_and_cautions, null);
  const sideEffects = firstOrFallback(drug.adverse_reactions, null);
  const activeIngredient = firstOrFallback(drug.active_ingredient, null);

  detailSection.innerHTML = `
    <button class="back-button" id="back-btn">&larr; Back to results</button>
    <div class="label-card">
      <div class="stamp">Educational use only</div>
      <div class="label-head">
        <h2 class="drug-name">${escapeHtml(brand)}</h2>
        ${generic ? `<div class="generic-name">generic: ${escapeHtml(generic)}</div>` : ''}
      </div>
      <div class="label-body">
        ${labelField('Purpose / Uses', purpose)}
        ${labelField('Active Ingredient', activeIngredient)}
        ${labelField('Dosage &amp; Administration', dosage)}
        ${labelField('Warnings', warnings, true)}
        ${labelField('Side Effects', sideEffects)}
      </div>
    </div>
  `;

  document.getElementById('back-btn').addEventListener('click', () => {
    detailSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');
  });

  // Scroll the label card into view, since on mobile the user may
  // have scrolled down through a long results list before selecting it.
  detailSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Builds one field row on the label card. Returns an empty string
// (renders nothing) if the FDA data simply doesn't include that field,
// which is common — not every label reports every category.
function labelField(title, content, isWarning = false) {
  if (!content) return '';
  return `
    <div class="label-field${isWarning ? ' warning' : ''}">
      <h3>${escapeHtml(title.replace('&amp;', '&'))}</h3>
      <p>${escapeHtml(content)}</p>
    </div>
  `;
}

// =============================================================
// SMALL HELPERS
// =============================================================

// openFDA returns most fields as arrays (e.g. multiple label sections
// concatenated); this grabs the first entry or a fallback value.
function firstOrFallback(arr, fallback) {
  if (Array.isArray(arr) && arr.length > 0 && arr[0]) return arr[0];
  return fallback;
}

// Basic HTML-escaping so drug names/label text from the API can never
// be interpreted as markup (defends against a maliciously crafted
// API response being rendered as live HTML).
function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}