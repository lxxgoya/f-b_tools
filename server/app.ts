import { importAntarcticaSample } from "./samples.ts";
import { MailDeliveryError } from "./email.ts";
import { installAccountRoutes, type AccountOptions } from "./account.ts";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
  randomUUID,
} from "node:crypto";
import { promisify } from "node:util";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import {
  makeChecklist,
  draftDocument,
  documentKinds,
  type Collaboration,
  type Store,
} from "../src/domain.ts";
const scrypt = promisify(scryptCallback);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const text = (max = 200) => z.string().trim().min(1).max(max);
const amount = z.number().int().min(0).max(1_000_000_000);
const settlementSchema = z
  .object({
    sales: amount,
    ingredients: amount,
    other: amount,
    wage: amount,
    bonus: amount,
  })
  .strict();
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T00:00:00Z");
    return !isNaN(+d) && d.toISOString().slice(0, 10) === s;
  }, "유효한 날짜를 입력하세요.");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const collaborationSchema = z
  .object({
    title: text(),
    date: dateSchema,
    startTime: time,
    endTime: time,
    collaborator: text(),
    partyType: z.enum(["개인", "사업자"]),
    activity: text(2000),
    food: z.boolean(),
    cooking: z.boolean(),
    outsideFood: z.boolean(),
    worksOnSite: z.boolean(),
    payment: z.enum(["가게", "협업자"]),
    expectedSales: amount,
    expectedIngredients: amount,
    people: z.number().int().min(1).max(1000),
  })
  .strict();
const updateSchema = z
  .object({
    revision: z.number().int().min(0),
    status: z.enum(["준비 중", "운영 예정", "정산 필요", "완료"]).optional(),
    notes: z.string().max(10000).optional(),
    settlement: settlementSchema.optional(),
    checklist: z
      .array(z.object({ id: text(), done: z.boolean() }).strict())
      .max(30)
      .optional(),
  })
  .strict();
const credentials = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    password: z.string().min(10, "비밀번호는 10자 이상 입력하세요.").max(128),
    name: text(80).optional(),
  })
  .strict();
