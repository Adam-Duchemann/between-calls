import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSealedPrivateGoogleGrant,
  readPrivateGoogleGrant,
  sealPrivateGoogleGrant,
} from "./privateGrantStorage";

const key = {
  access_token: "synthetic-access-token",
  refresh_token: "synthetic-refresh-token",
  expiry_date: 123456,
  calGoogleAccountId: "fixture-account",
  calGoogleGrantVersion: "fixture-version",
};

describe("private Google grant storage", () => {
  beforeEach(() => vi.stubEnv("CALENDSO_ENCRYPTION_KEY", "fixture-grant-secret-32-bytes---"));
  afterEach(() => vi.unstubAllEnvs());

  it("reads existing plaintext grants during cutover", () => {
    expect(isSealedPrivateGoogleGrant(key)).toBe(false);
    expect(readPrivateGoogleGrant(key, 7)).toEqual(key);
  });

  it("persists account and version metadata with randomized authenticated ciphertext", () => {
    const stored = sealPrivateGoogleGrant(key, 7);
    expect(isSealedPrivateGoogleGrant(stored)).toBe(true);
    expect(stored).toMatchObject({
      calGoogleAccountId: key.calGoogleAccountId,
      calGoogleGrantVersion: key.calGoogleGrantVersion,
    });
    expect(JSON.stringify(stored)).not.toContain(key.access_token);
    expect(JSON.stringify(stored)).not.toContain(key.refresh_token);
    expect(stored).not.toHaveProperty("expiry_date");
    expect(sealPrivateGoogleGrant(key, 7)).not.toEqual(stored);
    expect(readPrivateGoogleGrant(stored, 7)).toEqual(key);
  });

  it("rejects a different owner, modified metadata and modified ciphertext", () => {
    const stored = sealPrivateGoogleGrant(key, 7);
    expect(() => readPrivateGoogleGrant(stored, 8)).toThrow("Could not decrypt");
    expect(() => readPrivateGoogleGrant({ ...stored, calGoogleAccountId: "other" }, 7)).toThrow(
      "Could not decrypt"
    );
    expect(() => readPrivateGoogleGrant({ ...stored, calGoogleGrantVersion: "other" }, 7)).toThrow(
      "Could not decrypt"
    );
    expect(() => readPrivateGoogleGrant({ ...stored, ciphertext: "AAAA" }, 7)).toThrow("Could not decrypt");
  });

  it("rejects a changed encryption secret and refuses to seal without the configured key", () => {
    const stored = sealPrivateGoogleGrant(key, 7);
    vi.stubEnv("CALENDSO_ENCRYPTION_KEY", "another-grant-secret-32-bytes---");
    expect(() => readPrivateGoogleGrant(stored, 7)).toThrow("Could not decrypt");
    vi.stubEnv("CALENDSO_ENCRYPTION_KEY", "");
    expect(() => sealPrivateGoogleGrant(key, 7)).toThrow("CALENDSO_ENCRYPTION_KEY");
  });
});
