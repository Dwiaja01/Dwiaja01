const DEFAULT_IDS = [
  'dogecoin',
  'shiba-inu',
  'pepe',
  'dogwifcoin',
  'bonk',
  'floki',
  'book-of-meme',
  'popcat',
  'mog-coin',
  'cat-in-a-dogs-world',
  'brett',
  'turbo'
];

const STORAGE_KEYS = {
  coinIds: 'meme-monitor:coin-ids',
  watchlist: 'meme-monitor:watchlist',
  alerts: 'meme-monitor:alerts'
};

const state = {
  coins: [],
  timer: null,
  watchlist: readJson(STORAGE_KEYS.watchlist, []),
  alerts: readJson(STORAGE_KEYS.alerts, {}),
  lastAlertHit: new Map()
};

const elements = {
  coinIds: document.querySelector('#coinIds'),
  refreshButton: document.querySelector('#refreshButton'),
  refreshInterval: document.querySelector('#refreshInterval'),
  sortSelect: document.querySelector('#sortSelect'),
  searchInput: document.querySelector('#searchInput'),
  searchResults: document.querySelector('#searchResults'),
  connectionStatus: document.querySelector('#connectionStatus'),
  tableBody: document.querySelector('#coinTableBody'),
  totalMarketCap: document.querySelector('#totalMarketCap'),
  totalVolume: document.querySelector('#totalVolume'),
  gainersCount: document.querySelector('#gainersCount'),
  lastRefresh: document.querySelector('#lastRefresh'),
  marketCanvas: document.querySelector('#marketCanvas'),
  alertLog: document.querySelector('#alertLog'),
  clearAlerts: document.querySelector('#clearAlerts')
};

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function formatCurrency(value, compact = false) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: Math.abs(value) < 1 ? 8 : 2
  }).format(value);
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${Number(value).toFixed(2)}%`;
}

function parseIds() {
  return elements.coinIds.value
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter((id) => /^[a-z0-9-]+$/.test(id))
    .slice(0, 40);
}

function setStatus(text, type = '') {
  elements.connectionStatus.textContent = text;
  elements.connectionStatus.className = `status-pill ${type}`.trim();
}

function changeClass(value) {
  if (value > 0) return 'change good';
  if (value < 0) return 'change bad';
  return 'change';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function fetchCoins() {
  const ids = parseIds();
  if (!ids.length) {
    addAlert('Daftar coin kosong. Tambahkan minimal satu ID CoinGecko.');
    return;
  }

  writeJson(STORAGE_KEYS.coinIds, ids);
  setStatus('Mengambil data...', '');
  elements.refreshButton.disabled = true;

  try {
    const params = new URLSearchParams({ ids: ids.join(','), order: elements.sortSelect.value });
    const response = await fetch(`/api/coins?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error || 'Data gagal dimuat.');

    state.coins = payload.data || [];
    renderDashboard(payload.refreshedAt);
    drawMarketCanvas(state.coins);
    checkPriceAlerts(state.coins);
    if (payload.source === 'demo') {
      setStatus(`Mode demo · ${state.coins.length} coin`, 'error');
      addAlert(payload.warning || 'Data live tidak tersedia, menampilkan data demo.');
    } else {
      setStatus(`Online · ${state.coins.length} coin`, 'ok');
    }
  } catch (error) {
    setStatus('Gagal memuat data', 'error');
    addAlert(`Gagal memuat data pasar: ${error.message}`);
    if (!state.coins.length) renderEmpty(error.message);
  } finally {
    elements.refreshButton.disabled = false;
  }
}

function renderDashboard(refreshedAt) {
  const totalMarketCap = state.coins.reduce((sum, coin) => sum + (coin.market_cap || 0), 0);
  const totalVolume = state.coins.reduce((sum, coin) => sum + (coin.total_volume || 0), 0);
  const gainers = state.coins.filter((coin) => (coin.price_change_percentage_24h || 0) > 0).length;

  elements.totalMarketCap.textContent = formatCurrency(totalMarketCap, true);
  elements.totalVolume.textContent = formatCurrency(totalVolume, true);
  elements.gainersCount.textContent = `${gainers}/${state.coins.length}`;
  elements.lastRefresh.textContent = new Date(refreshedAt || Date.now()).toLocaleTimeString('id-ID');

  renderTable();
}

