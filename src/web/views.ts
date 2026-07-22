/**
 * Plain server-rendered HTML views for the dashboard. No template engine
 * or frontend framework — matches the rest of this project's minimal
 * dependency footprint. Every user-supplied value is passed through
 * escapeHtml() before being interpolated, since this is the one place in
 * the whole project rendering untrusted input into a browser context.
 */
import { BotInstance } from "@/lib/db";

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const HEAD = `
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0f1115; color: #e6e8eb; margin: 0; padding: 0;
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #9aa1ac; margin: 0 0 28px; font-size: 14px; }
  a { color: #7cb0ff; }
  form.card, .card {
    background: #161922; border: 1px solid #262b38; border-radius: 12px;
    padding: 20px; margin-bottom: 16px;
  }
  label { display: block; font-size: 13px; color: #9aa1ac; margin: 12px 0 6px; }
  label:first-child { margin-top: 0; }
  input[type=email], input[type=password], input[type=text] {
    width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid #2c3140;
    background: #0f1115; color: #e6e8eb; font-size: 14px;
  }
  button, .btn {
    display: inline-block; margin-top: 16px; padding: 10px 16px; border-radius: 8px;
    border: none; background: #3b82f6; color: white; font-size: 14px; cursor: pointer;
    text-decoration: none;
  }
  button.danger, .btn.danger { background: #ef4444; }
  button.secondary, .btn.secondary { background: #2c3140; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .instance { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .instance + .instance { border-top: 1px solid #262b38; margin-top: 12px; padding-top: 12px; }
  .status { font-size: 12px; padding: 3px 8px; border-radius: 999px; font-weight: 600; }
  .status.running { background: #14311f; color: #4ade80; }
  .status.stopped { background: #2a2c33; color: #9aa1ac; }
  .status.starting { background: #332a14; color: #facc15; }
  .status.error { background: #3a1414; color: #f87171; }
  .meta { font-size: 12px; color: #7d8590; margin-top: 2px; }
  .err { background: #2a1414; border: 1px solid #4a1f1f; color: #f8b4b4; padding: 10px 12px;
    border-radius: 8px; font-size: 13px; margin-bottom: 16px; }
  .flash { background: #14311f; border: 1px solid #1f4a2f; color: #a7f3c8; padding: 10px 12px;
    border-radius: 8px; font-size: 13px; margin-bottom: 16px; }
  nav { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  nav .brand { font-weight: 700; }
  code { background: #0f1115; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
  .hint { font-size: 12px; color: #7d8590; margin-top: 6px; }
</style>
`;

function layout(title: string, body: string, nav?: string): string {
  return `<!doctype html>
<html lang="en">
<head><title>${escapeHtml(title)}</title>${HEAD}</head>
<body>
  <div class="wrap">
    ${nav ?? ""}
    ${body}
  </div>
</body>
</html>`;
}

function loggedInNav(email: string): string {
  return `<nav>
    <div class="brand">🤖 Bot Dashboard</div>
    <div class="row" style="align-items:center;">
      <span class="meta">${escapeHtml(email)}</span>
      <form method="post" action="/logout" style="margin:0;">
        <button class="secondary" type="submit" style="margin-top:0;">Log out</button>
      </form>
    </div>
  </nav>`;
}

export function renderLogin(error?: string): string {
  return layout(
    "Log in",
    `
    <h1>Log in</h1>
    <p class="sub">Manage your Telegram bot tokens.</p>
    ${error ? `<div class="err">${escapeHtml(error)}</div>` : ""}
    <form class="card" method="post" action="/login">
      <label>Email</label>
      <input type="email" name="email" required autofocus />
      <label>Password</label>
      <input type="password" name="password" required />
      <button type="submit">Log in</button>
    </form>
    <p class="sub">No account yet? <a href="/signup">Sign up</a></p>
  `,
  );
}

export function renderSignup(error?: string): string {
  return layout(
    "Sign up",
    `
    <h1>Create an account</h1>
    <p class="sub">One account can manage several bot tokens.</p>
    ${error ? `<div class="err">${escapeHtml(error)}</div>` : ""}
    <form class="card" method="post" action="/signup">
      <label>Email</label>
      <input type="email" name="email" required autofocus />
      <label>Password</label>
      <input type="password" name="password" required minlength="8" />
      <p class="hint">At least 8 characters.</p>
      <button type="submit">Sign up</button>
    </form>
    <p class="sub">Already have an account? <a href="/login">Log in</a></p>
  `,
  );
}

