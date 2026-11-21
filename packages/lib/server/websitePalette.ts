import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { contrastRatio } from "@calcom/prisma/bookingPageAppearanceSchema";
import { readPublicWebsite } from "./readPublicWebsite";

const colourPattern = /#[\da-f]{6}\b|#[\da-f]{3}\b|rgb\(\s*\d{1,3}[,\s]+\d{1,3}[,\s]+\d{1,3}\s*\)/gi;
const unavailable = () => new ErrorWithCode(ErrorCode.BadRequest, "website_palette_unavailable");

function normaliseColour(value: string): string | null {
  if (value.startsWith("#"))
    return (
      value.length === 4
        ? `#${Array.from(value.slice(1))
            .map((c) => c + c)
            .join("")}`
        : value
    ).toUpperCase();
  const channels = value.match(/\d+/g)?.map(Number);
  if (!channels || channels.length !== 3 || channels.some((c) => c > 255)) return null;
  return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}
function attributes(tag: string): Record<string, string> {
  return Object.fromEntries(
    Array.from(tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)).map((match) => [
      match[1].toLowerCase(),
      (match[2] ?? match[3] ?? match[4]).replace(/&amp;/g, "&"),
    ])
  );
}
function withoutScripts(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}
function preferredColour(css: string, names: string): string | null {
  const expression = new RegExp(
    `--(?:[\\w-]*-)?(?:${names})(?:-color)?\\s*:\\s*(${colourPattern.source})`,
    "i"
  );
  const match = css.match(expression);
  return match ? normaliseColour(match[1]) : null;
}
// Static root selectors cover common theme classes without executing website code.
function rootVariables(html: string, css: string): string {
  const roots = ["html", "body"].map((tag) => ({
    tag,
    attrs: attributes(html.match(new RegExp(`<${tag}\\b[^>]*>`, "i"))?.[0] || ""),
  }));
  const values = new Map<string, { value: string; weight: number }>();
  for (const rule of Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))) {
    const weights = rule[1].split(",").flatMap((raw) => {
      const selector = raw.trim();
      if (selector === ":root") return [10];
      if (!/^(?:html|body)?(?:[.#][\w-]+)*$/.test(selector) || !selector) return [];
      const tag = selector.match(/^(html|body)/)?.[1];
      const ids = Array.from(selector.matchAll(/#([\w-]+)/g)).map((match) => match[1]);
      const classes = Array.from(selector.matchAll(/\.([\w-]+)/g)).map((match) => match[1]);
      return roots.some(
        (root) =>
          (!tag || root.tag === tag) &&
          ids.every((id) => root.attrs.id === id) &&
          classes.every((name) => (root.attrs.class || "").split(/\s+/).includes(name))
      )
        ? [ids.length * 100 + classes.length * 10 + (tag ? 1 : 0)]
        : [];
    });
    if (!weights.length) continue;
    const weight = Math.max(...weights);
    for (const declaration of Array.from(rule[2].matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g))) {
      if ((values.get(declaration[1])?.weight ?? -1) <= weight)
        values.set(declaration[1], { value: declaration[2], weight });
    }
  }
  return Array.from(values)
    .map(([name, entry]) => `${name}:${entry.value};`)
    .join(" ");
}
function colourful(hex: string): boolean {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  return Math.max(...channels) - Math.min(...channels) > 20;
}

export function extractWebsitePalette(html: string, stylesheets: string[]) {
  const cleanHtml = withoutScripts(html);
  const inlineStyles = Array.from(cleanHtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)).map(
    (match) => match[1]
  );
  const inlineAttributes = Array.from(cleanHtml.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)).map(
    (match) => match[1] ?? match[2]
  );
  const css = [...inlineStyles, ...inlineAttributes, ...stylesheets]
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const matches = (css.match(colourPattern) || [])
    .slice(0, 4096)
    .map(normaliseColour)
    .filter((colour): colour is string => !!colour);
  if (!matches.length) throw unavailable();
  const counts = new Map<string, number>();
  for (const colour of matches) counts.set(colour, (counts.get(colour) || 0) + 1);
  const colours = Array.from(counts.keys()).sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0));
  const paletteCss = rootVariables(cleanHtml, css) || css;
  const background =
    preferredColour(paletteCss, "bg|background|paper|canvas") ||
    colours.find((colour) => contrastRatio(colour, "#000000") > 12) ||
    "#FFFFFF";
  const surfaceCandidate = preferredColour(paletteCss, "surface|card");
  const surface =
    surfaceCandidate && contrastRatio(surfaceCandidate, background) < 1.5 ? surfaceCandidate : background;
  const proposedText = preferredColour(paletteCss, "ink|text|foreground");
  const readableOnBoth = (colour: string) =>
    contrastRatio(colour, background) >= 4.5 && contrastRatio(colour, surface) >= 4.5;
  const text =
    proposedText && readableOnBoth(proposedText)
      ? proposedText
      : ["#292923", "#FFFFFF", "#000000"].find(readableOnBoth);
  if (!text) throw unavailable();
  const themeMeta = Array.from(cleanHtml.matchAll(/<meta\b[^>]*>/gi))
    .map((match) => attributes(match[0]))
    .find((meta) => meta.name?.toLowerCase() === "theme-color");
  const metaColour = themeMeta?.content?.match(/^#[\da-f]{3}(?:[\da-f]{3})?$/i)
    ? normaliseColour(themeMeta.content)
    : null;
  const proposedAccent = preferredColour(paletteCss, "accent|teal|primary|brand") || metaColour;
  const accent =
    proposedAccent && readableOnBoth(proposedAccent)
      ? proposedAccent
      : colours.find((colour) => colourful(colour) && readableOnBoth(colour)) || text;
  const headingFont: "serif" | "sans" = /font-family\s*:[^;}]*\b(?:Georgia|Times New Roman)\b/i.test(css)
    ? "serif"
    : "sans";
  return { background, surface, accent, text, headingFont };
}

export async function suggestWebsiteAppearance(input: string, read = readPublicWebsite) {
  const deadline = Date.now() + 20000;
  const page = await read(input, "html", deadline);
  const base = new URL(page.url);
  const stylesheets: string[] = [];
  const links = Array.from(withoutScripts(page.body).matchAll(/<link\b[^>]*>/gi)).map((match) =>
    attributes(match[0])
  );
  const urls = new Set<string>();
  for (const link of links) {
    if (!link.rel?.toLowerCase().split(/\s+/).includes("stylesheet") || !link.href) continue;
    try {
      const url = new URL(link.href, base);
      if (url.origin === base.origin && url.protocol === "https:") urls.add(url.toString());
    } catch {
      continue;
    }
    if (urls.size === 3) break;
  }
  for (const url of Array.from(urls)) {
    try {
      stylesheets.push((await read(url, "css", deadline)).body);
    } catch {
      /* Inline colours remain useful when a stylesheet is unavailable. */
    }
  }
  return { ...extractWebsitePalette(page.body, stylesheets), websiteUrl: page.url };
}
