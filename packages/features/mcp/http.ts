import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";

const invalid = () => new ErrorWithCode(ErrorCode.BadRequest, "invalid_request");
const forbidden = () => new ErrorWithCode(ErrorCode.Forbidden, "access_denied");
const mediaType = (request: Request) =>
  request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();

export function assertBrowserMutation(request: Request, origin: string) {
  if (
    request.method !== "POST" ||
    request.headers.has("authorization") ||
    request.headers.get("origin") !== origin ||
    mediaType(request) !== "application/json"
  )
    throw forbidden();
}

export function assertMcpOrigin(request: Request, origin: string, allowedOrigins: string[] = []) {
  const incoming = request.headers.get("origin");
  if (incoming !== null && incoming !== origin && !allowedOrigins.includes(incoming)) throw forbidden();
}

export async function readMcpBody(request: Request): Promise<unknown> {
  const maximum = 32768;
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw invalid();
  const type = mediaType(request);
  if (type !== "application/json" && type !== "application/x-www-form-urlencoded") throw invalid();
  const reader = request.body?.getReader();
  if (!reader) throw invalid();
  let bytes = 0;
  let body = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) {
        await reader.cancel();
        throw invalid();
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    if (type === "application/json") return JSON.parse(body);
    const parameters = new URLSearchParams(body);
    const result: Record<string, string> = Object.create(null);
    parameters.forEach((value, key) => {
      if (Object.hasOwn(result, key)) throw invalid();
      result[key] = value;
    });
    return result;
  } catch {
    throw invalid();
  } finally {
    reader.releaseLock();
  }
}
