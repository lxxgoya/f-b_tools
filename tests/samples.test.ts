import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server/app.ts";
import { guidance, type Collaboration } from "../src/domain.ts";
import { importAntarcticaSample } from "../server/samples.ts";
test("안타르티카 예제: 원문 정보, 미확인 값, 소유권, 중복 방지와 영구 저장", async () => {
  const dir = mkdtempSync(join(tmpdir(), "haru-sample-")),
    path = join(dir, "db.sqlite");
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
        ...(cookie ? { cookie } : {}),
        ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
    return { response, body: await response.json() };
  }
  let ownerId = "",
    sampleId = "",
    storeId = "";
  try {
    assert.equal(
      (await request("/samples/antarctica", "POST", {})).response.status,
      401,
    );
    const register = await request("/auth/register", "POST", {
      email: "sample-owner@example.com",
      name: "운영자",
      password: "test-password-123",
    });
    ownerId = register.body.id;
    const cookie = register.response.headers.get("set-cookie")!.split(";")[0];
    const real = await request(
      "/stores",
      "POST",
      { name: "기존 실제 가게", category: "카페", address: "기존 주소" },
      cookie,
    );
    const result = await request("/samples/antarctica", "POST", {}, cookie);
    assert.equal(result.response.status, 201);
    assert.equal(result.body.created, true);
    const c = result.body.collaboration as Collaboration;
    sampleId = c.id;
    storeId = result.body.store.id;
    assert.equal(result.body.store.name, "hup · 예제");
    assert.notEqual(storeId, real.body.id);
    assert.equal(result.body.store.address, "서울시 성동구 독서당로 286, 1층");
    assert.equal(c.date, "2026-11-01");
    assert.equal(c.startTime, "17:00");
    assert.equal(c.endTime, "22:00");
    assert.deepEqual(c.sessions, [
      { label: "1부", startTime: "17:00", endTime: "19:00" },
      { label: "2부", startTime: "20:00", endTime: "22:00" },
    ]);
    for (const expected of [
      "35,000원",
      "25,000원",
      "참치회 토스타다",
      "멕시칸 쿠스쿠스",
      "비트 토스타다",
      "트레스 레체스",
      "파인애플",
      "Bring Your Own Beverages",
      "구글폼",
      "워크인",
      "Curated Antarctica",
      "금요일 오후 3시",
      "입금자명",
      "이체했습니다",
    ])
      assert.ok(c.notes.includes(expected), expected);
    assert.equal(c.people, null);
    assert.equal(c.partyType, "확인 필요");
    assert.equal(c.payment, "확인 필요");
    assert.equal(c.cooking, null);
    assert.equal(c.worksOnSite, null);
    assert.equal(c.outsideFood, null);
    assert.deepEqual(c.settlement, {
      sales: 0,
      ingredients: 0,
      other: 0,
      wage: 0,
      bonus: 0,
    });
    assert.equal(c.expectedSales, 0);
    assert.equal(c.status, "준비 중");
    assert.equal(guidance(c).title, "운영 방식 확인 필요");
    assert.ok(c.checklist.every((i) => !i.done));
    assert.ok(c.checklist.some((i) => i.id === "vegan"));
    assert.ok(c.checklist.some((i) => i.id === "session"));
    assert.ok(c.checklist.some((i) => i.id === "byob"));
    const docs = await request(
      `/collaborations/${c.id}/documents`,
      "GET",
      undefined,
      cookie,
    );
    assert.equal(docs.body.length, 1);
    assert.match(docs.body[0].body, /인원: 확인 필요/);
    assert.doesNotMatch(docs.body[0].body, /null명/);
    assert.match(docs.body[0].body, /1부 17:00–19:00/);
    const changed = await request(
      `/collaborations/${c.id}`,
      "PATCH",
      { revision: c.revision, notes: "예제에 직접 남긴 메모" },
      cookie,
    );
    assert.equal(changed.response.status, 200);
    const repeat = await request("/samples/antarctica", "POST", {}, cookie);
    assert.equal(repeat.response.status, 200);
    assert.equal(repeat.body.created, false);
    assert.equal(repeat.body.collaboration.id, c.id);
    assert.equal(repeat.body.collaboration.notes, "예제에 직접 남긴 메모");
    assert.equal(
      (await request("/stores", "GET", undefined, cookie)).body.length,
      2,
    );
    assert.deepEqual(
      (
        await request(
          `/stores/${real.body.id}/collaborations`,
          "GET",
          undefined,
          cookie,
        )
      ).body,
      [],
    );
    const other = await request("/auth/register", "POST", {
      email: "sample-other@example.com",
      name: "다른 운영자",
      password: "test-password-123",
    });
    const otherCookie = other.response.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (
        await request(
          `/stores/${storeId}/collaborations`,
          "GET",
          undefined,
          otherCookie,
        )
      ).response.status,
      404,
    );
    const otherSample = await request(
      "/samples/antarctica",
      "POST",
      {},
      otherCookie,
    );
    assert.notEqual(otherSample.body.collaboration.id, c.id);
    assert.notEqual(otherSample.body.store.id, storeId);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
  const reopened = createApp(path);
  try {
    const again = importAntarcticaSample(reopened.db, ownerId);
    assert.equal(again.created, false);
    assert.equal(again.collaboration.id, sampleId);
    assert.equal(again.collaboration.notes, "예제에 직접 남긴 메모");
    assert.equal(again.store.id, storeId);
  } finally {
    reopened.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("예제 생성 도중 오류가 나면 가게·협업·참여자도 남기지 않는다", () => {
  const { db } = createApp(":memory:");
  try {
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
      "user",
      "test@example.com",
      "테스트",
      "test-hash",
      "2026-10-27",
    );
    db.exec(
      "CREATE TRIGGER reject_sample_document BEFORE INSERT ON documents BEGIN SELECT RAISE(ABORT,'test transaction failure'); END;",
    );
    assert.throws(
      () => importAntarcticaSample(db, "user"),
      /test transaction failure/,
    );
    for (const table of [
      "stores",
      "collaborations",
      "collaborators",
      "documents",
      "sample_imports",
    ])
      assert.equal(
        db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n,
        0,
        table,
      );
  } finally {
    db.close();
  }
});
