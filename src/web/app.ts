import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { pool } from "@/lib/db";
import {
  createWebUser,
  getWebUserByEmail,
  getWebUserById,
  createBotInstance,
  listBotInstancesForUser,
  getBotInstanceForUser,
  setBotInstanceEnabled,
  deleteBotInstance,
  getInstanceSetting,
  setInstanceSetting,
} from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { botManager } from "@/bot/manager";
import {
  renderLogin,
  renderSignup,
  renderDashboard,
  renderInstanceSettings,
} from "@/web/views";

declare module "express-session" {
  interface SessionData {
    webUserId?: number;
  }
}

const PgSession = connectPgSimple(session);

export function createWebApp() {
  const app = express();

  app.use(express.urlencoded({ extended: false }));

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error("Please specify SESSION_SECRET in your environment variables.");
  }

  app.use(
    session({
      store: new PgSession({ pool, createTableIfMissing: true }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        // Behind a PaaS's TLS-terminating proxy the app itself sees plain
        // HTTP, so req.secure is false even though the browser connection
        // is HTTPS — trust the proxy's X-Forwarded-Proto instead (see
        // `app.set("trust proxy", 1)` below) so the cookie can still be
        // marked Secure in production.
        secure: process.env.NODE_ENV === "production",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      },
    }),
  );

  app.set("trust proxy", 1);

  function requireAuth(req: Request, res: Response, next: NextFunction) {
    if (!req.session.webUserId) {
      res.redirect("/login");
      return;
    }
    next();
  }

  app.get("/", (_req, res) => res.redirect("/dashboard"));

  app.get("/healthz", (_req, res) => res.send("ok"));

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------

  app.get("/signup", (req, res) => {
    if (req.session.webUserId) return res.redirect("/dashboard");
    res.send(renderSignup());
  });

  app.post("/signup", async (req, res) => {
    const email = String(req.body.email || "").trim();
    const password = String(req.body.password || "");

    if (!email || !password || password.length < 8) {
      res.status(400).send(renderSignup("Enter a valid email and a password of at least 8 characters."));
      return;
    }

    const existing = await getWebUserByEmail(email);
    if (existing) {
      res.status(400).send(renderSignup("An account with that email already exists."));
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await createWebUser(email, passwordHash);
    req.session.webUserId = user.id;
    res.redirect("/dashboard");
  });

  app.get("/login", (req, res) => {
    if (req.session.webUserId) return res.redirect("/dashboard");
    res.send(renderLogin());
  });

  app.post("/login", async (req, res) => {
    const email = String(req.body.email || "").trim();
    const password = String(req.body.password || "");

    const user = await getWebUserByEmail(email);
    // Always run bcrypt.compare, even for a nonexistent user (against a
    // dummy hash), so the response time doesn't leak whether the email is
    // registered.
    const valid = user
      ? await bcrypt.compare(password, user.password_hash)
      : await bcrypt.compare(password, "$2a$12$invalidsaltinvalidsaltinuxWzq3z1z1z1z1z1z1z1z1z1z1z1z");

    if (!user || !valid) {
      res.status(401).send(renderLogin("Incorrect email or password."));
      return;
    }

    req.session.webUserId = user.id;
    res.redirect("/dashboard");
  });

  app.post("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/login"));
  });

  // -----------------------------------------------------------------------
  // Dashboard
  // -----------------------------------------------------------------------

  app.get("/dashboard", requireAuth, async (req, res) => {
    const user = await getWebUserById(req.session.webUserId!);
    if (!user) {
      req.session.destroy(() => res.redirect("/login"));
      return;
    }
    const instances = await listBotInstancesForUser(user.id);
    res.send(
      renderDashboard(
        user.email,
        instances,
        req.query.flash ? String(req.query.flash) : undefined,
        req.query.error ? String(req.query.error) : undefined,
      ),
    );
  });

  app.post("/bots", requireAuth, async (req, res) => {
    const label = String(req.body.label || "").trim() || "My bot";
    const token = String(req.body.token || "").trim();
    const adminsRaw = String(req.body.admins || "").trim();

    if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
      res.redirect("/dashboard?error=" + encodeURIComponent("That doesn't look like a valid Telegram bot token."));
      return;
    }

    const { ciphertext, iv, tag } = encryptSecret(token);
    const instance = await createBotInstance({
      webUserId: req.session.webUserId!,
      label,
      tokenCiphertext: ciphertext,
      tokenIv: iv,
      tokenTag: tag,
      tokenLast6: token.slice(-6),
    });

    if (adminsRaw) {
      await setInstanceSetting(instance.id, "admins", adminsRaw);
    }

    await botManager.start(instance);
    res.redirect("/dashboard?flash=" + encodeURIComponent(`"${label}" added.`));
  });

  app.get("/bots/:id", requireAuth, async (req, res) => {
    const instance = await getBotInstanceForUser(Number(req.params.id), req.session.webUserId!);
    if (!instance) return res.redirect("/dashboard");

    const user = (await getWebUserById(req.session.webUserId!))!;
    const [prefix, botname, admins] = await Promise.all([
      getInstanceSetting(instance.id, "prefix"),
      getInstanceSetting(instance.id, "botname"),
      getInstanceSetting(instance.id, "admins"),
    ]);

    res.send(
      renderInstanceSettings(user.email, instance, {
        prefix: prefix || "/",
        botname: botname || "",
        admins: admins || "",
      }),
    );
  });

  app.post("/bots/:id/settings", requireAuth, async (req, res) => {
    const instance = await getBotInstanceForUser(Number(req.params.id), req.session.webUserId!);
    if (!instance) return res.redirect("/dashboard");

    const prefix = String(req.body.prefix || "/").trim().slice(0, 5) || "/";
    const botname = String(req.body.botname || "").trim();
    const admins = String(req.body.admins || "").trim();

    await Promise.all([
      setInstanceSetting(instance.id, "prefix", prefix),
      setInstanceSetting(instance.id, "botname", botname),
      setInstanceSetting(instance.id, "admins", admins),
    ]);

    // Settings only take effect on the running TelegramBot's in-memory
    // ChatbotConfig if we rebuild it, so restart the instance to pick up
    // the change immediately rather than waiting for the next crash/deploy.
    if (instance.enabled) {
      await botManager.start(instance);
    }

    res.redirect(`/bots/${instance.id}?flash=saved`);
  });

  app.post("/bots/:id/start", requireAuth, async (req, res) => {
    const instance = await getBotInstanceForUser(Number(req.params.id), req.session.webUserId!);
    if (!instance) return res.redirect("/dashboard");
    await setBotInstanceEnabled(instance.id, true);
    await botManager.start({ ...instance, enabled: true });
    res.redirect("/dashboard");
  });

  app.post("/bots/:id/stop", requireAuth, async (req, res) => {
    const instance = await getBotInstanceForUser(Number(req.params.id), req.session.webUserId!);
    if (!instance) return res.redirect("/dashboard");
    await setBotInstanceEnabled(instance.id, false);
    await botManager.stop(instance.id);
    res.redirect("/dashboard");
  });

  app.post("/bots/:id/delete", requireAuth, async (req, res) => {
    const instance = await getBotInstanceForUser(Number(req.params.id), req.session.webUserId!);
    if (!instance) return res.redirect("/dashboard");
    await botManager.stop(instance.id);
    await deleteBotInstance(instance.id);
    res.redirect("/dashboard?flash=" + encodeURIComponent(`"${instance.label}" removed.`));
  });

  return app;
}
