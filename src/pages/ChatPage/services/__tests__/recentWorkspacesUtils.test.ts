import { describe, expect, it } from "vitest";
import { deduplicateWorkspaces } from "../recentWorkspacesUtils";
import type { WorkspaceInfo } from "../recentWorkspacesTypes";

describe("recentWorkspacesUtils", () => {
  describe("deduplicateWorkspaces", () => {
    describe("deduplication logic", () => {
      it("should return empty array when input is empty", () => {
        const result = deduplicateWorkspaces([]);
        expect(result).toEqual([]);
      });

      it("should return same array when no duplicates", () => {
        const workspaces: WorkspaceInfo[] = [
          { path: "/path/to/workspace1", name: "Workspace 1" },
          { path: "/path/to/workspace2", name: "Workspace 2" },
          { path: "/path/to/workspace3", name: "Workspace 3" },
        ];
        const result = deduplicateWorkspaces(workspaces);
        expect(result).toEqual(workspaces);
      });

      it("should remove duplicate paths keeping first occurrence", () => {
        const workspaces: WorkspaceInfo[] = [
          { path: "/path/to/workspace1", name: "Workspace 1" },
          { path: "/path/to/workspace2", name: "Workspace 2" },
          { path: "/path/to/workspace1", name: "Workspace 1 Duplicate" },
        ];
        const result = deduplicateWorkspaces(workspaces);
        expect(result).toHaveLength(2);
        expect(result[0].name).toBe("Workspace 1");
        expect(result[1].name).toBe("Workspace 2");
      });

      it("should remove all duplicate paths", () => {
        const workspaces: WorkspaceInfo[] = [
          { path: "/path/to/workspace1", name: "Workspace 1" },
          { path: "/path/to/workspace1", name: "Workspace 1 Duplicate 1" },
          { path: "/path/to/workspace1", name: "Workspace 1 Duplicate 2" },
        ];
        const result = deduplicateWorkspaces(workspaces);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("Workspace 1");
      });

      it("should handle multiple different duplicates", () => {
        const workspaces: WorkspaceInfo[] = [
          { path: "/path/to/workspace1", name: "Workspace 1" },
          { path: "/path/to/workspace2", name: "Workspace 2" },
          { path: "/path/to/workspace1", name: "Workspace 1 Duplicate" },
          { path: "/path/to/workspace2", name: "Workspace 2 Duplicate" },
          { path: "/path/to/workspace3", name: "Workspace 3" },
        ];
        const result = deduplicateWorkspaces(workspaces);
        expect(result).toHaveLength(3);
        expect(result[0].name).toBe("Workspace 1");
        expect(result[1].name).toBe("Workspace 2");
        expect(result[2].name).toBe("Workspace 3");
      });

      it("should preserve order of first occurrences", () => {
        const workspaces: WorkspaceInfo[] = [
          { path: "/path/to/workspace3", name: "Workspace 3" },
          { path: "/path/to/workspace1", name: "Workspace 1" },
          { path: "/path/to/workspace3", name: "Workspace 3 Duplicate" },
          { path: "/path/to/workspace2", name: "Workspace 2" },
          { path: "/path/to/workspace1", name: "Workspace 1 Duplicate" },
        ];
        const result = deduplicateWorkspaces(workspaces);
        expect(result).toHaveLength(3);
        expect(result[0].name).toBe("Workspace 3");
        expect(result[1].name).toBe("Workspace 1");
        expect(result[2].name).toBe("Workspace 2");
      });
    });

    describe("edge cases", () => {
      it("should handle single workspace", () => {
        const workspaces: WorkspaceInfo[] = [{ path: "/path/to/workspace1", name: "Workspace 1" }];
        const result = deduplicateWorkspaces(workspaces);
        expect(result).toEqual(workspaces);
      });

      it("should handle unicode in paths", () => {
        const workspaces: WorkspaceInfo[] = [
          { path: "/路径/到/工作区1", name: "Workspace 1" },
          { path: "/路径/到/工作区2", name: "Workspace 2" },
          { path: "/路径/到/工作区1", name: "Workspace 1 Duplicate" },
        ];
        const result = deduplicateWorkspaces(workspaces);
        expect(result).toHaveLength(2);
        expect(result[0].name).toBe("Workspace 1");
      });

      it("should handle special characters in paths", () => {
        const workspaces: WorkspaceInfo[] = [
          { path: "/path/to/workspace-1", name: "Workspace 1" },
          { path: "/path/to/workspace_2", name: "Workspace 2" },
          { path: "/path/to/workspace-1", name: "Workspace 1 Duplicate" },
        ];
        const result = deduplicateWorkspaces(workspaces);
        expect(result).toHaveLength(2);
      });

      it("should handle very long paths", () => {
        const longPath = "/path/" + "a".repeat(1000);
        const workspaces: WorkspaceInfo[] = [
          { path: longPath, name: "Workspace 1" },
          { path: longPath, name: "Workspace 1 Duplicate" },
        ];
        const result = deduplicateWorkspaces(workspaces);
        expect(result).toHaveLength(1);
        expect(result[0].path).toBe(longPath);
      });

      it("should handle workspaces with same name but different paths", () => {
        const workspaces: WorkspaceInfo[] = [
          { path: "/path/to/workspace1", name: "My Workspace" },
          { path: "/different/path/workspace2", name: "My Workspace" },
        ];
        const result = deduplicateWorkspaces(workspaces);
        expect(result).toHaveLength(2);
      });

      it("should handle workspaces with different names but same path", () => {
        const workspaces: WorkspaceInfo[] = [
          { path: "/path/to/workspace1", name: "Workspace A" },
          { path: "/path/to/workspace1", name: "Workspace B" },
        ];
        const result = deduplicateWorkspaces(workspaces);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("Workspace A");
      });
    });

    describe("real-world scenarios", () => {
      it("should handle typical workspace list", () => {
        const workspaces: WorkspaceInfo[] = [
          { path: "/Users/user/projects/frontend", name: "Frontend Project" },
          { path: "/Users/user/projects/backend", name: "Backend Project" },
          { path: "/Users/user/projects/frontend", name: "Frontend Project" },
          { path: "/Users/user/projects/mobile", name: "Mobile Project" },
        ];
        const result = deduplicateWorkspaces(workspaces);
        expect(result).toHaveLength(3);
        expect(result.map((w) => w.name)).toEqual([
          "Frontend Project",
          "Backend Project",
          "Mobile Project",
        ]);
      });

      it("should handle Windows-style paths", () => {
        const workspaces: WorkspaceInfo[] = [
          { path: "C:\\Users\\user\\projects\\workspace1", name: "Workspace 1" },
          { path: "C:\\Users\\user\\projects\\workspace2", name: "Workspace 2" },
          {
            path: "C:\\Users\\user\\projects\\workspace1",
            name: "Workspace 1 Duplicate",
          },
        ];
        const result = deduplicateWorkspaces(workspaces);
        expect(result).toHaveLength(2);
      });

      it("should handle mixed path styles", () => {
        const workspaces: WorkspaceInfo[] = [
          { path: "/Users/user/projects/workspace1", name: "Workspace 1" },
          { path: "/home/user/workspace2", name: "Workspace 2" },
          { path: "/Users/user/projects/workspace1", name: "Workspace 1 Duplicate" },
        ];
        const result = deduplicateWorkspaces(workspaces);
        expect(result).toHaveLength(2);
      });

      it("should handle relative paths", () => {
        const workspaces: WorkspaceInfo[] = [
          { path: "../workspace1", name: "Workspace 1" },
          { path: "../workspace2", name: "Workspace 2" },
          { path: "../workspace1", name: "Workspace 1 Duplicate" },
        ];
        const result = deduplicateWorkspaces(workspaces);
        expect(result).toHaveLength(2);
      });
    });

    describe("performance", () => {
      it("should handle large workspace lists efficiently", () => {
        const workspaces: WorkspaceInfo[] = [];
        for (let i = 0; i < 1000; i++) {
          workspaces.push({
            path: `/path/to/workspace${i % 100}`, // Creates duplicates
            name: `Workspace ${i}`,
          });
        }
        const result = deduplicateWorkspaces(workspaces);
        expect(result).toHaveLength(100); // Only 100 unique paths
      });

      it("should handle workspace list with all same path", () => {
        const workspaces: WorkspaceInfo[] = Array.from({ length: 100 }, (_, i) => ({
          path: "/same/path",
          name: `Workspace ${i}`,
        }));
        const result = deduplicateWorkspaces(workspaces);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("Workspace 0");
      });
    });
  });
});
