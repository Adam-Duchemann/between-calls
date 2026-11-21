import { appStoreMetadata } from "@calcom/app-store/appStoreMetaData";
import { expect, it } from "vitest";

it("uses provider-focused descriptions throughout the integration catalog", () => {
  const upstreamDescriptions = Object.values(appStoreMetadata)
    .filter(({ description }) => /\bcal\.(?:diy|com)\b/i.test(description))
    .map(({ slug }) => slug);

  expect(upstreamDescriptions).toEqual([]);
});
