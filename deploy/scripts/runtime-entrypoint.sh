#!/bin/sh
set -eu

read_required_secret() {
  secret_name="$1"
  secret_file="$2"
  if [ -z "$secret_file" ] || [ ! -r "$secret_file" ]; then
    echo "Required secret file for $secret_name is unavailable" >&2
    exit 1
  fi
  cat "$secret_file"
}

if [ -n "${AUTH_SECRET_FILE:-}" ]; then
  AUTH_SECRET="$(read_required_secret AUTH_SECRET "$AUTH_SECRET_FILE")"
  export AUTH_SECRET
fi
if [ -n "${CURSOR_SIGNING_SECRET_FILE:-}" ]; then
  CURSOR_SIGNING_SECRET="$(read_required_secret CURSOR_SIGNING_SECRET "$CURSOR_SIGNING_SECRET_FILE")"
  export CURSOR_SIGNING_SECRET
fi
if [ -n "${MQTT_PASSWORD_FILE:-}" ]; then
  MQTT_PASSWORD="$(read_required_secret MQTT_PASSWORD "$MQTT_PASSWORD_FILE")"
  export MQTT_PASSWORD
fi

if [ -z "${DATABASE_URL:-}" ]; then
  database_password="$(read_required_secret DATABASE_PASSWORD "${POSTGRES_PASSWORD_FILE:-}")"
  encoded_password="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$database_password")"
  DATABASE_URL="postgresql://${POSTGRES_USER}:${encoded_password}@${POSTGRES_HOST:-postgres}:${POSTGRES_PORT:-5432}/${POSTGRES_DB}?schema=public"
  export DATABASE_URL
fi

exec "$@"
