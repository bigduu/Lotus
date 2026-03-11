import { ExecutionStatus } from "../types/chat";

export interface FormattedResult {
  isJson: boolean;
  formattedText: string;
  parsedJson?: unknown;
}

export interface FileChangeCheckpoint {
  created: boolean;
  id?: string;
  path?: string;
  size_bytes?: number;
  reason?: string;
}

export interface FileChangeDiff {
  unified: string;
  old_line_count?: number;
  new_line_count?: number;
  added_lines?: number;
  removed_lines?: number;
  truncated?: boolean;
}

export interface FileChangeResultPayload {
  operation: string;
  message?: string;
  file_path: string;
  workspace?: string;
  checkpoint?: FileChangeCheckpoint;
  diff: FileChangeDiff;
}

export interface DiffStats {
  added: number;
  removed: number;
}

export type DiffLineKind =
  | "meta"
  | "hunk"
  | "context"
  | "add"
  | "remove"
  | "modified_add"
  | "modified_remove";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export interface CollapseOptions {
  maxLines?: number;
  maxCharacters?: number;
}

const DEFAULT_COLLAPSE_OPTIONS: Required<CollapseOptions> = {
  maxLines: 8,
  maxCharacters: 500,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toStringValue = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const toNumberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const toBooleanValue = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

export const parseFileChangeResultPayload = (
  content: string,
): FileChangeResultPayload | null => {
  if (!content) {
    return null;
  }

  const trimmed = content.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!isRecord(parsed)) {
      return null;
    }

    const filePath = toStringValue(parsed.file_path);
    const operation = toStringValue(parsed.operation);
    const diffRaw = parsed.diff;
    if (!filePath || !operation || !isRecord(diffRaw)) {
      return null;
    }

    const unified = toStringValue(diffRaw.unified);
    if (!unified) {
      return null;
    }

    const checkpointRaw = parsed.checkpoint;
    const checkpoint: FileChangeCheckpoint | undefined = isRecord(checkpointRaw)
      ? {
          created: toBooleanValue(checkpointRaw.created) ?? false,
          id: toStringValue(checkpointRaw.id),
          path: toStringValue(checkpointRaw.path),
          size_bytes: toNumberValue(checkpointRaw.size_bytes),
          reason: toStringValue(checkpointRaw.reason),
        }
      : undefined;

    return {
      operation,
      message: toStringValue(parsed.message),
      file_path: filePath,
      workspace: toStringValue(parsed.workspace),
      checkpoint,
      diff: {
        unified,
        old_line_count: toNumberValue(diffRaw.old_line_count),
        new_line_count: toNumberValue(diffRaw.new_line_count),
        added_lines: toNumberValue(diffRaw.added_lines),
        removed_lines: toNumberValue(diffRaw.removed_lines),
        truncated: toBooleanValue(diffRaw.truncated),
      },
    };
  } catch {
    return null;
  }
};

const isRemovedLine = (line: string): boolean =>
  line.startsWith("-") && !line.startsWith("---");

const isAddedLine = (line: string): boolean =>
  line.startsWith("+") && !line.startsWith("+++");

export const parseUnifiedDiffLines = (unified: string): DiffLine[] => {
  const rawLines = unified.split("\n");
  const output: DiffLine[] = [];

  let index = 0;
  while (index < rawLines.length) {
    const line = rawLines[index] ?? "";

    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      output.push({ kind: "meta", text: line });
      index += 1;
      continue;
    }
    if (line.startsWith("@@")) {
      output.push({ kind: "hunk", text: line });
      index += 1;
      continue;
    }

    if (isRemovedLine(line)) {
      const removedBlock: string[] = [];
      while (index < rawLines.length && isRemovedLine(rawLines[index] ?? "")) {
        removedBlock.push(rawLines[index] ?? "");
        index += 1;
      }

      const addedBlock: string[] = [];
      while (index < rawLines.length && isAddedLine(rawLines[index] ?? "")) {
        addedBlock.push(rawLines[index] ?? "");
        index += 1;
      }

      if (addedBlock.length > 0) {
        removedBlock.forEach((item) =>
          output.push({ kind: "modified_remove", text: item }),
        );
        addedBlock.forEach((item) =>
          output.push({ kind: "modified_add", text: item }),
        );
      } else {
        removedBlock.forEach((item) =>
          output.push({ kind: "remove", text: item }),
        );
      }
      continue;
    }

    if (isAddedLine(line)) {
      output.push({ kind: "add", text: line });
      index += 1;
      continue;
    }

    output.push({ kind: "context", text: line });
    index += 1;
  }

  return output;
};

export const extractDiffStatsFromUnified = (unified: string): DiffStats => {
  let added = 0;
  let removed = 0;

  for (const line of unified.split("\n")) {
    if (isAddedLine(line)) {
      added += 1;
      continue;
    }
    if (isRemovedLine(line)) {
      removed += 1;
    }
  }

  return { added, removed };
};

export const getFileChangeDiffStats = (content: string): DiffStats | null => {
  const payload = parseFileChangeResultPayload(content);
  if (!payload) {
    return null;
  }

  const fallback = extractDiffStatsFromUnified(payload.diff.unified);
  return {
    added: payload.diff.added_lines ?? fallback.added,
    removed: payload.diff.removed_lines ?? fallback.removed,
  };
};

