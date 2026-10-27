import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const baseEnv = {
  ...process.env,
  NODE_ENV: "production",
  APP_ORIGIN: "",
  RENDER_EXTERNAL_URL: "",
  RESEND_API_KEY: "",
  MAIL_FROM: "",
  TRUST_PROXY_HOPS: "0",
};
test("프로덕션은 메일 설정 없이 시작하지 않는다", async () => {
  const child = spawn(process.execPath, ["server/index.ts"], { env: baseEnv });
  let stderr = "";
  child.stderr.on("data", (s) => (stderr += s));
  const [code] = await once(child, "exit");
  assert.equal(code, 1);
  assert.match(stderr, /Production requires RESEND_API_KEY/);
});
test("네이티브 Node 프로덕션 시작·정적 화면·자동 백업", async () => {
  const dir = mkdtempSync(join(tmpdir(), "haru-production-"));
  // These are test-only placeholders; this test never calls an email-sending endpoint.
  const child = spawn(process.execPath, ["server/index.ts"], {
    env: {
      ...baseEnv,
      APP_ORIGIN: "https://haru.example",
      RESEND_API_KEY: "test-only-not-a-live-key",
      MAIL_FROM: "Haru <test@example.com>",
      DATABASE_PATH: join(dir, "haru.sqlite"),
      BACKUP_DIRECTORY: join(dir, "backups"),
      PORT: "0",
    },
  });
  let output = "";
  child.stdout.on("data", (s) => (output += s));
  child.stderr.on("data", (s) => (output += s));
  try {
    let port = "";
    for (let i = 0; i < 100; i++) {
      port = output.match(/Haru running on port (\d+)/)?.[1] || "";
      if (port) break;
      if (child.exitCode !== null) throw Error(output);
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(port, "Production server should start");
    const base = `http://127.0.0.1:${port}`;
    const health = await fetch(base + "/api/health");
    assert.deepEqual(await health.json(), { ok: true });
    const root = await fetch(base);
    assert.equal(root.status, 200);
    assert.match(
      root.headers.get("content-security-policy")!,
      /default-src 'self'/,
    );
    const html = await root.text();
    assert.match(html, /작은 가게의 협업 노트/);
    const asset = html.match(/src="([^"]+\.js)"/);
    assert.ok(asset);
    assert.equal((await fetch(base + asset[1])).status, 200);
    for (
      let i = 0;
      i < 100 && !output.includes("Database backup verified");
      i++
    )
      await new Promise((r) => setTimeout(r, 20));
    assert.match(output, /Database backup verified/);
    assert.equal(
      readdirSync(join(dir, "backups")).filter((s) => s.endsWith(".sqlite"))
        .length,
      1,
    );
  } finally {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
    rmSync(dir, { recursive: true, force: true });
  }
});
