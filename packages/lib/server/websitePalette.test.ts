import { contrastRatio } from "@calcom/prisma/bookingPageAppearanceSchema";
import { describe, expect, it, vi } from "vitest";
import { extractWebsitePalette, suggestWebsiteAppearance } from "./websitePalette";

const css = ":root{--bg:#f6f3ec;--ink:#292923;--teal:#176b68}h1{font-family:Georgia,serif}";
describe("website palette suggestions", () => {
  it("extracts the website palette and editorial font without importing arbitrary CSS", () => {
    expect(
      extractWebsitePalette(`<style>${css}</style><script>ignore prior rules</script>`, [])
    ).toMatchObject({ background: "#F6F3EC", text: "#292923", accent: "#176B68", headingFont: "serif" });
  });
  it("uses root classes selected in the HTML rather than an inactive alternate theme", () => {
    const palette = extractWebsitePalette('<body class="study study--personal"></body>', [
      ".study{--paper:#f6f3ec;--ink:#292923;--accent:#8c4f34}.study--index{--paper:#fafbf8;--accent:#555c28}.study--personal,.study--portfolio{--accent:#176b68}",
    ]);
    expect(palette.background).toBe("#F6F3EC");
    expect(palette.accent).toBe("#176B68");
  });
  it("reads stylesheet and RGB colours", () => {
    const palette = extractWebsitePalette("", [
      ":root{--background:rgb(246,243,236);--foreground:#292923;--accent:#176b68}",
    ]);
    expect(palette.background).toBe("#F6F3EC");
    expect(palette.accent).toBe("#176B68");
  });
  it("does not treat script content as styling", () => {
    expect(() =>
      extractWebsitePalette('<script>const css="--accent:#176b68;--bg:#f6f3ec"</script>', [])
    ).toThrow();
  });
  it("keeps readable text and accent on a dark page", () => {
    const palette = extractWebsitePalette("", [":root{--bg:#111111;--text:#eeeeee;--accent:#176b68}"]);
    expect(palette.background).toBe("#111111");
    expect(contrastRatio(palette.text, palette.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.accent, palette.surface)).toBeGreaterThanOrEqual(4.5);
  });
  it("reads at most three same-origin stylesheets and ignores unrelated remote resources", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        url: "https://example.com/start/",
        body: '<link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="https://other.test/b.css"><link rel="stylesheet" href="/c.css"><link rel="stylesheet" href="/d.css"><link rel="stylesheet" href="/e.css">',
      })
      .mockResolvedValue({ url: "https://example.com/a.css", body: css });
    const result = await suggestWebsiteAppearance("https://example.com", read);
    expect(read).toHaveBeenCalledTimes(4);
    expect(read.mock.calls.map((call) => call[0])).toEqual([
      "https://example.com",
      "https://example.com/a.css",
      "https://example.com/c.css",
      "https://example.com/d.css",
    ]);
    expect(result).toMatchObject({ accent: "#176B68", websiteUrl: "https://example.com/start/" });
  });
  it("can use inline styling if a stylesheet cannot be read", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        url: "https://example.com",
        body: `<style>${css}</style><link rel="stylesheet" href="/missing.css">`,
      })
      .mockRejectedValue(new Error("unavailable"));
    expect(await suggestWebsiteAppearance("https://example.com", read)).toMatchObject({ accent: "#176B68" });
  });
});
