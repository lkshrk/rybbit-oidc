import { FastifyRequest, FastifyReply } from "fastify";
import { createRequire } from "module";
import { DISABLE_CREDENTIAL_LOGIN, DISABLE_SIGNUP, LITE_DASHBOARD, MAPBOX_TOKEN } from "../lib/const.js";
import { getOidcProvider } from "../lib/oidc.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json");

export async function getConfig(_: FastifyRequest, reply: FastifyReply) {
  const oidcProvider = getOidcProvider();

  return reply.send({
    disableSignup: DISABLE_SIGNUP,
    disableCredentialLogin: DISABLE_CREDENTIAL_LOGIN,
    mapboxToken: MAPBOX_TOKEN,
    liteDashboard: LITE_DASHBOARD,
    oidcProvider: oidcProvider ? { name: oidcProvider.name } : null,
  });
}

export async function getVersion(_: FastifyRequest, reply: FastifyReply) {
  return reply.send({ version });
}
