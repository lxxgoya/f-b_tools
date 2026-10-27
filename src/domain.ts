export type Status = "준비 중" | "운영 예정" | "정산 필요" | "완료";
export type ChecklistItem = {
  id: string;
  title: string;
  description: string;
  done: boolean;
};
export type Settlement = {
  sales: number;
  ingredients: number;
  other: number;
  wage: number;
  bonus: number;
};
export type Collaboration = {
  id: string;
  storeId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  collaborator: string;
  partyType: "개인" | "사업자";
  activity: string;
  food: boolean;
  cooking: boolean;
  outsideFood: boolean;
  worksOnSite: boolean;
  payment: "가게" | "협업자";
  expectedSales: number;
  expectedIngredients: number;
  people: number;
  status: Status;
  checklist: ChecklistItem[];
  settlement: Settlement;
  notes: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
};
export type Store = {
  id: string;
  name: string;
  category: string;
  address: string;
};
export type SavedDocument = {
  id: string;
  collaborationId: string;
  kind: DocumentKind;
  title: string;
  body: string;
  createdAt: string;
};
export const documentKinds = [
  "협업 운영 합의서",
  "일일 근로조건 확인서",
  "공간 대관 계약서",
  "참여자 사전 안내문",
] as const;
export type DocumentKind = (typeof documentKinds)[number];
export const money = (n: number) => new Intl.NumberFormat("ko-KR").format(n);
export function totals(s: Settlement) {
  const payout = s.wage + s.bonus;
  const costs = s.ingredients + s.other + payout;
  return {
    payout,
    costs,
    remaining: s.sales - costs,
    margin: s.sales > 0 ? ((s.sales - costs) / s.sales) * 100 : null,
  };
}
export function makeChecklist(food: boolean, works: boolean): ChecklistItem[] {
  const rows = [
    [
      "menu",
      "메뉴·프로그램 확정",
      "제공할 메뉴 또는 프로그램, 판매가격, 수량과 품절 시 안내를 함께 정하세요.",
    ],
    [
      "supply",
      "재료·준비물 확인",
      "식재료와 장비의 구매 담당자, 보관 방법, 비용 부담과 증빙을 확인하세요.",
    ],
    ...(food
      ? [
          [
            "health",
            "위생·영업 요건 확인",
            "음식 취급자의 건강진단 등 필요 서류, 조리 장소와 영업신고 범위를 관할 보건소에 확인하세요.",
          ],
        ]
      : []),
    ...(works
      ? [
          [
            "work",
            "참여 조건 확정",
            "업무, 근무시간·휴게시간, 기본임금, 지급일과 실제 지휘·감독 관계를 확인하세요. 근로자에 해당하면 법정 기준을 반영한 근로계약이 필요합니다.",
          ],
        ]
      : []),
    [
      "agreement",
      "합의 내용 문서로 남기기",
      "역할, 매출 귀속, 비용 부담, 지급 조건, 취소·사고 시 책임을 서로 확인하세요. 문서 메뉴에서 검토 초안을 만들 수 있습니다.",
    ],
    [
      "payment",
      "결제·매출 귀속 확인",
      "결제 명의, 고객 영수증 발급, 환불 담당자와 매출 기록 방법을 일치시키세요.",
    ],
    [
      "promotion",
      "홍보 내용 확인",
      "일정, 장소, 가격, 예약·취소 조건과 고객 문의 담당자를 확인하세요.",
    ],
    [
      "day",
      "당일 운영 준비",
      "장비, 동선, 알레르기 안내, 비상 연락처와 마감 담당자를 점검하세요.",
    ],
    [
      "sales",
      "매출·비용 입력",
      "정산 화면에 실제 매출과 직접비를 입력하고 영수증 등 증빙을 별도로 보관하세요.",
    ],
    [
      "settlement",
      "지급·정산 확인",
      "지급 대상과 금액을 확인하고 실제 지급을 마친 뒤 협업을 완료하세요. 세무 처리는 별도로 확인해야 합니다.",
    ],
  ];
  return rows.map(([id, title, description]) => ({
    id,
    title,
    description,
    done: false,
  }));
}
export function guidance(
  c: Pick<
    Collaboration,
    "worksOnSite" | "payment" | "partyType" | "food" | "cooking" | "outsideFood"
  >,
) {
  const title =
    c.payment === "가게"
      ? c.worksOnSite
        ? "가게 영업 + 현장 참여"
        : "가게 영업 + 외부 협업"
      : c.worksOnSite
        ? "협업자 결제 + 공동 운영 검토"
        : "공간 제공 + 독립 운영 검토";
  const warnings: string[] = [];
  if (c.outsideFood)
    warnings.push(
      "외부에서 조리한 음식은 판매 전에 제조 장소, 영업신고 및 반입 가능 여부를 관할 보건소에 확인하세요.",
    );
  if (c.payment === "협업자")
    warnings.push(
      "협업자가 결제를 받는다면 영업 주체, 매출 귀속, 영수증 발급과 공간 사용 범위를 먼저 확인하세요.",
    );
  if (c.partyType === "개인" && c.payment === "협업자")
    warnings.push(
      "사업자가 아닌 개인의 직접 판매는 사업자등록·영업신고 등 필요한 요건을 확인한 후 진행하세요.",
    );
  if (c.worksOnSite)
    warnings.push(
      "현장 업무의 지휘·감독, 시간·장소 구속 등 실제 관계에 따라 근로자 여부를 검토하세요. 사업자등록 여부만으로 결정되지 않습니다.",
    );
  if (c.food)
    warnings.push(
      "음식·음료 판매는 기존 가게의 영업신고 범위와 건강진단 등 위생 요건을 확인하세요.",
    );
  return {
    title,
    warnings,
    flow:
      c.payment === "가게"
        ? [
            "고객 결제 → 우리 가게",
            "매출 기록 → 우리 가게",
            "협업자 지급 → 합의한 조건",
          ]
        : [
            "고객 결제 → 협업자",
            "매출·환불 책임 → 사전 확인",
            "가게 지급 → 공간·운영 합의",
          ],
  };
}
export function draftDocument(
  kind: DocumentKind,
  c: Collaboration,
  store: Store,
) {
  const s = totals(c.settlement);
  const common = `${kind} · 검토 초안\n\n행사: ${c.title}\n장소: ${store.name}${store.address ? ` (${store.address})` : ""}\n일시: ${c.date} ${c.startTime}–${c.endTime}${c.endTime <= c.startTime ? " (종료는 다음 날)" : ""}\n가게 운영자: [성명·사업자 정보 기재]\n협업자: ${c.collaborator} (${c.partyType})\n내용: ${c.activity}\n`;
  const sections: Record<DocumentKind, string> = {
    "협업 운영 합의서": `\n1. 운영과 역할\n${guidance(c).title}\n가게 담당 업무: [기재]\n협업자 담당 업무: [기재]\n\n2. 매출과 비용\n결제 수령: ${c.payment}\n예상 매출: ${money(c.expectedSales)}원\n식재료 조달·비용 부담: [기재]\n환불·고객 응대 담당: [기재]\n\n3. 지급과 마감\n지급액·산정 방식·지급일: [합의 후 기재]\n취소, 손해배상, 사고 책임과 분쟁 해결: [합의 후 기재]`,
    "일일 근로조건 확인서": `\n근로관계 확인을 위한 작성 보조 문서입니다. 완성된 근로계약서가 아닙니다.\n\n업무: ${c.activity}\n근무 장소: ${store.name}\n시작·종료: ${c.startTime}–${c.endTime}\n휴게시간: [시작·종료 및 총 시간 기재]\n기본임금 입력액: ${money(c.settlement.wage)}원\n성과급 입력액: ${money(c.settlement.bonus)}원\n임금 산정 기준·구성항목: [기재]\n지급일·지급 방법: [기재]\n소정근로일·휴일·휴가 등 해당 조건: [확인 후 기재]\n\n최저임금, 연장·야간·휴일근로 등 적용 여부와 서면 명시·교부 의무를 확인하고 고용노동부 표준근로계약서 등 공식 양식으로 최종 작성하세요.`,
    "공간 대관 계약서": `\n1. 사용 범위\n공간·시설·장비: [기재]\n사용 목적: ${c.activity}\n설치·철수 시간: [기재]\n\n2. 대관료와 책임\n대관료·보증금·지급일: [기재]\n결제 수령 예정: ${c.payment}\n영업신고·등록 등 운영 요건 확인 담당: [기재]\n시설 파손, 청소, 소음, 사고·배상 책임: [합의 후 기재]\n취소·환불 조건: [합의 후 기재]\n\n대관 계약만으로 판매·조리 등 영업 요건이 충족되지는 않습니다.`,
    "참여자 사전 안내문": `\n함께 준비할 내용\n${
      c.checklist
        .filter((x) => !x.done)
        .map((x) => `□ ${x.title}`)
        .join("\n") || "등록된 준비 항목을 모두 확인했습니다."
    }\n\n당일 참여 인원: ${c.people}명\n결제 담당: ${c.payment}\n식재료·장비 준비 담당: [기재]\n위생·안전 및 알레르기 안내: [기재]\n집합 시간·비상 연락처: [기재]\n\n정산 입력 현황\n매출 ${money(c.settlement.sales)}원 / 직접비·지급액 합계 ${money(s.costs)}원\n입력된 금액은 확정 지급 또는 세무 처리를 의미하지 않습니다.`,
  };
  return (
    common +
    sections[kind] +
    `\n\n추가 합의 및 메모\n${c.notes || "[기재]"}\n\n확인 일자: __________\n가게 운영자: __________ (서명)\n협업자: __________ (서명)\n\n※ 입력값으로 만든 검토 초안입니다. 빈 항목과 실제 사실관계를 확인하고 필요한 법정 사항을 반영하세요. 법률 검토, 전자서명 또는 세금 신고를 대신하지 않습니다.`
  );
}
