import { lookup } from "node:dns/promises";
import type { RequestOptions } from "node:https";
import { request } from "node:https";
import { isIP } from "node:net";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import ipaddr from "ipaddr.js";

const failure = () => new ErrorWithCode(ErrorCode.BadRequest, "website_palette_unavailable");
const MAX_BYTES = 1024 * 1024;
const redirects = new Set([301, 302, 303, 307, 308]);

function publicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.process(address);
  return parsed.range() === "unicast";
}

function publicUrl(value: string): URL {
  if (value.length > 2048) throw failure();
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443"))
    throw failure();
  if (hostname === "localhost" || /\.(localhost|local|internal)\.?$/.test(hostname)) throw failure();
  if (isIP(hostname) && !publicAddress(hostname)) throw failure();
  url.hash = "";
  return url;
}

async function resolveTarget(url: URL, deadline: number) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) return { address: hostname, family: isIP(hostname) };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answers = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(failure()), Math.max(1, Math.min(2500, deadline - Date.now())));
      }),
    ]);
    if (!answers.length || answers.some(({ address }) => !publicAddress(address))) throw failure();
    return answers.find((answer) => answer.family === 4) ?? answers[0];
  } finally {
    clearTimeout(timer);
  }
}

export async function readPublicWebsite(
  input: string,
  kind: "html" | "css",
  deadline = Date.now() + 8000
): Promise<{ url: string; body: string }> {
  let url = publicUrl(input);
  for (let hop = 0; hop <= 3; hop++) {
    if (Date.now() >= deadline) throw failure();
    const target = await resolveTarget(url, deadline);
    const result = await new Promise<{ body: string; location?: string }>((resolve, reject) => {
      // Pin DNS at connect time while retaining the original hostname for TLS verification.
      const options: RequestOptions & { autoSelectFamily: boolean } = {
        agent: false,
        autoSelectFamily: false,
        family: target.family,
        lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
        headers: {
          Accept: kind === "html" ? "text/html" : "text/css",
          "Accept-Encoding": "identity",
          "User-Agent": "BookWithAdam-Palette/1.0",
        },
      };
      const req = request(url, options, (response) => {
        if (redirects.has(response.statusCode ?? 0)) {
          response.destroy();
          if (!response.headers.location) return reject(failure());
          resolve({ body: "", location: response.headers.location });
          return;
        }
        const contentType = (response.headers["content-type"] || "").split(";")[0].trim();
        const expected = kind === "html" ? ["text/html", "application/xhtml+xml"] : ["text/css"];
        if (
          response.statusCode !== 200 ||
          !expected.includes(contentType) ||
          (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") ||
          Number(response.headers["content-length"] || 0) > MAX_BYTES
        ) {
          response.destroy();
          reject(failure());
          return;
        }
        const chunks: Buffer[] = [];
        let length = 0;
        response.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length > MAX_BYTES) {
            req.destroy(failure());
            reject(failure());
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", () => reject(failure()));
        response.on("aborted", () => reject(failure()));
        response.on("end", () => resolve({ body: Buffer.concat(chunks).toString("utf8") }));
      });
      const timeout = setTimeout(
        () => req.destroy(failure()),
        Math.max(1, Math.min(5000, deadline - Date.now()))
      );
      req.on("error", () => reject(failure()));
      req.on("close", () => clearTimeout(timeout));
      req.end();
    });
    if (!result.location) return { url: url.toString(), body: result.body };
    url = publicUrl(new URL(result.location, url).toString());
  }
  throw failure();
}
