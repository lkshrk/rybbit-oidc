import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const shiplightRoot = process.env.SHIPLIGHT_ROOT ?? "/opt/shiplight";
const postgresHost = process.env.OIDC_E2E_POSTGRES_HOST ?? "postgres";
const postgresPort = process.env.OIDC_E2E_POSTGRES_PORT ?? "5432";
const redisHost = process.env.OIDC_E2E_REDIS_HOST ?? "redis";
const redisPort = process.env.OIDC_E2E_REDIS_PORT ?? "6379";
const clickhouseHost = process.env.OIDC_E2E_CLICKHOUSE_HOST ?? "http://clickhouse:8123";

const backendUrl = process.env.OIDC_E2E_BACKEND_URL ?? "http://127.0.0.1:3001";
const clientUrl = process.env.OIDC_E2E_CLIENT_URL ?? "http://127.0.0.1:3002";
const issuer = process.env.OIDC_E2E_ISSUER ?? "http://127.0.0.1:3556";

const serverEnv = {
  ...process.env,
  NODE_ENV: "development",
  CLICKHOUSE_HOST: clickhouseHost,
  CLICKHOUSE_DB: "analytics",
  CLICKHOUSE_USER: "default",
  CLICKHOUSE_PASSWORD: "frog",
  POSTGRES_HOST: postgresHost,
  POSTGRES_PORT: postgresPort,
  POSTGRES_DB: "analytics",
  POSTGRES_USER: "frog",
  POSTGRES_PASSWORD: "frog",
  REDIS_HOST: redisHost,
  REDIS_PORT: redisPort,
  REDIS_PASSWORD: "changeme",
  BETTER_AUTH_SECRET: "oidc-e2e-secret-at-least-32-characters",
  BASE_URL: backendUrl,
  DISABLE_SIGNUP: "false",
  CLUSTER_WORKERS: "1",
  OIDC_NAME: "E2E SSO",
  OIDC_CLIENT_ID: "rybbit-e2e",
  OIDC_CLIENT_SECRET: "rybbit-e2e-secret",
  OIDC_DISCOVERY_URL: `${issuer}/.well-known/openid-configuration`,
  OIDC_SCOPES: "openid,profile,email,groups",
  OIDC_GROUP_CLAIM: "groups",
  OIDC_GROUP_MAPPING: JSON.stringify([
    {
      group: "analytics-admins",
      organizationId: "oidc-e2e-org",
      role: "admin",
      teamNames: ["Analytics"],
    },
    {
      group: "support",
      organizationId: "oidc-e2e-org",
      teamNames: ["Support"],
    },
  ]),
};

const clientEnv = {
  ...process.env,
  NEXT_PUBLIC_BACKEND_URL: backendUrl,
  NEXT_PUBLIC_DISABLE_SIGNUP: "false",
  NEXT_PUBLIC_LITE_DASHBOARD: "false",
};

const shiplightEnv = {
  ...process.env,
  NODE_PATH: process.env.NODE_PATH ?? "/opt/shiplight/node_modules",
};

function run(command, args, options = {}) {
  const result = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: options.stdio ?? "inherit",
  });

  return new Promise((resolve, reject) => {
    result.on("error", error => {
      error.command = command;
      error.args = args;
      reject(error);
    });
    result.on("exit", code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: options.stdio ?? "inherit",
  });

  child.stopping = false;
  child.on("exit", code => {
    if (!child.stopping) {
      console.error(`${command} ${args.join(" ")} exited with ${code}`);
    }
  });
  return child;
}

