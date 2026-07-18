# TelegramBOT

A TypeScript Telegram bot with AI chat, Facebook/YouTube downloading, and TikTok/Shoti commands.

## Stack

- **Runtime**: Node.js with `tsx` (TypeScript execution)
- **Bot library**: `node-telegram-bot-api`
- **AI**: Groq SDK (powers `/ai` command)
- **Keep-alive**: Express HTTP server

## Running the bot

```bash
npm install
npm run dev   # development (watch mode)
npm start     # production
```

## Required environment variables

| Variable | Required | Description |
|---|---|---|
| `BOT_TOKEN` | ✅ Yes | Telegram bot token from @BotFather |
| `GROQ_API_KEY` | Optional | Powers the `/ai` command |
| `SHOTI_APIKEY` | Optional | Powers `/shoti` and `/ishoti` TikTok commands |
| `PORT` | Optional | Keep-alive server port (defaults to 3000) |
| `DATABASE_URL` | ✅ Yes | NeonDB (Postgres) connection string — powers users, groups, balances, XP/levels. See "Database" below. |

See `.env.example` for a template.

## Database

Backed by NeonDB (Postgres). Schema lives in `sql/migrations/`, applied with:

```bash
npm run db:migrate
```

Tables: `users`, `groups`, `group_members`, `user_wallets` + `wallet_transactions`
(coin balance and its audit ledger), `user_levels` (per-group XP/level),
`level_rewards` (optional per-level custom coin bonus/message). XP is
awarded and level-ups are detected by `src/events/rankup.ts`, which fires
on every group message.

## Project structure

```
sql/
  migrations/     # Postgres schema migrations (run via `npm run db:migrate`)
src/
  index.ts        # Entry point — wires commands and events
  config.ts       # Bot configuration
  keep_alive.ts   # Express keep-alive server
  agent/          # AI agent logic
  commands/       # Bot command handlers
  events/         # Bot event handlers
  lib/            # DB client, greet card renderer, other shared logic
  scripts/        # One-off scripts (migration runner)
  types/          # TypeScript type definitions
  utils/          # Shared utilities (wrapper, markdown, etc.)
```

## User preferences

- Imported from GitHub; keep existing structure and stack.
