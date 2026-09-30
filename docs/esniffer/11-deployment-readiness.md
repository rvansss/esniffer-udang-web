# Audit Deployment Readiness

Tanggal audit: 1 Oktober 2026 (Asia/Jakarta)

## Kesimpulan

Status keseluruhan: **SIAP UNTUK DEPLOYMENT MANUAL TERKONTROL, BELUM TERVERIFIKASI DI VPS**.

Runtime aplikasi, autentikasi, MQTTS worker, graceful shutdown, health web/worker, image, Compose production-like, dan template reverse proxy telah disiapkan. Verifikasi akhir tetap memerlukan certificate/domain production, stack aktual di VPS, restore drill, capacity test, dan perangkat fisik. Prosedur operator terbaru ada di `12-runbook-deployment-manual.md`.

## Environment dan perintah aktual

| Komponen | Yang diuji |
|---|---|
| Node/npm | Node `v22.23.2`, npm `10.9.8` |
| PostgreSQL | PostgreSQL 15.18 lokal, Prisma 7.9.1 melalui lockfile |
| Broker TLS | Mosquitto `2.1.2` dari image `eclipse-mosquitto:2` |
| PKI test | OpenSSL 3.6.3; CA dan server certificate sementara, RSA 2048, SAN `localhost` dan `127.0.0.1`, masa berlaku satu hari |
| Web | Next.js 16.3.0 production build/start |

Perintah utama yang dijalankan:

```text
node --experimental-strip-types --test test/deployment/mqtt-tls.test.ts
node --experimental-strip-types --test --test-concurrency=1 test/e2e/mqtt-ingestion.test.ts
npm test
npm run typecheck
npm run lint
npm run build -- --webpack
```

Fault test health juga menjalankan `next start` dengan `DATABASE_URL` menuju port yang tidak tersedia, lalu meminta `/api/health/live` dan `/api/health/ready` melalui loopback.

## Audit runtime dan security

| Area | Status | Hasil aktual |
|---|:---:|---|
| Next.js production build | **PASS** | Webpack build selesai; security headers aktif; `X-Powered-By` dinonaktifkan |
| Environment web | **PASS** | `AUTH_SECRET`, `CURSOR_SIGNING_SECRET`, dan `APP_BASE_URL` divalidasi untuk production; secret minimal 32 karakter dan base URL wajib HTTPS pada readiness |
| Environment worker | **PASS** | Production wajib menyediakan URL, client ID, username, password, dan CA file; `mqtt://` ditolak dan credential dalam URL ditolak |
| Environment database | **PASS** | `DATABASE_URL` tidak memiliki fallback pada production; fallback localhost hanya berlaku non-production |
| `.env.example` | **PASS** | Nama variabel diselaraskan dengan kode (`AUTH_SECRET`, `MQTT_URL`, dan lainnya); hanya placeholder, tanpa credential nyata atau secret `NEXT_PUBLIC_*` |
| Cookie session | **PASS** | Production cookie dan clear-cookie teruji `Secure`, `HttpOnly`, `SameSite=Lax`; token mentah tetap hanya di cookie dan respons API `no-store, private` |
| HTTP security headers | **PASS** | `nosniff`, `DENY`, referrer policy, dan permissions policy muncul pada server production test |
| Secret exposure worker | **PASS** | Status worker tidak lagi mengembalikan password; URL berisi userinfo ditolak sebelum dapat dicatat di log |
| PostgreSQL/Prisma | **PARTIAL** | Singleton/pool dan migration tersedia; role runtime terpisah, batas koneksi final, one-shot migration target, backup, dan restore drill belum diuji pada production |
| Container/Compose | **PASS** | Dockerfile multi-stage berhasil dibangun dan Compose production-like lolos render; stack lengkap dengan secret/certificate production belum dijalankan |
| Reverse proxy HTTPS | **PARTIAL** | Template nginx TLS 1.2/1.3, redirect, HSTS, body/rate limit, dan forwarded headers tersedia; domain/certificate production belum diuji |

Fallback secret/credential development masih tersedia untuk test lokal, tetapi cabang production sekarang fail-closed dan diuji eksplisit.

## MQTT TLS dan autentikasi

Konfigurasi yang benar-benar diuji adalah TLS server + autentikasi username/password per ACL, bukan mutual TLS.

| Skenario | Status | Bukti |
|---|:---:|---|
| Broker certificate dan TLS listener 8883 | **PASS** | `mosquitto-tls.conf` yang ada di repository dijalankan langsung pada container ephemeral |
| CA trust benar | **PASS** | Worker membaca `MQTT_CA_FILE`, memverifikasi certificate/SAN, terkoneksi, dan subscription aktif |
| CA tidak dipercaya | **PASS** | Worker menolak koneksi dengan `self-signed certificate in certificate chain` |
| Certificate verification | **PASS** | `rejectUnauthorized: true`; tidak ada opsi untuk mematikannya melalui environment/config |
| Client authentication | **PASS** | Username/password sah diterima; password salah ditolak broker |
| ACL worker | **PASS** | Worker hanya mendapat read telemetry/status dan write ACK dari ACL aktual |
| Broker restart | **PASS** | Container dihentikan/dijalankan kembali; worker menjadi offline lalu reconnect dan subscription aktif kembali |
| mTLS client certificate | **SKIPPED** | Worker mendukung pasangan file cert/key, tetapi broker template memakai TLS + password (`require_certificate false`); mTLS tidak diklaim |
| Certificate production/rotation/revocation | **SKIPPED** | Test memakai CA sementara, bukan CA/domain production; prosedur rotasi belum tersedia |