function waitForUrl(url, timeoutMs = 60_000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(url, response => {
        response.resume();
        if ((response.statusCode ?? 500) < 500) {
          resolve();
        } else {
          retry();
        }
      });
      request.on("error", retry);
      request.setTimeout(2_000, () => {
        request.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for ${url}`));
      } else {
        setTimeout(attempt, 1_000);
      }
    };

    attempt();
  });
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.stopping = true;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 5_000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function runPostgres(sql) {
  await withPostgres(client => client.query(sql));
}

async function queryPostgres(sql) {
  const result = await withPostgres(client => client.query(sql));
  const firstRow = result.rows[0];
  if (!firstRow) return "";

  return String(firstRow[Object.keys(firstRow)[0]] ?? "").trim();
}

async function withPostgres(callback) {
  const requireFromServer = createRequire(path.join(repoRoot, "server", "package.json"));
  const { Client } = requireFromServer("pg");
  const client = new Client({
    host: postgresHost,
    port: Number(postgresPort),
    database: "analytics",
    user: "frog",
    password: "frog",
  });

  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function seedOrganization() {
  await runPostgres(`INSERT INTO "organization" ("id", "name", "slug", "createdAt")
     VALUES ('oidc-e2e-org', 'OIDC E2E Org', 'oidc-e2e', now())
     ON CONFLICT ("id") DO NOTHING;`);
}

async function ensureNodeInstall(directory, args = ["ci"]) {
  if (existsSync(path.join(directory, "node_modules", ".package-lock.json"))) return;
  await run("npm", args, { cwd: directory });
}

async function ensureDependencies() {
  const sharedDir = path.join(repoRoot, "shared");

  await ensureNodeInstall(sharedDir);
  await run("npm", ["run", "build"], { cwd: sharedDir });
  await ensureNodeInstall(path.join(repoRoot, "server"), ["ci", "--legacy-peer-deps"]);
  await ensureNodeInstall(path.join(repoRoot, "client"), ["ci", "--legacy-peer-deps"]);
}

async function runShiplightTest() {
  const yamlPath = "tests/oidc-login.test.yaml";
  const generatedSpec = "tests/oidc-login.yaml.spec.ts";

  try {
    await run("shiplight", ["transpile", yamlPath], {
      cwd: repoRoot,
      env: shiplightEnv,
    });
    await runOidcBrowserFlow();
  } finally {
    await rm(path.join(repoRoot, generatedSpec), { force: true });
  }
}

async function stageStandaloneAssets() {
  const clientDir = path.join(repoRoot, "client");
  const standaloneDir = path.join(clientDir, ".next", "standalone");
  await mkdir(path.join(standaloneDir, ".next"), { recursive: true });
  await cp(path.join(clientDir, ".next", "static"), path.join(standaloneDir, ".next", "static"), {
    recursive: true,
  });
  await cp(path.join(clientDir, "public"), path.join(standaloneDir, "public"), {
    recursive: true,
  });
}

async function runOidcBrowserFlow() {
  const requireFromShiplight = createRequire(path.join(shiplightRoot, "package.json"));
  const { chromium, expect } = requireFromShiplight("@playwright/test");
  const browser = await chromium.launch();

  try {
    const context = await browser.newContext({ baseURL: clientUrl });
    const page = await context.newPage();
    page.on("console", message => {
      if (["error", "warning"].includes(message.type())) {
        console.log(`[browser:${message.type()}] ${message.text()}`);
      }
    });
    page.on("pageerror", error => {
      console.log(`[browser:pageerror] ${error.message}`);
    });

    const backendConfig = await (await context.request.get(`${backendUrl}/api/config`)).json();
    expect(backendConfig.oidcProvider).toEqual({ name: "E2E SSO" });

    await page.goto("/login");
    const browserConfig = await page.evaluate(async () => {
      const response = await fetch("http://127.0.0.1:3001/api/config", { credentials: "include" });
      return response.json();
    });
    expect(browserConfig.oidcProvider).toEqual({ name: "E2E SSO" });

    await expect(page.getByRole("button", { name: "E2E SSO" })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "E2E SSO" }).click();

    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect.poll(() => page.url()).not.toContain("3556");
    await expect
      .poll(async () => {
        const response = await context.request.get(`${backendUrl}/api/auth/get-session`);
        const session = await response.json();
        return session?.user?.email;
      })
      .toBe("oidc-user@example.com");
  } finally {
    await browser.close();
  }
}

async function assertGroupMapping() {
  const role = await queryPostgres(`
    SELECT m.role
    FROM "member" m
    JOIN "user" u ON u.id = m."userId"
    WHERE u.email = 'oidc-user@example.com'
      AND m."organizationId" = 'oidc-e2e-org'
  `);

  if (role !== "admin") {
    throw new Error(`Expected oidc-user@example.com to be admin in oidc-e2e-org, got "${role}"`);
  }

  const teamMemberships = await queryPostgres(`
    SELECT COUNT(*)
    FROM "teamMember" tm
    JOIN "team" t ON t.id = tm."teamId"
    JOIN "user" u ON u.id = tm."userId"
    WHERE u.email = 'oidc-user@example.com'
      AND t."organizationId" = 'oidc-e2e-org'
      AND t.name IN ('Analytics', 'Support')
  `);

  if (teamMemberships !== "2") {
    throw new Error(`Expected two mapped team memberships, got "${teamMemberships}"`);
  }
}

let provider;
let backend;
let client;

try {
  await ensureDependencies();
  await run("npm", ["run", "db:migrate"], { cwd: path.join(repoRoot, "server"), env: serverEnv });
  await seedOrganization();

  provider = start("node", [path.join(__dirname, "provider.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OIDC_E2E_ISSUER: issuer,
      OIDC_E2E_CLIENT_ID: "rybbit-e2e",
      OIDC_E2E_CLIENT_SECRET: "rybbit-e2e-secret",
    },
  });
  await waitForUrl(`${issuer}/.well-known/openid-configuration`);

  await run("npm", ["run", "build"], { cwd: path.join(repoRoot, "server"), env: serverEnv });
  backend = start("node", ["dist/index.js"], { cwd: path.join(repoRoot, "server"), env: serverEnv });
  await waitForUrl(`${backendUrl}/api/health`);

  await run("npm", ["run", "build"], { cwd: path.join(repoRoot, "client"), env: clientEnv });
  await stageStandaloneAssets();
  client = start("node", [".next/standalone/server.js"], {
    cwd: path.join(repoRoot, "client"),
    env: {
      ...clientEnv,
      HOSTNAME: "127.0.0.1",
      PORT: "3002",
    },
  });
  await waitForUrl(`${clientUrl}/login`);

  await runShiplightTest();
  await assertGroupMapping();
} finally {
  await stopProcess(client);
  await stopProcess(backend);
  await stopProcess(provider);
}
