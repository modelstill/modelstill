# 0014. Store onboarding completion as a timestamp on the auth user

- **Status:** accepted
- **Date:** 2026-11-24
- **Deciders:** dashboard maintainers

## Context

The dashboard has a sign-up flow: a new user lands on a short onboarding (name, first task, API
key, MCP connection) before the task list. Products with workspaces often decide "onboarded" by
whether the user has one (a Better Auth organization). ModelStill has no workspaces, so it
needs its own per-user flag that survives sign-out, other browsers and new sessions.

## Decision

- `auth_user.onboarded_at` (`timestamp with time zone`, nullable) holds when the user finished or
  skipped onboarding. Migration `apps/api/drizzle/0004_onboarding.sql`.
- It is a Better Auth `additionalFields` entry with `input: false`, so `get-session` returns it and
  `update-user` cannot set it.
- `POST /v1/me/onboarding` (session only) sets it once; repeating it keeps the first time.
- The dashboard layout sends a signed-in user with no `onboardedAt` to `/onboarding`.

## Consequences

- Users who signed in before this change see onboarding once; "Skip" on any step finishes it.
- Resetting a user's onboarding is a SQL update to null; there is no API for it.

## Alternatives considered

- Browser storage: lost on another device, so the flow would repeat.
- A separate `user_onboarding` table with per-step state: more than the dashboard needs, since
  every step can be redone from Settings and Connect.

## Links

- Code: `apps/api/src/auth/onboarding.ts`, `apps/api/test/onboarding.test.ts`,
  `apps/website/src/app/onboarding/`
