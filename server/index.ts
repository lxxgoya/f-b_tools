import { backupDatabase } from "./backup.ts";
import { resendMailer } from "./email.ts";
import { createApp } from "./app.ts";
import { resolve } from "node:path";
import { createServer } from "node:http";
import express from "express";
const production = process.env.NODE_ENV === "production";
if (!process.env.APP_ORIGIN && process.env.RENDER_EXTERNAL_URL)
  process.env.APP_ORIGIN = process.env.RENDER_EXTERNAL_URL;
if (production && (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM))
  throw new Error(
    "Production requires RESEND_API_KEY and a verified MAIL_FROM sender",
  );
if (production && !process.env.APP_ORIGIN)
  throw new Error("Production requires APP_ORIGIN=https://your-domain.example");
if (production && new URL(process.env.APP_ORIGIN!).protocol !== "https:")
  throw new Error("Production APP_ORIGIN must use HTTPS");
const databasePath = process.env.DATABASE_PATH || resolve("data/haru.sqlite");
const { app, db } = createApp(databasePath, {
  secureCookie: production,
  requireEmailVerification: production,
  appOrigin: process.env.APP_ORIGIN,
  sendAccountMail:
    process.env.RESEND_API_KEY && process.env.MAIL_FROM
      ? resendMailer(process.env.RESEND_API_KEY, process.env.MAIL_FROM)
      : undefined,
  trustProxyHops: process.env.TRUST_PROXY_HOPS
    ? Number(process.env.TRUST_PROXY_HOPS)
    : 0,
});
let vite:
  Awaited<ReturnType<(typeof import("vite"))["createServer"]>> | undefined;
if (production) {
  app.use((_req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    next();
  });
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer: createViteServer } = await import("vite");
  vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const server = createServer(app);
server.on("error", async (error) => {
  console.error("Server could not start:", error.message);
  await vite?.close();
  db.close();
  process.exit(1);
});
server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log(
    `Haru running on port ${(server.address() as { port: number }).port} (${production ? "production" : "development"})`,
  ),
);
let backupRunning = false;
async function scheduledBackup() {
  if (backupRunning) return;
  backupRunning = true;
  try {
    await backupDatabase(databasePath, process.env.BACKUP_DIRECTORY);
    console.log("Database backup verified");
  } catch (e) {
    console.error(
      "Database backup failed:",
      e instanceof Error ? e.message : "unknown",
    );
  } finally {
    backupRunning = false;
  }
}
const backupTimer = production
  ? setInterval(() => void scheduledBackup(), 12 * 60 * 60_000)
  : undefined;
backupTimer?.unref();
if (production) void scheduledBackup();
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(backupTimer);
  await vite?.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  server.closeIdleConnections();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
