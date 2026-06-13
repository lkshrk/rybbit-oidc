import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => {
  const tx = {
    query: {
      member: {
        findFirst: vi.fn(),
      },
      team: {
        findFirst: vi.fn(),
      },
    },
    selectResults: [] as unknown[][],
    inserts: [] as Array<{ tableName: string | undefined; values: unknown }>,
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };

  return {
    userFindFirst: vi.fn(),
    transaction: vi.fn(),
    tx,
  };
});

const authUtilsMock = vi.hoisted(() => ({
  invalidateSitesAccessCache: vi.fn(),
}));

vi.mock("../db/postgres/postgres.js", () => ({
  db: {
    query: {
      user: {
        findFirst: dbMock.userFindFirst,
      },
    },
    transaction: dbMock.transaction,
  },
}));

vi.mock("./auth-utils.js", () => authUtilsMock);

import {
  applyOidcGroupMappingForUser,
  buildOidcAssignments,
  getBetterAuthOidcProviders,
  parseOidcProvider,
} from "./oidc.js";

const originalEnv = process.env;

function configureOidcEnv(groupMapping: unknown[], overrides: NodeJS.ProcessEnv = {}) {
  process.env = {
    ...originalEnv,
    OIDC_NAME: "Acme SSO",
    OIDC_CLIENT_ID: "client-id",
    OIDC_CLIENT_SECRET: "client-secret",
    OIDC_DISCOVERY_URL: "https://idp.example.com/.well-known/openid-configuration",
    OIDC_GROUP_MAPPING: JSON.stringify(groupMapping),
    ...overrides,
  };
}

function resetDbMock() {
  dbMock.userFindFirst.mockReset();
  dbMock.transaction.mockReset();
  dbMock.tx.query.member.findFirst.mockReset();
  dbMock.tx.query.team.findFirst.mockReset();
  dbMock.tx.select.mockReset();
  dbMock.tx.insert.mockReset();
  dbMock.tx.update.mockReset();
  dbMock.tx.selectResults = [];
  dbMock.tx.inserts = [];
  authUtilsMock.invalidateSitesAccessCache.mockReset();

  dbMock.transaction.mockImplementation(async callback => callback(dbMock.tx));
  dbMock.tx.select.mockImplementation(() => ({
    from: () => ({
      where: async () => dbMock.tx.selectResults.shift() ?? [],
    }),
  }));
  dbMock.tx.insert.mockImplementation(table => ({
    values: vi.fn(async values => {
      dbMock.tx.inserts.push({
        tableName: table?.[Symbol.for("drizzle:Name")],
        values,
      });
    }),
  }));
  dbMock.tx.update.mockImplementation(() => ({
    set: vi.fn(() => ({
      where: vi.fn(async () => undefined),
    })),
  }));
}

function insertCallsForTable(tableName: string) {
  return dbMock.tx.inserts.filter(insert => insert.tableName === tableName);
}

beforeEach(() => {
  process.env = { ...originalEnv };
  resetDbMock();
});

afterEach(() => {
  process.env = originalEnv;
});

