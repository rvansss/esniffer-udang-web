# Runbook Deployment Manual VPS

Tanggal penyusunan: 1 Oktober 2026 (Asia/Jakarta)

Dokumen ini menyiapkan langkah yang **akan dijalankan operator di VPS**. Penyusunan ini tidak melakukan SSH, perubahan DNS/firewall, push, atau deployment. Gunakan `deploy/compose.production.yml`; jangan gunakan Compose development untuk production.

## Status verifikasi repository

| Skenario | Status | Hasil aktual lokal |
|---|:---:|---|
| Render Compose | **PASS** | `docker compose ... config --quiet` berhasil tanpa error |
| Build image web/worker | **PASS** | Multi-stage image berhasil dibangun; proses runtime memakai UID/GID 10001 dan dependency development dipangkas |
| Build Next.js dalam image | **PASS** | Next.js 16.3.8 Webpack build berhasil, 21 route |
| MQTTS dan reconnect | **PASS** | CA/credential invalid ditolak; restart broker pulih melalui bounded exponential backoff+jitter |
| Probe worker | **PASS** | `/health/live` independen dari dependency; `/health/ready` berubah 503 → 200 mengikuti probe MQTT/subscription/DB |
| Stack Compose penuh | **SKIPPED** | Belum dijalankan dengan certificate dan secret production |
| HTTPS domain production | **SKIPPED** | Memerlukan DNS dan certificate aktual di VPS |
| Backup/restore drill | **SKIPPED** | Prosedur tersedia di bawah, tetapi belum dijalankan pada volume VPS |

## Artefak dan batas keamanan

- `Dockerfile` menghasilkan target runtime bersama untuk web/worker dan target `migration` terpisah yang membawa Prisma CLI.
- Web, worker, dan migration memperoleh secret melalui file `/run/secrets`; entrypoint tidak mencetak nilainya.
- PostgreSQL dan web tidak dipublish. Port host yang dipublish hanya `80`, `443`, dan `8883`.
- Network `backend` bersifat internal. Data PostgreSQL, Mosquitto, dan cache Next memakai named volume.
- Mosquitto mewajibkan TLS, password hash, dan ACL. `healthcheck` hanya boleh membaca `$SYS/broker/version`; worker hanya membaca telemetry/status dan menulis ACK.
- Healthcheck container worker memakai liveness agar outage dependency tidak menyebabkan restart loop. Readiness operasional tersedia di `http://worker:8081/health/ready` dari dalam network Compose.
- Image tag pada template belum dipin ke digest. Pin digest setelah image yang akan dirilis selesai dibangun/ditarik.

## 1. Persiapan satu kali di VPS

Prasyarat: Docker Engine dengan Compose v2, OpenSSL, domain dashboard dan broker yang sudah mengarah ke VPS, serta certificate HTTPS dan MQTT yang valid. Certificate server MQTT harus memiliki SAN yang sama dengan `MQTT_BROKER_HOST`.

```sh
cd /opt/esniffer-udang-web
cp deploy/.env.production.example deploy/.env.production
install -d -m 700 deploy/secrets/mqtt deploy/secrets/https deploy/backups
umask 077
openssl rand -base64 48 > deploy/secrets/postgres_password.txt
openssl rand -base64 48 > deploy/secrets/postgres_runtime_password.txt
openssl rand -base64 48 > deploy/secrets/auth_secret.txt
openssl rand -base64 48 > deploy/secrets/cursor_signing_secret.txt
openssl rand -base64 36 > deploy/secrets/mqtt/worker_password.txt
openssl rand -base64 36 > deploy/secrets/mqtt/healthcheck_password.txt
chmod 600 deploy/secrets/*.txt deploy/secrets/mqtt/*.txt
```

Edit `deploy/.env.production`: domain, image tag unik per rilis, database, pool, dan path file. Jangan menaruh nilai secret di file env. Tempatkan file berikut lewat kanal aman:

```text
deploy/secrets/https/fullchain.pem
deploy/secrets/https/privkey.pem
deploy/secrets/mqtt/ca.crt
deploy/secrets/mqtt/server.crt
deploy/secrets/mqtt/server.key
```

Bangun password file Mosquitto dari secret mentah. Tambahkan setiap perangkat dengan username yang sama dengan `device_id`, lalu tambahkan ACL device yang sempit di `docker/mosquitto/config/acl.txt`.

```sh
docker run --rm -v "$PWD/deploy/secrets/mqtt:/work" eclipse-mosquitto:2 \
  mosquitto_passwd -b -c /work/passwords.txt worker "$(cat deploy/secrets/mqtt/worker_password.txt)"
docker run --rm -v "$PWD/deploy/secrets/mqtt:/work" eclipse-mosquitto:2 \
  mosquitto_passwd -b /work/passwords.txt healthcheck "$(cat deploy/secrets/mqtt/healthcheck_password.txt)"
docker run --rm -it -v "$PWD/deploy/secrets/mqtt:/work" eclipse-mosquitto:2 \
  mosquitto_passwd /work/passwords.txt esp32-001
chmod 600 deploy/secrets/mqtt/passwords.txt deploy/secrets/mqtt/server.key deploy/secrets/https/privkey.pem
```

Verifikasi tidak ada secret/certificate ter-track:

```sh
git status --short
git check-ignore deploy/.env.production deploy/secrets/postgres_password.txt deploy/secrets/mqtt/server.key
```

