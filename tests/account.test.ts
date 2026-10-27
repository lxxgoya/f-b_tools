import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server/app.ts";
import { backupDatabase } from "../server/backup.ts";
import { resendMailer, type AccountMail } from "../server/email.ts";
const input = {
  email: "account@example.com",
  name: "운영자",
  password: "initial-password-123",
};
async function fixture(fail = false) {
  const mails: AccountMail[] = [];
  let failure = fail;
  const options = {
    requireEmailVerification: true,
    appOrigin: "https://haru.example",
    sendAccountMail: async (m: AccountMail) => {
      if (failure) throw Error("Provider unavailable");
      mails.push(m);
    },
  };
  const { app, db } = createApp(":memory:", options);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = async (
    path: string,
    method = "POST",
    data: unknown = {},
    cookie = "",
  ) => {
    const response = await fetch(base + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: method === "GET" ? undefined : JSON.stringify(data),
    });
    return { response, body: await response.json() };
  };
  return {
    db,
    mails,
    request,
    setFailure: (v: boolean) => (failure = v),
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      db.close();
    },
  };
}
const raw = (m: AccountMail) => new URL(m.url).hash.split("=")[1];
test("이메일 확인, 일회용 토큰, 계정 복구와 모든 세션 무효화", async () => {
  const f = await fixture();
  try {
    const reg = await f.request("/auth/register", "POST", input);
    assert.equal(reg.response.status, 202);
    assert.equal(reg.body.verificationRequired, true);
    assert.equal(reg.response.headers.get("set-cookie"), null);
    assert.equal(f.mails.length, 1);
    const verification = raw(f.mails[0]);
    assert.equal(f.mails[0].purpose, "verify");
    assert.match(f.mails[0].url, /^https:\/\/haru.example\/#verify-email=/);
    const row = f.db.prepare("SELECT token FROM account_tokens").get()!;
    assert.notEqual(row.token, verification);
    assert.equal(
      row.token,
      createHash("sha256").update(verification).digest("hex"),
    );
    assert.equal(
      (
        await f.request("/auth/login", "POST", {
          email: input.email,
          password: input.password,
        })
      ).response.status,
      403,
    );
    const verified = await f.request("/auth/verify-email", "POST", {
      token: verification,
    });
    assert.equal(verified.response.status, 200);
    const cookie = verified.response.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (await f.request("/me", "GET", undefined, cookie)).response.status,
      200,
    );
    assert.equal(
      (await f.request("/auth/verify-email", "POST", { token: verification }))
        .response.status,
      400,
    );
    const known = await f.request("/auth/forgot-password", "POST", {
      email: input.email,
    });
    const unknown = await f.request("/auth/forgot-password", "POST", {
      email: "unknown@example.com",
    });
    assert.equal(known.response.status, 202);
    assert.deepEqual(known.body, unknown.body);
    assert.equal(f.mails.length, 2);
    const reset = raw(f.mails[1]);
    assert.equal(f.mails[1].purpose, "reset");
    assert.equal(
      (await f.request("/auth/verify-email", "POST", { token: reset })).response
        .status,
      400,
    );
    assert.equal(
      (
        await f.request("/auth/reset-password", "POST", {
          token: reset,
          password: "tiny",
        })
      ).response.status,
      400,
    );
    assert.equal(
      (
        await f.request("/auth/reset-password", "POST", {
          token: reset,
          password: "new-password-12345",
        })
      ).response.status,
      200,
    );
    assert.equal(
      (await f.request("/me", "GET", undefined, cookie)).response.status,
      401,
    );
    assert.equal(
      (
        await f.request("/auth/login", "POST", {
          email: input.email,
          password: input.password,
        })
      ).response.status,
      401,
    );
    assert.equal(
      (
        await f.request("/auth/login", "POST", {
          email: input.email,
          password: "new-password-12345",
        })
      ).response.status,
      200,
    );
    assert.equal(
      (
        await f.request("/auth/reset-password", "POST", {
          token: reset,
          password: "other-password-123",
        })
      ).response.status,
      400,
    );
    await f.request("/auth/forgot-password", "POST", { email: input.email });
    const expired = raw(f.mails.at(-1)!);
    f.db.prepare("UPDATE account_tokens SET expires_at=?").run(Date.now() - 1);
    assert.equal(
      (
        await f.request("/auth/reset-password", "POST", {
          token: expired,
          password: "other-password-123",
        })
      ).response.status,
      400,
    );
  } finally {
    await f.close();
  }
});
test("메일 발송 실패 시 인증을 우회하지 않고 재발송으로 복구한다", async () => {
  const f = await fixture(true);
  try {
    assert.equal(
      (await f.request("/auth/register", "POST", input)).response.status,
      503,
    );
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM sessions").get()!.n,
      0,
    );
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM account_tokens").get()!.n,
      0,
    );
    f.setFailure(false);
    assert.equal(
      (
        await f.request("/auth/resend-verification", "POST", {
          email: input.email,
        })
      ).response.status,
      202,
    );
    assert.equal(f.mails.length, 1);
    assert.equal(
      (
        await f.request("/auth/verify-email", "POST", {
          token: raw(f.mails[0]),
        })
      ).response.status,
      200,
    );
  } finally {
    await f.close();
  }
});
test("인증 요청 제한은 계정별로 적용되고 DB에 보관된다", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 10; i++)
      assert.equal(
        (
          await f.request("/auth/forgot-password", "POST", {
            email: "absent@example.com",
          })
        ).response.status,
        202,
      );
    const blocked = await f.request("/auth/forgot-password", "POST", {
      email: "absent@example.com",
    });
    assert.equal(blocked.response.status, 429);
    assert.ok(Number(blocked.response.headers.get("retry-after")) > 0);
    assert.equal(
      (
        await f.request("/auth/forgot-password", "POST", {
          email: "different@example.com",
        })
      ).response.status,
      202,
    );
    assert.ok(
      Number(f.db.prepare("SELECT count(*) AS n FROM auth_limits").get()!.n) >=
        3,
    );
  } finally {
    await f.close();
  }
});
test("백업은 WAL의 최신 데이터를 포함하고 기존 백업 외 파일은 지우지 않는다", async () => {
  const directory = mkdtempSync(join(tmpdir(), "haru-backup-"));
  const path = join(directory, "source.sqlite"),
    dest = join(directory, "backups");
  const { db } = createApp(path);
  try {
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
      "one",
      "backup@example.com",
      "보관",
      "hash",
      new Date().toISOString(),
    );
    const first = await backupDatabase(path, dest, 1);
    const copy = new DatabaseSync(first, { readOnly: true });
    try {
      assert.equal(
        copy.prepare("SELECT name FROM users WHERE id=?").get("one")!.name,
        "보관",
      );
      assert.equal(
        copy.prepare("PRAGMA integrity_check").get()!.integrity_check,
        "ok",
      );
    } finally {
      copy.close();
    }
    writeFileSync(join(dest, "keep-me.txt"), "user file");
    await new Promise((r) => setTimeout(r, 5));
    const second = await backupDatabase(path, dest, 1);
    assert.ok(existsSync(second));
    assert.ok(!existsSync(first));
    assert.ok(existsSync(join(dest, "keep-me.txt")));
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("실제 메일 전송 어댑터는 HTTPS를 사용하고 공급자 실패를 성공으로 처리하지 않는다", async () => {
  const original = globalThis.fetch;
  let url = "",
    body: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    url = String(input);
    body = JSON.parse(String(init?.body));
    return new Response("{}", { status: 200 });
  };
  try {
    const send = resendMailer(
      "test-only-placeholder",
      "Haru <hello@example.com>",
    );
    await send({
      to: "user@example.com",
      purpose: "verify",
      url: "https://haru.example/#verify-email=example",
    });
    assert.equal(url, "https://api.resend.com/emails");
    assert.deepEqual(body.to, ["user@example.com"]);
    assert.match(String(body.text), /24시간/);
    globalThis.fetch = async () => new Response("{}", { status: 503 });
    await assert.rejects(
      () =>
        send({
          to: "user@example.com",
          purpose: "reset",
          url: "https://haru.example/#reset-password=example",
        }),
      /HTTP 503/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
