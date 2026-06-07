# Meme Coin Art Monitor

Aplikasi monitoring meme coin berbasis Node.js tanpa dependency eksternal. Dashboard menampilkan harga, market cap, volume, perubahan 1 jam/24 jam/7 hari, watchlist, alert harga lokal, pencarian coin, auto-refresh, dan visualisasi pasar bergaya kanvas lukisan.

> Data berasal dari CoinGecko. Aplikasi ini adalah alat pemantauan, bukan saran finansial.

## Fitur

- Proxy API lokal untuk CoinGecko di `/api/coins` dan `/api/search`.
- Daftar meme coin default: Dogecoin, Shiba Inu, Pepe, WIF, Bonk, Floki, BOME, Popcat, Mog, MEW, Brett, dan Turbo.
- Watchlist dan alert harga tersimpan di `localStorage` browser.
- Auto-refresh pilihan 30 detik, 60 detik, 5 menit, atau nonaktif.
- Kanvas visual yang menggambar sapuan warna berdasarkan performa 24 jam dan market cap.
- Tidak memerlukan API key untuk mode dasar.
- Fallback data demo otomatis aktif jika CoinGecko sedang tidak dapat dijangkau, sehingga UI tetap bisa dicoba.

## Cara menjalankan

```bash
npm start
```

Buka browser ke:

```text
http://localhost:3000
```

Port dapat diubah dengan environment variable:

```bash
PORT=8080 npm start
```

## Pemeriksaan kode

```bash
npm run check
```

## Catatan penggunaan

1. Edit kolom **Coin IDs** menggunakan ID CoinGecko, dipisahkan koma.
2. Gunakan kotak pencarian untuk menemukan dan menambahkan coin baru.
3. Klik ⭐ untuk memasukkan coin ke watchlist lokal.
4. Isi **Alert harga** dalam USD; alert muncul ketika harga saat ini sama dengan atau melewati target.

Karena endpoint publik CoinGecko memiliki batas rate limit, gunakan interval refresh yang wajar saat memantau banyak coin.