Private key, certificate, dan password test dibuat di direktori temporary dan dihapus saat cleanup. Pola `*.key`, `*.crt`, direktori cert, secrets, password aktual, dan data broker diabaikan Git.

## Lifecycle worker

| Skenario | Status | Hasil |
|---|:---:|---|
| Reconnect/resubscribe | **PASS** | Teruji dengan restart broker nyata melalui MQTTS |
| Persistent session | **PASS** | Worker memakai MQTT 5, `clean=false`, session expiry 24 jam |
| Bounded queue | **PASS** | Batas antrean tetap diuji dan tidak tumbuh tanpa batas |
| Graceful drain | **PASS** | Shutdown berhenti menerima pesan baru, memproses seluruh item yang sudah antre, lalu menutup MQTT |
| ACK setelah commit | **PASS** | Test outage dan ACK-publish failure membuktikan tidak ada ACK sukses sebelum commit |
| Restart dan committed state | **PASS** | Payload committed sebelum restart mendapat ACK `duplicate` dengan reading ID yang sama dan row count tetap satu sesudah restart |
| `write after end` | **PASS** | Direproduksi pada stop tepat setelah subscribe. Penyebabnya race penulisan DISCONNECT MQTT.js pada stream teardown; setelah drain transport ditutup tanpa write baru. Delapan start/stop berurutan dan suite penuh tidak lagi menghasilkan log tersebut |
| Exponential backoff+jitter | **PASS** | Retry manual memakai rentang 1–30 detik, exponential growth, jitter, reset sesudah connect, dan dibuktikan pulih setelah restart broker |

Forced transport close dilakukan hanya setelah antrean dan task aktif selesai. Persistent session broker dan deduplikasi database menjaga redelivery aman.

## Liveness dan readiness

| Probe | Status | Hasil |
|---|:---:|---|
| Web `/api/health/live` | **PASS** | Tetap HTTP 200 saat database diarahkan ke endpoint tidak tersedia; tidak melakukan query dependency |
| Web `/api/health/ready` | **PASS** | HTTP 200 saat config+DB sehat; HTTP 503 saat config production tidak lengkap atau DB tidak dapat dijangkau; respons tidak membocorkan detail error dan `no-store` |
| Recovery web | **PARTIAL** | State sehat dan gagal diuji, tetapi transisi stop/start database production yang sama belum dilakukan |
| Worker liveness/readiness endpoint | **PASS** | `/health/live` hanya status proses; `/health/ready` mensyaratkan MQTT, subscription, dan query DB; transisi 503 → 200 teruji |
| Broker readiness terautentikasi | **PARTIAL** | Listener TLS/auth diuji oleh koneksi worker, tetapi belum diintegrasikan sebagai healthcheck deployment |

## Regression gate

| Gate | Status | Hasil |
|---|:---:|---|
| TLS deployment test | **PASS** | 1/1, 0 skipped |
| `npm test` | **PASS** | 141/141, 12 suite, 0 fail, 0 skipped |
| `npm run typecheck` | **PASS** | 0 error |
| `npm run lint` | **PASS** | 0 error, 0 warning |
| `npm run build -- --webpack` | **PASS** | 21 routes termasuk dua health endpoint |
| Turbopack default | **SKIPPED** | Sandbox sebelumnya melarang proses internal membuka port; Webpack production build lulus |

## Blocker deployment

1. Compose lengkap belum dijalankan memakai secret, domain, dan certificate production di VPS.
2. CA/server certificate production, renewal, rotasi/revokasi credential device, dan distribusi trust ke perangkat belum diuji.
3. Auth lokal masih memerlukan keputusan/persetujuan production atau penggantian dengan OIDC.
4. Backup off-host, restore drill, RPO/RTO, disk pressure, capacity/pool sizing, dan image digest pinning belum diverifikasi.
5. Prisma CLI one-shot masih memiliki advisory dependency high tanpa upgrade non-breaking; CLI dipisahkan dari target runtime web/worker dan hanya dijalankan selama migration terkontrol.

## Belum diverifikasi

- ESP32 fisik terhadap broker MQTTS dan penyimpanan CA/credential pada perangkat.
- mTLS client certificate karena deployment yang diuji memilih TLS + password.
- HTTPS melalui reverse proxy production.
- PostgreSQL yang tidak dipublish dan role least-privilege dalam network deployment nyata.
- Broker persistence/queued delivery melintasi restart dengan volume production.
- Environment VPS/staging, firewall, DNS, certificate renewal, monitoring, backup, dan rollback nyata.
