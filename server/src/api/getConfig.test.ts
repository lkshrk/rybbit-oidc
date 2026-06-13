import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyReply } from "fastify";

import { getConfig } from "./getConfig.js";

const originalEnv = process.env;

afterEach(() => {
  process.env = originalEnv;
  vi.resetModules();
});

describe("getConfig", () => {
  it("exposes configured OIDC provider without leaking provider secrets or mappings", async () => {
    const groupMapping = [{ group: "analytics", organizationId: "org_1", role: "admin" }];
    process.env = {
      ...originalEnv,
      OIDC_NAME: "Acme SSO",
      OIDC_CLIENT_ID: "client-id",
      OIDC_CLIENT_SECRET: "client-secret",
      OIDC_DISCOVERY_URL: "https://idp.example.com/.well-known/openid-configuration",
      OIDC_GROUP_MAPPING: JSON.stringify(groupMapping),
    };
    const send = vi.fn();
    const reply = {
      send,
    } as unknown as FastifyReply;

    await getConfig({} as never, reply);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        oidcProvider: { name: "Acme SSO" },
      })
    );
    expect(JSON.stringify(send.mock.calls[0][0])).not.toContain("client-secret");
    expect(JSON.stringify(send.mock.calls[0][0])).not.toContain("analytics");
  });

  it("does not expose incomplete OIDC provider config", async () => {
    process.env = {
      ...originalEnv,
      OIDC_NAME: "Broken SSO",
      OIDC_CLIENT_ID: "client-id",
    };
    const send = vi.fn();
    const reply = {
      send,
    } as unknown as FastifyReply;

    await getConfig({} as never, reply);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        oidcProvider: null,
      })
    );
  });

  it("exposes credential login disablement", async () => {
    process.env = {
      ...originalEnv,
      DISABLE_CREDENTIAL_LOGIN: "true",
    };
    vi.resetModules();
    const { getConfig: getConfigWithEnv } = await import("./getConfig.js");
    const send = vi.fn();
    const reply = {
      send,
    } as unknown as FastifyReply;

    await getConfigWithEnv({} as never, reply);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        disableCredentialLogin: true,
      })
    );
  });
});
