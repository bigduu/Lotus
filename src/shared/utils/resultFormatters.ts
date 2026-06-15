import { ExecutionStatus } from "@shared/types/chat";

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

export interface MemoryInspectDataPayload {
  scope: string;
  project_key?: string;
  total_memories: number;
  by_type: Record<string, number>;
  by_status: Record<string, number>;
  recent_ids: string[];
  view_files: string[];
  index_files: string[];
  state_files: string[];
  stale_candidate_count: number;
  last_reindex_at?: string;
  last_dream_at?: string;
  topic_paths: string[];
}

export interface MemoryInspectRebuildPayload {
  action: "inspect" | "rebuild";
  scope?: string;
  project_key?: string;
  data: MemoryInspectDataPayload;
}

export interface DiffStats {
  added: number;
  removed: number;
}

export interface ConclusionToolResultPayload {
  type: "conclusion";
  title: string;
  conclusion: string;
  key_points: string[];
  next_steps: string[];
  confidence?: string;
}

export interface MermaidGraphPayload {
  title?: string;
  graph: string;
}

export interface ConclusionWithOptionsConclusionPayload {
  title: string;
  summary: string;
  key_points: string[];
  next_steps: string[];
  confidence?: string;
  mermaid?: MermaidGraphPayload;
}

export interface ConclusionWithOptionsToolResultPayload {
  question: string;
  options: string[];
  allow_custom: boolean;
  conclusion?: ConclusionWithOptionsConclusionPayload;
}

export type DiffLineKind =
  | "meta"
  | "hunk"
  | "context"
  | "add"
  | "remove"
  | "modified_add"
  | "modified_remove"
  | "gap";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export type SideBySideDiffRowKind = "meta" | "hunk" | "context" | "add" | "remove" | "modified";

export interface SideBySideDiffRow {
  kind: SideBySideDiffRowKind;
  text?: string;
  oldLineNumber?: number;
  newLineNumber?: number;
  oldText?: string;
  newText?: string;
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

const parseJsonRecord = (content: string): Record<string, unknown> | null => {
  if (!content) return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const decodeEscapedText = (value: string): string => {
  if (!/\\u[0-9a-fA-F]{4}|\\n|\\t|\\r/.test(value)) {
    return value;
  }

  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r");
};

const normalizeTextArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => decodeEscapedText(item).trim())
    .filter(Boolean);
};

const normalizeOptionalText = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = decodeEscapedText(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseMermaidPayload = (value: unknown): MermaidGraphPayload | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const graph = normalizeOptionalText(value.graph);
  if (!graph) {
    return undefined;
  }

  return {
    title: normalizeOptionalText(value.title),
    graph,
  };
};

const parseConclusionWithOptionsConclusionPayload = (
  value: unknown,
): ConclusionWithOptionsConclusionPayload | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const summary = normalizeOptionalText(value.summary) ?? normalizeOptionalText(value.conclusion);
  if (!summary) {
    return undefined;
  }

  return {
    title: normalizeOptionalText(value.title) || "Conclusion",
    summary,
    key_points: normalizeTextArray(value.key_points),
    next_steps: normalizeTextArray(value.next_steps),
    confidence: normalizeOptionalText(value.confidence),
    mermaid: parseMermaidPayload(value.mermaid),
  };
};

export const parseConclusionToolResultPayload = (
  content: string,
): ConclusionToolResultPayload | null => {
  const parsed = parseJsonRecord(content);
  if (!parsed) {
    return null;
  }

  const conclusion = normalizeOptionalText(parsed.conclusion);
  if (!conclusion) {
    return null;
  }

  if (parsed.type != null && parsed.type !== "conclusion") {
    return null;
  }

  return {
    type: "conclusion",
    title: normalizeOptionalText(parsed.title) || "Conclusion",
    conclusion,
    key_points: normalizeTextArray(parsed.key_points),
    next_steps: normalizeTextArray(parsed.next_steps),
    confidence: normalizeOptionalText(parsed.confidence),
  };
};

export const parseInteractiveQuestionToolResultPayload = (
  content: string,
): ConclusionWithOptionsToolResultPayload | null => {
  const parsed = parseJsonRecord(content);
  if (!parsed) {
    return null;
  }

  const question = normalizeOptionalText(parsed.question);
  if (!question) {
    return null;
  }

  const status = normalizeOptionalText(parsed.status);
  if (status && status !== "awaiting_user_input" && status !== "awaiting_permission_approval") {
    return null;
  }

  return {
    question,
    options: normalizeTextArray(parsed.options),
    allow_custom: typeof parsed.allow_custom === "boolean" ? parsed.allow_custom : true,
    conclusion: parseConclusionWithOptionsConclusionPayload(parsed.conclusion),
  };
};