Catatan: init script role runtime hanya berjalan ketika volume PostgreSQL masih kosong. Jika memakai database/volume lama, buat role runtime dan grant ekuivalen secara manual sebelum memulai web/worker.

## 2. Preflight setiap rilis

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml config --quiet
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml build web worker
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml --profile tools build migrate
docker image inspect "$(sed -n 's/^APP_IMAGE=//p' deploy/.env.production):$(sed -n 's/^APP_TAG=//p' deploy/.env.production)" --format '{{index .RepoDigests 0}}'
```

Simpan tag/digest image, Git revision, nama migration terakhir, dan waktu rilis di catatan operasi. Jalankan `docker compose ... config` tanpa menyalin output ke tiket publik karena path deployment akan terlihat.

## 3. Backup sebelum migration

```sh
set -a
. deploy/.env.production
set +a
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="deploy/backups/esniffer-${stamp}.dump"
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml up -d postgres
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --create --clean > "$backup"
sha256sum "$backup" > "${backup}.sha256"
sha256sum -c "${backup}.sha256"
```

Salin backup dan checksum ke penyimpanan off-host terenkripsi sesuai RPO/retensi organisasi. Backup lokal saja tidak melindungi kehilangan VPS/volume.

## 4. Migration satu kali dan start

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml up -d postgres mosquitto
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml ps
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml --profile tools run --rm migrate
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml up -d web worker proxy
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml ps
```

Migration tidak dijalankan dari startup replica web/worker. Jika migration gagal, jangan lanjutkan start rilis; simpan log error, perbaiki migration, atau jalankan rollback sesuai bagian 7.

## 5. Smoke check setelah start

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml exec -T web \
  node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)})"
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml exec -T worker \
  node -e "fetch('http://127.0.0.1:8081/health/ready').then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)})"
curl --fail --show-error --silent "https://${DASHBOARD_HOST}/api/health/ready"
openssl s_client -connect "${MQTT_BROKER_HOST}:8883" -servername "${MQTT_BROKER_HOST}" -CAfile deploy/secrets/mqtt/ca.crt </dev/null
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml logs --since=10m web worker mosquitto proxy
```

Lanjutkan smoke telemetry dengan satu `message_id` unik: publish perangkat/simulator, cocokkan ACK setelah commit, row database, API latest/history, dan dashboard seperti prosedur integrasi pada dokumen 10. Jangan mencatat payload yang mengandung credential.

## 6. Restore drill dan restore insiden

Drill ke database terpisah, tanpa menimpa production:

```sh
sha256sum -c "${backup}.sha256"
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml exec -T postgres \
  createdb -U "$POSTGRES_USER" esniffer_restore_drill
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d esniffer_restore_drill --no-owner --no-privileges < "$backup"
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d esniffer_restore_drill -c 'SELECT count(*) FROM sensor_readings;'
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml exec -T postgres \
  dropdb -U "$POSTGRES_USER" esniffer_restore_drill
```

Untuk restore insiden: aktifkan maintenance window, hentikan `proxy web worker`, verifikasi checksum, terminasi koneksi database target, restore archive menggunakan owner, jalankan smoke query, lalu start kembali. Perintah drop/restore production bersifat destruktif; tulis nama database eksplisit dan minta peer review sebelum menjalankannya.

## 7. Rollback

Rollback aplikasi untuk migration backward-compatible:

```sh
# Ubah APP_TAG ke tag rilis sebelumnya yang sudah tercatat.
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml up -d --no-deps web worker
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml ps
```

Jangan menjalankan `migrate reset` atau membalik migration otomatis di production. Bila schema baru tidak backward-compatible, hentikan traffic dan worker, restore backup pra-rilis yang sudah diverifikasi, lalu jalankan image sebelumnya. Data yang masuk setelah waktu backup akan hilang; keputusan ini harus mengikuti RPO dan persetujuan insiden.

## 8. Checklist penerimaan VPS

- [ ] Image ditandai unik dan digest dicatat; tidak memakai `latest`.
- [ ] Secret berbeda untuk owner DB, runtime DB, auth, cursor, worker MQTT, healthcheck, dan tiap perangkat.
- [ ] Certificate chain/SAN/expiry HTTPS dan MQTTS valid; private key mode 600 dan tidak ter-track.
- [ ] Hanya 80/443/8883 dipublish; PostgreSQL, web 3000, dan worker 8081 tidak terbuka dari host publik.
- [ ] Migration one-shot sukses dan tidak berjalan pada web/worker startup.
- [ ] Semua container healthy; web/worker readiness 200.
- [ ] Telemetry → ACK → DB → API → dashboard terbukti dengan ID/timestamp yang sama.
- [ ] Restart Mosquitto dan worker tidak menduplikasi reading committed.
- [ ] Backup off-host memiliki checksum; restore drill sukses dan durasi dicatat.
- [ ] Monitoring disk/volume, expiry certificate, container health, dan error log aktif.

## Belum dapat diverifikasi di repository

DNS/firewall VPS, certificate production dan renewal, kecukupan CPU/RAM/pool, pull/pinning digest lintas arsitektur, persistence setelah reboot host, backup off-host, restore/RPO/RTO nyata, rotasi/revokasi credential, serta perangkat ESP32 fisik tetap harus diverifikasi di VPS/staging. Repository belum boleh disebut production-ready penuh sebelum checklist tersebut selesai.
