import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  buildWorkspaceUrl,
  appendQueryParams,
  delay,
  runBatchRequests,
  uploadWorkspaceFile,
  streamWorkspaceResponse,
} from "../workspaceApiHelpers";

describe("workspaceApiHelpers", () => {
  describe("buildWorkspaceUrl", () => {
    it("should build URL with endpoint starting with slash", () => {
      const result = buildWorkspaceUrl("http://localhost:8080", "/api/test");
      expect(result).toBe("http://localhost:8080/api/test");
    });

    it("should build URL with endpoint without leading slash", () => {
      const result = buildWorkspaceUrl("http://localhost:8080", "api/test");
      expect(result).toBe("http://localhost:8080/api/test");
    });

    it("should handle empty endpoint", () => {
      const result = buildWorkspaceUrl("http://localhost:8080", "");
      expect(result).toBe("http://localhost:8080/");
    });

    it("should handle root endpoint", () => {
      const result = buildWorkspaceUrl("http://localhost:8080", "/");
      expect(result).toBe("http://localhost:8080/");
    });

    it("should handle base URL with trailing slash", () => {
      const result = buildWorkspaceUrl("http://localhost:8080/", "api/test");
      expect(result).toBe("http://localhost:8080/api/test");
    });

    it("should handle nested endpoints", () => {
      const result = buildWorkspaceUrl("http://localhost:8080", "/api/v1/workspaces");
      expect(result).toBe("http://localhost:8080/api/v1/workspaces");
    });

    it("should handle base URL with path", () => {
      const result = buildWorkspaceUrl("http://localhost:8080/backend", "/api/test");
      expect(result).toBe("http://localhost:8080/backend/api/test");
    });

    it("should handle complex endpoints with query string format", () => {
      const result = buildWorkspaceUrl("http://localhost:8080", "/api/files?path=/home");
      expect(result).toBe("http://localhost:8080/api/files?path=/home");
    });
  });

  describe("appendQueryParams", () => {
    it("should append single query parameter", () => {
      const result = appendQueryParams("http://localhost:8080/api", {
        key: "value",
      });
      expect(result).toContain("key=value");
    });

    it("should append multiple query parameters", () => {
      const result = appendQueryParams("http://localhost:8080/api", {
        key1: "value1",
        key2: "value2",
      });
      expect(result).toContain("key1=value1");
      expect(result).toContain("key2=value2");
    });

    it("should handle URL without query params", () => {
      const result = appendQueryParams("http://localhost:8080/api");
      expect(result).toBe("http://localhost:8080/api");
    });

    it("should handle empty query params object", () => {
      const result = appendQueryParams("http://localhost:8080/api", {});
      expect(result).toBe("http://localhost:8080/api");
    });

    it("should handle undefined query params", () => {
      const result = appendQueryParams("http://localhost:8080/api", undefined);
      expect(result).toBe("http://localhost:8080/api");
    });

    it("should skip null and undefined values", () => {
      const result = appendQueryParams("http://localhost:8080/api", {
        valid: "value",
        nullValue: null as any,
        undefinedValue: undefined as any,
      });
      expect(result).toContain("valid=value");
      expect(result).not.toContain("nullValue");
      expect(result).not.toContain("undefinedValue");
    });

    it("should preserve existing query params", () => {
      const result = appendQueryParams("http://localhost:8080/api?existing=param", {
        new: "value",
      });
      expect(result).toContain("existing=param");
      expect(result).toContain("new=value");
    });

    it("should handle special characters in values", () => {
      const result = appendQueryParams("http://localhost:8080/api", {
        path: "/home/user/file.txt",
      });
      expect(result).toContain("path=");
      expect(result).toContain("%2F"); // Encoded slashes
    });

    it("should handle spaces in values", () => {
      const result = appendQueryParams("http://localhost:8080/api", {
        name: "test value",
      });
      expect(result).toContain("name=test+value");
    });
  });

  describe("delay", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should resolve after specified milliseconds", async () => {
      const promise = delay(1000);

      vi.advanceTimersByTime(999);
      const pendingBefore = Promise.race([promise, Promise.resolve("pending")]);
      expect(await pendingBefore).toBe("pending");

      vi.advanceTimersByTime(1);
      await expect(promise).resolves.toBeUndefined();
    });

    it("should resolve immediately for 0ms", async () => {
      const promise = delay(0);
      vi.runAllTimers();
      await expect(promise).resolves.toBeUndefined();
    });

    it("should handle large delay values", async () => {
      const promise = delay(10000);
      vi.advanceTimersByTime(10000);
      await expect(promise).resolves.toBeUndefined();
    });

    it("should return a promise", () => {
      const result = delay(100);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe("runBatchRequests", () => {
    it("should run single request", async () => {
      const requests = [() => Promise.resolve("result1")];
      const results = await runBatchRequests(requests);
      expect(results).toEqual(["result1"]);
    });

    it("should run multiple requests within batch size", async () => {
      const requests = [
        () => Promise.resolve(1),
        () => Promise.resolve(2),
        () => Promise.resolve(3),
      ];
      const results = await runBatchRequests(requests);
      expect(results).toEqual([1, 2, 3]);
    });

    it("should run requests in batches of 5", async () => {
      const requests = Array.from({ length: 10 }, (_, i) => Promise.resolve(i)).map((p) => () => p);
      const results = await runBatchRequests(requests);
      expect(results).toHaveLength(10);
    });

    it("should handle empty request array", async () => {
      const results = await runBatchRequests([]);
      expect(results).toEqual([]);
    });

    it("should preserve order of results", async () => {
      const requests = [
        () => Promise.resolve("first"),
        () => Promise.resolve("second"),
        () => Promise.resolve("third"),
      ];
      const results = await runBatchRequests(requests);
      expect(results[0]).toBe("first");
      expect(results[1]).toBe("second");
      expect(results[2]).toBe("third");
    });

    it("should handle requests that reject", async () => {
      const requests = [
        () => Promise.resolve("success"),
        () => Promise.reject(new Error("failure")),
      ];
      await expect(runBatchRequests(requests)).rejects.toThrow("failure");
    });

    it("should process requests concurrently within batch", async () => {
      const order: number[] = [];
      const requests = [
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              order.push(1);
              resolve(1);
            }, 10);
          }),
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              order.push(2);
              resolve(2);
            }, 5);
          }),
      ];

      // Use fake timers for this test
      vi.useFakeTimers();
      const promise = runBatchRequests(requests);

      await vi.runAllTimersAsync();
      const results = await promise;

      expect(results).toEqual([1, 2]);
      // Second should complete first due to shorter timeout
      expect(order).toEqual([2, 1]);

      vi.useRealTimers();
    });

    it("should handle more than 5 requests", async () => {
      const requests = Array.from({ length: 7 }, (_, i) => Promise.resolve(i)).map((p) => () => p);
      const results = await runBatchRequests(requests);
      expect(results).toHaveLength(7);
      expect(results).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });
  });

  describe("uploadWorkspaceFile", () => {
    it("should upload file with FormData", async () => {
      const mockRequest = vi.fn().mockResolvedValue({ success: true });
      const file = new File(["content"], "test.txt", { type: "text/plain" });

      const result = await uploadWorkspaceFile(
        mockRequest,
        "http://localhost:8080",
        "/upload",
        { Authorization: "Bearer token" },
        file,
      );

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith(
        "http://localhost:8080/upload",
        expect.objectContaining({
          method: "POST",
          body: expect.any(FormData),
        }),
      );
      expect(result).toEqual({ success: true });
    });

    it("should include additional data in FormData", async () => {
      const mockRequest = vi.fn().mockResolvedValue({});
      const file = new File(["content"], "test.txt");

      await uploadWorkspaceFile(mockRequest, "http://localhost:8080", "/upload", {}, file, {
        userId: "123",
        description: "test file",
      });

      const callArgs = mockRequest.mock.calls[0];
      const formData = callArgs[1].body as FormData;

      expect(formData.get("file")).toBe(file);
      expect(formData.get("userId")).toBe("123");
      expect(formData.get("description")).toBe("test file");
    });

    it("should filter out Content-Type header", async () => {
      const mockRequest = vi.fn().mockResolvedValue({});
      const file = new File(["content"], "test.txt");

      await uploadWorkspaceFile(
        mockRequest,
        "http://localhost:8080",
        "/upload",
        {
          "Content-Type": "application/json",
          Authorization: "Bearer token",
        },
        file,
      );

      const headers = mockRequest.mock.calls[0][1].headers;
      expect(headers).not.toHaveProperty("Content-Type");
      expect(headers).toHaveProperty("Authorization");
    });

    it("should filter Content-Type case-insensitively", async () => {
      const mockRequest = vi.fn().mockResolvedValue({});
      const file = new File(["content"], "test.txt");

      await uploadWorkspaceFile(
        mockRequest,
        "http://localhost:8080",
        "/upload",
        {
          "content-type": "application/json",
          "CONTENT-TYPE": "text/plain",
        },
        file,
      );

      const headers = mockRequest.mock.calls[0][1].headers;
      expect(headers).not.toHaveProperty("content-type");
      expect(headers).not.toHaveProperty("CONTENT-TYPE");
    });

    it("should handle endpoint without leading slash", async () => {
      const mockRequest = vi.fn().mockResolvedValue({});
      const file = new File(["content"], "test.txt");

      await uploadWorkspaceFile(mockRequest, "http://localhost:8080", "upload", {}, file);

      expect(mockRequest).toHaveBeenCalledWith("http://localhost:8080/upload", expect.any(Object));
    });

    it("should preserve other custom headers", async () => {
      const mockRequest = vi.fn().mockResolvedValue({});
      const file = new File(["content"], "test.txt");

      await uploadWorkspaceFile(
        mockRequest,
        "http://localhost:8080",
        "/upload",
        {
          "X-Custom-Header": "custom-value",
          Authorization: "Bearer token",
        },
        file,
      );

      const headers = mockRequest.mock.calls[0][1].headers;
      expect(headers["X-Custom-Header"]).toBe("custom-value");
      expect(headers["Authorization"]).toBe("Bearer token");
    });
  });

  describe("streamWorkspaceResponse", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          body: {
            getReader: () => ({
              read: vi
                .fn()
                .mockResolvedValueOnce({
                  done: false,
                  value: new TextEncoder().encode('{"data":"test1"}\n{"data":"test2"}'),
                })
                .mockResolvedValueOnce({ done: true, value: undefined }),
              releaseLock: vi.fn(),
            }),
          },
        }),
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("should yield parsed JSON lines from stream", async () => {
      const generator = streamWorkspaceResponse("http://localhost:8080", "/stream", {});

      const results = [];
      for await (const item of generator) {
        results.push(item);
      }

      expect(results).toEqual([{ data: "test1" }, { data: "test2" }]);
    });

    it("should send POST request with JSON body", async () => {
      const mockFetch = vi.mocked(fetch);
      const testData = { query: "test" };

      const generator = streamWorkspaceResponse(
        "http://localhost:8080",
        "/stream",
        { Authorization: "Bearer token" },
        testData,
      );

      // Consume generator
      for await (const _ of generator) {
      }

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8080/stream",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer token",
          }),
          body: JSON.stringify(testData),
        }),
      );
    });

    it("should throw error on non-ok response", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as any);

      const generator = streamWorkspaceResponse("http://localhost:8080", "/stream", {});

      await expect(async () => {
        for await (const _ of generator) {
          // Should throw before yielding
        }
      }).rejects.toThrow("HTTP 404: Not Found");
    });

    it("should throw error when response body is null", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        body: null,
      } as any);

      const generator = streamWorkspaceResponse("http://localhost:8080", "/stream", {});

      await expect(async () => {
        for await (const _ of generator) {
          // Should throw
        }
      }).rejects.toThrow("Response body is null");
    });

    it("should handle empty lines in stream", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => ({
            read: vi
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode('{"data":"test"}\n\n  \n{"data":"test2"}'),
              })
              .mockResolvedValueOnce({ done: true, value: undefined }),
            releaseLock: vi.fn(),
          }),
        },
      } as any);

      const generator = streamWorkspaceResponse("http://localhost:8080", "/stream", {});

      const results = [];
      for await (const item of generator) {
        results.push(item);
      }

      expect(results).toHaveLength(2);
      expect(results).toEqual([{ data: "test" }, { data: "test2" }]);
    });

    it("should warn and skip lines that fail to parse", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => ({
            read: vi
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode('{"valid":"json"}\ninvalid json\n{"also":"valid"}'),
              })
              .mockResolvedValueOnce({ done: true, value: undefined }),
            releaseLock: vi.fn(),
          }),
        },
      } as any);

      const generator = streamWorkspaceResponse("http://localhost:8080", "/stream", {});

      const results = [];
      for await (const item of generator) {
        results.push(item);
      }

      expect(results).toHaveLength(2);
      expect(results).toEqual([{ valid: "json" }, { also: "valid" }]);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to parse streaming response line:",
        "invalid json",
      );

      consoleSpy.mockRestore();
    });

    it("should release reader lock after completion", async () => {
      const releaseLock = vi.fn();
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn().mockResolvedValueOnce({ done: true, value: undefined }),
            releaseLock,
          }),
        },
      } as any);

      const generator = streamWorkspaceResponse("http://localhost:8080", "/stream", {});

      // Consume generator
      for await (const _ of generator) {
      }

      expect(releaseLock).toHaveBeenCalled();
    });

    it("should release reader lock even if error occurs", async () => {
      const releaseLock = vi.fn();
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn().mockRejectedValue(new Error("Read error")),
            releaseLock,
          }),
        },
      } as any);

      const generator = streamWorkspaceResponse("http://localhost:8080", "/stream", {});

      try {
        for await (const _ of generator) {
          // Should throw
        }
      } catch {
        // Expected
      }

      expect(releaseLock).toHaveBeenCalled();
    });

    it("should handle multiple chunks from stream", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => ({
            read: vi
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode('{"chunk":1}'),
              })
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode('{"chunk":2}'),
              })
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode('{"chunk":3}'),
              })
              .mockResolvedValueOnce({ done: true, value: undefined }),
            releaseLock: vi.fn(),
          }),
        },
      } as any);

      const generator = streamWorkspaceResponse("http://localhost:8080", "/stream", {});

      const results = [];
      for await (const item of generator) {
        results.push(item);
      }

      expect(results).toHaveLength(3);
      expect(results).toEqual([{ chunk: 1 }, { chunk: 2 }, { chunk: 3 }]);
    });
  });
});
