---
title: team.jacarendalabs.com login wall
summary: Host the J Labs AI team on Paperclip at team.jacarendalabs.com behind an authenticated wall with TOTP 2FA, password reset and a show/hide password control
status: PLAN, not yet executed
created: 2026-10-24
---

# Goal

Run this Paperclip fork at `https://team.jacarendalabs.com`, reachable only after login, with:

1. TOTP two factor authentication
2. Password reset by email
3. A show/hide toggle on every password field

# Decisions (locked 2026-10-24)

| Decision | Choice | Why |
|---|---|---|
| Login wall | Extend Paperclip's own Better Auth | Paperclip owns per-user identity for boards, companies, budgets and audit. A proxy wall cannot supply that: it has no SSO or proxy-identity support (see Baseline). |
| Hosting | Fly.io | Needs a long-lived process, a persistent volume and spawned agent CLIs, so Vercel is out. Fly issues Let's Encrypt certs, which the apex CAA already permits. |
| Database | Embedded Postgres on the Fly volume now, a dedicated Supabase project later | Decided 2026-10-24. Sharing the website's database was rejected: `agents` collides (`supabase/migrations/20260504000008_agents_presence.sql:9` vs `packages/db/src/migrations/0000_mature_masked_marvel.sql`), the website's `create table if not exists` makes that collision silent in one direction, and a Paperclip credential in that database bypasses RLS on live business data while running autonomous agent CLIs. Same Supabase org, separate project. |
| Email transport | Resend over plain `fetch` | `resend._domainkey` is already verified on the apex. Calling the REST API directly adds zero dependencies, so `package.json` and `pnpm-lock.yaml` stay free of fork-only diffs. |

# Verified baseline

Everything below was read in this tree, not assumed.

## Already present, reuse as is

- Authenticated wall: `PAPERCLIP_DEPLOYMENT_MODE=authenticated` with `PAPERCLIP_DEPLOYMENT_EXPOSURE=public`, documented in `docs/deploy/deployment-modes.md`. The production Docker stage already defaults to `authenticated` + `private` (`Dockerfile:216-231`).
- Better Auth email and password sign-in, invite-only capable through `PAPERCLIP_AUTH_DISABLE_SIGN_UP=true` (`server/src/auth/better-auth.ts:273-277`, `server/src/config.ts:234-238`).
- Auth rate limiting turns on automatically in `authenticated` mode (`server/src/auth/better-auth.ts:67-86`).
- Trusted origins derive from `PAPERCLIP_PUBLIC_URL` plus `PAPERCLIP_ALLOWED_HOSTNAMES` (`server/src/auth/better-auth.ts:184-210`, `server/src/config.ts:218-241`). Setting `PAPERCLIP_PUBLIC_URL` alone also flips `authBaseUrlMode` to `explicit`.
- Board claim flow promotes the first signed-in user to instance admin (`docs/deploy/deployment-modes.md`).
- Invite flow for adding members after sign-up is disabled, v2026.416.0 onward (`docs/deploy/aws-ecs.md:427`).
- Container contract: port `3100`, data dir `/paperclip` via `PAPERCLIP_HOME`, health at `/api/health` (`Dockerfile:216-233`).

## Absent, this is the actual build

| Ask | State in this tree | Evidence |
|---|---|---|
| 2FA | No `twoFactor` plugin registered; no `twoFactorEnabled` column; no `twoFactor` table | `server/src/auth/better-auth.ts:285-305`, `packages/db/src/schema/auth.ts:3-11` |
| Password reset | No `sendResetPassword` callback, and no email library anywhere in the repo | `server/src/auth/better-auth.ts:273-277`; `grep` for resend/nodemailer/ses/postmark across all `package.json` returns nothing |
| Show/hide password | Plain `type="password"` | `ui/src/pages/Auth.tsx:178` |

The J Labs admin app at `admin.jacarendalabs.com` supplies a working reference for two of the three, but not a drop-in: it is Next.js plus Supabase Auth, where this is Express plus Better Auth. Borrow the flow shape and the policies, not the code.

- Reference MFA: `apps/website/src/app/api/admin/auth/mfa/{enroll,verify,recovery}/route.ts`
- Reference reset: `apps/website/src/app/api/admin/auth/{forgot,reset}-password/route.ts`
- Reference email client: `packages/email/src/client.ts` reads `RESEND_API_KEY`; senders use `from: Jacarenda Labs <$BOOKING_FROM_EMAIL>`
- Show/hide is absent there too (`apps/website/src/app/admin/login/LoginForm.tsx:83`), so it is net new in both places.

## Better Auth 1.7.2 contract (from vendor docs, to re-confirm against installed types)

