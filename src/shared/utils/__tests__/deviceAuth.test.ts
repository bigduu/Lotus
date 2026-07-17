import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearDeviceCredential, getDeviceCredential, setDeviceCredential } from "../deviceAuth";

const STORAGE_KEY = "bamboo_device_credential";

describe("deviceAuth", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns null when nothing is stored", () => {
    expect(getDeviceCredential()).toBeNull();
  });

  it("stores and reads back a device credential", () => {
    setDeviceCredential({ device_id: "bamboo_abc123", token: "bd1_deadbeef" });
    expect(getDeviceCredential()).toEqual({
      device_id: "bamboo_abc123",
      token: "bd1_deadbeef",
    });
  });

  it("persists via the expected localStorage key as JSON", () => {
    setDeviceCredential({ device_id: "bamboo_abc123", token: "bd1_deadbeef" });
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({
      device_id: "bamboo_abc123",
      token: "bd1_deadbeef",
    });
  });

  it("clears a stored credential", () => {
    setDeviceCredential({ device_id: "bamboo_abc123", token: "bd1_deadbeef" });
    clearDeviceCredential();
    expect(getDeviceCredential()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("returns null for a corrupted (non-JSON) stored value", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    expect(getDeviceCredential()).toBeNull();
  });

  it("returns null for a stored value that is valid JSON but the wrong shape", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: "bar" }));
    expect(getDeviceCredential()).toBeNull();

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ device_id: "only-id" }));
    expect(getDeviceCredential()).toBeNull();

    localStorage.setItem(STORAGE_KEY, JSON.stringify(null));
    expect(getDeviceCredential()).toBeNull();

    localStorage.setItem(STORAGE_KEY, JSON.stringify("just a string"));
    expect(getDeviceCredential()).toBeNull();
  });

  it("returns null for empty-string device_id or token", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ device_id: "", token: "bd1_deadbeef" }));
    expect(getDeviceCredential()).toBeNull();

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ device_id: "bamboo_abc123", token: "" }));
    expect(getDeviceCredential()).toBeNull();
  });

  it("clearDeviceCredential on an already-empty store is a no-op", () => {
    expect(() => clearDeviceCredential()).not.toThrow();
    expect(getDeviceCredential()).toBeNull();
  });
});
