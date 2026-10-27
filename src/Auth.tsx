import React, { useState } from "react";
import { Sprout, CheckCircle2, ArrowRight, LoaderCircle } from "lucide-react";
import { api, ApiError } from "./api";
type User = { id: string; name: string; email: string };
type Mode = "login" | "register" | "pending" | "forgot" | "reset" | "verify";
export function Auth({
  onLogin,
  initialError,
  onReset,
}: {
  onLogin: (u: User) => void;
  initialError: string;
  onReset: () => void;
}) {
  const [link] = useState(() => {
    const m = window.location.hash.match(
      /^#(verify-email|reset-password)=([a-f0-9]{64})$/,
    );
    return m ? { kind: m[1], token: m[2] } : null;
  });
  const [mode, setMode] = useState<Mode>(
    link?.kind === "verify-email" ? "verify" : link ? "reset" : "login",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(initialError),
    [notice, setNotice] = useState(""),
    [email, setEmail] = useState("");
  const clearLink = () =>
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  const switchMode = (m: Mode) => {
    setMode(m);
    setError("");
    setNotice("");
  };
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const f = new FormData(e.currentTarget);
    try {
      if (mode === "verify") {
        const u = await api<User>("/auth/verify-email", "POST", {
          token: link?.token,
        });
        clearLink();
        onLogin(u);
      } else if (mode === "reset") {
        if (f.get("password") !== f.get("confirmPassword"))
          throw Error("새 비밀번호가 서로 다릅니다.");
        const r = await api<{ message: string }>(
          "/auth/reset-password",
          "POST",
          { token: link?.token, password: f.get("password") },
        );
        clearLink();
        onReset();
        setMode("login");
        setNotice(r.message);
      } else if (mode === "forgot" || mode === "pending") {
        const r = await api<{ message: string }>(
          `/auth/${mode === "forgot" ? "forgot-password" : "resend-verification"}`,
          "POST",
          { email },
        );
        setNotice(r.message);
      } else {
        const r = await api<
          User | { verificationRequired: true; email: string; message: string }
        >(`/auth/${mode === "register" ? "register" : "login"}`, "POST", {
          email,
          password: f.get("password"),
          ...(mode === "register" ? { name: f.get("name") } : {}),
        });
        if ("verificationRequired" in r) {
          setMode("pending");
          setNotice(r.message);
        } else {
          clearLink();
          onLogin(r);
        }
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && mode === "login")
        setMode("pending");
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const headings: Record<Mode, string> = {
    login: "다시 만나 반가워요.",
    register: "첫 하루를 시작해볼까요?",
    pending: "받은편지함을 확인해주세요.",
    forgot: "비밀번호를 잊으셨나요?",
    reset: "새 비밀번호를 정해주세요.",
    verify: "이메일 주소를 확인해요.",
  };
  const descriptions: Record<Mode, string> = {
    login: "로그인하고 준비하던 협업을 이어가세요.",
    register: "나만의 계정으로 가게와 협업을 관리하세요.",
    pending:
      "확인 메일의 링크를 열면 가입이 완료돼요. 메일이 없다면 다시 요청하세요.",
    forgot: "가입한 이메일로 비밀번호 재설정 링크를 보내드려요.",
    reset: "다른 곳에서 쓰지 않는 10자 이상의 비밀번호를 입력해주세요.",
    verify: "아래 버튼을 눌러 이메일 확인을 완료하고 하루를 시작하세요.",
  };
  const buttons: Record<Mode, string> = {
    login: "로그인",
    register: "계정 만들기",
    pending: "확인 메일 다시 보내기",
    forgot: "재설정 메일 보내기",
    reset: "비밀번호 변경하기",
    verify: "이메일 확인하고 시작하기",
  };
  return (
    <div className="auth-page">
      <section className="auth-story">
        <a className="brand" href="#">
          <span className="brand-icon">
            <Sprout size={23} />
          </span>
          하루<span className="brand-dot">.</span>
        </a>
        <span className="eyebrow">A LITTLE SPACE. A NEW POSSIBILITY.</span>
        <h1>
          우리 가게에서
          <br />
          함께 만드는
          <br />
          <em>새로운 하루.</em>
        </h1>
        <p>
          처음 나누는 아이디어부터 마지막 정산까지.
          <br />
          작은 가게를 위한, 든든한 협업 노트.
        </p>
        <div className="auth-illustration">
          <span className="sun" />
          <div className="shop">
            <div className="awning">HARU COFFEE & FRIENDS</div>
            <div className="shop-front">
              <div className="shop-window">
                <Sprout size={64} strokeWidth={1.2} />
              </div>
              <div className="shop-door">
                <span>OPEN</span>
              </div>
            </div>
          </div>
          <div className="plant">
            <Sprout size={56} />
          </div>
        </div>
        <span className="auth-caption">좋은 공간에 좋은 만남이 더해질 때.</span>
      </section>
      <section className="auth-form">
        <div className="auth-form-inner">
          <span className="eyebrow">YOUR NEXT COLLABORATION</span>
          <h2>{headings[mode]}</h2>
          <p>{descriptions[mode]}</p>
          <form onSubmit={submit}>
            {mode === "register" && (
              <label>
                이름
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={80}
                  placeholder="어떻게 불러드릴까요?"
                />
              </label>
            )}
            {!["verify", "reset"].includes(mode) && (
              <label>
                이메일
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="hello@example.com"
                />
              </label>
            )}
            {["login", "register", "reset"].includes(mode) && (
              <label>
                {mode === "reset" ? "새 비밀번호" : "비밀번호"}
                <input
                  name="password"
                  type="password"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  minLength={10}
                  maxLength={128}
                  required
                  placeholder="10자 이상 입력해주세요"
                />
              </label>
            )}
            {mode === "reset" && (
              <label>
                새 비밀번호 확인
                <input
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  maxLength={128}
                  required
                  placeholder="한 번 더 입력해주세요"
                />
              </label>
            )}
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            {notice && (
              <div className="info-note" role="status">
                <CheckCircle2 size={15} />
                <p>{notice}</p>
              </div>
            )}
            <button className="btn primary full" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                buttons[mode]
              )}
              <ArrowRight size={17} />
            </button>
          </form>
          {mode === "login" && (
            <div className="auth-recovery">
              <button
                className="text-button"
                onClick={() => switchMode("forgot")}
              >
                비밀번호를 잊으셨나요?
              </button>
            </div>
          )}
          <p className="auth-toggle">
            {mode === "login"
              ? "처음 방문하셨나요?"
              : mode === "register"
                ? "이미 계정이 있나요?"
                : "다른 계정으로 이용하려면"}{" "}
            <button
              onClick={() => {
                clearLink();
                switchMode(mode === "login" ? "register" : "login");
              }}
            >
              {mode === "login" ? "회원가입" : "로그인"}
            </button>
          </p>
          <div className="auth-fine">
            <CheckCircle2 size={15} />
            <span>협업 기록은 내 계정에 안전하게 저장돼요.</span>
          </div>
        </div>
      </section>
    </div>
  );
}