describe("OIDC configuration", () => {
  it("parses one complete OIDC provider and ignores incomplete config", () => {
    expect(
      parseOidcProvider({
        OIDC_NAME: "Broken SSO",
        OIDC_CLIENT_ID: "missing-parts",
      })
    ).toBeNull();

    const provider = parseOidcProvider({
      OIDC_NAME: "Acme SSO",
      OIDC_CLIENT_ID: "client-id",
      OIDC_CLIENT_SECRET: "client-secret",
      OIDC_DISCOVERY_URL: "https://idp.example.com/.well-known/openid-configuration",
      OIDC_SCOPES: "openid,email,profile,groups",
      OIDC_GROUP_CLAIM: "roles",
    });

    expect(provider).toMatchObject({
      providerId: "oidc",
      name: "Acme SSO",
      clientId: "client-id",
      clientSecret: "client-secret",
      discoveryUrl: "https://idp.example.com/.well-known/openid-configuration",
      scopes: ["openid", "email", "profile", "groups"],
      groupClaim: "roles",
    });
  });

  it("maps OIDC groups to organization roles and team names", () => {
    const provider = parseOidcProvider({
      OIDC_CLIENT_ID: "client-id",
      OIDC_CLIENT_SECRET: "client-secret",
      OIDC_DISCOVERY_URL: "https://idp.example.com/.well-known/openid-configuration",
      OIDC_GROUP_MAPPING: JSON.stringify([
        {
          group: "analytics-admins",
          organizationId: "org_1",
          role: "admin",
          teamNames: ["Analytics"],
        },
        {
          group: "support",
          organizationId: "org_1",
          teamIds: ["team_support"],
        },
      ]),
    });

    expect(
      buildOidcAssignments(provider!, {
        groups: ["analytics-admins", "support", "ignored"],
      })
    ).toEqual([
      {
        organizationId: "org_1",
        role: "admin",
        teamIds: ["team_support"],
        teamNames: ["Analytics"],
      },
    ]);
  });

  it("supports a string group claim and ignores invalid mapping rows", () => {
    const provider = parseOidcProvider({
      OIDC_CLIENT_ID: "client-id",
      OIDC_CLIENT_SECRET: "client-secret",
      OIDC_DISCOVERY_URL: "https://idp.example.com/.well-known/openid-configuration",
      OIDC_GROUP_CLAIM: "role",
      OIDC_GROUP_MAPPING: JSON.stringify([
        {
          group: "owner-role",
          organizationId: "org_1",
          role: "owner",
        },
        {
          group: "",
          organizationId: "org_2",
        },
      ]),
    });

    expect(buildOidcAssignments(provider!, { role: "owner-role" })).toEqual([
      {
        organizationId: "org_1",
        role: "owner",
        teamIds: [],
        teamNames: [],
      },
    ]);
  });

  it("uses default scopes and maps Better Auth user fields without exposing group claims", () => {
    configureOidcEnv([]);

    const providers = getBetterAuthOidcProviders();
    const mappedUser = providers[0].mapProfileToUser?.({
      sub: "subject_1",
      name: "Person",
      email: "person@example.com",
      email_verified: true,
      image: "https://example.com/avatar.png",
      groups: ["analytics"],
    });

    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({
      providerId: "oidc",
      scopes: ["openid", "profile", "email"],
    });
    expect(mappedUser).toEqual({
      id: "subject_1",
      name: "Person",
      email: "person@example.com",
      emailVerified: true,
      image: "https://example.com/avatar.png",
    });
    expect(mappedUser).not.toHaveProperty("groups");
  });

  it("captures OIDC claims and creates organization, team, and team membership assignments", async () => {
    configureOidcEnv([
      {
        group: "analytics-admins",
        organizationId: "org_1",
        role: "admin",
        teamIds: ["team_existing"],
        teamNames: ["Analytics"],
      },
    ]);
    dbMock.userFindFirst.mockResolvedValue({ id: "user_1", email: "person@example.com" });
    dbMock.tx.query.member.findFirst.mockResolvedValue(null);
    dbMock.tx.query.team.findFirst.mockResolvedValue(null);
    dbMock.tx.selectResults = [[{ id: "team_existing" }], []];

    const [provider] = getBetterAuthOidcProviders();
    provider.mapProfileToUser?.({
      id: "subject_1",
      name: "Person",
      email: "person@example.com",
      emailVerified: true,
      image: null,
      groups: ["analytics-admins"],
    });

    await applyOidcGroupMappingForUser("user_1");

    expect(dbMock.transaction).toHaveBeenCalledTimes(1);
    expect(insertCallsForTable("member")[0].values).toEqual(
      expect.objectContaining({
        userId: "user_1",
        organizationId: "org_1",
        role: "admin",
      })
    );
    expect(insertCallsForTable("team")[0].values).toEqual(
      expect.objectContaining({
        name: "Analytics",
        organizationId: "org_1",
      })
    );
    expect(insertCallsForTable("teamMember")[0].values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ teamId: "team_existing", userId: "user_1" }),
        expect.objectContaining({ userId: "user_1" }),
      ])
    );
    expect(authUtilsMock.invalidateSitesAccessCache).toHaveBeenCalledWith("user_1");
  });

  it("keeps existing owner role and does not duplicate existing teams or memberships", async () => {
    configureOidcEnv([
      {
        group: "analytics",
        organizationId: "org_1",
        role: "member",
        teamNames: ["Analytics"],
      },
    ]);
    dbMock.userFindFirst.mockResolvedValue({ id: "user_1", email: "person@example.com" });
    dbMock.tx.query.member.findFirst.mockResolvedValue({
      id: "member_1",
      userId: "user_1",
      organizationId: "org_1",
      role: "owner",
    });
    dbMock.tx.query.team.findFirst.mockResolvedValue({ id: "team_analytics" });
    dbMock.tx.selectResults = [[{ teamId: "team_analytics" }]];

    const [provider] = getBetterAuthOidcProviders();
    provider.mapProfileToUser?.({
      id: "subject_1",
      name: "Person",
      email: "person@example.com",
      emailVerified: true,
      image: null,
      groups: ["analytics"],
    });

    await applyOidcGroupMappingForUser("user_1");

    expect(dbMock.tx.update).not.toHaveBeenCalled();
    expect(insertCallsForTable("member")).toHaveLength(0);
    expect(insertCallsForTable("team")).toHaveLength(0);
    expect(insertCallsForTable("teamMember")).toHaveLength(0);
    expect(authUtilsMock.invalidateSitesAccessCache).toHaveBeenCalledWith("user_1");
  });

  it("does not apply mappings when callback claims are missing or already consumed", async () => {
    configureOidcEnv([
      {
        group: "analytics",
        organizationId: "org_1",
        role: "admin",
      },
    ]);
    dbMock.userFindFirst.mockResolvedValue({ id: "user_1", email: "person@example.com" });

    await applyOidcGroupMappingForUser("user_1");

    expect(dbMock.transaction).not.toHaveBeenCalled();
    expect(authUtilsMock.invalidateSitesAccessCache).not.toHaveBeenCalled();
  });
});