/**
 * Returns true when a tool result is a permission-approval prompt synthesized by
 * the backend permission gate (`status === "awaiting_permission_approval"`). Such
 * results should render as an interactive Approve/Deny question regardless of
 * which tool was gated (e.g. a gated `Bash` call), not as raw JSON.
 */
export const isPermissionApprovalResult = (content: string): boolean => {
  const parsed = parseJsonRecord(content);
  return normalizeOptionalText(parsed?.status) === "awaiting_permission_approval";
};

export const formatConclusionWithOptionsConclusionAsMarkdown = (
  conclusion: ConclusionWithOptionsConclusionPayload | undefined,
): string | null => {
  if (!conclusion) {
    return null;
  }

  const sections: string[] = [`## ${conclusion.title}`, conclusion.summary];
  if (conclusion.confidence) {
    sections.push(`**Confidence:** ${conclusion.confidence}`);
  }
  if (conclusion.key_points.length > 0) {
    sections.push(
      ["**Key points**", ...conclusion.key_points.map((point) => `- ${point}`)].join("\n"),
    );
  }
  if (conclusion.next_steps.length > 0) {
    sections.push(
      [
        "**Next steps**",
        ...conclusion.next_steps.map((step, index) => `${index + 1}. ${step}`),
      ].join("\n"),
    );
  }
  if (conclusion.mermaid?.graph) {
    const mermaidTitle = conclusion.mermaid.title
      ? `**${conclusion.mermaid.title}**\n\n`
      : "**Flow**\n\n";
    sections.push(`${mermaidTitle}\`\`\`mermaid\n${conclusion.mermaid.graph}\n\`\`\``);
  }

  return sections.join("\n\n");
};

export const formatConclusionToolResultAsMarkdown = (content: string): string | null => {
  const payload = parseConclusionToolResultPayload(content);
  if (!payload) {
    return null;
  }

  const sections: string[] = [`## ${payload.title}`, payload.conclusion];

  if (payload.confidence) {
    sections.push(`**Confidence:** ${payload.confidence}`);
  }

  if (payload.key_points.length > 0) {
    sections.push(
      ["**Key points**", ...payload.key_points.map((point) => `- ${point}`)].join("\n"),
    );
  }

  if (payload.next_steps.length > 0) {
    sections.push(
      ["**Next steps**", ...payload.next_steps.map((step, index) => `${index + 1}. ${step}`)].join(
        "\n",
      ),
    );
  }

  return sections.join("\n\n");
};

export const parseFileChangeResultPayload = (content: string): FileChangeResultPayload | null => {
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

export const parseMemoryInspectRebuildPayload = (
  content: string,
): MemoryInspectRebuildPayload | null => {
  const parsed = parseJsonRecord(content);
  if (!parsed) {
    return null;
  }

  const action = normalizeOptionalText(parsed.action);
  if (action !== "inspect" && action !== "rebuild") {
    return null;
  }

  const dataRaw = parsed.data;
  if (!isRecord(dataRaw)) {
    return null;
  }

  const scope = normalizeOptionalText(dataRaw.scope);
  const totalMemories = toNumberValue(dataRaw.total_memories);
  if (!scope || typeof totalMemories !== "number") {
    return null;
  }

  const normalizeCountRecord = (value: unknown): Record<string, number> => {
    if (!isRecord(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, number] =>
          typeof entry[0] === "string" && typeof entry[1] === "number",
      ),
    );
  };

  return {
    action,
    scope: normalizeOptionalText(parsed.scope),
    project_key: normalizeOptionalText(parsed.project_key),
    data: {
      scope,
      project_key: normalizeOptionalText(dataRaw.project_key),
      total_memories: totalMemories,
      by_type: normalizeCountRecord(dataRaw.by_type),
      by_status: normalizeCountRecord(dataRaw.by_status),
      recent_ids: normalizeTextArray(dataRaw.recent_ids),
      view_files: normalizeTextArray(dataRaw.view_files),
      index_files: normalizeTextArray(dataRaw.index_files),
      state_files: normalizeTextArray(dataRaw.state_files),
      stale_candidate_count: toNumberValue(dataRaw.stale_candidate_count) ?? 0,
      last_reindex_at: normalizeOptionalText(dataRaw.last_reindex_at),
      last_dream_at: normalizeOptionalText(dataRaw.last_dream_at),
      topic_paths: normalizeTextArray(dataRaw.topic_paths),
    },
  };
};

const isRemovedLine = (line: string): boolean => line.startsWith("-") && !line.startsWith("---");

