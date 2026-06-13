# Rybbit Shiplight Test Context

Rybbit is a web analytics application with a Next.js client and a Node/Fastify backend.

The local OIDC E2E environment is self-contained. It starts Postgres, Redis, ClickHouse, a disposable OIDC provider, the backend, and the production-built client. The browser test targets `http://127.0.0.1:3002`.

Use Docker for reproducible local and CI E2E runs:

```sh
cd client
npm run test:e2e:oidc
```

The OIDC E2E test uses a synthetic identity provider user:

- Email: `oidc-user@example.com`
- Groups: `analytics-admins`, `support`
- Expected organization: `oidc-e2e-org`
- Expected role: `admin`
- Expected teams: `Analytics`, `Support`

Do not store real IdP credentials in committed test files.
