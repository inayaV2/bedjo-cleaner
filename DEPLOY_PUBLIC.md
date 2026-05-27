# Deploy Bedjo Cleaner agar QR bisa dibuka semua user

QR hanya bisa dibuka semua HP jika link-nya mengarah ke domain publik, bukan `localhost`, `127.0.0.1`, atau IP Wi-Fi laptop.

## Opsi cepat: Vercel

1. Upload folder `BedjoCleaner` ke GitHub.
2. Buka Vercel dan pilih `New Project`.
3. Pilih repo Bedjo Cleaner.
4. Set root directory ke folder `BedjoCleaner` jika repo berisi folder luar.
5. Build command kosongkan.
6. Output directory kosongkan atau pakai default.
7. Deploy.

Setelah deploy, contoh domain:

```text
https://bedjo-cleaner.vercel.app
```

## Opsi cepat: Netlify

1. Upload folder `BedjoCleaner` ke GitHub.
2. Buka Netlify dan pilih `Add new site`.
3. Pilih repo.
4. Publish directory arahkan ke `BedjoCleaner`.
5. Build command kosongkan.
6. Deploy.

## Setelah punya domain publik

Buka `js/app-config.js`, isi:

```js
PUBLIC_SITE_ORIGIN: "https://domain-kamu.com",
```

Contoh:

```js
PUBLIC_SITE_ORIGIN: "https://bedjo-cleaner.vercel.app",
```

Setelah itu deploy ulang.

QR akan menjadi:

```text
https://domain-kamu.com/public/tracking.html?code={order_code}
```

Halaman tracking tetap mengambil data dari Supabase, jadi database tidak perlu dipindah.
