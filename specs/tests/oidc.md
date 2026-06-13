# OIDC Login And Group Mapping

Status: Ready

## Goal

Verify that an enabled OIDC provider appears on the login page, completes the OAuth/OIDC callback flow, creates an authenticated Rybbit session, and applies configured group-to-organization/team mappings.

## User Roles

- Anonymous visitor starting from `/login`
- Synthetic OIDC user returned by the local disposable provider

## Environment

- Environment file: `environments/oidc-local.env.yaml`
- Browser base URL: `http://127.0.0.1:3002`
- Backend URL: `http://127.0.0.1:3001`
- OIDC issuer: `http://127.0.0.1:3556`

## Auth

No pre-auth fixture is required. The test signs in through the local OIDC provider.

## Journey

1. Open `/login`.
2. Verify the configured `E2E SSO` OIDC provider is visible.
3. Start OIDC login.
4. Approve the sign-in on the local provider page.
5. Verify the user returns to Rybbit and the session exists.
6. The Node harness performs SQL assertions for organization role and team membership.

## Expected Results

- The user is authenticated as `oidc-user@example.com`.
- The user is a member of `oidc-e2e-org` with role `admin`.
- The user belongs to the `Analytics` and `Support` teams.

## Assertions

- Browser: OIDC button is visible.
- Browser: Provider sign-in button is visible.
- Browser: Better Auth session API returns `oidc-user@example.com`.
- SQL post-check: role is `admin`.
- SQL post-check: mapped team membership count is `2`.

## Test Data

The disposable provider returns the groups `analytics-admins` and `support`. The harness seeds `oidc-e2e-org` before the browser test starts.

## Cleanup

The Docker runner tears down all compose services and volumes after each run.

## Implemented Tests

- `tests/oidc-login.test.yaml`
