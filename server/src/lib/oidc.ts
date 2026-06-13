import { and, eq, inArray } from "drizzle-orm";
import type { GenericOAuthConfig } from "better-auth/plugins";

import { db } from "../db/postgres/postgres.js";
import { member, team, teamMember, user } from "../db/postgres/schema.js";

export type OidcRole = "owner" | "admin" | "member";

export interface OidcGroupMapping {
  group: string;
  organizationId: string;
  role?: OidcRole;
  teamIds?: string[];
  teamNames?: string[];
}

export interface ParsedOidcProvider extends GenericOAuthConfig {
  name: string;
  groupClaim: string;
  groupMappings: OidcGroupMapping[];
}

export interface OidcAssignment {
  organizationId: string;
  role: OidcRole;
  teamIds: string[];
  teamNames: string[];
}

type Claims = Record<string, unknown>;

const pendingClaimsByProviderEmail = new Map<string, { claims: Claims; expiresAt: number }>();
const CLAIM_TTL_MS = 10 * 60 * 1000;
export const OIDC_PROVIDER_ID = "oidc";

function splitEnvList(value?: string) {
  return (value ?? "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function parseGroupMappings(value?: string): OidcGroupMapping[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    const mappings: OidcGroupMapping[] = [];

    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const group = typeof record.group === "string" ? record.group.trim() : "";
      const organizationId = typeof record.organizationId === "string" ? record.organizationId.trim() : "";
      if (!group || !organizationId) continue;

      const role =
        record.role === "owner" || record.role === "admin" || record.role === "member" ? record.role : "member";
      const teamIds = Array.isArray(record.teamIds)
        ? record.teamIds.filter((teamId): teamId is string => typeof teamId === "string" && teamId.trim().length > 0)
        : [];
      const teamNames = Array.isArray(record.teamNames)
        ? record.teamNames.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
        : [];

      mappings.push({ group, organizationId, role, teamIds, teamNames });
    }

    return mappings;
  } catch {
    return [];
  }
}

