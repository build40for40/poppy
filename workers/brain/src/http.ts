export const BASE_PATH = "/poppy/api";

export function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

export function error(status: number, code: string, extra?: Record<string, unknown>, headers?: HeadersInit): Response {
  return json({ error: code, ...extra }, status, headers);
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(code);
  }

  toResponse(): Response {
    return error(this.status, this.code, this.extra);
  }
}

/** Reads the body as the exact text that was sent, so a signature can be checked against it before anything parses it. */
export async function readText(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get("Content-Length"));
  if (declared > maxBytes) throw new HttpError(413, "body_too_large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new HttpError(413, "body_too_large");
  return text;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