- Server: `twoFactor()` from `better-auth/plugins`, TOTP issuer comes from `appName` or `issuer`.
- Schema: `user.twoFactorEnabled` boolean, plus table `twoFactor` with `id`, `userId` FK, `secret`, `backupCodes` JSON, `createdAt`.
- Sign-in returns `twoFactorRedirect: true` with `twoFactorMethods` when a factor is enrolled.
- Reset: `emailAndPassword.sendResetPassword({ user, url, token })`; `POST /request-password-reset` takes `{ email, redirectTo }`; `POST /reset-password` takes `{ newPassword, token }`.

## Infrastructure facts

- `team.jacarendalabs.com` is assigned to no Vercel project. The four assigned names are apex, `www`, `admin` and `business`. It currently resolves only through the wildcard `*` ALIAS, so the name is free to point at Fly.
- DNS is on `ns1/ns2.vercel-dns.com`, team scope `jacarenda-labs`, so records are managed with `vercel dns` in that scope.
- Apex CAA allows `pki.goog`, `sectigo.com` and `letsencrypt.org` only. Fly passes. AWS ACM would have failed until `amazon.com` was added, which is one reason ECS was not chosen.
- Resend DKIM and a `send` MX for `feedback-smtp.eu-west-1.amazonses.com` are already live on the apex.

# Phases

Each phase ends at a gate. A gate is something observed in the running system, not a passing type check. `tsc` and vitest cannot see a wall that does not hold.

## Phase 0: fork hygiene

1. Work on `feat/team-login-wall`. Keep every fork-only doc under `docs/jlabs/` so upstream merges never touch it.
2. Record the upstream sync procedure: `git fetch upstream && git merge upstream/master`.
3. Decide the fork migration number range. Upstream is at `0371` (`packages/db/src/migrations`, 371 files) and adds roughly one per change, so a fork migration taking `0372` collides on the next sync. `check-migration-numbering.ts` enforces 4 digit prefixes, no duplicate numbers, strict ordering and an exact journal-to-file match, but it does *not* require contiguity. Therefore fork migrations take `9000+`, which sorts last permanently.

**Gate:** `pnpm --filter @paperclipai/db exec tsx src/check-migration-numbering.ts` passes on a branch carrying a dummy `9000_` migration, and still passes after a simulated upstream merge that adds `0372`.

## Phase 1: secrets, and the database decision

1. Leave `DATABASE_URL` unset for now. With no `DATABASE_URL` the server starts its own PostgreSQL under `PAPERCLIP_HOME` (`server/src/index.ts:482`, `:574`), which on Fly means the volume. Zero cost, zero new credentials.
2. Generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32`. Never commit it. It is required at boot and the server throws without it (`server/src/auth/better-auth.ts:244-250`).
3. Later, when moving to the dedicated Supabase project: `DATABASE_URL` on the pooled connection with `DATABASE_PREPARED_STATEMENTS=false`, `DATABASE_MIGRATION_URL` on the direct 5432 connection, per `docs/deploy/database.md`.

**Gate:** `/api/health` returns 200 from the running machine, and the startup log line naming the embedded cluster path confirms it resolved to the volume, not to the container filesystem.

## Phase 2: the wall, before any new features

Ship unmodified Paperclip behind the real domain first, so later failures are attributable.

1. `fly launch --no-deploy`, single instance, no auto-stop. It is stateful.
2. Fly volume mounted at `/paperclip` for assets, the local secrets key and agent workspaces. Needed even with external Postgres.
3. Secrets: `DATABASE_URL`, `DATABASE_MIGRATION_URL`, `BETTER_AUTH_SECRET`, plus the agent provider keys you intend to use (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).
4. Env: `PAPERCLIP_DEPLOYMENT_MODE=authenticated`, `PAPERCLIP_DEPLOYMENT_EXPOSURE=public`, `PAPERCLIP_PUBLIC_URL=https://team.jacarendalabs.com`, `PAPERCLIP_ALLOWED_HOSTNAMES=team.jacarendalabs.com`.
5. `fly certs add team.jacarendalabs.com`, then add the CNAME in the `jacarenda-labs` Vercel DNS scope. The wildcard ALIAS does not conflict with a specific CNAME, the specific record wins.
6. First sign-up, then complete the board claim URL printed at startup.
7. Set `PAPERCLIP_AUTH_DISABLE_SIGN_UP=true` and redeploy. Add the rest of the team by invite.

**Gate, all four observed on the live host:**
- Logged out, `https://team.jacarendalabs.com` serves the login page and no board data.
- A wrong password returns 401, and repeated attempts hit the rate limiter.
- Sign-up returns an error once disabled.
- `curl -sf https://team.jacarendalabs.com/api/health` returns 200 over TLS with no cert warning.

## Phase 3: show/hide password

Smallest change, lands first so the test harness is proven before the security-sensitive work.