function isValidUrl(value?: string) {
  if (!value) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function parseOidcProvider(env: NodeJS.ProcessEnv): ParsedOidcProvider | null {
  const clientId = env.OIDC_CLIENT_ID;
  const clientSecret = env.OIDC_CLIENT_SECRET;
  const discoveryUrl = env.OIDC_DISCOVERY_URL;
  if (!clientId || !clientSecret || !isValidUrl(discoveryUrl)) return null;

  const scopes = splitEnvList(env.OIDC_SCOPES);

  return {
    providerId: OIDC_PROVIDER_ID,
    name: env.OIDC_NAME || "SSO",
    clientId,
    clientSecret,
    discoveryUrl,
    scopes: scopes.length > 0 ? scopes : ["openid", "profile", "email"],
    groupClaim: env.OIDC_GROUP_CLAIM || "groups",
    groupMappings: parseGroupMappings(env.OIDC_GROUP_MAPPING),
  };
}

function normalizeClaimValues(value: unknown) {
  if (Array.isArray(value)) {
    return new Set(value.filter((item): item is string => typeof item === "string"));
  }
  if (typeof value === "string") {
    return new Set([value]);
  }
  return new Set<string>();
}

export function buildOidcAssignments(provider: ParsedOidcProvider, claims: Claims): OidcAssignment[] {
  const groups = normalizeClaimValues(claims[provider.groupClaim]);
  const byOrganization = new Map<string, OidcAssignment>();

  for (const mapping of provider.groupMappings) {
    if (!groups.has(mapping.group)) continue;

    const existing = byOrganization.get(mapping.organizationId) ?? {
      organizationId: mapping.organizationId,
      role: "member" as OidcRole,
      teamIds: [],
      teamNames: [],
    };

    existing.role = strongestRole(existing.role, mapping.role ?? "member");
    existing.teamIds = Array.from(new Set([...existing.teamIds, ...(mapping.teamIds ?? [])]));
    existing.teamNames = Array.from(new Set([...existing.teamNames, ...(mapping.teamNames ?? [])]));
    byOrganization.set(mapping.organizationId, existing);
  }

  return Array.from(byOrganization.values());
}

function strongestRole(current: OidcRole, next: OidcRole): OidcRole {
  const rank: Record<OidcRole, number> = { member: 0, admin: 1, owner: 2 };
  return rank[next] > rank[current] ? next : current;
}

export function storeOidcClaims(claims: Claims) {
  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : null;
  if (!email) return;

  pendingClaimsByProviderEmail.set(email, {
    claims,
    expiresAt: Date.now() + CLAIM_TTL_MS,
  });
}

function consumeOidcClaims(email: string) {
  const key = email.toLowerCase();
  const pending = pendingClaimsByProviderEmail.get(key);
  pendingClaimsByProviderEmail.delete(key);
  if (!pending || pending.expiresAt < Date.now()) return null;
  return pending.claims;
}

export function getOidcProvider() {
  return parseOidcProvider(process.env);
}

export function getBetterAuthOidcProviders(): GenericOAuthConfig[] {
  const provider = getOidcProvider();
  if (!provider) return [];

  return [
    {
      providerId: provider.providerId,
      clientId: provider.clientId,
      clientSecret: provider.clientSecret,
      discoveryUrl: provider.discoveryUrl,
      scopes: provider.scopes,
      mapProfileToUser: profile => {
        storeOidcClaims(profile);
        return {
          id:
            typeof profile.id === "string"
              ? profile.id
              : typeof profile.sub === "string"
                ? profile.sub
                : String(profile.id ?? ""),
          name: typeof profile.name === "string" ? profile.name : "",
          email: typeof profile.email === "string" ? profile.email : "",
          emailVerified: Boolean(profile.emailVerified ?? profile.email_verified),
          image: typeof profile.image === "string" ? profile.image : null,
        };
      },
    },
  ];
}

export async function applyOidcGroupMappingForUser(userId: string) {
  const provider = getOidcProvider();
  if (!provider || provider.groupMappings.length === 0) return;

  const userRecord = await db.query.user.findFirst({
    where: eq(user.id, userId),
  });
  if (!userRecord?.email) return;

  const claims = consumeOidcClaims(userRecord.email);
  if (!claims) return;

  const assignments = buildOidcAssignments(provider, claims);
  if (assignments.length === 0) return;

  const now = new Date().toISOString();

  for (const assignment of assignments) {
    await db.transaction(async tx => {
      const existingMember = await tx.query.member.findFirst({
        where: and(eq(member.userId, userId), eq(member.organizationId, assignment.organizationId)),
      });

      if (existingMember) {
        const nextRole = existingMember.role === "owner" && assignment.role !== "owner" ? "owner" : assignment.role;
        if (existingMember.role !== nextRole) {
          await tx.update(member).set({ role: nextRole }).where(eq(member.id, existingMember.id));
        }
      } else {
        await tx.insert(member).values({
          id: crypto.randomUUID(),
          userId,
          organizationId: assignment.organizationId,
          role: assignment.role,
          createdAt: now,
        });
      }

      const resolvedTeamIds = new Set<string>();
      if (assignment.teamIds.length > 0) {
        const teamsById = await tx
          .select({ id: team.id })
          .from(team)
          .where(and(eq(team.organizationId, assignment.organizationId), inArray(team.id, assignment.teamIds)));
        teamsById.forEach(teamRecord => {
          if (teamRecord.id) resolvedTeamIds.add(teamRecord.id);
        });
      }

      for (const teamName of assignment.teamNames) {
        const existingTeam = await tx.query.team.findFirst({
          where: and(eq(team.organizationId, assignment.organizationId), eq(team.name, teamName)),
        });

        if (existingTeam?.id) {
          resolvedTeamIds.add(existingTeam.id);
        } else {
          const teamId = crypto.randomUUID();
          await tx.insert(team).values({
            id: teamId,
            name: teamName,
            organizationId: assignment.organizationId,
            createdAt: now,
            updatedAt: now,
          });
          resolvedTeamIds.add(teamId);
        }
      }

      if (resolvedTeamIds.size > 0) {
        const existingTeamMemberships = await tx
          .select({ teamId: teamMember.teamId })
          .from(teamMember)
          .where(and(eq(teamMember.userId, userId), inArray(teamMember.teamId, Array.from(resolvedTeamIds))));
        const existingTeamIds = new Set(existingTeamMemberships.map(teamRecord => teamRecord.teamId));
        const missingTeamIds = Array.from(resolvedTeamIds).filter(teamId => !existingTeamIds.has(teamId));

        if (missingTeamIds.length > 0) {
          await tx.insert(teamMember).values(
            missingTeamIds.map(teamId => ({
              id: crypto.randomUUID(),
              teamId,
              userId,
              createdAt: now,
            }))
          );
        }
      }
    });
  }

  const { invalidateSitesAccessCache } = await import("./auth-utils.js");
  invalidateSitesAccessCache(userId);
}
