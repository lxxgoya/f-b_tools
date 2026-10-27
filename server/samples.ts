import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  draftDocument,
  makeChecklist,
  type Store,
  type Collaboration,
} from "../src/domain.ts";
export const antarcticaSampleKey = "antarctica-session-08";
export function importAntarcticaSample(db: DatabaseSync, userId: string) {
  const existing = db
    .prepare(
      "SELECT store_id,collaboration_id FROM sample_imports WHERE user_id=? AND sample_key=?",
    )
    .get(userId, antarcticaSampleKey) as
    { store_id: string; collaboration_id: string } | undefined;
  if (existing) {
    const store = db
      .prepare(
        "SELECT id,name,category,address FROM stores WHERE id=? AND user_id=?",
      )
      .get(existing.store_id, userId) as Store | undefined;
    const row = db
      .prepare("SELECT data FROM collaborations WHERE id=? AND store_id=?")
      .get(existing.collaboration_id, existing.store_id) as
      { data: string } | undefined;
    if (!store || !row) throw Error("Sample reference is inconsistent");
    return {
      store,
      collaboration: JSON.parse(row.data) as Collaboration,
      created: false,
    };
  }
  const store: Store = {
    id: randomUUID(),
    name: "hup · 예제",
    category: "음식점",
    address: "서울시 성동구 독서당로 286, 1층",
  };
  const now = new Date().toISOString();
  const checklist = makeChecklist(true, true).map((item) => ({
    ...item,
    description:
      item.id === "menu"
        ? "일반 메뉴 35,000원, 비건 메뉴 25,000원. 아래 행사 안내의 메뉴와 실제 제공 내용을 최종 확인하세요."
        : item.id === "payment"
          ? "신청자는 식사 비용 결제 후 구글폼을 제출합니다. 폼의 이체 완료 체크는 신청자의 자기신고입니다. 실제 입금은 별도로 확인하세요. 계좌 수령인과 가게·협업자의 관계, 매출 귀속과 환불 담당자는 별도 확인이 필요합니다."
          : item.description,
  }));
  checklist.splice(
    1,
    0,
    {
      id: "price-consistency",
      title: "예약폼 가격 안내 일치 확인",
      description:
        "폼 상단은 일반 35,000원·비건 25,000원인데 결제 안내 첫 문장은 35,000원으로 고정돼 있습니다. 선택 메뉴에 맞는 금액과 안내가 일치하는지 확인하세요.",
      done: false,
    },
    {
      id: "refund-policy",
      title: "환불 기준일·처리 담당 확인",
      description:
        "폼은 금요일 오후 3시까지 연락하면 전액 환불한다고 안내합니다. 행사 기준 2026-10-30 15:00(한국 시간)로 해석할 수 있으나 정확한 날짜·기한 이후 처리·연락처를 운영자에게 확인하세요.",
      done: false,
    },
    {
      id: "session",
      title: "타임별 정원·예약 명단 확인",
      description:
        "1부 17:00–19:00, 2부 20:00–22:00. 각 타임의 정원, 일반·비건 선택 인원 및 결제 확인 명단을 준비하세요. 안내문에는 정원·예약 링크가 없습니다.",
      done: false,
    },
    {
      id: "vegan",
      title: "비건 디저트·알레르기 확인",
      description:
        "일반·비건 메뉴에 같은 트레스 레체스 케이크명이 기재돼 있습니다. 비건 제공분의 유제품·달걀 대체 여부와 교차접촉 방지를 확인하세요. 일반 메뉴에는 참치·새우가 포함됩니다.",
      done: false,
    },
    {
      id: "byob",
      title: "BYOB·워크인 운영 확인",
      description:
        "음료·주류 지참 안내, 잔·얼음·냉장 보관 및 정리 담당자를 확인하세요. 워크인은 추후 안내 예정이며 동일 요금입니다. 허용 인원·현장 결제 담당자를 확정하세요.",
      done: false,
    },
  );
  const collaboration: Collaboration = {
    id: randomUUID(),
    storeId: store.id,
    title: "[예제] 안타르티카 Session 08 · Supper Club",
    date: "2026-11-01",
    startTime: "17:00",
    endTime: "22:00",
    collaborator: "안타르티카 (Antarctica)",
    partyType: "확인 필요",
    activity:
      "Mexican Seafood Night · 계절 해산물을 중심으로 한 예약제 서퍼 클럽. 일반 35,000원 / 비건 25,000원. 1부 17:00–19:00, 2부 20:00–22:00.",
    food: true,
    cooking: null,
    outsideFood: null,
    worksOnSite: null,
    payment: "확인 필요",
    expectedSales: 0,
    expectedIngredients: 0,
    people: null,
    status: "준비 중",
    checklist,
    settlement: { sales: 0, ingredients: 0, other: 0, wage: 0, bonus: 0 },
    notes: `[사용자가 제공한 행사 안내를 정리한 예제입니다. 실제 예약·결제·정산 데이터가 아닙니다.]

ANTARCTICA SESSION 08 — SUPPER CLUB SERVICE
2026년 11월 1일 일요일
장소: hup (@hup.irl), 서울시 성동구 독서당로 286, 1층
1부 17:00–19:00 / 2부 20:00–22:00
19:00–20:00는 두 타임 사이 시간이며 예약을 받는 별도 타임으로 간주하지 않습니다.

일반 메뉴 · 35,000원
• Tuna Tostada — 참치회 토스타다
• Chipotle Grilled Shrimp with Mexican Couscous Salad — 치폴레 새우구이와 멕시칸 쿠스쿠스 샐러드
• Tres Leches Cake with Seasonal Fruits — 트레스 레체스 케이크와 제철 과일

비건 메뉴 · 25,000원
• Roasted Beetroot Tostada — 비트 토스타다
• Vegan Chipotle Skewers with Mexican Couscous Salad — 비건 치폴레 꼬치(파인애플, 가지, 호박, 두부, 고구마)와 멕시칸 쿠스쿠스 샐러드
• Tres Leches Cake with Seasonal Fruits — 트레스 레체스 케이크와 제철 과일
※ 비건 제공분의 유제품·달걀 대체와 교차접촉 방지는 확인 필요

음료·주류: Bring Your Own Beverages (자유 지참)
음악: Curated Antarctica November Session Playlist

예약 안내
수요 조사·인원 제한을 위해 예약 우선 진행.
식사 비용 결제 후 구글폼 제출. 프로필 상단 링크로 신청.
안내 계정: https://www.instagram.com/hup.irl/
추가 예약폼 자료: 캡처는 2부 예약폼이며 1부 별도 폼의 존재·주소는 확인되지 않았습니다.
이름: 예약자 본인 성함 또는 별명, 입금자명과 동일하게 기재 요청.
연락처: 휴대폰 번호 또는 이메일 주소.
결제: 폼에 안내된 은행 계좌로 선입금 후 제출. 실제 예금주·계좌번호 및 화면의 로그인 이메일은 공개 예제에 포함하지 않았습니다.
신청자의 “예약금도 이체했습니다” 체크와 운영자의 실제 입금 확인은 구분해야 합니다.
폼 결제 안내 첫 문장은 35,000원으로 고정돼 있으나 하단 가격표는 일반 35,000원 / 비건 25,000원입니다. 메뉴별 금액 안내 일치 확인 필요.
환불 안내: 금요일 오후 3시까지 연락 시 전액 환불.
행사 직전 금요일인 2026-10-30 15:00(한국 시간)로 해석할 수 있으나 정확한 기준일·기한 이후 처리·연락 방법은 확인 필요.
구글폼 실제 주소, 결제 수령인의 가게·협업자 관계, 실제 입금·예약 응답은 제공되지 않았습니다.
워크인 가능 여부는 추후 안내. 워크인도 동일한 세션 이용 금액 적용.

추가 확인할 운영 정보
협업자의 사업자 여부, 운영 참여 인원, 현장 역할과 근무 관계, 조리 장소·외부 음식 반입 여부, 결제 수령 주체·매출 귀속, 비용·기본 지급액·성과급은 확인되지 않았습니다.
예상 매출·비용과 실제 정산은 입력하지 않았습니다. 정산의 0원은 초기값이며 실제 0원 매출을 의미하지 않습니다.`,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    sampleKey: antarcticaSampleKey,
    sessions: [
      { label: "1부", startTime: "17:00", endTime: "19:00" },
      { label: "2부", startTime: "20:00", endTime: "22:00" },
    ],
  };
  const kind = "참여자 사전 안내문",
    body = draftDocument(kind, collaboration, store);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO stores VALUES(?,?,?,?,?)").run(
      store.id,
      userId,
      store.name,
      store.category,
      store.address,
    );
    db.prepare("INSERT INTO collaborations VALUES(?,?,?)").run(
      collaboration.id,
      store.id,
      JSON.stringify(collaboration),
    );
    db.prepare("INSERT INTO collaborators VALUES(?,?,?,?)").run(
      randomUUID(),
      collaboration.id,
      collaboration.collaborator,
      collaboration.partyType,
    );
    db.prepare("INSERT INTO documents VALUES(?,?,?,?,?,?)").run(
      randomUUID(),
      collaboration.id,
      kind,
      `${collaboration.title} · ${kind}`,
      body,
      now,
    );
    db.prepare("INSERT INTO document_drafts VALUES(?,?,?)").run(
      collaboration.id,
      kind,
      body,
    );
    db.prepare("INSERT INTO sample_imports VALUES(?,?,?,?)").run(
      userId,
      antarcticaSampleKey,
      store.id,
      collaboration.id,
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { store, collaboration, created: true };
}