/**
 * Recursively process JSON values to convert escaped newlines to actual newlines
 */
const unescapeJsonStrings = (value: unknown): unknown => {
  if (typeof value === "string") {
    // Replace literal \n with actual newlines
    return value.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }
  if (Array.isArray(value)) {
    return value.map(unescapeJsonStrings);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = unescapeJsonStrings(val);
    }
    return result;
  }
  return value;
};

/**
 * Try to parse JSON content and return formatted output with metadata.
 */
export const formatResultContent = (content: string): FormattedResult => {
  if (!content) {
    return {
      isJson: false,
      formattedText: "",
    };
  }

  const trimmed = content.trim();

  if (!trimmed) {
    return {
      isJson: false,
      formattedText: "",
    };
  }

  // Quick heuristic to avoid JSON.parse on plain text
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    if (!(trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      return {
        isJson: false,
        formattedText: content,
      };
    }
  }

  try {
    const parsed = JSON.parse(trimmed);

    // Check if this is a simple object with a single "content" or "result" field
    // that contains the actual text content
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length === 1
    ) {
      const key = Object.keys(parsed)[0];
      if (
        (key === "content" || key === "result" || key === "output") &&
        typeof parsed[key] === "string"
      ) {
        // This is likely a wrapped text content, extract and unescape it
        const textContent = parsed[key] as string;
        const unescaped = textContent
          .replace(/\\n/g, "\n")
          .replace(/\\t/g, "\t");
        return {
          isJson: false, // Treat as plain text for better display
          formattedText: unescaped,
          parsedJson: parsed,
        };
      }
    }

    // For complex JSON, unescape strings recursively
    const unescaped = unescapeJsonStrings(parsed);
    return {
      isJson: true,
      formattedText: JSON.stringify(unescaped, null, 2),
      parsedJson: unescaped,
    };
  } catch (error) {
    // Fall back to original content if parsing fails
    return {
      isJson: false,
      formattedText: content,
    };
  }
};

/**
 * Determine whether a block of content should be collapsed by default.
 */
export const shouldCollapseContent = (
  content: string,
  options: CollapseOptions = {},
): boolean => {
  const config: Required<CollapseOptions> = {
    ...DEFAULT_COLLAPSE_OPTIONS,
    ...options,
  };

  if (!content) {
    return false;
  }

  const lineCount = content.split(/\r?\n/).length;
  if (lineCount > config.maxLines) {
    return true;
  }

  return content.length > config.maxCharacters;
};

/**
 * Generate a truncated preview snippet for large payloads.
 */
export const createContentPreview = (
  content: string,
  maxLength = 320,
): { preview: string; isTruncated: boolean } => {
  if (!content) {
    return { preview: "", isTruncated: false };
  }

  if (content.length <= maxLength) {
    return { preview: content, isTruncated: false };
  }

  return {
    preview: content.substring(0, maxLength).trimEnd() + "…",
    isTruncated: true,
  };
};

/**
 * Generate a compact preview (~60 chars) for collapsed view.
 * Used in ToolResultCard header to show a brief result summary.
 */
export const createCompactPreview = (content: string): string => {
  if (!content) {
    return "No content";
  }

  const maxLength = 60;
  const trimmed = content.trim();
  const fileChangePayload = parseFileChangeResultPayload(trimmed);
  if (fileChangePayload) {
    const target =
      fileChangePayload.file_path.split(/[\\/]/).pop() || fileChangePayload.file_path;
    const summary = `${fileChangePayload.operation}: ${target}`;
    return summary.length <= maxLength
      ? summary
      : summary.substring(0, maxLength).trimEnd() + "…";
  }

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  // For JSON content, try to extract a meaningful summary
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);

      // Check for common result patterns
      if (typeof parsed === "object" && parsed !== null) {
        // If it has a content/result/output field, use that
        const resultKey = [
          "content",
          "result",
          "output",
          "message",
          "data",
        ].find((k) => k in parsed && typeof parsed[k] === "string");
        if (resultKey) {
          const value = parsed[resultKey];
          return value.length <= maxLength
            ? value
            : value.substring(0, maxLength).trimEnd() + "…";
        }

        // For arrays, show count
        if (Array.isArray(parsed)) {
          return `Array with ${parsed.length} items`;
        }

        // For objects, show key count
        const keys = Object.keys(parsed);
        return `Object with ${keys.length} propert${keys.length === 1 ? "y" : "ies"}`;
      }
    } catch {
      // Fall through to default truncation
    }
  }

  return trimmed.substring(0, maxLength).trimEnd() + "…";
};

/**
 * Map execution status to Ant Design friendly colors.
 */
export const getStatusColor = (status: ExecutionStatus): string => {
  switch (status) {
    case "success":
      return "green";
    case "error":
      return "red";
    case "warning":
      return "orange";
    default:
      return "blue";
  }
};

/**
 * Normalize stringified JSON payloads for clipboard usage.
 */
export const safeStringify = (value: unknown, spacing = 2): string => {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, spacing);
  } catch (error) {
    console.error("[resultFormatters] Failed to stringify value:", error);
    return String(value);
  }
};