function renderTable() {
  if (!state.coins.length) {
    renderEmpty('Tidak ada coin yang cocok. Periksa kembali ID CoinGecko.');
    return;
  }

  elements.tableBody.innerHTML = state.coins
    .map((coin) => {
      const isWatched = state.watchlist.includes(coin.id);
      const alertValue = state.alerts[coin.id] || '';
      return `
        <tr>
          <td><button class="watch-btn ${isWatched ? 'active' : ''}" data-watch="${coin.id}" aria-label="Toggle watchlist ${escapeHtml(coin.name)}">★</button></td>
          <td>
            <div class="coin-cell">
              <img src="${coin.image}" alt="" loading="lazy" />
              <span class="coin-name">
                <strong>${escapeHtml(coin.name)}</strong>
                <small>${escapeHtml(coin.symbol)}</small>
              </span>
            </div>
          </td>
          <td>${formatCurrency(coin.current_price)}</td>
          <td class="${changeClass(coin.price_change_percentage_1h_in_currency)}">${formatPercent(coin.price_change_percentage_1h_in_currency)}</td>
          <td class="${changeClass(coin.price_change_percentage_24h)}">${formatPercent(coin.price_change_percentage_24h)}</td>
          <td class="${changeClass(coin.price_change_percentage_7d_in_currency)}">${formatPercent(coin.price_change_percentage_7d_in_currency)}</td>
          <td>${formatCurrency(coin.market_cap, true)}</td>
          <td>${formatNumber(coin.total_volume)}</td>
          <td><input class="alert-input" data-alert="${coin.id}" type="number" min="0" step="any" value="${escapeHtml(alertValue)}" placeholder="USD" aria-label="Alert harga ${escapeHtml(coin.name)}" /></td>
        </tr>`;
    })
    .join('');
}

function renderEmpty(message) {
  elements.tableBody.innerHTML = `<tr><td colspan="9" class="empty">${escapeHtml(message)}</td></tr>`;
}

function drawMarketCanvas(coins) {
  const canvas = elements.marketCanvas;
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#160f2c');
  gradient.addColorStop(0.55, '#201235');
  gradient.addColorStop(1, '#0f1d32');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  if (!coins.length) {
    ctx.fillStyle = '#c9bedc';
    ctx.font = '28px sans-serif';
    ctx.fillText('Menunggu data pasar...', 36, 70);
    return;
  }

  const maxMarketCap = Math.max(...coins.map((coin) => coin.market_cap || 1));
  coins.forEach((coin, index) => {
    const change = coin.price_change_percentage_24h || 0;
    const spark = coin.sparkline_in_7d?.price || [];
    const radius = 18 + Math.sqrt((coin.market_cap || 1) / maxMarketCap) * 58;
    const x = 70 + ((index * 97) % (width - 140));
    const y = 75 + ((index * 61) % (height - 150));
    const hue = change >= 0 ? 135 : 342;

    ctx.beginPath();
    ctx.fillStyle = `hsla(${hue}, 88%, 62%, 0.18)`;
    ctx.strokeStyle = `hsla(${hue}, 92%, 70%, 0.72)`;
    ctx.lineWidth = 3;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (spark.length > 2) {
      ctx.beginPath();
      ctx.strokeStyle = `hsla(${hue}, 95%, 78%, 0.82)`;
      ctx.lineWidth = 2;
      const min = Math.min(...spark);
      const max = Math.max(...spark);
      spark.slice(-40).forEach((price, sparkIndex, arr) => {
        const lineX = x - radius + (sparkIndex / Math.max(arr.length - 1, 1)) * radius * 2;
        const lineY = y + radius / 2 - ((price - min) / Math.max(max - min, 0.00000001)) * radius;
        if (sparkIndex === 0) ctx.moveTo(lineX, lineY);
        else ctx.lineTo(lineX, lineY);
      });
      ctx.stroke();
    }

    ctx.fillStyle = '#f8f4ff';
    ctx.font = '700 13px sans-serif';
    ctx.fillText(coin.symbol.toUpperCase(), x - radius / 2, y + 4);
  });
}

