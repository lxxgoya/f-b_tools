import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.ts";
import {
  totals,
  guidance,
  makeChecklist,
  draftDocument,
  type Collaboration,
  type Store,
} from "../src/domain.ts";
const sample = {
  title: "커피 × 디저트",
  date: "2026-10-31",
  startTime: "11:00",
  endTime: "18:00",
  collaborator: "수진",
  partyType: "개인",
  activity: "게스트 디저트 판매",
  food: true,
  cooking: true,
  outsideFood: true,
  worksOnSite: true,
  payment: "가게",
  expectedSales: 820000,
  expectedIngredients: 200000,
  people: 2,
};
test("실제 인증, 가게 분리, 협업 전체 흐름과 영구 저장", async () => {
  const dir = mkdtempSync(join(tmpdir(), "haru-test-")),
    path = join(dir, "test.sqlite");
  const { app, db } = createApp(path);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  async function request(
    route: string,
    method = "GET",
    data?: unknown,
    cookie = "",
  ) {
    const response = await fetch(base + "/api" + route, {
      method,
      headers: {
        ...(data !== undefined ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
    return { response, body: await response.json() };
  }
  let collabId = "",
    ownerId = "";
  try {
    assert.equal((await request("/stores")).response.status, 401);
    const bad = await request("/auth/register", "POST", {
      name: "운영자",
      email: "bad",
      password: "short",
    });
    assert.equal(bad.response.status, 400);
    const first = await request("/auth/register", "POST", {
      name: "운영자",
      email: "owner@example.com",
      password: "strong-password-123",
    });
    assert.equal(first.response.status, 201);
    ownerId = first.body.id;
    const cookie = first.response.headers.get("set-cookie")!.split(";")[0];
    assert.match(first.response.headers.get("set-cookie")!, /HttpOnly/);
    assert.match(first.response.headers.get("set-cookie")!, /SameSite=Lax/);
    assert.equal(
      (
        await request("/auth/register", "POST", {
          name: "다시",
          email: "OWNER@example.com",
          password: "strong-password-123",
        })
      ).response.status,
      409,
    );
    const userRow = db
      .prepare("SELECT password FROM users WHERE id=?")
      .get(ownerId)!;
    assert.notEqual(userRow.password, "strong-password-123");
    assert.match(String(userRow.password), /^[a-f0-9]{32}:[a-f0-9]{128}$/);
    const session = db
      .prepare("SELECT token FROM sessions WHERE user_id=?")
      .get(ownerId)!;
    assert.notEqual(session.token, cookie.slice("haru_session=".length));
    const store = (
      await request(
        "/stores",
        "POST",
        { name: "오후의 커피", category: "카페", address: "서울" },
        cookie,
      )
    ).body as Store;
    const store2 = (
      await request(
        "/stores",
        "POST",
        { name: "두 번째 가게", category: "바", address: "" },
        cookie,
      )
    ).body;
    const second = await request("/auth/register", "POST", {
      name: "다른 사용자",
      email: "other@example.com",
      password: "another-password-123",
    });
    const otherCookie = second.response.headers
      .get("set-cookie")!
      .split(";")[0];
    assert.equal(
      (
        await request(
          `/stores/${store.id}/collaborations`,
          "GET",
          undefined,
          otherCookie,
        )
      ).response.status,
      404,
    );
    assert.equal(
      (await request("/stores", "GET", undefined, otherCookie)).body.length,
      0,
    );
    assert.equal(
      (await request(`/stores/${store.id}/draft`, "PUT", sample, cookie))
        .response.status,
      200,
    );
    assert.equal(
      (await request(`/stores/${store.id}/draft`, "GET", undefined, cookie))
        .body.title,
      sample.title,
    );
    assert.equal(
      (
        await request(
          `/stores/${store.id}/draft`,
          "GET",
          undefined,
          otherCookie,
        )
      ).response.status,
      404,
    );
    const invalidDate = await request(
      `/stores/${store.id}/collaborations`,
      "POST",
      { ...sample, date: "2026-02-30" },
      cookie,
    );
    assert.equal(invalidDate.response.status, 400);
    const created = await request(
      `/stores/${store.id}/collaborations`,
      "POST",
      sample,
      cookie,
    );
    assert.equal(created.response.status, 201);
    let c = created.body as Collaboration;
    collabId = c.id;
    assert.equal(c.status, "준비 중");
    assert.equal(c.checklist.length, 10);
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM collaborators").get()!.n,
      1,
    );
    assert.equal(
      (
        await request(
          `/stores/${store2.id}/collaborations`,
          "GET",
          undefined,
          cookie,
        )
      ).body.length,
      0,
    );
    assert.equal(
      (
        await request(
          `/collaborations/${c.id}`,
          "PATCH",
          { revision: 0, notes: "침입" },
          otherCookie,
        )
      ).response.status,
      404,
    );
    const update = await request(
      `/collaborations/${c.id}`,
      "PATCH",
      {
        revision: c.revision,
        checklist: [{ id: "menu", done: true }],
        notes: "우유 알레르기 안내 확인",
      },
      cookie,
    );
    assert.equal(update.response.status, 200);
    c = update.body;
    assert.equal(c.checklist[0].done, true);
    const stale = await request(
      `/collaborations/${c.id}`,
      "PATCH",
      { revision: 0, notes: "덮어쓰기" },
      cookie,
    );
    assert.equal(stale.response.status, 409);
    assert.equal(
      (
        await request(
          `/collaborations/${c.id}`,
          "PATCH",
          {
            revision: c.revision,
            settlement: {
              sales: -1,
              ingredients: 0,
              other: 0,
              wage: 0,
              bonus: 0,
            },
          },
          cookie,
        )
      ).response.status,
      400,
    );
    c = (
      await request(
        `/collaborations/${c.id}`,
        "PATCH",
        {
          revision: c.revision,
          status: "정산 필요",
          settlement: {
            sales: 820000,
            ingredients: 200000,
            other: 23000,
            wage: 150000,
            bonus: 100000,
          },
        },
        cookie,
      )
    ).body;
    assert.deepEqual(totals(c.settlement), {
      payout: 250000,
      costs: 473000,
      remaining: 347000,
      margin: (347000 / 820000) * 100,
    });
    const doc = await request(
      `/collaborations/${c.id}/documents`,
      "POST",
      { kind: "협업 운영 합의서" },
      cookie,
    );
    assert.equal(doc.response.status, 201);
    assert.match(doc.body.body, /오후의 커피/);
    assert.match(doc.body.body, /커피 × 디저트/);
    assert.match(doc.body.body, /검토 초안/);
    assert.equal(
      (
        await request(
          `/collaborations/${c.id}/documents`,
          "GET",
          undefined,
          otherCookie,
        )
      ).response.status,
      404,
    );
    assert.equal(
      (
        await request(
          `/collaborations/${c.id}/documents`,
          "GET",
          undefined,
          cookie,
        )
      ).body.length,
      1,
    );
    await request(
      `/collaborations/${c.id}/document-drafts`,
      "PUT",
      { kind: "협업 운영 합의서", body: "수정한 초안" },
      cookie,
    );
    assert.equal(
      (
        await request(
          `/collaborations/${c.id}/document-drafts`,
          "GET",
          undefined,
          cookie,
        )
      ).body["협업 운영 합의서"],
      "수정한 초안",
    );
    assert.equal(
      (
        await request(
          `/collaborations/${c.id}/document-drafts`,
          "PUT",
          { kind: "협업 운영 합의서", body: "침입" },
          otherCookie,
        )
      ).response.status,
      404,
    );
    c = (
      await request(
        `/collaborations/${c.id}`,
        "PATCH",
        { revision: c.revision, status: "완료" },
        cookie,
      )
    ).body;
    assert.equal(c.status, "완료");
    assert.equal(
      (
        await request(
          `/collaborations/${c.id}`,
          "PATCH",
          { revision: c.revision, notes: "완료 후 변경" },
          cookie,
        )
      ).response.status,
      409,
    );
    await request(`/stores/${store.id}/draft`, "DELETE", {}, cookie);
    assert.equal(
      (await request(`/stores/${store.id}/draft`, "GET", undefined, cookie))
        .body,
      null,
    );
    const cross = await fetch(base + "/api/stores", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({ name: "위조", category: "카페", address: "" }),
    });
    assert.equal(cross.status, 403);
    assert.equal(
      (
        await request("/auth/login", "POST", {
          email: "owner@example.com",
          password: "wrong-password-123",
        })
      ).response.status,
      401,
    );
    await request("/auth/logout", "POST", {}, cookie);
    assert.equal(
      (await request("/me", "GET", undefined, cookie)).response.status,
      401,
    );
    const login = await request("/auth/login", "POST", {
      email: "owner@example.com",
      password: "strong-password-123",
    });
    assert.equal(login.response.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    db.close();
  }
  const reopened = createApp(path);
  try {
    const record = reopened.db
      .prepare("SELECT data FROM collaborations WHERE id=?")
      .get(collabId)!;
    assert.equal(JSON.parse(String(record.data)).status, "완료");
    assert.equal(JSON.parse(String(record.data)).settlement.sales, 820000);
    assert.equal(
      reopened.db.prepare("SELECT count(*) AS n FROM documents").get()!.n,
      1,
    );
  } finally {
    reopened.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("운영 안내는 실제 확인 사항을 제시하고 체크리스트를 구분한다", () => {
  const g = guidance({ ...sample, payment: "협업자" } as Collaboration);
  assert.match(g.title, /검토/);
  assert.ok(g.warnings.some((w) => w.includes("관할 보건소")));
  assert.ok(g.warnings.some((w) => w.includes("사업자가 아닌 개인")));
  assert.ok(g.warnings.some((w) => w.includes("지휘·감독")));
  const list = makeChecklist(false, false);
  assert.equal(list.length, 8);
  assert.ok(!list.some((i) => i.id === "health" || i.id === "work"));
  assert.equal(
    totals({ sales: 0, ingredients: 100, other: 0, wage: 0, bonus: 0 }).margin,
    null,
  );
  assert.equal(
    totals({ sales: 0, ingredients: 100, other: 0, wage: 0, bonus: 0 })
      .remaining,
    -100,
  );
});
test("HTTPS용 쿠키와 인증 세션 만료", async () => {
  const { app, db } = createApp(":memory:", { secureCookie: true });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const reg = await fetch(base + "/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "테스트",
        email: "tls@example.com",
        password: "test-password-123",
      }),
    });
    assert.match(reg.headers.get("set-cookie")!, /; Secure/);
    const cookie = reg.headers.get("set-cookie")!.split(";")[0];
    db.prepare("UPDATE sessions SET expires_at=?").run(Date.now() - 1);
    assert.equal(
      (await fetch(base + "/api/me", { headers: { cookie } })).status,
      401,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
});