function statusBadge(instance: BotInstance): string {
  return `<span class="status ${instance.status}">${instance.status}</span>`;
}

export function renderDashboard(
  email: string,
  instances: BotInstance[],
  flash?: string,
  error?: string,
): string {
  const list = instances.length
    ? instances
        .map(
          (inst) => `
      <div class="instance">
        <div>
          <div><strong>${escapeHtml(inst.label)}</strong> ${statusBadge(inst)}</div>
          <div class="meta">
            ${inst.bot_username ? `@${escapeHtml(inst.bot_username)} &middot; ` : ""}
            token ends <code>${escapeHtml(inst.token_last6)}</code>
            ${inst.status === "error" && inst.last_error ? `<br/><span style="color:#f87171;">${escapeHtml(inst.last_error)}</span>` : ""}
          </div>
        </div>
        <div class="row">
          <a class="btn secondary" href="/bots/${inst.id}">Settings</a>
          <form method="post" action="/bots/${inst.id}/${inst.enabled ? "stop" : "start"}">
            <button class="secondary" type="submit">${inst.enabled ? "Stop" : "Start"}</button>
          </form>
          <form method="post" action="/bots/${inst.id}/delete" onsubmit="return confirm('Remove this bot and its stored token? This cannot be undone.');">
            <button class="danger" type="submit">Remove</button>
          </form>
        </div>
      </div>`,
        )
        .join("")
    : `<p class="sub">No bots added yet.</p>`;

  return layout(
    "Dashboard",
    `
    <h1>Your bots</h1>
    <p class="sub">Each bot runs on its own Telegram token, polled independently.</p>
    ${flash ? `<div class="flash">${escapeHtml(flash)}</div>` : ""}
    ${error ? `<div class="err">${escapeHtml(error)}</div>` : ""}
    <div class="card">${list}</div>

    <h1>Add a bot</h1>
    <p class="sub">
      Create a bot with <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a>
      and paste its token below. Your Telegram numeric user id (from
      <a href="https://t.me/userinfobot" target="_blank" rel="noopener">@userinfobot</a>) as an admin
      lets you use admin-only commands like <code>/prefix</code>.
    </p>
    <form class="card" method="post" action="/bots">
      <label>Label</label>
      <input type="text" name="label" placeholder="My bot" required />
      <label>Bot token</label>
      <input type="text" name="token" placeholder="123456789:AA..." required autocomplete="off" />
      <label>Admin Telegram ID(s), comma-separated</label>
      <input type="text" name="admins" placeholder="e.g. 123456789" />
      <button type="submit">Add &amp; start</button>
    </form>
  `,
    loggedInNav(email),
  );
}

export function renderInstanceSettings(
  email: string,
  instance: BotInstance,
  settings: { prefix: string; botname: string; admins: string },
  flash?: string,
): string {
  return layout(
    "Bot settings",
    `
    <h1>${escapeHtml(instance.label)} settings</h1>
    <p class="sub">${statusBadge(instance)} ${instance.bot_username ? `&middot; @${escapeHtml(instance.bot_username)}` : ""}</p>
    ${flash ? `<div class="flash">${escapeHtml(flash)}</div>` : ""}
    <form class="card" method="post" action="/bots/${instance.id}/settings">
      <label>Command prefix</label>
      <input type="text" name="prefix" value="${escapeHtml(settings.prefix)}" maxlength="5" required />
      <label>Bot name (used for passive "hey &lt;name&gt;" AI triggers)</label>
      <input type="text" name="botname" value="${escapeHtml(settings.botname)}" />
      <label>Admin Telegram ID(s), comma-separated</label>
      <input type="text" name="admins" value="${escapeHtml(settings.admins)}" />
      <button type="submit">Save</button>
    </form>
    <p><a href="/dashboard">&larr; Back to dashboard</a></p>
  `,
    loggedInNav(email),
  );
}
