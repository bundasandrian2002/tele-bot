# TelegramBOT — multi-user web dashboard

A TypeScript Telegram bot with AI chat, Facebook/YouTube downloading, and
TikTok-download/leveling/moderation commands — now driven by a web
dashboard where each user securely adds and manages their own bot token,
instead of one bot token hardcoded into the environment.

## What changed from the single-bot version

- **Web dashboard** (Express + server-rendered HTML) at `/` — sign up, log
  in, add a Telegram bot token, start/stop it, edit its prefix/admins, or
  remove it.
- **Multiple bots, one process.** Every user's bot runs as its own
  `node-telegram-bot-api` polling instance inside one shared Node process
  (`src/bot/manager.ts`), started/stopped on demand from the dashboard —
  no redeploy needed to add a bot.
- **Tokens encrypted at rest** (AES-256-GCM, `src/lib/crypto.ts`) using a
  server-held `ENCRYPTION_KEY` that's never stored in the database.
- **Removed:** `/shoti`, `/ishoti`, `/shoticron`, `/shotiv0`, and `/add`
  (the TikTok "shoti" content family, including the auto-posting cron).
  That family pulls unvetted clips from an unofficial third-party scraper
  and is a known pattern for surfacing sexualized content of young-looking
  creators without consent — not something this build automates or scales
  to more users.
- **`/eval` disabled by default.** All tenants share one process now, so
  arbitrary code run via `/eval` isn't isolated between them — it could
  read another tenant's decrypted bot token or `ENCRYPTION_KEY` out of
  memory. Opt in with `ENABLE_EVAL_COMMAND=true` only on a single-tenant or
  fully trusted deployment.
- **`/restart` restarts only the calling tenant's bot** (reconnects that
  one polling session), not the whole shared process.

## Known limitation — not yet multi-tenant: shared data

`users`, `groups`, `group_members`, `user_wallets`, and `user_levels` have
**no per-bot-instance scoping**. Coin balances, XP/levels, and group
records are shared across every tenant's bot in this deployment — e.g. a
Telegram user's coin balance is the same no matter which tenant's bot they
talk to. Fine for a single operator running several bots for their own
communities; not safe yet for mutually-untrusting tenants. Fixing this
means adding a `bot_instance_id` column to those tables and scoping every
query in `src/lib/db.ts` by it — a larger schema change intentionally left
out of this pass. `AutoGreet` (`src/lib/autogreetScheduler.ts`) is left
unwired for the same reason (it would broadcast into every tenant's groups
at once).

## Stack

- **Runtime**: Node.js with `tsx` (TypeScript execution)
- **Bot library**: `node-telegram-bot-api`
- **Web**: Express + `express-session` (Postgres-backed via
  `connect-pg-simple`) + `bcryptjs` for password hashing
- **AI**: Groq SDK (powers the `/ai` command)
- **DB**: NeonDB (Postgres) via `pg`

## Running

```bash
npm install
npm run db:migrate   # applies sql/migrations/, including the new web/multi-user tables
npm run dev          # development (watch mode)
npm start             # production
```

Open the port shown in the logs (default `3000`) and sign up. From the
dashboard, add a bot token from
[@BotFather](https://t.me/BotFather) — it starts polling immediately.

## Required environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ Yes | NeonDB (Postgres) connection string. |
| `ENCRYPTION_KEY` | ✅ Yes | 32 bytes, base64 — encrypts stored bot tokens. |
| `SESSION_SECRET` | ✅ Yes | Signs the dashboard's session cookie. |
| `GROQ_API_KEY` | Optional | Powers `/ai`, via [Groq](https://console.groq.com). |
| `PORT` | Optional | Web dashboard port (defaults to 3000). |
| `NODE_ENV` | Optional | Set to `production` when deployed (marks the session cookie Secure). |
| `ENABLE_EVAL_COMMAND` | Optional | `true` to re-enable `/eval` (see warning above). |

Generate `ENCRYPTION_KEY`/`SESSION_SECRET` with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

See `.env.example` for a template. `BOT_TOKEN` and `SHOTI_APIKEY` from the
old single-bot setup are no longer used — bot tokens are added per user
through the dashboard instead.

## Database

Schema lives in `sql/migrations/`, applied with `npm run db:migrate`.
`sql/migrations/0003_web_multiuser.sql` adds `web_users`, `bot_instances`
(encrypted tokens + status), and `bot_instance_settings` (per-bot prefix,
admins, developer mode). Existing tables from the single-bot version are
unchanged (see the shared-data limitation above).

## Project structure

```
sql/
  migrations/     # Postgres schema migrations (run via `npm run db:migrate`)
src/
  index.ts        # Entry point — starts the bot manager + web dashboard
  config.ts       # Fallback ChatbotConfig defaults (each tenant overrides via DB)
  bot/
    manager.ts    # Starts/stops one polling TelegramBot per user token
  web/
    app.ts        # Express app: auth + bot token management routes
    views.ts       # Server-rendered HTML views
  agent/          # AI agent logic
  commands/       # Bot command handlers
  events/         # Bot event handlers
  lib/            # DB client, crypto, greet card renderer, other shared logic
  scripts/        # One-off scripts (migration runner)
  types/          # TypeScript type definitions
  utils/          # Shared utilities (wrapper, markdown, etc.)
```

## User preferences

- Imported from GitHub; keep existing structure and stack.