const isAddedLine = (line: string): boolean => line.startsWith("+") && !line.startsWith("+++");

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
        removedBlock.forEach((item) => output.push({ kind: "modified_remove", text: item }));
        addedBlock.forEach((item) => output.push({ kind: "modified_add", text: item }));
      } else {
        removedBlock.forEach((item) => output.push({ kind: "remove", text: item }));
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

export const createFocusedUnifiedDiffPreview = (
  unified: string,
  options?: {
    contextLines?: number;
    maxLines?: number;
    preserveLeadingMeta?: boolean;
  },
): DiffLine[] => {
  const parsed = parseUnifiedDiffLines(unified);
  if (parsed.length === 0) {
    return parsed;
  }

  const contextLines = Math.max(0, options?.contextLines ?? 2);
  const maxLines = Math.max(1, options?.maxLines ?? 120);
  const preserveLeadingMeta = options?.preserveLeadingMeta ?? true;
  const changeKinds = new Set<DiffLineKind>(["add", "remove", "modified_add", "modified_remove"]);

  const changeIndexes = parsed
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => changeKinds.has(line.kind))
    .map(({ index }) => index);

  if (changeIndexes.length === 0 || parsed.length <= maxLines) {
    return parsed.slice(0, maxLines);
  }

  const leadingMetaIndexes: number[] = [];
  if (preserveLeadingMeta) {
    for (let i = 0; i < parsed.length; i += 1) {
      if (parsed[i]?.kind !== "meta") {
        break;
      }
      leadingMetaIndexes.push(i);
    }
  }

  const buildMergedRanges = (
    windowContext: number,
    includeLeadingMeta: boolean,
  ): Array<{ start: number; end: number }> => {
    const ranges: Array<{ start: number; end: number }> = [];

    if (includeLeadingMeta && leadingMetaIndexes.length > 0) {
      ranges.push({
        start: leadingMetaIndexes[0],
        end: leadingMetaIndexes[leadingMetaIndexes.length - 1],
      });
    }

    changeIndexes.forEach((index) => {
      ranges.push({
        start: Math.max(0, index - windowContext),
        end: Math.min(parsed.length - 1, index + windowContext),
      });
    });

    ranges.sort((a, b) => a.start - b.start);

    return ranges.reduce<Array<{ start: number; end: number }>>((acc, current) => {
      const last = acc[acc.length - 1];
      if (!last) {
        acc.push({ ...current });
        return acc;
      }
      if (current.start <= last.end + 1) {
        last.end = Math.max(last.end, current.end);
        return acc;
      }
      acc.push({ ...current });
      return acc;
    }, []);
  };

  const renderRanges = (ranges: Array<{ start: number; end: number }>): DiffLine[] => {
    const preview: DiffLine[] = [];

    ranges.forEach((range, rangeIndex) => {
      if (rangeIndex > 0) {
        preview.push({ kind: "gap", text: "⋯" });
      }
      for (let i = range.start; i <= range.end; i += 1) {
        preview.push(parsed[i]);
      }
    });

    return preview;
  };

  let dynamicContext = contextLines;
  let ranges = buildMergedRanges(dynamicContext, preserveLeadingMeta);
  let preview = renderRanges(ranges);

  while (preview.length > maxLines && dynamicContext > 0) {
    dynamicContext -= 1;
    ranges = buildMergedRanges(dynamicContext, preserveLeadingMeta);
    preview = renderRanges(ranges);
  }

  if (preview.length > maxLines && preserveLeadingMeta) {
    ranges = buildMergedRanges(dynamicContext, false);
    preview = renderRanges(ranges);
  }

  if (preview.length > maxLines) {
    return preview.slice(0, maxLines);
  }

  return preview;
};

const parseUnifiedHunkHeader = (line: string): { oldStart: number; newStart: number } | null => {
  const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (!match) {
    return null;
  }

  return {
    oldStart: Number.parseInt(match[1], 10),
    newStart: Number.parseInt(match[2], 10),
  };
};

const stripUnifiedLinePrefix = (line: string): string => {
  if (!line) {
    return "";
  }

  const prefix = line[0];
  if (prefix === "+" || prefix === "-" || prefix === " ") {
    return line.slice(1);
  }

  return line;
};

const advanceDiffCursor = (value: number | null): number | null => {
  if (value == null) {
    return null;
  }
  return value + 1;
};

