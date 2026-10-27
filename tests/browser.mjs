import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const artifactDir = process.env.HARU_ARTIFACTS || "/tmp/haru-artifacts";
mkdirSync(artifactDir, { recursive: true });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const email = `browser-${Date.now()}@example.com`;
try {
  await page.goto(process.env.HARU_BASE_URL || "http://127.0.0.1:3000");
  await page.getByRole("heading", { name: "다시 만나 반가워요." }).waitFor();
  await page.screenshot({
    path: `${artifactDir}/login-desktop.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await page
    .getByRole("textbox", { name: "이름", exact: true })
    .fill("테스트 운영자");
  await page.getByRole("textbox", { name: "이메일", exact: true }).fill(email);
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("browser-password-123");
  await page.getByRole("button", { name: "계정 만들기" }).click();
  await page.getByRole("button", { name: "첫 가게 등록하기" }).click();
  await page.getByRole("textbox", { name: "가게 이름" }).fill("오후의 커피");
  await page.getByRole("textbox", { name: "주소" }).fill("서울 성동구");
  await page
    .getByRole("button", { name: "가게 등록하기", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "함께 만드는, 다음 하루." })
    .waitFor();
  await page.getByRole("button", { name: "새 협업", exact: true }).click();
  await page
    .getByRole("textbox", { name: "협업 이름" })
    .fill("성보 × 오후의 커피");
  await page.getByLabel("날짜", { exact: true }).fill("2026-10-31");
  await page.getByRole("textbox", { name: "누구와 함께하나요?" }).fill("성보");
  await page
    .getByRole("textbox", { name: "함께 무엇을 하나요?" })
    .fill("게스트 디저트와 커피 페어링");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await page
    .getByRole("switch", { name: "외부에서 조리한 음식을 가져오나요?" })
    .click();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await page.getByLabel("예상 매출", { exact: true }).fill("820000");
  await page.getByLabel("예상 식재료비", { exact: true }).fill("200000");
  await page.getByRole("button", { name: "협업 만들기", exact: true }).click();
  await page
    .getByRole("heading", { name: "성보 × 오후의 커피", exact: true })
    .waitFor();
  await page
    .getByRole("checkbox", { name: "메뉴·프로그램 확정", exact: true })
    .click();
  await page
    .getByPlaceholder(
      "메뉴 아이디어, 준비물, 서로 확인할 내용을 자유롭게 남겨요.",
    )
    .fill("비건 옵션은 별도 안내");
  await page.getByText("자동 저장", { exact: true }).waitFor();
  await page.getByRole("button", { name: "문서", exact: true }).click();
  await page.getByRole("textbox", { name: "문서 내용" }).waitFor();
  await page
    .getByRole("textbox", { name: "문서 내용" })
    .fill(
      "테스트 협업 합의서\n행사: 성보 × 오후의 커피\n추가 확인: 비건 옵션 안내",
    );
  await page.getByText("초안 자동 저장됨", { exact: true }).waitFor();
  await page.getByRole("button", { name: "문서 저장", exact: true }).click();
  await page.getByText("문서를 저장했어요.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "미리보기", exact: true }).click();
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: `${artifactDir}/agreement.pdf`,
    format: "A4",
    printBackground: true,
  });
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "정산", exact: true }).click();
  await page.getByLabel("총매출", { exact: true }).fill("820000");
  await page.getByLabel("식재료비", { exact: true }).fill("200000");
  await page.getByLabel("기타 직접비", { exact: true }).fill("23000");
  await page.getByLabel("기본임금·기본 지급액", { exact: true }).fill("150000");
  await page.getByLabel("성과급·추가 지급액", { exact: true }).fill("100000");
  await page.getByText("자동 저장", { exact: true }).waitFor();
  assert.match(await page.locator(".remaining strong").innerText(), /347,000/);
  await page.screenshot({
    path: `${artifactDir}/settlement-desktop.png`,
    fullPage: true,
  });
  await page
    .getByRole("checkbox", {
      name: "매출·비용을 확인했고, 실제 지급 및 필요한 증빙 정리를 마쳤어요.",
    })
    .check();
  await page.getByRole("button", { name: "정산 완료하고 기록하기" }).click();
  await page.getByText("정산을 완료한 협업이에요.").waitFor();
  await page.getByRole("button", { name: "협업 기록", exact: true }).click();
  await page
    .getByRole("button", { name: "성보 × 오후의 커피 성보", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "협업 보드", exact: false })
    .first()
    .click();
  // Add a second in-progress collaboration to exercise dashboard cards.
  await page.getByRole("button", { name: "새 협업", exact: true }).click();
  await page
    .getByRole("textbox", { name: "협업 이름" })
    .fill("수진의 가을 베이커리");
  await page.getByRole("textbox", { name: "누구와 함께하나요?" }).fill("수진");
  await page
    .getByRole("textbox", { name: "함께 무엇을 하나요?" })
    .fill("주말 베이커리 팝업");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await page.getByRole("button", { name: "협업 만들기", exact: true }).click();
  await page
    .getByRole("heading", { name: "수진의 가을 베이커리", exact: true })
    .waitFor();
  await page
    .getByRole("main")
    .getByRole("button", { name: "협업 보드", exact: true })
    .click();
  await page.screenshot({
    path: `${artifactDir}/dashboard-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(250);
  await page.screenshot({
    path: `${artifactDir}/dashboard-mobile.png`,
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "mobile overflow",
  );
  await page.getByRole("button", { name: /수진의 가을 베이커리/ }).click();
  await page.getByRole("button", { name: "정산", exact: true }).click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "mobile settlement overflow",
  );
  await page.screenshot({
    path: `${artifactDir}/settlement-mobile.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await page.getByRole("heading", { name: "다시 만나 반가워요." }).waitFor();
  await page.getByRole("textbox", { name: "이메일", exact: true }).fill(email);
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("browser-password-123");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page
    .getByRole("heading", { name: "함께 만드는, 다음 하루." })
    .waitFor();
  await page.getByRole("button", { name: /수진의 가을 베이커리/ }).waitFor();
  await page.getByText("성보 × 오후의 커피", { exact: true }).waitFor();
  await page.screenshot({
    path: `${artifactDir}/dashboard-mobile-relogin.png`,
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: registration, store, collaboration, checklist, autosave, document draft/version, PDF, settlement 347000, completion, history, mobile, logout, login; no browser errors.",
  );
  console.log(JSON.stringify({ testEmail: email, artifacts: artifactDir }));
} catch (e) {
  console.log(
    "PAGE STATE",
    await page
      .locator("main")
      .innerText()
      .catch(() => page.locator("body").innerText()),
  );
  await page.screenshot({ path: `${artifactDir}/failure.png`, fullPage: true });
  throw e;
} finally {
  await browser.close();
}
