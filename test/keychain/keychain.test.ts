import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock keytar before importing the keychain module so the real OS keychain
// is never touched. This pins the wrapper's service/account constants and its
// KeychainError translation behaviour.
vi.mock("keytar", () => ({
  default: {
    setPassword: vi.fn(),
    getPassword: vi.fn(),
    deletePassword: vi.fn(),
  },
}));

import keytar from "keytar";
const keytarMock = vi.mocked(keytar);

import {
  storeDeviceToken,
  getDeviceToken,
  deleteDeviceToken,
  isPaired,
} from "../../src/keychain/index.js";

describe("keychain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("storeDeviceToken", () => {
    it("calls keytar.setPassword with correct service/account", async () => {
      keytarMock.setPassword.mockResolvedValueOnce(undefined);
      await storeDeviceToken("my-token-xyz");
      expect(keytarMock.setPassword).toHaveBeenCalledWith(
        "agentsofmine-collector",
        "device-token",
        "my-token-xyz",
      );
    });

    it("throws KeychainError when keytar fails", async () => {
      keytarMock.setPassword.mockRejectedValueOnce(new Error("keychain locked"));
      await expect(storeDeviceToken("tok")).rejects.toMatchObject({ name: "KeychainError" });
    });
  });

  describe("getDeviceToken", () => {
    it("returns token when present", async () => {
      keytarMock.getPassword.mockResolvedValueOnce("tok-abc");
      const result = await getDeviceToken();
      expect(result).toBe("tok-abc");
    });

    it("returns null when not paired", async () => {
      keytarMock.getPassword.mockResolvedValueOnce(null);
      const result = await getDeviceToken();
      expect(result).toBeNull();
    });

    it("throws KeychainError when keytar fails", async () => {
      keytarMock.getPassword.mockRejectedValueOnce(new Error("access denied"));
      await expect(getDeviceToken()).rejects.toMatchObject({ name: "KeychainError" });
    });
  });

  describe("deleteDeviceToken", () => {
    it("returns true when token was deleted", async () => {
      keytarMock.deletePassword.mockResolvedValueOnce(true);
      const result = await deleteDeviceToken();
      expect(result).toBe(true);
    });

    it("returns false when no token found", async () => {
      keytarMock.deletePassword.mockResolvedValueOnce(false);
      const result = await deleteDeviceToken();
      expect(result).toBe(false);
    });

    it("throws KeychainError when keytar fails", async () => {
      keytarMock.deletePassword.mockRejectedValueOnce(new Error("access denied"));
      await expect(deleteDeviceToken()).rejects.toMatchObject({ name: "KeychainError" });
    });
  });

  describe("isPaired", () => {
    it("returns true when token exists", async () => {
      keytarMock.getPassword.mockResolvedValueOnce("some-token");
      expect(await isPaired()).toBe(true);
    });

    it("returns false when no token", async () => {
      keytarMock.getPassword.mockResolvedValueOnce(null);
      expect(await isPaired()).toBe(false);
    });
  });
});