function toggleWatch(id) {
  if (state.watchlist.includes(id)) {
    state.watchlist = state.watchlist.filter((coinId) => coinId !== id);
  } else {
    state.watchlist.push(id);
  }
  writeJson(STORAGE_KEYS.watchlist, state.watchlist);
  renderTable();
}

function updateAlert(id, value) {
  if (!value) delete state.alerts[id];
  else state.alerts[id] = value;
  writeJson(STORAGE_KEYS.alerts, state.alerts);
}

function checkPriceAlerts(coins) {
  coins.forEach((coin) => {
    const target = Number(state.alerts[coin.id]);
    if (!target || !coin.current_price) return;
    const crossed = coin.current_price >= target;
    const cooldownKey = `${coin.id}:${target}`;
    const lastHit = state.lastAlertHit.get(cooldownKey) || 0;
    const cooledDown = Date.now() - lastHit > 5 * 60 * 1000;
    if (crossed && cooledDown) {
      addAlert(`<strong>${escapeHtml(coin.name)}</strong> menyentuh ${formatCurrency(coin.current_price)} dan melewati alert ${formatCurrency(target)}.`);
      state.lastAlertHit.set(cooldownKey, Date.now());
    }
  });
}

function addAlert(message) {
  const first = elements.alertLog.querySelector('li');
  if (first && first.textContent.startsWith('Belum ada alert')) elements.alertLog.innerHTML = '';
  const item = document.createElement('li');
  item.innerHTML = `${new Date().toLocaleTimeString('id-ID')} · ${message}`;
  elements.alertLog.prepend(item);
}

function setupAutoRefresh() {
  if (state.timer) clearInterval(state.timer);
  const seconds = Number(elements.refreshInterval.value);
  if (seconds > 0) state.timer = setInterval(fetchCoins, seconds * 1000);
}

async function searchCoins() {
  const query = elements.searchInput.value.trim();
  if (query.length < 2) {
    elements.searchResults.style.display = 'none';
    return;
  }

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Pencarian gagal.');
    elements.searchResults.innerHTML = payload.data
      .map((coin) => `<button type="button" data-add-id="${coin.id}">${escapeHtml(coin.name)} <small>(${escapeHtml(coin.symbol)})</small></button>`)
      .join('');
    elements.searchResults.style.display = payload.data.length ? 'block' : 'none';
  } catch (error) {
    addAlert(`Pencarian gagal: ${error.message}`);
  }
}

function addCoinId(id) {
  const ids = new Set(parseIds());
  ids.add(id);
  elements.coinIds.value = [...ids].join(', ');
  writeJson(STORAGE_KEYS.coinIds, [...ids]);
  elements.searchInput.value = '';
  elements.searchResults.style.display = 'none';
  fetchCoins();
}

function debounce(callback, delay = 350) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => callback(...args), delay);
  };
}

function bindEvents() {
  elements.refreshButton.addEventListener('click', fetchCoins);
  elements.refreshInterval.addEventListener('change', setupAutoRefresh);
  elements.sortSelect.addEventListener('change', fetchCoins);
  elements.coinIds.addEventListener('change', fetchCoins);
  elements.searchInput.addEventListener('input', debounce(searchCoins));
  elements.clearAlerts.addEventListener('click', () => {
    elements.alertLog.innerHTML = '<li>Belum ada alert. Data yang tampil bukan saran finansial.</li>';
  });

  elements.searchResults.addEventListener('click', (event) => {
    const button = event.target.closest('[data-add-id]');
    if (button) addCoinId(button.dataset.addId);
  });

  elements.tableBody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-watch]');
    if (button) toggleWatch(button.dataset.watch);
  });

  elements.tableBody.addEventListener('change', (event) => {
    const input = event.target.closest('[data-alert]');
    if (input) updateAlert(input.dataset.alert, input.value);
  });
}

function init() {
  const storedIds = readJson(STORAGE_KEYS.coinIds, DEFAULT_IDS);
  elements.coinIds.value = storedIds.join(', ');
  bindEvents();
  setupAutoRefresh();
  fetchCoins();
}

init();
