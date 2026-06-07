const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const COINGECKO_HOST = 'api.coingecko.com';
const DEFAULT_MEME_IDS = [
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

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function sanitizeIdList(value) {
  if (!value) return DEFAULT_MEME_IDS;
  const ids = String(value)
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter((id) => /^[a-z0-9-]+$/.test(id));
  return ids.length ? ids.slice(0, 40) : DEFAULT_MEME_IDS;
}


function demoMarkets(ids) {
  const base = {
    'dogecoin': ['Dogecoin', 'doge', 0.18, 26000000000, 1400000000],
    'shiba-inu': ['Shiba Inu', 'shib', 0.000024, 14200000000, 620000000],
    'pepe': ['Pepe', 'pepe', 0.000011, 4700000000, 710000000],
    'dogwifcoin': ['dogwifhat', 'wif', 2.45, 2440000000, 390000000],
    'bonk': ['Bonk', 'bonk', 0.000027, 1900000000, 260000000],
    'floki': ['FLOKI', 'floki', 0.00021, 2010000000, 210000000]
  };

  return ids.map((id, index) => {
    const row = base[id] || [id.replaceAll('-', ' '), id.slice(0, 6), 0.01 + index * 0.007, 100000000 + index * 17000000, 9000000 + index * 2300000];
    const change = Number(((index % 2 === 0 ? 1 : -1) * (2.5 + index * 0.7)).toFixed(2));
    const sparkline = Array.from({ length: 48 }, (_, point) => row[2] * (1 + Math.sin((point + index) / 6) * 0.045 + change / 1000));
    return {
      id,
      name: row[0],
      symbol: row[1],
      image: `https://static.coingecko.com/s/coins/images/1/small/${id}.png`,
      current_price: row[2],
      market_cap: row[3],
      total_volume: row[4],
      price_change_percentage_1h_in_currency: change / 3,
      price_change_percentage_24h: change,
      price_change_percentage_7d_in_currency: change * 1.8,
      sparkline_in_7d: { price: sparkline }
    };
  });
}

function requestCoingecko(pathname, query = {}) {
  const url = new URL(`https://${COINGECKO_HOST}${pathname}`);
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'meme-coin-art-monitor/1.0'
        },
        timeout: 12000
      },
      (apiRes) => {
        let raw = '';
        apiRes.setEncoding('utf8');
        apiRes.on('data', (chunk) => {
          raw += chunk;
        });
        apiRes.on('end', () => {
          if (apiRes.statusCode < 200 || apiRes.statusCode >= 300) {
            reject(new Error(`CoinGecko returned ${apiRes.statusCode}: ${raw.slice(0, 160)}`));
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            reject(new Error(`Could not parse CoinGecko response: ${error.message}`));
          }
        });
      }
    );

    req.on('timeout', () => req.destroy(new Error('CoinGecko request timed out')));
    req.on('error', reject);
    req.end();
  });
}

async function handleApi(reqUrl, res) {
  try {
    if (reqUrl.pathname === '/api/coins') {
      const ids = sanitizeIdList(reqUrl.searchParams.get('ids'));
      try {
        const data = await requestCoingecko('/api/v3/coins/markets', {
          vs_currency: reqUrl.searchParams.get('vs_currency') || 'usd',
          ids: ids.join(','),
          order: reqUrl.searchParams.get('order') || 'market_cap_desc',
          per_page: String(Math.min(Number(reqUrl.searchParams.get('per_page') || ids.length), 100)),
          page: reqUrl.searchParams.get('page') || '1',
          sparkline: 'true',
          price_change_percentage: '1h,24h,7d'
        });
        sendJson(res, 200, { source: 'coingecko', refreshedAt: new Date().toISOString(), data });
      } catch (error) {
        sendJson(res, 200, {
          source: 'demo',
          refreshedAt: new Date().toISOString(),
          warning: `Data live CoinGecko tidak tersedia: ${error.message}`,
          data: demoMarkets(ids)
        });
      }
      return;
    }

    if (reqUrl.pathname === '/api/search') {
      const query = (reqUrl.searchParams.get('q') || '').trim();
      if (query.length < 2) {
        sendJson(res, 400, { error: 'Masukkan minimal 2 karakter untuk pencarian.' });
        return;
      }
      const data = await requestCoingecko('/api/v3/search', { query });
      sendJson(res, 200, { source: 'coingecko', data: (data.coins || []).slice(0, 12) });
      return;
    }

    sendJson(res, 404, { error: 'Endpoint API tidak ditemukan.' });
  } catch (error) {
    sendJson(res, 502, {
      error: 'Gagal mengambil data pasar. Coba lagi nanti atau cek koneksi internet.',
      detail: error.message
    });
  }
}

function serveStatic(reqUrl, res) {
  const requestedPath = decodeURIComponent(reqUrl.pathname === '/' ? '/index.html' : reqUrl.pathname);
  const normalizedPath = path.normalize(requestedPath).replace(/^([/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, normalizedPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (fallbackError, fallbackContent) => {
        if (fallbackError) {
          sendText(res, 404, 'Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
        res.end(fallbackContent);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600'
    });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' });
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method tidak didukung.' });
    return;
  }

  if (reqUrl.pathname.startsWith('/api/')) {
    handleApi(reqUrl, res);
    return;
  }

  serveStatic(reqUrl, res);
});

server.listen(PORT, () => {
  console.log(`Meme Coin Art Monitor berjalan di http://localhost:${PORT}`);
});
