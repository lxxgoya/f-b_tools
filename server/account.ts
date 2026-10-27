import type { Express, Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { MailDeliveryError, type SendAccountMail } from "./email.ts";
const scrypt = promisify(scryptCallback);
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
const token = z.string().regex(/^[a-f0-9]{64}$/);
export type AccountOptions = {
  requireEmailVerification?: boolean;
  appOrigin?: string;
  sendAccountMail?: SendAccountMail;
  trustProxyHops?: number;
};
export function installAccountRoutes(
  app: Express,
  db: DatabaseSync,
  options: AccountOptions,
  signIn: (res: Response, id: string) => void,
) {
  if (
    options.requireEmailVerification &&
    (!options.sendAccountMail || !options.appOrigin)
  )
    throw new Error(
      "Email verification requires an origin and a configured mail sender",
    );
  db.exec(`CREATE TABLE IF NOT EXISTS verified_emails(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,verified_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS account_tokens(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,purpose TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS account_tokens_user ON account_tokens(user_id);
 CREATE TABLE IF NOT EXISTS auth_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL);`);
  const verified = (id: string) =>
    !!db.prepare("SELECT user_id FROM verified_emails WHERE user_id=?").get(id);
  async function issue(
    user: { id: string; email: string },
    purpose: "verify" | "reset",
  ) {
    if (!options.sendAccountMail || !options.appOrigin)
      throw new Error("Mail sender is not configured");
    const raw = randomBytes(32).toString("hex"),
      now = Date.now();
    db.prepare("DELETE FROM account_tokens WHERE expires_at<=?").run(now);
    db.prepare("INSERT INTO account_tokens VALUES(?,?,?,?)").run(
      digest(raw),
      user.id,
      purpose,
      now + (purpose === "verify" ? 24 * 60 : 30) * 60_000,
    );
    const url = new URL(options.appOrigin);
    url.hash = `${purpose === "verify" ? "verify-email" : "reset-password"}=${raw}`;
    try {
      await options.sendAccountMail({
        to: user.email,
        purpose,
        url: url.toString(),
      });
    } catch {
      db.prepare("DELETE FROM account_tokens WHERE token=?").run(digest(raw));
      throw new MailDeliveryError(
        "계정 안내 메일을 보내지 못했습니다. 잠시 후 다시 요청해주세요.",
      );
    }
  }
  const notice = {
    message:
      "입력한 계정으로 진행할 수 있다면 안내 메일을 보냈어요. 받은편지함과 스팸함을 확인해주세요.",
  };
  app.post("/api/auth/resend-verification", async (req, res) => {
    const d = z.object({ email }).strict().parse(req.body);
    if (!options.sendAccountMail) {
      res
        .status(503)
        .json({ error: "이메일 발송 기능이 아직 연결되지 않았습니다." });
      return;
    }
    const u = db
      .prepare("SELECT id,email FROM users WHERE email=?")
      .get(d.email) as { id: string; email: string } | undefined;
    if (u && !verified(u.id)) await issue(u, "verify");
    res.status(202).json(notice);
  });
  app.post("/api/auth/verify-email", (req, res) => {
    const d = z.object({ token }).strict().parse(req.body);
    db.exec("BEGIN");
    try {
      const row = db
        .prepare(
          "DELETE FROM account_tokens WHERE token=? AND purpose='verify' AND expires_at>? RETURNING user_id",
        )
        .get(digest(d.token), Date.now()) as { user_id: string } | undefined;
      if (!row) {
        db.exec("ROLLBACK");
        res
          .status(400)
          .json({
            error:
              "확인 링크가 만료되었거나 이미 사용되었습니다. 안내 메일을 다시 요청하세요.",
          });
        return;
      }
      db.prepare("INSERT OR IGNORE INTO verified_emails VALUES(?,?)").run(
        row.user_id,
        new Date().toISOString(),
      );
      db.prepare(
        "DELETE FROM account_tokens WHERE user_id=? AND purpose='verify'",
      ).run(row.user_id);
      const u = db
        .prepare("SELECT id,email,name FROM users WHERE id=?")
        .get(row.user_id)!;
      signIn(res, row.user_id);
      db.exec("COMMIT");
      res.json(u);
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
  app.post("/api/auth/forgot-password", async (req, res) => {
    const d = z.object({ email }).strict().parse(req.body);
    if (!options.sendAccountMail) {
      res
        .status(503)
        .json({
          error: "비밀번호 재설정 메일 기능이 아직 연결되지 않았습니다.",
        });
      return;
    }
    const u = db
      .prepare("SELECT id,email FROM users WHERE email=?")
      .get(d.email) as { id: string; email: string } | undefined;
    if (u) await issue(u, "reset");
    res.status(202).json(notice);
  });
  app.post("/api/auth/reset-password", async (req, res) => {
    const d = z
      .object({
        token,
        password: z
          .string()
          .min(10, "비밀번호는 10자 이상 입력하세요.")
          .max(128),
      })
      .strict()
      .parse(req.body);
    const invalid = () =>
      res
        .status(400)
        .json({
          error:
            "재설정 링크가 만료되었거나 이미 사용되었습니다. 다시 요청하세요.",
        });
    if (
      !db
        .prepare(
          "SELECT token FROM account_tokens WHERE token=? AND purpose='reset' AND expires_at>?",
        )
        .get(digest(d.token), Date.now())
    ) {
      invalid();
      return;
    }
    const salt = randomBytes(16).toString("hex"),
      key = (await scrypt(d.password, salt, 64)) as Buffer;
    db.exec("BEGIN");
    try {
      const row = db
        .prepare(
          "DELETE FROM account_tokens WHERE token=? AND purpose='reset' AND expires_at>? RETURNING user_id",
        )
        .get(digest(d.token), Date.now()) as { user_id: string } | undefined;
      if (!row) {
        db.exec("ROLLBACK");
        invalid();
        return;
      }
      db.prepare("UPDATE users SET password=? WHERE id=?").run(
        `${salt}:${key.toString("hex")}`,
        row.user_id,
      );
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(row.user_id);
      db.prepare(
        "DELETE FROM account_tokens WHERE user_id=? AND purpose='reset'",
      ).run(row.user_id);
      db.exec("COMMIT");
      res.json({
        message: "비밀번호를 변경했어요. 새 비밀번호로 로그인해주세요.",
      });
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
  return { verified, issue };
}
