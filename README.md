# Meme Coin Monitor

Script Python ringan untuk memantau coin meme populer dari CoinGecko dan menampilkan alert berdasarkan momentum harga, lonjakan volume, dan penurunan tajam.

> Catatan: output script ini bukan nasihat finansial. Selalu lakukan riset sendiri dan gunakan manajemen risiko.

## Fitur

- Tanpa dependency pihak ketiga; cukup Python 3.10+.
- Watchlist meme coin dapat diatur lewat argumen atau environment variable.
- Alert untuk:
  - kenaikan harga 24 jam dengan volume tinggi,
  - lonjakan volume antar-scan,
  - penurunan harga tajam sebagai peringatan risiko.
- Mendukung output tabel manusiawi atau JSON untuk integrasi bot/cron.

## Contoh penggunaan

Jalankan satu kali:

```bash
python3 scripts/meme_coin_monitor.py --once
```

Pantau tiap 60 detik dengan watchlist khusus:

```bash
python3 scripts/meme_coin_monitor.py --symbols doge,shib,pepe,bonk,wif --interval 60
```

Output JSON untuk automation:

```bash
python3 scripts/meme_coin_monitor.py --once --json
```

Uji tanpa akses internet menggunakan fixture lokal:

```bash
python3 scripts/meme_coin_monitor.py --once --json --input-file tests/fixtures/coingecko_markets_sample.json
```

Gunakan quote IDR:

```bash
python3 scripts/meme_coin_monitor.py --once --currency idr
```

## Konfigurasi penting

| Opsi | Environment variable | Default | Kegunaan |
| --- | --- | --- | --- |
| `--symbols` | `MEME_SYMBOLS` | `doge,shib,pepe,bonk,wif,floki,popcat,brett,mog,bome,turbo` | Daftar simbol coin yang dipantau. |
| `--interval` | `MONITOR_INTERVAL` | `300` | Jeda antar-scan dalam detik. |
| `--min-volume-usd` | `MIN_VOLUME_USD` | `10000000` | Minimum volume 24 jam agar alert momentum muncul. |
| `--min-volume-change-pct` | `MIN_VOLUME_CHANGE_PCT` | `25` | Minimum kenaikan volume sejak scan sebelumnya. |
| `--min-price-change-pct` | `MIN_PRICE_CHANGE_PCT` | `8` | Minimum kenaikan harga 24 jam. |
| `--max-price-drop-pct` | `MAX_PRICE_DROP_PCT` | `-10` | Batas penurunan harga untuk risk alert. |
| `--min-market-cap-rank` | `MIN_MARKET_CAP_RANK` | `500` | Abaikan coin dengan ranking market cap lebih buruk. |
| `--input-file` | - | - | Baca data market JSON lokal untuk testing/offline run. |

## Tips operasional

- Untuk monitoring real-time, jalankan di VPS memakai `tmux`, `systemd`, atau cron.
- Gunakan `--json` jika ingin meneruskan alert ke Telegram/Discord dengan script tambahan.
- Sesuaikan threshold agar tidak terlalu bising saat market volatil.
