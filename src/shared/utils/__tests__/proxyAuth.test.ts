import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearStoredProxyAuth,
  PROXY_AUTH_STORAGE_KEY,
  readStoredProxyAuth,
  writeStoredProxyAuth,
} from "../proxyAuth";
import type { ProxyAuthCredentials } from "../proxyAuth";

describe("proxyAuth", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe("readStoredProxyAuth", () => {
    it("returns null when localStorage is empty", () => {
      expect(readStoredProxyAuth()).toBeNull();
    });

    it("parses valid JSON credentials correctly", () => {
      const credentials: ProxyAuthCredentials = {
        username: "testuser",
        password: "testpass",
      };
      localStorage.setItem(
        PROXY_AUTH_STORAGE_KEY,
        JSON.stringify(credentials),
      );

      const result = readStoredProxyAuth();
      expect(result).toEqual(credentials);
    });

    it("handles invalid JSON gracefully", () => {
      localStorage.setItem(PROXY_AUTH_STORAGE_KEY, "not valid json");

      const result = readStoredProxyAuth();
      expect(result).toBeNull();
    });

    it("trims username whitespace", () => {
      const credentials = { username: "  testuser  ", password: "testpass" };
      localStorage.setItem(
        PROXY_AUTH_STORAGE_KEY,
        JSON.stringify(credentials),
      );

      const result = readStoredProxyAuth();
      expect(result).toEqual({ username: "testuser", password: "testpass" });
    });

    it("returns null when username is empty after trimming", () => {
      const credentials = { username: "   ", password: "testpass" };
      localStorage.setItem(
        PROXY_AUTH_STORAGE_KEY,
        JSON.stringify(credentials),
      );

      const result = readStoredProxyAuth();
      expect(result).toBeNull();
    });

    it("returns null when stored value is not an object", () => {
      localStorage.setItem(PROXY_AUTH_STORAGE_KEY, JSON.stringify("string"));

      const result = readStoredProxyAuth();
      expect(result).toBeNull();
    });

    it("returns null when stored value is null", () => {
      localStorage.setItem(PROXY_AUTH_STORAGE_KEY, JSON.stringify(null));

      const result = readStoredProxyAuth();
      expect(result).toBeNull();
    });

    it("returns credentials with empty password when password is not a string", () => {
      const credentials = { username: "testuser", password: 123 };
      localStorage.setItem(
        PROXY_AUTH_STORAGE_KEY,
        JSON.stringify(credentials),
      );

      const result = readStoredProxyAuth();
      expect(result).toEqual({ username: "testuser", password: "" });
    });

    it("handles special characters in password", () => {
      const credentials: ProxyAuthCredentials = {
        username: "testuser",
        password: 'p@$$w0rd!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
      };
      localStorage.setItem(
        PROXY_AUTH_STORAGE_KEY,
        JSON.stringify(credentials),
      );

      const result = readStoredProxyAuth();
      expect(result).toEqual(credentials);
    });

    it("handles unicode characters in credentials", () => {
      const credentials: ProxyAuthCredentials = {
        username: "用户名",
        password: "密码🔥",
      };
      localStorage.setItem(
        PROXY_AUTH_STORAGE_KEY,
        JSON.stringify(credentials),
      );

      const result = readStoredProxyAuth();
      expect(result).toEqual(credentials);
    });
  });

  describe("writeStoredProxyAuth", () => {
    it("stores credentials correctly", () => {
      const credentials: ProxyAuthCredentials = {
        username: "testuser",
        password: "testpass",
      };

      writeStoredProxyAuth(credentials);

      const stored = localStorage.getItem(PROXY_AUTH_STORAGE_KEY);
      expect(stored).toBe(JSON.stringify(credentials));
    });

    it("overwrites existing credentials", () => {
      const oldCredentials: ProxyAuthCredentials = {
        username: "olduser",
        password: "oldpass",
      };
      const newCredentials: ProxyAuthCredentials = {
        username: "newuser",
        password: "newpass",
      };

      writeStoredProxyAuth(oldCredentials);
      writeStoredProxyAuth(newCredentials);

      const stored = localStorage.getItem(PROXY_AUTH_STORAGE_KEY);
      expect(stored).toBe(JSON.stringify(newCredentials));
    });

    it("preserves whitespace in username and password", () => {
      const credentials: ProxyAuthCredentials = {
        username: "  testuser  ",
        password: "  testpass  ",
      };

      writeStoredProxyAuth(credentials);

      const stored = localStorage.getItem(PROXY_AUTH_STORAGE_KEY);
      expect(stored).toBe(JSON.stringify(credentials));
    });
  });

  describe("clearStoredProxyAuth", () => {
    it("removes credentials from localStorage", () => {
      const credentials: ProxyAuthCredentials = {
        username: "testuser",
        password: "testpass",
      };
      localStorage.setItem(
        PROXY_AUTH_STORAGE_KEY,
        JSON.stringify(credentials),
      );

      clearStoredProxyAuth();

      expect(localStorage.getItem(PROXY_AUTH_STORAGE_KEY)).toBeNull();
    });

    it("does not throw when no credentials exist", () => {
      clearStoredProxyAuth();
      expect(localStorage.getItem(PROXY_AUTH_STORAGE_KEY)).toBeNull();
    });
  });

  describe("integration: write -> read -> clear", () => {
    it("full lifecycle works correctly", () => {
      const credentials: ProxyAuthCredentials = {
        username: "integrationuser",
        password: "integrationpass",
      };

      // Write
      writeStoredProxyAuth(credentials);

      // Read
      const readResult = readStoredProxyAuth();
      expect(readResult).toEqual(credentials);

      // Clear
      clearStoredProxyAuth();

      // Verify cleared
      expect(readStoredProxyAuth()).toBeNull();
    });
  });
});
