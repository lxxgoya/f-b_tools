import { chromium } from "playwright-core";
import express from "express";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createApp } from "../server/app.ts";
const mails = [];
const options = {
  requireEmailVerification: true,
  appOrigin: "http://127.0.0.1",
  sendAccountMail: async (m) => mails.push(m),
};
const { app, db } = createApp(":memory:", options);
app.use(express.static(resolve("dist")));
app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
options.appOrigin = base;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  reducedMotion: "reduce",
});
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(base);
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await page
    .getByRole("textbox", { name: "이름", exact: true })
    .fill("공개 서비스 테스트");
  await page
    .getByRole("textbox", { name: "이메일", exact: true })
    .fill("public-test@example.com");
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("initial-password-123");
  await page.getByRole("button", { name: "계정 만들기" }).click();
  await page
    .getByRole("heading", { name: "받은편지함을 확인해주세요." })
    .waitFor();
  assert.equal(mails.length, 1);
  await page.goto(mails[0].url);
  await page.getByRole("button", { name: "이메일 확인하고 시작하기" }).click();
  await page.getByRole("button", { name: "첫 가게 등록하기" }).waitFor();
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await page.getByRole("button", { name: "비밀번호를 잊으셨나요?" }).click();
  await page
    .getByRole("textbox", { name: "이메일", exact: true })
    .fill("public-test@example.com");
  await page.getByRole("button", { name: "재설정 메일 보내기" }).click();
  await page.getByRole("status").waitFor();
  assert.equal(mails.length, 2);
  await page.goto(mails[1].url);
  await page
    .getByLabel("새 비밀번호", { exact: true })
    .fill("recovered-password-456");
  await page
    .getByLabel("새 비밀번호 확인", { exact: true })
    .fill("mismatched-password");
  await page.getByRole("button", { name: "비밀번호 변경하기" }).click();
  await page.getByText("새 비밀번호가 서로 다릅니다.").waitFor();
  await page
    .getByLabel("새 비밀번호 확인", { exact: true })
    .fill("recovered-password-456");
  await page.getByRole("button", { name: "비밀번호 변경하기" }).click();
  await page.getByRole("heading", { name: "다시 만나 반가워요." }).waitFor();
  assert.equal(new URL(page.url()).hash, "");
  await page
    .getByRole("textbox", { name: "이메일", exact: true })
    .fill("public-test@example.com");
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("recovered-password-456");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.getByRole("button", { name: "첫 가게 등록하기" }).waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: email-confirmation screen, one-time verification, forgot password, mismatch validation, password recovery and login on mobile. All email delivery mocked; no real recipients contacted.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  db.close();
}