export const parseUnifiedDiffSideBySideRows = (unified: string): SideBySideDiffRow[] => {
  const rawLines = unified.split("\n");
  const rows: SideBySideDiffRow[] = [];

  let oldLine: number | null = null;
  let newLine: number | null = null;
  let index = 0;

  while (index < rawLines.length) {
    const line = rawLines[index] ?? "";

    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      rows.push({ kind: "meta", text: line });
      index += 1;
      continue;
    }

    if (line.startsWith("@@")) {
      const parsed = parseUnifiedHunkHeader(line);
      if (parsed) {
        oldLine = parsed.oldStart;
        newLine = parsed.newStart;
      }
      rows.push({ kind: "hunk", text: line });
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
        const pairCount = Math.max(removedBlock.length, addedBlock.length);
        for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
          const removedLine = removedBlock[pairIndex];
          const addedLine = addedBlock[pairIndex];

          if (removedLine && addedLine) {
            rows.push({
              kind: "modified",
              oldLineNumber: oldLine ?? undefined,
              newLineNumber: newLine ?? undefined,
              oldText: stripUnifiedLinePrefix(removedLine),
              newText: stripUnifiedLinePrefix(addedLine),
            });
            oldLine = advanceDiffCursor(oldLine);
            newLine = advanceDiffCursor(newLine);
            continue;
          }

          if (removedLine) {
            rows.push({
              kind: "remove",
              oldLineNumber: oldLine ?? undefined,
              oldText: stripUnifiedLinePrefix(removedLine),
            });
            oldLine = advanceDiffCursor(oldLine);
            continue;
          }

          if (addedLine) {
            rows.push({
              kind: "add",
              newLineNumber: newLine ?? undefined,
              newText: stripUnifiedLinePrefix(addedLine),
            });
            newLine = advanceDiffCursor(newLine);
          }
        }
      } else {
        removedBlock.forEach((removedLine) => {
          rows.push({
            kind: "remove",
            oldLineNumber: oldLine ?? undefined,
            oldText: stripUnifiedLinePrefix(removedLine),
          });
          oldLine = advanceDiffCursor(oldLine);
        });
      }
      continue;
    }

    if (isAddedLine(line)) {
      rows.push({
        kind: "add",
        newLineNumber: newLine ?? undefined,
        newText: stripUnifiedLinePrefix(line),
      });
      newLine = advanceDiffCursor(newLine);
      index += 1;
      continue;
    }

    const contextText = stripUnifiedLinePrefix(line);
    rows.push({
      kind: "context",
      oldLineNumber: oldLine ?? undefined,
      newLineNumber: newLine ?? undefined,
      oldText: contextText,
      newText: contextText,
    });
    oldLine = advanceDiffCursor(oldLine);
    newLine = advanceDiffCursor(newLine);
    index += 1;
  }

  return rows;
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
        const unescaped = textContent.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
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
  } catch {
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
export const shouldCollapseContent = (content: string, options: CollapseOptions = {}): boolean => {
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
    const target = fileChangePayload.file_path.split(/[\\/]/).pop() || fileChangePayload.file_path;
    const summary = `${fileChangePayload.operation}: ${target}`;
    return summary.length <= maxLength ? summary : summary.substring(0, maxLength).trimEnd() + "…";
  }

  const memoryInspectPayload = parseMemoryInspectRebuildPayload(trimmed);
  if (memoryInspectPayload) {
    const scope = memoryInspectPayload.data.project_key || memoryInspectPayload.data.scope;
    const summary = `Memory ${memoryInspectPayload.action}: ${scope} (${memoryInspectPayload.data.total_memories})`;
    return summary.length <= maxLength ? summary : summary.substring(0, maxLength).trimEnd() + "…";
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
        if (
          parsed.type === "mermaid" &&
          typeof parsed.chart === "string" &&
          parsed.chart.trim().length > 0
        ) {
          const title =
            typeof parsed.title === "string" && parsed.title.trim().length > 0
              ? parsed.title.trim()
              : "Mermaid diagram";
          const summary = `Diagram: ${title}`;
          return summary.length <= maxLength
            ? summary
            : summary.substring(0, maxLength).trimEnd() + "…";
        }

        if (
          parsed.type === "conclusion" &&
          typeof parsed.conclusion === "string" &&
          parsed.conclusion.trim().length > 0
        ) {
          const summary = parsed.conclusion.trim();
          return summary.length <= maxLength
            ? summary
            : summary.substring(0, maxLength).trimEnd() + "…";
        }

        // If it has a content/result/output field, use that
        const resultKey = ["content", "result", "output", "message", "data"].find(
          (k) => k in parsed && typeof parsed[k] === "string",
        );
        if (resultKey) {
          const value = parsed[resultKey];
          return value.length <= maxLength ? value : value.substring(0, maxLength).trimEnd() + "…";
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
