#!/bin/sh
set -eu

runtime_password="$(cat /run/secrets/postgres_runtime_password)"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=db_name="$POSTGRES_DB" \
  --set=owner_role="$POSTGRES_USER" \
  --set=runtime_user="$POSTGRES_RUNTIME_USER" \
  --set=runtime_password="$runtime_password" <<'EOSQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'runtime_user', :'runtime_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'runtime_user') \gexec

GRANT CONNECT ON DATABASE :"db_name" TO :"runtime_user";
GRANT USAGE ON SCHEMA public TO :"runtime_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"runtime_user";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"runtime_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"runtime_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"runtime_user";
EOSQL
