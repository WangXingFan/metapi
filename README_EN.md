# Metapi Lite

Metapi Lite is a trimmed operations console for upstream relay-site account maintenance. The current build keeps only the shortest management workflow:

- Sites: maintain upstream site URLs, platform type, and optional external check-in URL
- Accounts: add accounts through site login or by importing Session / API Key credentials
- Account Keys: sync, complete, copy, and set account keys
- Check-in: run account check-ins and inspect check-in logs
- Import / Export: local backup restore plus WebDAV sync

The legacy unified `/v1/*` proxy gateway, smart routing UI, model marketplace, OAuth management, monitor, proxy logs, and model playground are no longer part of the current runtime entry points.

## Quick Start

```bash
npm install
npm run db:migrate
npm run dev
```

Default admin UI:

```text
http://127.0.0.1:5173
```

Default server:

```text
http://127.0.0.1:4000
```

Set at least these values for real use:

```bash
AUTH_TOKEN=change-this-admin-token
ACCOUNT_CREDENTIAL_SECRET=change-this-encryption-secret
DATA_DIR=./data
```

## Build And Run

```bash
npm run build
npm start
```

Desktop build:

```bash
npm run dev:desktop
npm run package:desktop
```

Docker still uses `docker/Dockerfile` and `docker/docker-compose.yml`.

## Current Navigation

```text
/sites          Sites
/accounts       Accounts
/keys           Account Keys
/checkin        Check-in
/import-export  Import / Export
```

Compatibility redirects:

```text
/tokens -> /keys
/settings/import-export -> /import-export
```

## Development

```bash
npm run typecheck
npm test
npm run build:web
npm run build:server
npm run build:desktop
```

Database changes still need synchronized Drizzle schema, migrations, and generated artifacts.

## Docs

This repository now keeps Lite docs only. See `docs/`:

- `docs/getting-started.md`
- `docs/configuration.md`
- `docs/deployment.md`
- `docs/operations.md`
- `docs/management-api.md`
- `docs/faq.md`

Preview locally:

```bash
npm run docs:dev
```
