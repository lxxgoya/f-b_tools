import { Auth } from "./Auth";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  LayoutDashboard,
  NotebookTabs,
  Store as StoreIcon,
  LogOut,
  X,
  CalendarDays,
  Clock3,
  Users,
  FileText,
  Wallet,
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  Sprout,
  Circle,
  Printer,
  Save,
  ArrowDownLeft,
  Menu,
} from "lucide-react";
import { api, ApiError } from "./api";
import {
  money,
  totals,
  guidance,
  draftDocument,
  documentKinds,
  type DocumentKind,
  type SavedDocument,
  type Collaboration,
  type Store,
  type Settlement,
  type Status,
} from "./domain";
import "@fontsource-variable/noto-sans-kr";
import "@fontsource-variable/dm-sans";
import "./style.css";
type User = { id: string; name: string; email: string };
type Page = "home" | "new" | "detail" | "documents" | "settlement" | "history";
type Patch = Partial<
  Pick<Collaboration, "status" | "notes" | "checklist" | "settlement">
>;
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const shortDate = (s: string) =>
  s ? `${Number(s.slice(5, 7))}.${s.slice(8)}` : "미정";
const dateLabel = (s: string) =>
  new Date(s + "T12:00:00").toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
function App() {
  const [accountHash, setAccountHash] = useState(window.location.hash);
  useEffect(() => {
    const changed = () => setAccountHash(window.location.hash);
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  const [user, setUser] = useState<User | null>(null),
    [boot, setBoot] = useState(true),
    [error, setError] = useState("");
  const [stores, setStores] = useState<Store[]>([]),
    [storeId, setStoreId] = useState(""),
    [items, setItems] = useState<Collaboration[]>([]),
    [page, setPage] = useState<Page>("home"),
    [selected, setSelected] = useState(""),
    [modal, setModal] = useState(false),
    [mobile, setMobile] = useState(false),
    [loading, setLoading] = useState(false);
  const [saveState, setSaveState] = useState("저장됨");
  const canonical = useRef(new Map<string, Collaboration>()),
    pending = useRef(new Map<string, Patch>()),
    running = useRef(new Set<string>()),
    timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const mounted = useRef(true);
  useEffect(() => {
    api<User>("/me")
      .then(setUser)
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) setError(e.message);
      })
      .finally(() => setBoot(false));
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    api<Store[]>("/stores")
      .then((s) => {
        setStores(s);
        setStoreId(s[0]?.id || "");
      })
      .catch((e) => setError(e.message));
  }, [user]);
  useEffect(() => {
    if (!storeId) {
      setItems([]);
      return;
    }
    let active = true;
    setLoading(true);
    api<Collaboration[]>(`/stores/${storeId}/collaborations`)
      .then((cs) => {
        if (!active) return;
        cs.forEach((c) => canonical.current.set(c.id, c));
        setItems(cs);
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [storeId]);
  const flush = useCallback(async (id: string) => {
    if (running.current.has(id) || !pending.current.has(id)) return;
    const patch = pending.current.get(id)!;
    pending.current.delete(id);
    running.current.add(id);
    setSaveState("저장 중");
    try {
      const c = await api<Collaboration>(`/collaborations/${id}`, "PATCH", {
        ...patch,
        checklist: patch.checklist?.map((i) => ({ id: i.id, done: i.done })),
        revision: canonical.current.get(id)!.revision,
      });
      canonical.current.set(id, c);
      setItems((old) =>
        old.map((i) =>
          i.id === id ? { ...c, ...pending.current.get(id) } : i,
        ),
      );
      setSaveState(
        pending.current.size
          ? "저장 대기"
          : running.current.size > 1
            ? "저장 중"
            : "저장됨",
      );
    } catch (e) {
      pending.current.set(id, { ...patch, ...pending.current.get(id) });
      setSaveState("저장 실패");
      setError((e as Error).message);
      running.current.delete(id);
      return;
    }
    running.current.delete(id);
    if (pending.current.has(id)) void flush(id);
  }, []);
  const update = useCallback(
    (id: string, patch: Patch) => {
      pending.current.set(id, { ...pending.current.get(id), ...patch });
      setItems((old) => old.map((i) => (i.id === id ? { ...i, ...patch } : i)));
      setSaveState("저장 대기");
      clearTimeout(timers.current.get(id));
      timers.current.set(
        id,
        setTimeout(() => void flush(id), 500),
      );
    },
    [flush],
  );
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (pending.current.size || running.current.size) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  const go = (p: Page, id?: string) => {
    setPage(p);
    if (id) setSelected(id);
    setMobile(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const current = items.find((c) => c.id === selected),
    store = stores.find((s) => s.id === storeId);
  const logout = async () => {
    if (pending.current.size || running.current.size) {
      setError(
        "자동 저장이 완료된 후 로그아웃하세요. 저장 실패 시 재시도를 눌러주세요.",
      );
      return;
    }
    try {
      await api("/auth/logout", "POST", {});
      setUser(null);
      setStores([]);
      setStoreId("");
      setItems([]);
      canonical.current.clear();
      go("home");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (boot)
    return (
      <div className="boot">
        <Sprout size={32} />
        <p>하루를 준비하고 있어요.</p>
      </div>
    );
  if (!user || /^#(verify-email|reset-password)=/.test(accountHash))
    return (
      <Auth
        key={accountHash || "account"}
        onLogin={(u) => {
          setAccountHash("");
          setUser(u);
        }}
        initialError={error}
        onReset={() => {
          setUser(null);
          setStoreId("");
          setStores([]);
          setItems([]);
        }}
      />
    );
  return (
    <div className="app">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("home");
          }}
        >
          <span className="brand-icon">
            <Sprout size={23} />
          </span>
          하루<span className="brand-dot">.</span>
        </a>
        <p className="brand-tag">작은 가게의 협업 노트</p>
        <div className="store-switch">
          <StoreIcon size={18} />
          <select
            aria-label="현재 가게"
            value={storeId}
            onChange={(e) => {
              if (pending.current.size || running.current.size) {
                setError("저장 완료 후 가게를 전환하세요.");
                return;
              }
              setStoreId(e.target.value);
              go("home");
            }}
          >
            <option value="" disabled>
              가게를 등록해주세요
            </option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
        <button
          className="text-button store-add"
          onClick={() => setModal(true)}
        >
          <Plus size={13} /> 가게 추가
        </button>
        <nav>
          <span className="nav-label">WORKSPACE</span>
          <button
            className={page !== "history" ? "active" : ""}
            onClick={() => go("home")}
          >
            <LayoutDashboard size={19} />
            협업 보드
            <ChevronRight className="nav-arrow" size={15} />
          </button>
          <button
            className={page === "history" ? "active" : ""}
            onClick={() => go("history")}
          >
            <NotebookTabs size={19} />
            협업 기록
          </button>
        </nav>
        <div className="sidebar-note">
          <span className="tiny-spark">✳</span>
          <p>
            함께하는 하루가
            <br />
            조금 더 가벼워지도록.
          </p>
          <span>준비부터 정산까지, 하루</span>
        </div>
        <div className="profile">
          <div className="avatar">{user.name.slice(0, 1)}</div>
          <div>
            <strong>{user.name}</strong>
            <small>가게 운영자</small>
          </div>
          <button aria-label="로그아웃" title="로그아웃" onClick={logout}>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      {mobile && <div className="scrim" onClick={() => setMobile(false)} />}
      <div className="workspace">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="메뉴 열기"
            onClick={() => setMobile(!mobile)}
          >
            <Menu size={21} />
          </button>
          <span>
            {store?.name || "나의 가게"} <ChevronRight size={13} />{" "}
            {page === "home"
              ? "협업 보드"
              : page === "history"
                ? "협업 기록"
                : page === "new"
                  ? "새 협업"
                  : current?.title || "협업"}
          </span>
          <div className="topbar-right">
            <span
              className={`save-indicator ${saveState === "저장 실패" ? "danger" : ""}`}
            >
              {saveState === "저장 중" ? (
                <LoaderCircle className="spin" size={13} />
              ) : (
                <CheckCircle2 size={13} />
              )}{" "}
              {saveState === "저장됨" ? "자동 저장" : saveState}
            </span>
            <span className="today-pill">{dateLabel(today())}</span>
          </div>
        </header>
        <main>
          {error && (
            <div role="alert" className="alert error">
              <AlertCircle size={18} />
              <span>{error}</span>
              {saveState === "저장 실패" && (
                <button
                  onClick={() => {
                    setError("");
                    for (const id of pending.current.keys()) void flush(id);
                  }}
                >
                  재시도
                </button>
              )}
              <button aria-label="알림 닫기" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="empty">
              <LoaderCircle className="spin" />
              <p>협업을 불러오는 중이에요.</p>
            </div>
          ) : !store ? (
            <div className="welcome">
              <span className="eyebrow">WELCOME TO HARU</span>
              <h1>
                우리 가게의 다음 하루,
                <br />
                여기서 시작해요.
              </h1>
              <p>
                가게를 등록하면 협업 준비와 문서, 정산을
                <br />
                한곳에서 차근차근 관리할 수 있어요.
              </p>
              <button className="btn primary" onClick={() => setModal(true)}>
                <Plus size={17} /> 첫 가게 등록하기
              </button>
              <div className="welcome-art">
                <Sprout size={100} strokeWidth={1} />
                <span>작은 시작, 함께하는 가능성.</span>
              </div>
            </div>
          ) : page === "home" ? (
            <Dashboard store={store} items={items} go={go} />
          ) : page === "history" ? (
            <History items={items} go={go} />
          ) : page === "new" ? (
            <NewCollaboration
              key={storeId}
              store={store}
              onCancel={() => go("home")}
              onCreate={(c) => {
                canonical.current.set(c.id, c);
                setItems((old) => [c, ...old]);
                go("detail", c.id);
              }}
            />
          ) : current ? (
            <>
              <div className="detail-heading">
                <button className="back" onClick={() => go("home")}>
                  <ChevronLeft size={16} /> 협업 보드
                </button>
                <div className="heading-line">
                  <div>
                    <span className="eyebrow">COLLABORATION NOTE</span>
                    <h1>{current.title}</h1>
                    <p>
                      {dateLabel(current.date)} · {current.startTime}–
                      {current.endTime}
                      {current.endTime <= current.startTime
                        ? " (+1일)"
                        : ""}{" "}
                      <span className="meta-divider">/</span>{" "}
                      {current.collaborator}
                    </p>
                  </div>
                  <StatusBadge status={current.status} />
                </div>
                <div className="tabs">
                  {(
                    [
                      ["detail", "운영·준비", CalendarDays],
                      ["documents", "문서", FileText],
                      ["settlement", "정산", Wallet],
                    ] as const
                  ).map(([p, label, Icon]) => (
                    <button
                      key={p}
                      className={page === p ? "active" : ""}
                      onClick={() => go(p, current.id)}
                    >
                      <Icon size={16} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {page === "detail" ? (
                <Detail
                  c={current}
                  update={(p) => update(current.id, p)}
                  go={go}
                />
              ) : page === "documents" ? (
                <Documents key={current.id} c={current} store={store} />
              ) : (
                <SettlementPage
                  c={current}
                  update={(p) => update(current.id, p)}
                  saveState={saveState}
                />
              )}
            </>
          ) : (
            <div className="empty">
              협업을 선택해주세요.
              <button className="btn" onClick={() => go("home")}>
                보드로 돌아가기
              </button>
            </div>
          )}
        </main>
        <footer>
          하루의 협업을, 빈틈없이.<span>HARU © {new Date().getFullYear()}</span>
        </footer>
      </div>
      {modal && (
        <StoreModal
          close={() => setModal(false)}
          onCreate={(s) => {
            setStores((old) => [...old, s]);
            setStoreId(s.id);
            go("home");
            setModal(false);
          }}
        />
      )}
    </div>
  );
}
function StoreModal({
  close,
  onCreate,
}: {
  close: () => void;
  onCreate: (s: Store) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="modal-layer">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="store-title"
      >
        <button className="close" aria-label="닫기" onClick={close}>
          <X size={20} />
        </button>
        <span className="eyebrow">YOUR SPACE</span>
        <h2 id="store-title">우리 가게를 알려주세요.</h2>
        <p>여러 가게를 등록하고 따로 관리할 수 있어요.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const f = new FormData(e.currentTarget);
            try {
              onCreate(
                await api<Store>("/stores", "POST", Object.fromEntries(f)),
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            가게 이름
            <input
              autoFocus
              name="name"
              required
              maxLength={100}
              placeholder="예: 오후의 커피"
            />
          </label>
          <label>
            어떤 가게인가요?
            <select name="category">
              <option>카페</option>
              <option>음식점</option>
              <option>바</option>
              <option>베이커리</option>
              <option>기타 공간</option>
            </select>
          </label>
          <label>
            주소 <small>선택</small>
            <input
              name="address"
              maxLength={300}
              placeholder="협업 문서에 들어갈 주소"
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn primary full" disabled={busy}>
            {busy ? "등록 중…" : "가게 등록하기"}
            <ArrowRight size={16} />
          </button>
        </form>
      </section>
    </div>
  );
}
function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge status-${status.replace(" ", "")}`}>
      <span />
      {status}
    </span>
  );
}
function Dashboard({
  store,
  items,
  go,
}: {
  store: Store;
  items: Collaboration[];
  go: (p: Page, id?: string) => void;
}) {
  const [filter, setFilter] = useState("전체");
  const active = items.filter((c) => c.status !== "완료"),
    done = items.filter((c) => c.status === "완료");
  const visible =
    filter === "전체" ? active : active.filter((c) => c.status === filter);
  const needs = active.reduce(
    (n, c) => n + c.checklist.filter((i) => !i.done).length,
    0,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MAKE ROOM FOR SOMETHING GOOD</span>
          <h1>
            함께 만드는, 다음 하루<span className="orange-dot">.</span>
          </h1>
          <p>{store.name}의 새로운 만남을 차근차근 준비해요.</p>
        </div>
        <button className="btn primary" onClick={() => go("new")}>
          <Plus size={18} />새 협업
        </button>
      </div>
      <div className="overview">
        <div>
          <span className="stat-label">
            함께 준비하는 협업
            <CalendarDays size={18} />
          </span>
          <strong>
            {active.length}
            <small>건</small>
          </strong>
          <p>새로운 가능성이 자라고 있어요</p>
        </div>
        <div>
          <span className="stat-label">
            확인할 준비사항
            <NotebookTabs size={18} />
          </span>
          <strong>
            {needs}
            <small>개</small>
          </strong>
          <p>하나씩 확인하면 어느새 준비 완료</p>
        </div>
        <div>
          <span className="stat-label">
            함께 마친 하루
            <CheckCircle2 size={18} />
          </span>
          <strong>
            {done.length}
            <small>회</small>
          </strong>
          <p>좋은 경험이 다음 협업의 밑거름으로</p>
        </div>
      </div>
      <section className="board">
        <div className="section-head">
          <h2>
            진행 중인 협업{" "}
            <span>{active.length.toString().padStart(2, "0")}</span>
          </h2>
          <span className="quiet">준비부터 정산까지, 한눈에</span>
        </div>
        <div className="filter-row">
          {["전체", "준비 중", "운영 예정", "정산 필요"].map((f) => (
            <button
              key={f}
              className={filter === f ? "selected" : ""}
              onClick={() => setFilter(f)}
            >
              {f}
              {f === "전체" && <span>{active.length}</span>}
            </button>
          ))}
        </div>
        <div className={`card-grid ${visible.length ? "" : "is-empty"}`}>
          {visible.map((c, i) => (
            <CollaborationCard
              key={c.id}
              c={c}
              index={i}
              onClick={() => go("detail", c.id)}
            />
          ))}
          <button className="new-card" onClick={() => go("new")}>
            <span>
              <Plus size={23} />
            </span>
            <strong>새로운 협업을 시작해요</strong>
            <p>어떤 하루를 함께 만들어볼까요?</p>
          </button>
        </div>
        {!visible.length && active.length > 0 && (
          <p className="filter-empty">이 상태의 협업은 아직 없어요.</p>
        )}
      </section>
      <div className="bottom-grid">
        <section className="recent">
          <div className="section-head">
            <h2>지난 협업</h2>
            <button className="text-button" onClick={() => go("history")}>
              기록 보기
              <ArrowUpRight size={15} />
            </button>
          </div>
          {done.length ? (
            done.slice(0, 3).map((c) => (
              <button
                className="recent-row"
                key={c.id}
                onClick={() => go("detail", c.id)}
              >
                <span className="mini-date">{shortDate(c.date)}</span>
                <span>
                  <strong>{c.title}</strong>
                  <small>매출 {money(c.settlement.sales)}원</small>
                </span>
                <span className="recent-amount">
                  {money(totals(c.settlement).remaining)}
                  <small>원 남았어요</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))
          ) : (
            <div className="past-empty">
              <NotebookTabs size={26} strokeWidth={1.3} />
              <p>함께 마친 하루가 이곳에 쌓여요.</p>
              <span>첫 협업을 마치고 기록을 남겨보세요.</span>
            </div>
          )}
        </section>
        <aside className="guide-card">
          <span className="eyebrow">A NOTE FOR YOUR DAY</span>
          <h3>“누가 결제를 받아야 하지?”</h3>
          <p>
            협업의 시작은 운영 구조를 정하는 일.
            <br />몇 가지 질문에 답하면, 확인할 사항과
            <br />
            필요한 문서를 정리해드려요.
          </p>
          <button className="text-button" onClick={() => go("new")}>
            새 협업에서 확인하기 <ArrowUpRight size={16} />
          </button>
          <span className="guide-spark">✳</span>
        </aside>
      </div>
    </>
  );
}
function CollaborationCard({
  c,
  index,
  onClick,
}: {
  c: Collaboration;
  index: number;
  onClick: () => void;
}) {
  const count = c.checklist.filter((i) => i.done).length;
  return (
    <button className={`collab-card tone-${index % 3}`} onClick={onClick}>
      <div className="card-top">
        <span className="card-date">
          {shortDate(c.date)}
          <small>
            {new Date(c.date + "T12:00:00").toLocaleDateString("ko-KR", {
              weekday: "short",
            })}
          </small>
        </span>
        <StatusBadge status={c.status} />
      </div>
      <div className="card-body">
        <span className="card-type">
          {c.food ? "FOOD & DRINK" : "SPACE & EXPERIENCE"}
        </span>
        <h3>{c.title}</h3>
        <p>
          {c.collaborator} <span>×</span> 우리 가게
        </p>
      </div>
      <div className="card-meta">
        <span>
          <Clock3 size={13} />
          {c.startTime}–{c.endTime}
        </span>
        <span>
          <Users size={13} />
          {c.people}명
        </span>
      </div>
      <div className="progress-label">
        <span>준비 체크리스트</span>
        <strong>
          {count}
          <em> / {c.checklist.length}</em>
        </strong>
      </div>
      <div className="progress-track">
        <span style={{ width: `${(count / c.checklist.length) * 100}%` }} />
      </div>
      <div className="card-bottom">
        <span>
          {c.status === "정산 필요"
            ? "매출을 입력하고 마무리해요"
            : c.date === today()
              ? "오늘, 함께하는 하루예요"
              : c.checklist.find((i) => !i.done)?.title ||
                "모든 준비를 확인했어요"}
        </span>
        <span className="round-arrow">
          <ArrowUpRight size={16} />
        </span>
      </div>
    </button>
  );
}
type NewData = Pick<
  Collaboration,
  | "title"
  | "date"
  | "startTime"
  | "endTime"
  | "collaborator"
  | "partyType"
  | "activity"
  | "food"
  | "cooking"
  | "outsideFood"
  | "worksOnSite"
  | "payment"
  | "expectedSales"
  | "expectedIngredients"
  | "people"
>;
function NewCollaboration({
  store,
  onCancel,
  onCreate,
}: {
  store: Store;
  onCancel: () => void;
  onCreate: (c: Collaboration) => void;
}) {
  const [step, setStep] = useState(0),
    [data, setData] = useState<NewData>({
      title: "",
      date: today(),
      startTime: "11:00",
      endTime: "18:00",
      collaborator: "",
      partyType: "개인",
      activity: "",
      food: true,
      cooking: true,
      outsideFood: false,
      worksOnSite: true,
      payment: "가게",
      expectedSales: 0,
      expectedIngredients: 0,
      people: 2,
    });
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [draftState, setDraftState] = useState("");
  const latest = useRef(data),
    queue = useRef<Promise<unknown>>(Promise.resolve()),
    completed = useRef(false),
    dirty = useRef(false);
  useEffect(() => {
    let active = true;
    api<Partial<NewData> | null>(`/stores/${store.id}/draft`)
      .then((d) => {
        if (!active) return;
        if (d) setData((old) => ({ ...old, ...d }));
        setReady(true);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [store.id]);
  const persist = useCallback(
    (d: NewData) => {
      setDraftState("임시 저장 중");
      const task = queue.current
        .catch(() => {})
        .then(() => api(`/stores/${store.id}/draft`, "PUT", d));
      queue.current = task;
      return task
        .then(() => setDraftState("입력 내용 자동 저장됨"))
        .catch((e) => {
          setDraftState("임시 저장 실패");
          setError(e.message);
        });
    },
    [store.id],
  );
  useEffect(() => {
    latest.current = data;
    if (!ready || !dirty.current) return;
    const timer = setTimeout(() => void persist(data), 600);
    return () => clearTimeout(timer);
  }, [data, ready, persist]);
  useEffect(
    () => () => {
      if (dirty.current && !completed.current) void persist(latest.current);
    },
    [persist],
  );
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (draftState.includes("중") || draftState.includes("실패")) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [draftState]);
  const change = <K extends keyof NewData>(key: K, value: NewData[K]) => {
    dirty.current = true;
    setData((d) => ({ ...d, [key]: value }));
  };
  const next = (e: React.FormEvent) => {
    e.preventDefault();
    setStep((s) => s + 1);
    window.scrollTo({ top: 0 });
  };
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      await persist(data);
      await queue.current;
      const c = await api<Collaboration>(
        `/stores/${store.id}/collaborations`,
        "POST",
        data,
      );
      completed.current = true;
      await api(`/stores/${store.id}/draft`, "DELETE", {}).catch(() => {});
      onCreate(c);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!ready)
    return (
      <div className="empty">
        {error || "작성하던 내용을 불러오고 있어요."}
        {error && (
          <button className="btn" onClick={() => window.location.reload()}>
            다시 불러오기
          </button>
        )}
      </div>
    );
  return (
    <div className="new-page">
      <button className="back" onClick={onCancel}>
        <ChevronLeft size={16} />
        협업 보드
      </button>
      <span className="eyebrow">LET’S MAKE A DAY</span>
      <h1>어떤 하루를 함께할까요?</h1>
      <p className="subtitle">
        몇 가지 질문이면 준비의 방향이 보여요. 입력 내용은 자동 저장돼요.
      </p>
      <div className="steps">
        {["만남의 기본 정보", "함께 일하는 방식", "예산과 준비 확인"].map(
          (s, i) => (
            <div key={s} className={i <= step ? "active" : ""}>
              <span>{i < step ? <Check size={14} /> : i + 1}</span>
              {s}
            </div>
          ),
        )}
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <form
        onSubmit={
          step < 2
            ? next
            : (e) => {
                e.preventDefault();
                void create();
              }
        }
      >
        <section className="form-card">
          {step === 0 ? (
            <>
              <span className="eyebrow">01 / THE OCCASION</span>
              <h2>먼저, 만남을 소개해주세요.</h2>
              <label>
                협업 이름
                <input
                  autoFocus
                  required
                  maxLength={200}
                  value={data.title}
                  onChange={(e) => change("title", e.target.value)}
                  placeholder="예: 오후의 커피 × 수진의 디저트"
                />
              </label>
              <div className="form-grid">
                <label>
                  날짜
                  <input
                    type="date"
                    required
                    value={data.date}
                    onChange={(e) => change("date", e.target.value)}
                  />
                </label>
                <label>
                  참여 인원
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    required
                    value={data.people}
                    onChange={(e) => change("people", Number(e.target.value))}
                  />
                </label>
                <label>
                  시작 시간
                  <input
                    type="time"
                    required
                    value={data.startTime}
                    onChange={(e) => change("startTime", e.target.value)}
                  />
                </label>
                <label>
                  종료 시간
                  <input
                    type="time"
                    required
                    value={data.endTime}
                    onChange={(e) => change("endTime", e.target.value)}
                  />
                </label>
              </div>
              {data.endTime <= data.startTime && (
                <p className="field-hint">종료 시간은 다음 날로 표시돼요.</p>
              )}
              <label>
                누구와 함께하나요?
                <input
                  required
                  maxLength={200}
                  value={data.collaborator}
                  onChange={(e) => change("collaborator", e.target.value)}
                  placeholder="이름 또는 브랜드명"
                />
              </label>
              <label>
                함께 무엇을 하나요?
                <textarea
                  required
                  maxLength={2000}
                  value={data.activity}
                  onChange={(e) => change("activity", e.target.value)}
                  placeholder="판매할 메뉴, 프로그램, 각자의 역할 등을 알려주세요."
                  rows={3}
                />
              </label>
            </>
          ) : step === 1 ? (
            <>
              <span className="eyebrow">02 / HOW WE WORK</span>
              <h2>함께하는 방식을 정해요.</h2>
              <Choice
                label="협업 상대는 사업자가 있나요?"
                options={["개인", "사업자"]}
                value={data.partyType}
                onChange={(v) => change("partyType", v as NewData["partyType"])}
              />
              <Toggle
                label="이 사람이 당일 가게에서 직접 일하나요?"
                hint="조리, 서빙, 진행 등 현장 업무를 포함해요."
                value={data.worksOnSite}
                onChange={(v) => change("worksOnSite", v)}
              />
              <Toggle
                label="음식이나 음료를 판매하나요?"
                value={data.food}
                onChange={(v) => {
                  change("food", v);
                  if (!v) {
                    change("cooking", false);
                    change("outsideFood", false);
                  }
                }}
              />
              {data.food && (
                <>
                  <Toggle
                    label="현장에서 조리하나요?"
                    value={data.cooking}
                    onChange={(v) => change("cooking", v)}
                  />
                  <Toggle
                    label="외부에서 조리한 음식을 가져오나요?"
                    hint="집이나 다른 장소에서 만들어오는 음식도 포함해요."
                    value={data.outsideFood}
                    onChange={(v) => change("outsideFood", v)}
                  />
                </>
              )}
              <Choice
                label="고객의 결제는 누가 받나요?"
                options={["가게", "협업자"]}
                value={data.payment}
                onChange={(v) => change("payment", v as NewData["payment"])}
              />
            </>
          ) : (
            <>
              <span className="eyebrow">03 / READY TO BEGIN</span>
              <h2>예산을 가볍게 짚어볼까요?</h2>
              <p className="field-hint">
                예상 금액은 준비용이에요. 실제 매출과 비용은 영업 후 정산에서
                입력해요.
              </p>
              <div className="form-grid">
                <Amount
                  label="예상 매출"
                  value={data.expectedSales}
                  onChange={(v) => change("expectedSales", v)}
                />
                <Amount
                  label="예상 식재료비"
                  value={data.expectedIngredients}
                  onChange={(v) => change("expectedIngredients", v)}
                />
              </div>
              <div className="structure-preview">
                <span className="eyebrow">검토할 운영 방식</span>
                <h3>{guidance(data).title}</h3>
                {guidance(data).flow.map((s) => (
                  <p key={s}>{s}</p>
                ))}
              </div>
              <div className="info-note">
                <AlertCircle size={17} />
                <p>
                  입력한 정보로 준비 목록과 문서 초안을 만들어요. 운영 방식의
                  적법성이나 근로자 여부를 확정하는 것은 아니에요.
                </p>
              </div>
            </>
          )}
        </section>
        <div className="form-actions">
          <button
            type="button"
            className="btn"
            onClick={() => (step ? setStep((s) => s - 1) : onCancel())}
          >
            <ChevronLeft size={16} />
            {step ? "이전" : "나중에 이어하기"}
          </button>
          <span className="draft-state">{draftState}</span>
          <button className="btn primary" disabled={busy}>
            {busy ? "만드는 중…" : step === 2 ? "협업 만들기" : "다음"}
            <ArrowRight size={17} />
          </button>
        </div>
      </form>
    </div>
  );
}
function Choice({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <fieldset className="choice-field">
      <legend>{label}</legend>
      <div className="choices">
        {options.map((v) => (
          <label className={v === value ? "chosen" : ""} key={v}>
            <input
              type="radio"
              checked={v === value}
              onChange={() => onChange(v)}
            />
            {v === value ? <CheckCircle2 size={17} /> : <Circle size={17} />}{" "}
            {v}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="toggle-row">
      <div>
        <strong>{label}</strong>
        {hint && <p>{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        className={`toggle ${value ? "on" : ""}`}
        onClick={() => onChange(!value)}
      >
        <span />
      </button>
    </div>
  );
}
function Amount({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <label>
      {label}
      <div className="amount-input">
        <input
          aria-label={label}
          type="number"
          inputMode="numeric"
          min={0}
          max={1_000_000_000}
          step={1}
          disabled={disabled}
          value={value === 0 ? "" : value}
          placeholder="0"
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n >= 0 && n <= 1_000_000_000)
              onChange(n);
          }}
        />
        <span>원</span>
      </div>
    </label>
  );
}
function Detail({
  c,
  update,
  go,
}: {
  c: Collaboration;
  update: (p: Patch) => void;
  go: (p: Page, id?: string) => void;
}) {
  const g = guidance(c),
    count = c.checklist.filter((i) => i.done).length;
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="detail-grid">
      <div>
        <section className="panel structure">
          <span className="eyebrow">OPERATING STRUCTURE</span>
          <h2>{g.title}</h2>
          <div className="flow">
            {g.flow.map((s, i) => (
              <div key={s}>
                <span>0{i + 1}</span>
                {s}
              </div>
            ))}
          </div>
          <p className="field-hint">
            입력값에 따른 검토 방향이에요. 실제 업무와 계약 내용을 함께
            확인하세요.
          </p>
        </section>
        {g.warnings.length > 0 && (
          <section className="panel warning-panel">
            <h3>
              <AlertCircle size={18} />
              판매·운영 전에 확인해주세요
            </h3>
            {g.warnings.map((w) => (
              <div className="warning-item" key={w}>
                {w}
              </div>
            ))}
            <div className="official-links">
              <a
                href="https://www.moel.go.kr/"
                target="_blank"
                rel="noreferrer"
              >
                고용노동부
                <ArrowUpRight size={13} />
              </a>
              <a
                href="https://www.foodsafetykorea.go.kr/"
                target="_blank"
                rel="noreferrer"
              >
                식품안전나라
                <ArrowUpRight size={13} />
              </a>
              <a href="https://www.nts.go.kr/" target="_blank" rel="noreferrer">
                국세청
                <ArrowUpRight size={13} />
              </a>
            </div>
            <p className="field-hint">
              일반 안내입니다. 영업 관련 사항은 관할 보건소, 근로관계는
              고용노동부·노무 전문가, 세무는 세무 전문가에게 구체적인 사실관계를
              확인하세요.
            </p>
          </section>
        )}
        <section className="panel checklist">
          <div className="section-head">
            <h2>하나씩, 준비해요</h2>
            <span className="count">
              {count} / {c.checklist.length}
            </span>
          </div>
          <div className="progress-track">
            <span style={{ width: `${(count / c.checklist.length) * 100}%` }} />
          </div>
          {c.checklist.map((item) => (
            <div
              className={`checklist-item ${item.done ? "done" : ""}`}
              key={item.id}
            >
              <div className="checklist-line">
                <button
                  disabled={c.status === "완료"}
                  role="checkbox"
                  aria-checked={item.done}
                  aria-label={item.title}
                  className="check-box"
                  onClick={() =>
                    update({
                      checklist: c.checklist.map((i) =>
                        i.id === item.id ? { ...i, done: !i.done } : i,
                      ),
                    })
                  }
                >
                  {item.done && <Check size={14} />}
                </button>
                <button
                  className="checklist-title"
                  onClick={() => setOpen(open === item.id ? null : item.id)}
                >
                  {item.title}
                  <ChevronDown
                    size={15}
                    className={open === item.id ? "rotated" : ""}
                  />
                </button>
              </div>
              {open === item.id && (
                <div className="checklist-description">
                  <p>{item.description}</p>
                  {item.id === "agreement" && (
                    <button
                      className="text-button"
                      onClick={() => go("documents", c.id)}
                    >
                      문서 만들기
                      <ArrowRight size={14} />
                    </button>
                  )}
                  {["sales", "settlement"].includes(item.id) && (
                    <button
                      className="text-button"
                      onClick={() => go("settlement", c.id)}
                    >
                      정산 열기
                      <ArrowRight size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </section>
      </div>
      <aside>
        <section className="panel">
          <span className="eyebrow">THIS COLLABORATION</span>
          <h3>하루의 기본 정보</h3>
          <dl className="info-list">
            <dt>협업 상대</dt>
            <dd>
              {c.collaborator} · {c.partyType}
            </dd>
            <dt>하는 일</dt>
            <dd>{c.activity}</dd>
            <dt>참여 인원</dt>
            <dd>{c.people}명</dd>
            <dt>조리</dt>
            <dd>
              {c.cooking ? "현장 조리" : "현장 조리 없음"}
              {c.outsideFood ? " · 외부 음식 반입" : ""}
            </dd>
            <dt>예상 매출</dt>
            <dd>{money(c.expectedSales)}원</dd>
            <dt>예상 식재료비</dt>
            <dd>{money(c.expectedIngredients)}원</dd>
          </dl>
          <label className="status-select">
            진행 상태
            <select
              value={c.status}
              onChange={(e) => {
                if (e.target.value === "완료") {
                  go("settlement", c.id);
                  return;
                }
                update({ status: e.target.value as Status });
              }}
            >
              {["준비 중", "운영 예정", "정산 필요", "완료"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </section>
        <section className="panel note-panel">
          <h3>함께 기억할 메모</h3>
          <textarea
            disabled={c.status === "완료"}
            rows={6}
            maxLength={10000}
            value={c.notes}
            onChange={(e) => update({ notes: e.target.value })}
            placeholder="메뉴 아이디어, 준비물, 서로 확인할 내용을 자유롭게 남겨요."
          />
          <span className="field-hint">변경 내용은 자동 저장돼요.</span>
        </section>
        <div className="info-note">
          <Sprout size={20} />
          <p>
            완료한 협업은 기록에 남아요.
            <br />
            수정이 필요하면 상태를 되돌려주세요.
          </p>
        </div>
      </aside>
    </div>
  );
}
function Documents({ c, store }: { c: Collaboration; store: Store }) {
  const [kind, setKind] = useState<DocumentKind>("협업 운영 합의서"),
    [body, setBody] = useState(() =>
      draftDocument("협업 운영 합의서", c, store),
    ),
    [docs, setDocs] = useState<SavedDocument[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState("");
  const [preview, setPreview] = useState(false),
    [edited, setEdited] = useState(false),
    [draftReady, setDraftReady] = useState(false);
  const drafts = useRef<Partial<Record<DocumentKind, string>>>({}),
    draftQueue = useRef<Promise<unknown>>(Promise.resolve()),
    draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    latestDraft = useRef<{ kind: DocumentKind; body: string } | null>(null);
  const persistDocument = useCallback(
    (d: { kind: DocumentKind; body: string }) => {
      setSaved("초안 자동 저장 중");
      draftQueue.current = draftQueue.current
        .catch(() => {})
        .then(() => api(`/collaborations/${c.id}/document-drafts`, "PUT", d))
        .then(() => {
          setSaved("초안 자동 저장됨");
          if (latestDraft.current === d) {
            setEdited(false);
            latestDraft.current = null;
          }
        })
        .catch((e) => {
          setSaved("초안 저장 실패");
          setError(e.message);
        });
    },
    [c.id],
  );
  useEffect(() => {
    let active = true;
    api<Partial<Record<DocumentKind, string>>>(
      `/collaborations/${c.id}/document-drafts`,
    )
      .then((d) => {
        if (!active) return;
        drafts.current = d;
        setBody(
          d["협업 운영 합의서"] ?? draftDocument("협업 운영 합의서", c, store),
        );
        setDraftReady(true);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
      clearTimeout(draftTimer.current);
      if (latestDraft.current) persistDocument(latestDraft.current);
    };
  }, [c.id, persistDocument]);
  useEffect(() => {
    api<SavedDocument[]>(`/collaborations/${c.id}/documents`)
      .then(setDocs)
      .catch((e) => setError(e.message));
  }, [c.id]);
  const selectKind = (k: DocumentKind) => {
    clearTimeout(draftTimer.current);
    if (latestDraft.current) persistDocument(latestDraft.current);
    setKind(k);
    setBody(drafts.current[k] ?? draftDocument(k, c, store));
    setSaved("");
  };
  async function save() {
    setBusy(true);
    setError("");
    try {
      const d = await api<SavedDocument>(
        `/collaborations/${c.id}/documents`,
        "POST",
        { kind, body },
      );
      setDocs((old) => [d, ...old]);
      setSaved("문서를 저장했어요.");
      setEdited(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (edited) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [edited]);
  return (
    <div className="document-layout">
      <aside>
        <section className="panel">
          <span className="eyebrow">DOCUMENTS</span>
          <h3>함께 확인하고, 남겨요.</h3>
          <p className="field-hint">
            입력한 정보를 채운 초안이에요. 빈 항목을 작성하고 최종 내용을
            확인하세요.
          </p>
          <div className="document-types">
            {documentKinds.map((k) => (
              <button
                key={k}
                className={kind === k ? "active" : ""}
                onClick={() => selectKind(k)}
              >
                <FileText size={17} />
                <span>{k}</span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        </section>
        <section className="panel">
          <h3>
            저장한 문서 <small>{docs.length}</small>
          </h3>
          {docs.length ? (
            docs.map((d) => (
              <button
                className="saved-doc"
                key={d.id}
                onClick={() => {
                  if (
                    edited &&
                    !window.confirm("수정 중인 초안을 바꾸시겠어요?")
                  )
                    return;
                  clearTimeout(draftTimer.current);
                  setBody(d.body);
                  setKind(d.kind);
                  drafts.current[d.kind] = d.body;
                  const copy = { kind: d.kind, body: d.body };
                  latestDraft.current = copy;
                  persistDocument(copy);
                  setSaved("저장한 문서를 불러왔어요.");
                }}
              >
                <FileText size={16} />
                <span>
                  {d.kind}
                  <small>
                    {new Date(d.createdAt).toLocaleString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <p className="field-hint">저장한 문서가 아직 없어요.</p>
          )}
        </section>
      </aside>
      <section className="panel document-editor">
        <div className="section-head">
          <div>
            <span className="eyebrow">DRAFT · 검토 초안</span>
            <h2>{kind}</h2>
          </div>
          <button className="text-button" onClick={() => setPreview(!preview)}>
            {preview ? "내용 수정" : "미리보기"}
          </button>
        </div>
        <div className="info-note">
          <AlertCircle size={16} />
          <p>
            법률 검토 전 초안입니다. 작성 보조 문서를 완성된 계약서로 사용하지
            마세요. PDF 저장은 인쇄 창에서 선택할 수 있어요.
          </p>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!draftReady ? (
          <div className="empty">
            {error
              ? "초안을 불러오지 못했어요. 새로고침 후 다시 시도해주세요."
              : "작성 중인 초안을 불러오고 있어요."}
          </div>
        ) : preview ? (
          <article className="document-paper">
            <pre>{body}</pre>
          </article>
        ) : (
          <textarea
            className="document-text"
            aria-label="문서 내용"
            maxLength={30000}
            value={body}
            onChange={(e) => {
              const value = e.target.value;
              setBody(value);
              setEdited(true);
              drafts.current[kind] = value;
              const d = { kind, body: value };
              latestDraft.current = d;
              setSaved("자동 저장 대기");
              clearTimeout(draftTimer.current);
              draftTimer.current = setTimeout(() => persistDocument(d), 500);
            }}
          />
        )}
        <div className="document-actions">
          <span>
            {saved ||
              (edited
                ? "자동 저장 중이에요"
                : "문서 저장을 누르면 현재 초안을 별도 기록으로 보관해요")}
          </span>
          <button
            className="btn"
            disabled={busy || !draftReady || !body.trim()}
            onClick={() => void save()}
          >
            <Save size={16} />
            {busy ? "저장 중" : "문서 저장"}
          </button>
          <button
            className="btn primary"
            disabled={!draftReady}
            onClick={() => {
              setPreview(true);
              setTimeout(() => window.print(), 100);
            }}
          >
            <Printer size={16} />
            인쇄 / PDF
          </button>
        </div>
      </section>
    </div>
  );
}
function SettlementPage({
  c,
  update,
  saveState,
}: {
  c: Collaboration;
  update: (p: Patch) => void;
  saveState: string;
}) {
  const s = c.settlement,
    t = totals(s),
    locked = c.status === "완료";
  const [confirmed, setConfirmed] = useState(false);
  const field = (key: keyof Settlement, value: number) =>
    update({ settlement: { ...s, [key]: value } });
  return (
    <div className="settlement-grid">
      <div>
        <section className="panel">
          <span className="eyebrow">CLOSE A GOOD DAY</span>
          <h2>함께한 하루를 숫자로 남겨요.</h2>
          <p className="field-hint">
            실제 매출과 비용을 입력하세요. 기본임금과 성과급은 서로 합의한
            지급액을 입력해요.
          </p>
          <div className="settlement-fields">
            <Amount
              label="총매출"
              value={s.sales}
              onChange={(n) => field("sales", n)}
              disabled={locked}
            />
            <div className="field-divider" />
            <Amount
              label="식재료비"
              value={s.ingredients}
              onChange={(n) => field("ingredients", n)}
              disabled={locked}
            />
            <Amount
              label="기타 직접비"
              value={s.other}
              onChange={(n) => field("other", n)}
              disabled={locked}
            />
            <Amount
              label="기본임금·기본 지급액"
              value={s.wage}
              onChange={(n) => field("wage", n)}
              disabled={locked}
            />
            <Amount
              label="성과급·추가 지급액"
              value={s.bonus}
              onChange={(n) => field("bonus", n)}
              disabled={locked}
            />
          </div>
          <div className="info-note">
            <AlertCircle size={17} />
            <p>
              여기서 남는 금액은 입력한 직접비와 협업자 지급액을 뺀 금액이에요.
              임대료, 세금, 결제 수수료 등 미입력 비용은 포함하지 않아요.
              지급액은 세전 기준으로 통일하고 원천징수 등은 별도로 확인하세요.
            </p>
          </div>
        </section>
      </div>
      <aside>
        <section className="settlement-summary">
          <span className="eyebrow">THE DAY IN NUMBERS</span>
          <h3>이번 협업의 정산</h3>
          <dl>
            <dt>총매출</dt>
            <dd>{money(s.sales)}원</dd>
            <dt>총비용</dt>
            <dd>− {money(t.costs)}원</dd>
            <dt className="sub">그중 협업자 지급액</dt>
            <dd className="sub">{money(t.payout)}원</dd>
          </dl>
          <div className="remaining">
            <span>가게에 남는 금액</span>
            <strong className={t.remaining < 0 ? "negative" : ""}>
              {money(t.remaining)}
              <small>원</small>
            </strong>
            <p>
              기여이익률{" "}
              <b>{t.margin === null ? "—" : `${t.margin.toFixed(1)}%`}</b>
            </p>
          </div>
          {locked ? (
            <>
              <div className="completed-note">
                <CheckCircle2 size={19} />
                정산을 완료한 협업이에요.
              </div>
              <button
                className="btn full"
                onClick={() => update({ status: "정산 필요" })}
              >
                수정하려면 정산 다시 열기
              </button>
            </>
          ) : (
            <>
              <label className="confirm-check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>
                  매출·비용을 확인했고, 실제 지급 및 필요한 증빙 정리를
                  마쳤어요.
                </span>
              </label>
              <button
                className="btn primary full"
                disabled={!confirmed || saveState !== "저장됨"}
                onClick={() => update({ status: "완료" })}
              >
                <Check size={17} />
                {saveState === "저장됨"
                  ? "정산 완료하고 기록하기"
                  : "저장 완료를 기다려주세요"}
              </button>
            </>
          )}
        </section>
        <p className="settlement-footnote">
          앱에서 실제 송금·세금 신고가 이루어지지는 않아요.
        </p>
      </aside>
    </div>
  );
}
function History({
  items,
  go,
}: {
  items: Collaboration[];
  go: (p: Page, id?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const done = items.filter((c) => c.status === "완료"),
    filtered = done
      .filter((c) =>
        `${c.title} ${c.collaborator}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  const sales = done.reduce((n, c) => n + c.settlement.sales, 0),
    remaining = done.reduce((n, c) => n + totals(c.settlement).remaining, 0);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">GOOD DAYS, KEPT TOGETHER</span>
          <h1>
            함께한 하루의 기록<span className="orange-dot">.</span>
          </h1>
          <p>지난 경험에서 다음 협업의 힌트를 찾아보세요.</p>
        </div>
        <button className="btn primary" onClick={() => go("new")}>
          <Plus size={17} />새 협업
        </button>
      </div>
      <div className="overview history-overview">
        <div>
          <span className="stat-label">
            완료한 협업
            <CheckCircle2 size={18} />
          </span>
          <strong>
            {done.length}
            <small>회</small>
          </strong>
        </div>
        <div>
          <span className="stat-label">
            누적 매출
            <Wallet size={18} />
          </span>
          <strong>
            {money(sales)}
            <small>원</small>
          </strong>
        </div>
        <div>
          <span className="stat-label">
            누적 기여이익
            <ArrowDownLeft size={18} />
          </span>
          <strong>
            {money(remaining)}
            <small>원</small>
          </strong>
        </div>
      </div>
      <section className="panel">
        <div className="section-head">
          <h2>협업별 정산 기록</h2>
          <input
            className="search"
            aria-label="기록 검색"
            placeholder="행사명·협업자 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {filtered.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>협업</th>
                  <th>날짜</th>
                  <th>매출</th>
                  <th>비용</th>
                  <th>협업자 지급액</th>
                  <th>기여이익</th>
                  <th>이익률</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const t = totals(c.settlement);
                  return (
                    <tr key={c.id}>
                      <td>
                        <button
                          className="table-link"
                          onClick={() => go("detail", c.id)}
                        >
                          {c.title}
                          <small>{c.collaborator}</small>
                        </button>
                      </td>
                      <td>{c.date}</td>
                      <td>{money(c.settlement.sales)}</td>
                      <td>{money(t.costs)}</td>
                      <td>{money(t.payout)}</td>
                      <td className="positive">{money(t.remaining)}</td>
                      <td>
                        {t.margin === null ? "—" : `${t.margin.toFixed(1)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="past-empty">
            <NotebookTabs size={32} />
            <h3>
              {query ? "검색 결과가 없어요." : "아직 완료한 협업이 없어요."}
            </h3>
            <p>정산을 마치면 매출과 기여이익이 이곳에 쌓여요.</p>
          </div>
        )}
        <p className="field-hint">
          금액 단위: 원 · 기여이익은 입력한 비용 기준이며 회계상 순이익과 다를
          수 있어요.
        </p>
      </section>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
