
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const statusEl = document.getElementById('status');

const resultsSection = document.getElementById('results-section');
const resultsList = document.getElementById('results-list');
const resultsCount = document.getElementById('results-count');
const filterInput = document.getElementById('filter-input');
const sortSelect = document.getElementById('sort-select');

const detailSection = document.getElementById('detail-section');


let currentResults = [];

let currentPage = 1;
const PAGE_SIZE = 15;


const OPENFDA_URL = 'https://api.fda.gov/drug/label.json';


const CORS_PROXY = 'https://corsproxy.io/?url=';


async function fetchWithFallback(url) {
  try {
    const direct = await fetch(url);
  
    if (direct.ok || direct.status === 404) return direct;
    throw new Error(`Direct request failed with status ${direct.status}`);
  } catch (directErr) {
    console.warn('Direct openFDA request failed, retrying via proxy:', directErr.message);
    const proxied = await fetch(CORS_PROXY + encodeURIComponent(url));
    return proxied;
  }
}


searchForm.addEventListener('submit', async (event) => {
  event.preventDefault(); // stop the page from reloading
  const term = searchInput.value.trim();
  if (!term) return;
  await searchDrugs(term);
});

async function searchDrugs(term) {
  
  detailSection.classList.add('hidden');
  resultsSection.classList.add('hidden');
  filterInput.value = '';
  setStatus(`Searching for "${term}"…`);

 
  const query = `(openfda.brand_name:${term}* OR openfda.generic_name:${term}*)`;
  const url = `${OPENFDA_URL}?search=${encodeURIComponent(query)}&limit=15`;

  try {
    const response = await fetchWithFallback(url);

    if (response.status === 404) {
      currentResults = [];
      setStatus(`No results found for "${term}". Try a different spelling or a generic name.`);
      return;
    }

    if (!response.ok) {
      
      throw new Error(`openFDA returned status ${response.status}`);
    }

    const data = await response.json();
    currentResults = data.results || [];

    if (currentResults.length === 0) {
      setStatus(`No results found for "${term}".`);
      return;
    }

    clearStatus();
    sortSelect.value = 'az'; 
    currentPage = 1;
    applyFilterAndSort();
  } catch (err) {
    
    console.error('MedLookup search failed:', err);
    setStatus('Could not reach the FDA database directly or via the fallback proxy. Please check your connection and try again.', true);
  }
}


function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}
function clearStatus() {
  statusEl.textContent = '';
  statusEl.classList.remove('error');
}


function renderResultsList(results) {
  resultsSection.classList.remove('hidden');
  resultsCount.textContent = `${results.length} result${results.length === 1 ? '' : 's'}`;

  
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


function displayName(drug) {
  const brand = firstOrFallback(drug.openfda?.brand_name, null);
  const generic = firstOrFallback(drug.openfda?.generic_name, null);
  return brand || generic || 'Unknown medicine';
}


function renderDetail(drug) {
  resultsSection.classList.add('hidden');
  detailSection.classList.remove('hidden');

  const brand = firstOrFallback(drug.openfda?.brand_name, 'Unknown medicine');
  const generic = firstOrFallback(drug.openfda?.generic_name, null);
  const name = displayName(drug);

  
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

 
  detailSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


function labelField(title, content, isWarning = false) {
  if (!content) return '';
  return `
    <div class="label-field${isWarning ? ' warning' : ''}">
      <h3>${escapeHtml(title.replace('&amp;', '&'))}</h3>
      <p>${escapeHtml(content)}</p>
    </div>
  `;
}


function firstOrFallback(arr, fallback) {
  if (Array.isArray(arr) && arr.length > 0 && arr[0]) return arr[0];
  return fallback;
}


function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}