export class MailDeliveryError extends Error {}
export type AccountMail = {
  to: string;
  purpose: "verify" | "reset";
  url: string;
};
export type SendAccountMail = (message: AccountMail) => Promise<void>;
export function resendMailer(apiKey: string, from: string): SendAccountMail {
  return async ({ to, purpose, url }) => {
    const verify = purpose === "verify";
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: verify
          ? "[하루] 이메일 주소를 확인해주세요"
          : "[하루] 비밀번호 재설정 안내",
        text: `${verify ? "하루에 오신 것을 환영합니다. 이메일 확인을 완료하려면" : "비밀번호를 새로 설정하려면"} 아래 링크를 여세요.\n\n${url}\n\n${verify ? "24시간" : "30분"} 동안 한 번만 사용할 수 있습니다. 요청하지 않았다면 이 메일을 무시하세요.`,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(`Email provider returned HTTP ${response.status}`);
  };
}
