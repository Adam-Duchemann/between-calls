import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStaticProps } from "../getStaticProps";

const database = vi.hoisted(() => ({ findUnique: vi.fn() }));
const registry = vi.hoisted(() => ({ getAppWithMetadata: vi.fn() }));
vi.mock("@calcom/prisma", () => ({ prisma: { app: database } }));
vi.mock("@calcom/app-store/_appRegistry", () => registry);
vi.mock("@calcom/app-store/getAppAssetFullPath", () => ({
  getAppAssetFullPath: (file: string) => `/fixtures/${file}`,
}));

const upstream = {
  slug: "google-calendar",
  dirName: "googlecalendar",
  description: "Connect a Google calendar.",
  publisher: "Cal.diy",
  email: "help@cal.com",
  url: "https://cal.com/",
};

function descriptionFile(markdown: string) {
  const original = fs.readFileSync;
  vi.spyOn(fs, "readFileSync").mockImplementation((file, options) => {
    if (typeof file === "string" && file.endsWith("/DESCRIPTION.md")) return Buffer.from(markdown);
    return original(file, options);
  });
}

describe("private integration details", () => {
  beforeEach(() => {
    vi.stubEnv("CAL_PRIVATE_INSTANCE", "true");
    database.findUnique.mockResolvedValue({ enabled: true, dirName: "googlecalendar" });
    registry.getAppWithMetadata.mockResolvedValue(upstream);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("hides upstream publisher, contact and demo screenshots while preserving provider help", async () => {
    registry.getAppWithMetadata.mockResolvedValue({
      ...upstream,
      docsUrl: "https://support.google.com/calendar",
    });
    descriptionFile("---\nitems:\n  - example.png\n---\nProvider help and description.");

    const result = await getStaticProps("google-calendar");
    expect(result).toMatchObject({
      privateInstance: true,
      data: { publisher: "", email: "", url: "", docsUrl: "https://support.google.com/calendar" },
      source: { content: "Provider help and description.", data: {} },
    });
    expect(result && !result.isAppDisabled && result.source.data.items).toBeUndefined();
  });

  it("uses the app summary for upstream-specific instructions and keeps genuine vendor links", async () => {
    registry.getAppWithMetadata.mockResolvedValue({
      ...upstream,
      slug: "vendor",
      publisher: "Vendor",
      url: "https://vendor.example/install",
      email: "support@vendor.example",
      docsUrl: "https://github.com/calcom/cal.diy/issues/1",
    });
    descriptionFile("Install the [Cal.diy](https://cal.com) app from the upstream App Store.");

    expect(await getStaticProps("vendor")).toMatchObject({
      installUrl: "https://vendor.example/install",
      data: { publisher: "Vendor", email: "support@vendor.example", url: "https://vendor.example/install" },
      source: { content: upstream.description },
    });
    const result = await getStaticProps("vendor");
    expect(result?.data.docsUrl).toBeUndefined();
  });

  it("retains the ordinary app store publisher, contacts, instructions and gallery", async () => {
    vi.stubEnv("CAL_PRIVATE_INSTANCE", "false");
    descriptionFile("---\nitems:\n  - example.png\n---\nInstall Cal.diy.");

    expect(await getStaticProps("google-calendar")).toMatchObject({
      privateInstance: false,
      data: { publisher: "Cal.diy", email: "help@cal.com", url: "https://cal.com/" },
      source: { content: "Install Cal.diy.", data: { items: ["/fixtures/example.png"] } },
    });
  });
});
