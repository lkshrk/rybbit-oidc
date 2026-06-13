import crypto from "node:crypto";
import http from "node:http";
import { URLSearchParams } from "node:url";

const issuer = process.env.OIDC_E2E_ISSUER ?? "http://127.0.0.1:3556";
const clientId = process.env.OIDC_E2E_CLIENT_ID ?? "rybbit-e2e";
const clientSecret = process.env.OIDC_E2E_CLIENT_SECRET ?? "rybbit-e2e-secret";
const email = process.env.OIDC_E2E_EMAIL ?? "oidc-user@example.com";
const name = process.env.OIDC_E2E_NAME ?? "OIDC User";
const groups = (process.env.OIDC_E2E_GROUPS ?? "analytics-admins,support")
  .split(",")
  .map(group => group.trim())
  .filter(Boolean);
const port = Number(new URL(issuer).port || 80);
const codes = new Map();

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = publicKey.export({ format: "jwk" });
jwk.kid = "rybbit-e2e-key";
jwk.alg = "RS256";
jwk.use = "sig";

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function sendHtml(response, status, body) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function signIdToken(nonce) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    kid: jwk.kid,
    typ: "JWT",
  };
  const payload = {
    iss: issuer,
    sub: "oidc-e2e-user",
    aud: clientId,
    exp: now + 300,
    iat: now,
    nonce,
    email,
    email_verified: true,
    name,
    groups,
  };
  const unsignedToken = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsignedToken), privateKey).toString("base64url");
  return `${unsignedToken}.${signature}`;
}

function parseBasicAuth(header) {
  if (!header?.startsWith("Basic ")) return null;
  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) return null;
  return {
    id: decoded.slice(0, separator),
    secret: decoded.slice(separator + 1),
  };
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", issuer);

  if (request.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
    return sendJson(response, 200, {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/userinfo`,
      jwks_uri: `${issuer}/jwks`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      scopes_supported: ["openid", "profile", "email", "groups"],
      claims_supported: ["sub", "email", "email_verified", "name", "groups"],
    });
  }

  if (request.method === "GET" && url.pathname === "/jwks") {
    return sendJson(response, 200, { keys: [jwk] });
  }

  if (request.method === "GET" && url.pathname === "/authorize") {
    const params = url.searchParams.toString();
    return sendHtml(
      response,
      200,
      `<!doctype html>
      <html>
        <body>
          <form method="post" action="/login">
            <input type="hidden" name="params" value="${escapeHtml(params)}" />
            <label>Email <input name="email" value="${email}" /></label>
            <label>Password <input name="password" type="password" value="password" /></label>
            <button type="submit">Sign in</button>
          </form>
        </body>
      </html>`
    );
  }

  if (request.method === "POST" && url.pathname === "/login") {
    const body = new URLSearchParams(await readBody(request));
    const params = new URLSearchParams(body.get("params") ?? "");
    const redirectUri = params.get("redirect_uri");
    const state = params.get("state");
    if (!redirectUri) return sendJson(response, 400, { error: "missing redirect_uri" });

    const code = crypto.randomUUID();
    codes.set(code, {
      nonce: params.get("nonce") ?? undefined,
    });
    const redirect = new URL(redirectUri);
    redirect.searchParams.set("code", code);
    if (state) redirect.searchParams.set("state", state);
    response.writeHead(302, { location: redirect.toString() });
    return response.end();
  }

  if (request.method === "POST" && url.pathname === "/token") {
    const body = new URLSearchParams(await readBody(request));
    const basicAuth = parseBasicAuth(request.headers.authorization);
    const requestClientId = basicAuth?.id ?? body.get("client_id");
    const requestClientSecret = basicAuth?.secret ?? body.get("client_secret");
    const code = body.get("code");
    const codeRecord = code ? codes.get(code) : null;

    if (requestClientId !== clientId || requestClientSecret !== clientSecret) {
      return sendJson(response, 401, { error: "invalid_client" });
    }
    if (!code || !codeRecord) {
      return sendJson(response, 400, { error: "invalid_grant" });
    }
    codes.delete(code);

    return sendJson(response, 200, {
      access_token: crypto.randomUUID(),
      token_type: "Bearer",
      expires_in: 300,
      id_token: signIdToken(codeRecord.nonce),
    });
  }

  if (request.method === "GET" && url.pathname === "/userinfo") {
    return sendJson(response, 200, {
      sub: "oidc-e2e-user",
      email,
      email_verified: true,
      name,
      groups,
    });
  }

  sendJson(response, 404, { error: "not_found" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`OIDC E2E provider listening on ${issuer}`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
