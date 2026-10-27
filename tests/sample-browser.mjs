import { chromium } from "playwright-core";
import express from "express";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { createApp } from "../server/app.ts";
const { app, db } = createApp(":memory:");
app.use(express.static(resolve("dist")));
app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
mkdirSync("/tmp/haru-sample-artifacts", { recursive: true });
try {
  await page.goto(base);
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await page
    .getByRole("textbox", { name: "이름", exact: true })
    .fill("예제 테스트 운영자");
  await page
    .getByRole("textbox", { name: "이메일", exact: true })
    .fill("sample-browser@example.com");
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("sample-password-123");
  await page.getByRole("button", { name: "계정 만들기" }).click();
  await page.getByRole("button", { name: "첫 가게 등록하기" }).click();
  await page.getByRole("textbox", { name: "가게 이름" }).fill("헙 실제 가게");
  await page
    .getByRole("button", { name: "가게 등록하기", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "함께 만드는, 다음 하루." })
    .waitFor();
  await page.getByRole("button", { name: "안타르티카 예제 불러오기" }).click();
  await page
    .getByRole("heading", {
      name: "[예제] 안타르티카 Session 08 · Supper Club",
      exact: true,
    })
    .waitFor();
  await page
    .getByRole("heading", { name: "운영 방식 확인 필요", exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel("현재 가게").inputValue(),
    String(db.prepare("SELECT store_id FROM sample_imports").get().store_id),
  );
  await page.getByText("1부 17:00–19:00", { exact: true }).waitFor();
  await page.getByText("2부 20:00–22:00", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "예약폼 가격 안내 일치 확인", exact: true })
    .click();
  await page.getByText(/폼 상단은 일반 35,000원/).waitFor();
  const notes = page.getByPlaceholder(
    "메뉴 아이디어, 준비물, 서로 확인할 내용을 자유롭게 남겨요.",
  );
  const original = await notes.inputValue();
  assert.match(original, /금요일 오후 3시/);
  assert.match(original, /입금자명/);
  await notes.fill(original + "\n운영자가 예제에 추가한 메모");
  await page.getByText("자동 저장", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "안타르티카 예제 열기", exact: true })
    .click();
  assert.match(await notes.inputValue(), /운영자가 예제에 추가한 메모/);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM sample_imports").get().n,
    1,
  );
  await page.screenshot({
    path: "/tmp/haru-sample-artifacts/detail-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "문서", exact: true }).click();
  await page
    .getByRole("button", { name: "참여자 사전 안내문", exact: true })
    .click();
  const content = page.getByRole("textbox", { name: "문서 내용" });
  await content.waitFor();
  assert.match(await content.inputValue(), /비건 메뉴 · 25,000원/);
  assert.doesNotMatch(await content.inputValue(), /null명/);
  await page.getByRole("button", { name: "운영·준비", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile detail should not overflow",
  );
  await page.screenshot({
    path: "/tmp/haru-sample-artifacts/detail-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  const actualStore = db
    .prepare("SELECT id FROM stores WHERE name='헙 실제 가게'")
    .get().id;
  await page.getByLabel("현재 가게").selectOption(String(actualStore));
  await page
    .getByRole("heading", { name: "함께 만드는, 다음 하루." })
    .waitFor();
  assert.equal(
    db
      .prepare("SELECT count(*) AS n FROM collaborations WHERE store_id=?")
      .get(actualStore).n,
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: one-click sample import, isolated store, two sessions, unknown fields, price/refund guidance, preserved edits, documents and mobile layout.",
  );
} catch (e) {
  console.log(await page.locator("body").innerText());
  throw e;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  db.close();
}
