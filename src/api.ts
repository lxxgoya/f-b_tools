export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method,
    headers: data !== undefined ? { "Content-Type": "application/json" } : {},
    body: data !== undefined ? JSON.stringify(data) : undefined,
    credentials: "same-origin",
  });
  const body = await r.json();
  if (!r.ok) throw new ApiError(body.error || "요청에 실패했습니다.", r.status);
  return body;
}