1. Add a `PasswordField` component in `ui/src/components/` wrapping the existing input styling: a trailing button that flips `type` between `password` and `text`, `aria-pressed`, `aria-label` that changes with state, and `autoComplete` passed through unchanged.
2. Use it in `ui/src/pages/Auth.tsx` and in every later form this plan adds (reset, 2FA enable).

**Gate:** a test asserting the input's `type` attribute actually changes on click, plus a look at the rendered page. Reveal defaults to off on mount.

## Phase 4: password reset

1. `server/src/services/email/resend.ts`: a `sendEmail({ to, subject, html, text })` helper posting to `https://api.resend.com/emails`, reading `RESEND_API_KEY` and `PAPERCLIP_EMAIL_FROM`. An unset key is a hard error at the call site, never a silent no-op, so a reset request cannot look successful while sending nothing.
2. Wire `emailAndPassword.sendResetPassword` in `server/src/auth/better-auth.ts` to build the link from the same resolved public URL the auth instance uses, so a misconfigured env cannot mail a `localhost` link.
3. UI: a "Forgot your password?" link on `Auth.tsx`, a request page, and a `/reset-password` page reading `?token=` and posting `{ newPassword, token }`. Handle the documented `?error=INVALID_TOKEN` branch explicitly.
4. The request response must not reveal whether an address exists.

**Gate:** on production, request a reset for a real mailbox, receive the mail, follow the link, set a new password, sign in with the new password and confirm the old one now fails. Submitting the form is the only evidence that counts here.

## Phase 5: TOTP 2FA

1. Migration `9000_jlabs_two_factor.sql` plus schema additions in `packages/db/src/schema/auth.ts`: `user.two_factor_enabled` boolean not null default false, and a `two_factor` table with FK `user_id` on delete cascade. Check the `twoFactor` plugin's expected column naming against the installed package types before writing the SQL, since Drizzle maps camelCase fields to snake_case columns here.
2. Register `twoFactor({ issuer: "J Labs Team" })` in the plugin list. Note the plugin array is currently built conditionally for `workspaceLoginHandoffPlugin` (`server/src/auth/better-auth.ts:287-305`); append rather than replace, or the workspace handoff silently stops being registered.
3. UI, following the existing raw-`fetch` style in `ui/src/api/auth.ts` rather than adding the Better Auth React client: enable flow showing a QR plus the secret, verification before enabling, one-time display of backup codes, a challenge screen on the `twoFactorRedirect: true` response, and a backup-code path.
4. Policy: require 2FA for instance admins. Decide and write down whether `trustDevice` is allowed, it defaults to 30 days.

**Gate, each one observed:**
- Enrol with a real authenticator, sign out, sign in, and get stopped at the challenge.
- A wrong code is rejected.
- A backup code works once and is refused the second time.
- A user with no factor enrolled can still sign in, so the rollout does not lock the team out.
- Deleting a user cascades the `two_factor` row (verify the FK action, not just the column).

## Phase 6: hardening and handover

1. Confirm `PAPERCLIP_AUTH_DISABLE_SIGN_UP=true` survived the redeploys.
2. Supabase backups on, and a documented restore test.
3. Write `docs/jlabs/RUNBOOK-team.md`: deploy, roll back, rotate `BETTER_AUTH_SECRET`, re-issue the cert, recover a locked-out user.
4. Code review pass on the auth diff before merge.

# Traps

- **Migration numbering.** The real risk is not a failing check, it is a silent overwrite if a fork migration takes a number upstream later reuses. The `9000+` range removes the collision; the journal still needs our entry kept last after each merge.
- **A green type check is not a login wall.** Every gate above names something observed in the running system. `tsc` and vitest read static artefacts and will stay green through a wall that does not hold.
- **An absent instrument reads as an absent defect.** If a reset email does not arrive, establish whether the probe worked before concluding anything about the code.
- **Secure cookies.** `shouldDisableSecureAuthCookies` has several branches (`server/src/auth/better-auth.ts:88-116`). An http public URL or a misread proxy header downgrades cookies. Assert `Secure` on the real `Set-Cookie` from production.
- **Upstream merge surface.** The fork diff should stay confined to: `server/src/auth/better-auth.ts`, one new `server/src/services/email/` file, `packages/db/src/schema/auth.ts`, one `9000+` migration, `ui/src/pages/Auth.tsx`, new UI files, and `docs/jlabs/`. Anything spreading beyond that list is a signal to stop and reconsider.
- **Agent CLIs need keys in the container.** Without them, adapters surface missing prerequisites rather than failing loudly (`docs/deploy/docker.md`).

# Open items

- Which mailbox sends the reset mail: reuse `hello@jacarendalabs.com` or a dedicated `team@`.
- Whether 2FA is mandatory for all members or admins only.
- Fly region and machine size, which depends on how many agents run concurrently.