export function createApp(
  dbPath: string,
  options: { secureCookie?: boolean } & AccountOptions = {},
) {
  if (dbPath !== ":memory:")
    mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS stores(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,category TEXT NOT NULL,address TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS collaborations(id TEXT PRIMARY KEY,store_id TEXT NOT NULL REFERENCES stores(id),data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS collaborators(id TEXT PRIMARY KEY,collaboration_id TEXT UNIQUE NOT NULL REFERENCES collaborations(id) ON DELETE CASCADE,name TEXT NOT NULL,party_type TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,collaboration_id TEXT NOT NULL REFERENCES collaborations(id) ON DELETE CASCADE,kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS document_drafts(collaboration_id TEXT NOT NULL REFERENCES collaborations(id) ON DELETE CASCADE,kind TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(collaboration_id,kind));
 CREATE TABLE IF NOT EXISTS drafts(store_id TEXT PRIMARY KEY REFERENCES stores(id),data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sample_imports(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,sample_key TEXT NOT NULL,store_id TEXT NOT NULL REFERENCES stores(id),collaboration_id TEXT NOT NULL REFERENCES collaborations(id),PRIMARY KEY(user_id,sample_key));
 CREATE INDEX IF NOT EXISTS stores_user ON stores(user_id);
 CREATE INDEX IF NOT EXISTS collaborations_store ON collaborations(store_id);
 CREATE INDEX IF NOT EXISTS documents_collaboration ON documents(collaboration_id);`);
  const app = express();
  app.disable("x-powered-by");
  if (options.trustProxyHops) app.set("trust proxy", options.trustProxyHops);
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    if (req.path.startsWith("/api/"))
      res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "100kb" }));
  app.use("/api", (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      const configured = process.env.APP_ORIGIN;
      let valid = true;
      if (origin) {
        try {
          valid = configured
            ? origin === new URL(configured).origin
            : new URL(origin).host === req.get("host");
        } catch {
          valid = false;
        }
      }
      if (req.get("sec-fetch-site") === "cross-site" || !valid) {
        res.status(403).json({ error: "다른 사이트에서 보낸 요청입니다." });
        return;
      }
      if (!req.is("application/json")) {
        res.status(415).json({ error: "JSON 요청이 필요합니다." });
        return;
      }
    }
    next();
  });
  type User = { id: string; email: string; name: string; password: string };
  const tokenFrom = (req: Request) =>
    req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("haru_session="))
      ?.slice(13);
  const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name });
  const cookie = (token: string, maxAge: number) =>
    `haru_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${options.secureCookie ? "; Secure" : ""}`;
  function signIn(res: Response, id: string) {
    const token = randomBytes(32).toString("hex");
    const now = Date.now();
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      hash(token),
      id,
      now + 7 * 86400_000,
    );
    res.setHeader("Set-Cookie", cookie(token, 7 * 86400));
  }
  // Place the limiter before all account routes; retain counts across process restarts.
  db.exec(
    "CREATE TABLE IF NOT EXISTS auth_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL)",
  );
  app.use("/api/auth", (req, res, next) => {
    if (req.method !== "POST" || req.path === "/logout") {
      next();
      return;
    }
    const now = Date.now();
    db.prepare("DELETE FROM auth_limits WHERE reset_at<=?").run(now);
    const keys = [{ key: hash(`ip:${req.ip}`), max: 120 }];
    if (typeof req.body?.email === "string")
      keys.push({
        key: hash(`account:${req.path}:${req.body.email.trim().toLowerCase()}`),
        max: 10,
      });
    for (const { key, max } of keys) {
      db.prepare(
        "INSERT INTO auth_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
      ).run(key, now + 15 * 60_000);
      const limit = db
        .prepare("SELECT count,reset_at FROM auth_limits WHERE key=?")
        .get(key) as { count: number; reset_at: number };
      if (limit.count > max) {
        res.setHeader("Retry-After", Math.ceil((limit.reset_at - now) / 1000));
        res
          .status(429)
          .json({ error: "요청이 많습니다. 15분 후 다시 시도하세요." });
        return;
      }
    }
    next();
  });
  const account = installAccountRoutes(app, db, options, signIn);
  app.post("/api/auth/register", async (req, res) => {
    const data = credentials.extend({ name: text(80) }).parse(req.body);
    const salt = randomBytes(16).toString("hex");
    const key = (await scrypt(data.password, salt, 64)) as Buffer;
    const id = randomUUID();
    try {
      db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
        id,
        data.email,
        data.name,
        `${salt}:${key.toString("hex")}`,
        new Date().toISOString(),
      );
    } catch (e) {
      if ((e as Error).message.includes("UNIQUE")) {
        res.status(409).json({ error: "이미 가입된 이메일입니다." });
        return;
      }
      throw e;
    }
    if (options.requireEmailVerification) {
      await account.issue({ id, email: data.email }, "verify");
      res.status(202).json({
        verificationRequired: true,
        email: data.email,
        message:
          "이메일 확인 링크를 보냈어요. 확인 후 가게를 등록할 수 있어요.",
      });
      return;
    }
    signIn(res, id);
    res.status(201).json({ id, email: data.email, name: data.name });
  });
  app.post("/api/auth/login", async (req, res) => {
    const data = credentials.parse(req.body);
    const u = db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(data.email) as User | undefined;
    const [salt, expected] = (
      u?.password || `${"0".repeat(32)}:${"0".repeat(128)}`
    ).split(":");
    const actual = (await scrypt(data.password, salt, 64)) as Buffer;
    if (!u || !timingSafeEqual(actual, Buffer.from(expected, "hex"))) {
      res.status(401).json({ error: "이메일 또는 비밀번호를 확인하세요." });
      return;
    }
    if (options.requireEmailVerification && !account.verified(u.id)) {
      res.status(403).json({
        error:
          "이메일 확인이 필요합니다. 안내 메일을 확인하거나 다시 요청하세요.",
        code: "EMAIL_NOT_VERIFIED",
      });
      return;
    }
    const old = tokenFrom(req);
    if (old) db.prepare("DELETE FROM sessions WHERE token=?").run(hash(old));
    signIn(res, u.id);
    res.json(publicUser(u));
  });
  app.post("/api/auth/logout", (req, res) => {
    const token = tokenFrom(req);
    if (token)
      db.prepare("DELETE FROM sessions WHERE token=?").run(hash(token));
    res.setHeader("Set-Cookie", cookie("", 0));
    res.json({ ok: true });
  });
  app.get("/api/health", (_req, res) => {
    db.prepare("SELECT 1").get();
    res.json({ ok: true });
  });
  app.use("/api", (req, res, next) => {
    const token = tokenFrom(req);
    const u = token
      ? (db
          .prepare(
            "SELECT u.* FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?",
          )
          .get(hash(token), Date.now()) as User | undefined)
      : undefined;
    if (!u) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    if (options.requireEmailVerification && !account.verified(u.id)) {
      res.status(403).json({ error: "이메일 확인 후 이용할 수 있습니다." });
      return;
    }
    res.locals.user = u;
    next();
  });
  app.get("/api/me", (_req, res) => res.json(publicUser(res.locals.user)));
  app.post("/api/samples/antarctica", (_req, res) => {
    const result = importAntarcticaSample(db, res.locals.user.id);
    res.status(result.created ? 201 : 200).json(result);
  });
  function ownedStore(id: string, userId: string) {
    return db
      .prepare(
        "SELECT id,name,category,address FROM stores WHERE id=? AND user_id=?",
      )
      .get(id, userId) as Store | undefined;
  }
  function ownedCollab(id: string, userId: string) {
    const row = db
      .prepare(
        "SELECT c.data FROM collaborations c JOIN stores s ON c.store_id=s.id WHERE c.id=? AND s.user_id=?",
      )
      .get(id, userId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Collaboration) : undefined;
  }
  app.get("/api/stores", (_req, res) =>
    res.json(
      db
        .prepare(
          "SELECT id,name,category,address FROM stores WHERE user_id=? ORDER BY rowid",
        )
        .all(res.locals.user.id),
    ),
  );
  app.post("/api/stores", (req, res) => {
    const s = z
      .object({
        name: text(100),
        category: text(60),
        address: z.string().trim().max(300),
      })
      .strict()
      .parse(req.body);
    const id = randomUUID();
    db.prepare("INSERT INTO stores VALUES(?,?,?,?,?)").run(
      id,
      res.locals.user.id,
      s.name,
      s.category,
      s.address,
    );
    res.status(201).json({ id, ...s });
  });
  app.get("/api/stores/:id/draft", (req, res) => {
    if (!ownedStore(req.params.id as string, res.locals.user.id)) {
      res.status(404).json({ error: "가게를 찾을 수 없습니다." });
      return;
    }
    const r = db
      .prepare("SELECT data FROM drafts WHERE store_id=?")
      .get(req.params.id as string) as { data: string } | undefined;
    res.json(r ? JSON.parse(r.data) : null);
  });
  app.put("/api/stores/:id/draft", (req, res) => {
    if (!ownedStore(req.params.id as string, res.locals.user.id)) {
      res.status(404).json({ error: "가게를 찾을 수 없습니다." });
      return;
    }
    const data = z
      .record(
        z.string(),
        z.union([z.string().max(2000), z.number().finite(), z.boolean()]),
      )
      .parse(req.body);
    db.prepare(
      "INSERT INTO drafts VALUES(?,?) ON CONFLICT(store_id) DO UPDATE SET data=excluded.data",
    ).run(req.params.id as string, JSON.stringify(data));
    res.json({ ok: true });
  });
  app.delete("/api/stores/:id/draft", (req, res) => {
    if (!ownedStore(req.params.id as string, res.locals.user.id)) {
      res.status(404).json({ error: "가게를 찾을 수 없습니다." });
      return;
    }
    db.prepare("DELETE FROM drafts WHERE store_id=?").run(
      req.params.id as string,
    );
    res.json({ ok: true });
  });
  app.get("/api/stores/:id/collaborations", (req, res) => {
    if (!ownedStore(req.params.id as string, res.locals.user.id)) {
      res.status(404).json({ error: "가게를 찾을 수 없습니다." });
      return;
    }
    res.json(
      db
        .prepare(
          "SELECT data FROM collaborations WHERE store_id=? ORDER BY rowid DESC",
        )
        .all(req.params.id as string)
        .map((r) => JSON.parse(r.data as string)),
    );
  });
  app.post("/api/stores/:id/collaborations", (req, res) => {
    if (!ownedStore(req.params.id as string, res.locals.user.id)) {
      res.status(404).json({ error: "가게를 찾을 수 없습니다." });
      return;
    }
    const data = collaborationSchema.parse(req.body);
    const now = new Date().toISOString();
    const id = randomUUID();
    const c: Collaboration = {
      ...data,
      id,
      storeId: req.params.id as string,
      status: "준비 중",
      checklist: makeChecklist(data.food, data.worksOnSite),
      settlement: { sales: 0, ingredients: 0, other: 0, wage: 0, bonus: 0 },
      notes: "",
      createdAt: now,
      updatedAt: now,
      revision: 0,
    };
    db.exec("BEGIN");
    try {
      db.prepare("INSERT INTO collaborations VALUES(?,?,?)").run(
        id,
        c.storeId,
        JSON.stringify(c),
      );
      db.prepare("INSERT INTO collaborators VALUES(?,?,?,?)").run(
        randomUUID(),
        id,
        c.collaborator,
        c.partyType,
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    res.status(201).json(c);
  });
  app.patch("/api/collaborations/:id", (req, res) => {
    const c = ownedCollab(req.params.id as string, res.locals.user.id);
    if (!c) {
      res.status(404).json({ error: "협업을 찾을 수 없습니다." });
      return;
    }
    const data = updateSchema.parse(req.body);
    if (data.revision !== c.revision) {
      res.status(409).json({
        error: "다른 화면에서 수정되었습니다. 새로고침 후 다시 입력하세요.",
      });
      return;
    }
    if (
      c.status === "완료" &&
      (data.settlement || data.checklist || data.notes !== undefined) &&
      !data.status
    ) {
      res
        .status(409)
        .json({ error: "완료한 협업은 먼저 상태를 변경한 뒤 수정하세요." });
      return;
    }
    if (data.checklist) {
      if (data.checklist.some((i) => !c.checklist.some((j) => j.id === i.id))) {
        res.status(400).json({ error: "잘못된 준비 항목입니다." });
        return;
      }
      c.checklist = c.checklist.map((i) => ({
        ...i,
        done: data.checklist?.find((j) => j.id === i.id)?.done ?? i.done,
      }));
    }
    if (data.status) c.status = data.status;
    if (data.notes !== undefined) c.notes = data.notes;
    if (data.settlement) c.settlement = data.settlement;
    c.updatedAt = new Date().toISOString();
    c.revision++;
    db.prepare("UPDATE collaborations SET data=? WHERE id=?").run(
      JSON.stringify(c),
      c.id,
    );
    res.json(c);
  });
  app.get("/api/collaborations/:id/document-drafts", (req, res) => {
    if (!ownedCollab(req.params.id as string, res.locals.user.id)) {
      res.status(404).json({ error: "협업을 찾을 수 없습니다." });
      return;
    }
    res.json(
      Object.fromEntries(
        db
          .prepare(
            "SELECT kind,body FROM document_drafts WHERE collaboration_id=?",
          )
          .all(req.params.id as string)
          .map((r) => [r.kind, r.body]),
      ),
    );
  });
  app.put("/api/collaborations/:id/document-drafts", (req, res) => {
    if (!ownedCollab(req.params.id as string, res.locals.user.id)) {
      res.status(404).json({ error: "협업을 찾을 수 없습니다." });
      return;
    }
    const d = z
      .object({ kind: z.enum(documentKinds), body: z.string().max(30000) })
      .strict()
      .parse(req.body);
    db.prepare(
      "INSERT INTO document_drafts VALUES(?,?,?) ON CONFLICT(collaboration_id,kind) DO UPDATE SET body=excluded.body",
    ).run(req.params.id as string, d.kind, d.body);
    res.json({ ok: true });
  });
  app.get("/api/collaborations/:id/documents", (req, res) => {
    if (!ownedCollab(req.params.id as string, res.locals.user.id)) {
      res.status(404).json({ error: "협업을 찾을 수 없습니다." });
      return;
    }
    res.json(
      db
        .prepare(
          "SELECT id,collaboration_id AS collaborationId,kind,title,body,created_at AS createdAt FROM documents WHERE collaboration_id=? ORDER BY rowid DESC",
        )
        .all(req.params.id as string),
    );
  });
  app.post("/api/collaborations/:id/documents", (req, res) => {
    const c = ownedCollab(req.params.id as string, res.locals.user.id);
    if (!c) {
      res.status(404).json({ error: "협업을 찾을 수 없습니다." });
      return;
    }
    const data = z
      .object({
        kind: z.enum(documentKinds),
        body: z.string().trim().min(1).max(30000).optional(),
      })
      .strict()
      .parse(req.body);
    const store = ownedStore(c.storeId, res.locals.user.id)!;
    const doc = {
      id: randomUUID(),
      collaborationId: c.id,
      kind: data.kind,
      title: `${c.title} · ${data.kind}`,
      body: data.body ?? draftDocument(data.kind, c, store),
      createdAt: new Date().toISOString(),
    };
    db.prepare("INSERT INTO documents VALUES(?,?,?,?,?,?)").run(
      doc.id,
      doc.collaborationId,
      doc.kind,
      doc.title,
      doc.body,
      doc.createdAt,
    );
    res.status(201).json(doc);
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "요청한 기능을 찾을 수 없습니다." }),
  );
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof MailDeliveryError) {
      res.status(503).json({ error: err.message });
      return;
    }
    if (err instanceof z.ZodError) {
      res.status(400).json({
        error: err.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("\n"),
      });
      return;
    }
    if (
      typeof err === "object" &&
      err !== null &&
      "status" in err &&
      err.status === 413
    ) {
      res.status(413).json({ error: "입력한 내용이 너무 큽니다." });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: "요청 형식이 올바르지 않습니다." });
      return;
    }
    console.error(
      "Request failed:",
      err instanceof Error ? err.message : "unknown",
    );
    res
      .status(500)
      .json({ error: "저장 중 문제가 생겼습니다. 잠시 후 다시 시도하세요." });
  });
  return { app, db };
}
