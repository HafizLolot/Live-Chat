# HaloDesk Live Chat

Website live chat dengan panel admin realtime. Dibina menggunakan Node.js tanpa dependency tambahan — cukup jalankan dan pakai.

## Cara menjalankan

1. Pastikan **Node.js 18+** sudah terpasang.
2. Klik dua kali `start.bat`, atau jalankan dari terminal:

   ```bash
   node server.js
   ```

3. Buka:
   - **Website pelanggan:** http://localhost:3000
   - **Panel admin:** http://localhost:3000/LivechatAdmin

Tidak perlu `npm install`.

## Deploy ke Render

Aplikasi ini memerlukan pelayan Node.js (SSE + API), jadi **tidak boleh** dihoskan di Netlify sebagai laman statik. Gunakan Render:

1. Push projek ini ke repositori GitHub.
2. Di [Render Dashboard](https://dashboard.render.com), klik **New +** → **Blueprint**, kemudian pilih repositori tersebut. Fail `render.yaml` akan dikesan secara automatik.
3. Jika diminta, masukkan nilai **ADMIN_PASSWORD** (kata laluan admin yang kukuh). Ini penting supaya kata laluan kekal sama setiap kali deploy.
4. Klik **Apply** dan tunggu deploy selesai. Render akan memberikan URL seperti `https://halodesk-livechat.onrender.com`.
5. Buka URL tersebut untuk pelanggan, dan `https://.../LivechatAdmin` untuk panel admin.

Tanpa `render.yaml`, anda juga boleh cipta **Web Service** secara manual dengan tetapan:

- Runtime: **Node**
- Build command: `npm install --omit=dev`
- Start command: `node server.js`
- Environment variable: `ADMIN_PASSWORD`

### Penyimpanan data di Render

Pelayan membaca `PORT` dan `HOST` daripada environment, jadi ia terus berfungsi di Render.

Secara lalai data disimpan dalam folder `data/`. Pada pelan **Free**, storan Render adalah sementara — `data/chats.json` dan `data/admin-auth.json` akan hilang apabila servis restart, deploy semula, atau tidur kerana tidak aktif. Untuk penyimpanan kekal:

1. Naik taraf servis ke pelan berbayar (Starter).
2. Tambah **Disk** dengan mount path `/var/data`.
3. Tetapkan environment variable `DATA_DIR` kepada `/var/data`.

Dengan cara itu semua perbualan dan tetapan admin kekal walaupun servis dimulakan semula.

## Akses admin tanpa kata laluan

Secara lalai, panel admin **tidak memerlukan kata laluan** (mod terbuka). Ini memudahkan penggunaan peribadi, tetapi **tidak selamat untuk produksi awam**.

Untuk mengaktifkan semula perlindungan kata laluan, tetapkan environment variable:

```text
ADMIN_AUTH_REQUIRED=true
```

dan (pilihan) `ADMIN_PASSWORD`. Selepas itu, panel admin akan meminta kata laluan seperti biasa.

> ⚠️ Jika anda hoskan aplikasi ini untuk umum, sangat disyorkan aktifkan `ADMIN_AUTH_REQUIRED=true`.

Pelanggan dan admin boleh menghantar gambar atau video terus dalam perbualan:

- Butang lampiran (📎) di sebelah kotak mesej.
- Format disokong: gambar `JPG, PNG, GIF, WEBP, AVIF` dan video `MP4, WEBM, MOV, OGG`.
- Saiz maksimum: **25 MB** setiap fail.
- Fail disimpan dalam folder `data/uploads` dengan nama UUID dan disajikan melalui `/uploads/<fail>` (dengan sokongan HTTP Range untuk video).
- Mesej teks boleh kosong apabila terdapat lampiran.

## Cara guna

1. Buka laman pelanggan, masukkan nama, kemudian mulakan perbualan.
2. Buka panel admin di tab lain, kemudian log masuk dengan kata laluan admin.
3. Klik perbualan di senarai kiri, kemudian balas mesej.
4. Balasan admin akan muncul di laman pelanggan secara **masa nyata** tanpa muat semula.
5. Indikator **sedang menaip** muncul di kedua-dua arah: pelanggan nampak admin menaip, dan admin nampak pelanggan menaip.
6. Selepas admin menandakan perbualan **selesai**, kedua-dua pihak tidak boleh menghantar mesej. Admin perlu klik **Buka semula** untuk membalas semula, manakala pelanggan boleh klik **Mulakan baharu** untuk memulakan perbualan baharu.

### Kata laluan admin

Pada kali pertama pelayan dijalankan, kata laluan admin dijana secara automatik:

- Dipaparkan di terminal, dan
- Disimpan dalam `data/ADMIN-PASSWORD.txt`.

Simpan kata laluan tersebut, kemudian tukar melalui butang **Tukar kata laluan** dalam panel admin. Fail `ADMIN-PASSWORD.txt` akan dipadam secara automatik selepas kata laluan ditukar.

Untuk menetapkan kata laluan sendiri, gunakan pemboleh ubah persekitaran `ADMIN_PASSWORD`:

PowerShell:

```powershell
$env:ADMIN_PASSWORD='kata-laluan-pilihan-anda'; node server.js
```

Command Prompt:

```bat
set ADMIN_PASSWORD=kata-laluan-pilihan-anda && node server.js
```

Jika `ADMIN_PASSWORD` ditetapkan, butang tukar kata laluan dalam panel admin akan disembunyikan kerana kata laluan dikawal oleh pemboleh ubah tersebut.

Sesi admin disimpan dalam memori selama 12 jam (maksimum 24 jam). Memulakan semula pelayan akan log keluar semua sesi.

Panel admin juga menyokong:

- Log masuk / keluar dengan kata laluan admin
- Tukar kata laluan admin (jika tidak menggunakan `ADMIN_PASSWORD`)
- Carian nama/mesej
- Penapis perbualan aktif dan selesai
- Indikator pelanggan online
- Indikator menaip dua hala (pelanggan ↔ admin)
- Kiraan mesej belum dibaca
- Bunyi notifikasi
- Balasan pantas
- Tanda selesai / buka semula (mesej disekat semasa perbualan ditutup)
- Padam perbualan
- Paparan responsif untuk telefon

## Penyimpanan data

Semua perbualan disimpan di:

```text
data/chats.json
```

Lokasi folder `data/` boleh ditukar dengan menetapkan environment variable `DATA_DIR` (contohnya `/var/data` semasa menggunakan Render Disk).

Fail ini dicipta secara automatik apabila mesej pertama masuk. Untuk sandaran, salin fail tersebut.

Maklumat pengesahan admin disimpan di `data/admin-auth.json` (hash kata laluan, bukan teks biasa). Jangan kongsikan fail ini.

## Menukar port

PowerShell:

```powershell
$env:PORT=8080; node server.js
```

Command Prompt:

```bat
set PORT=8080 && node server.js
```

Kemudian akses `http://localhost:8080` dan `http://localhost:8080/LivechatAdmin`.

## Struktur projek

```text
Live Chat/
├── server.js          # Pelayan HTTP, API, SSE, pengesahan dan penyimpanan
├── package.json
├── start.bat
├── public/
│   ├── index.html     # Laman pelanggan
│   ├── admin.html     # Panel admin
│   ├── styles.css
│   ├── admin.css
│   ├── app.js
│   ├── admin.js
│   └── favicon.svg
└── data/
    ├── chats.json     # Dicipta secara automatik
    ├── admin-auth.json        # Hash kata laluan admin (dicipta secara automatik)
    └── ADMIN-PASSWORD.txt     # Kata laluan awal (padam selepas disimpan)
```

## Catatan keselamatan

- Panel `/LivechatAdmin` dilindungi dengan kata laluan dan sesi cookie `HttpOnly` + `SameSite=Strict`.
- Cubaan log masuk dihadkan kepada 8 kali setiap 10 minit bagi setiap alamat IP.
- API admin, SSE admin, penghantaran mesej sebagai admin, dan status "admin menaip" semuanya memerlukan sesi yang sah.
- Tukar kata laluan automatik selepas log masuk pertama. Jika `ADMIN-PASSWORD.txt` masih wujud, simpan kata laluan di tempat selamat dan padam fail tersebut.
- Jika laman dipaparkan di internet, gunakan **HTTPS** (reverse proxy seperti Nginx/Caddy) supaya cookie dan kata laluan tidak dihantar secara teks biasa. Tetapkan juga `ADMIN_PASSWORD` yang kukuh.
- Lupa kata laluan? Padam `data/admin-auth.json`, kemudian mulakan semula pelayan untuk menjana kata laluan baharu. Semua perbualan dalam `data/chats.json` tidak terjejas.
