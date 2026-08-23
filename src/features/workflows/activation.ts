import { isApiError } from "@services/api";

import type { TypedWorkflowSource } from "./domain";

export interface WorkflowSelection {
  id: string;
  source: TypedWorkflowSource;
  revision: number;
  args: Record<string, unknown>;
}

export interface WorkflowArgumentsResult {
  args: Record<string, unknown> | null;
  error: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const jsonValuesEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => jsonValuesEqual(entry, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) && jsonValuesEqual(left[key], right[key]),
    )
  );
};

const valueMatchesType = (value: unknown, expected: unknown): boolean => {
  if (Array.isArray(expected)) {
    return expected.some((entry) => valueMatchesType(value, entry));
  }
  switch (expected) {
    case "null":
      return value === null;
    case "array":
      return Array.isArray(value);
    case "object":
      return isRecord(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case undefined:
      return true;
    default:
      return false;
  }
};

/**
 * Build a safe initial argument object from root-property defaults only.
 * Schema descriptions and other catalog metadata never enter the request.
 */
export const defaultWorkflowArguments = (schema: unknown): Record<string, unknown> => {
  if (!isRecord(schema) || !isRecord(schema.properties)) return {};
  return Object.fromEntries(
    Object.entries(schema.properties).flatMap(([name, property]) =>
      isRecord(property) && Object.prototype.hasOwnProperty.call(property, "default")
        ? [[name, property.default] as const]
        : [],
    ),
  );
};

/**
 * Validate the catalog's public root object schema before sending. Bamboo
 * remains authoritative and performs the complete JSON Schema validation.
 */
export const validateWorkflowArguments = (
  args: unknown,
  schema?: Record<string, unknown>,
): string | null => {
  if (!isRecord(args)) return "Workflow arguments must be a JSON object.";
  if (!schema) return null;

  const required = Array.isArray(schema.required)
    ? schema.required.filter((value): value is string => typeof value === "string")
    : [];
  for (const name of required) {
    if (!Object.prototype.hasOwnProperty.call(args, name)) {
      return `Missing required Workflow argument: ${name}`;
    }
  }

  const properties = isRecord(schema.properties) ? schema.properties : {};
  if (schema.additionalProperties === false) {
    const unknown = Object.keys(args).find(
      (name) => !Object.prototype.hasOwnProperty.call(properties, name),
    );
    if (unknown) return `Unknown Workflow argument: ${unknown}`;
  }

  for (const [name, value] of Object.entries(args)) {
    const property = properties[name];
    if (!isRecord(property)) continue;
    if (!valueMatchesType(value, property.type)) {
      const expected = Array.isArray(property.type)
        ? property.type.join(" or ")
        : String(property.type ?? "the declared type");
      return `Workflow argument ${name} must be ${expected}.`;
    }
    if (
      Array.isArray(property.enum) &&
      !property.enum.some((entry) => jsonValuesEqual(entry, value))
    ) {
      return `Workflow argument ${name} must be one of the allowed values.`;
    }
  }

  return null;
};

export const parseWorkflowArguments = (
  raw: string,
  schema?: Record<string, unknown>,
): WorkflowArgumentsResult => {
  let parsed: unknown;
  try {
    parsed = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return { args: null, error: "Workflow arguments must be valid JSON." };
  }
  const error = validateWorkflowArguments(parsed, schema);
  return { args: error ? null : (parsed as Record<string, unknown>), error };
};

export const WORKFLOW_SELECTION_ERROR_CODES = [
  "workflow_revision_missing",
  "workflow_revision_mismatch",
  "workflow_source_mismatch",
  "workflow_manual_only",
  "workflow_selection_invalid",
  "workflow_snapshot_unavailable",
  "workflow_snapshot_too_large",
  "workflow_context_invalid",
  "workflow_activation_running_conflict",
] as const;

export type WorkflowSelectionErrorCode = (typeof WORKFLOW_SELECTION_ERROR_CODES)[number];

const workflowSelectionErrorCodes = new Set<string>(WORKFLOW_SELECTION_ERROR_CODES);

type StructuredWorkflowError = {
  error?: {
    code?: unknown;
    message?: unknown;
    recoverable?: unknown;
  };
  code?: unknown;
  message?: unknown;
  recoverable?: unknown;
};

export class WorkflowSelectionError extends Error {
  constructor(
    public readonly code: WorkflowSelectionErrorCode,
    message: string,
    public readonly recoverable: boolean,
    public readonly status: number,
  ) {
    super(message);
    this.name = "WorkflowSelectionError";
  }
}

/** Convert only Bamboo's typed Workflow failures; unrelated 409/422s stay unchanged. */
export const toWorkflowSelectionError = (error: unknown): WorkflowSelectionError | null => {
  if (error instanceof WorkflowSelectionError) return error;
  if (
    error instanceof Error &&
    error.name === "WorkflowSelectionError" &&
    "code" in error &&
    typeof error.code === "string" &&
    workflowSelectionErrorCodes.has(error.code)
  ) {
    const shaped = error as Error & {
      code: WorkflowSelectionErrorCode;
      recoverable?: boolean;
      status?: number;
    };
    return new WorkflowSelectionError(
      shaped.code,
      shaped.message,
      shaped.recoverable !== false,
      typeof shaped.status === "number" ? shaped.status : 0,
    );
  }
  if (!isApiError(error) || !error.body) return null;

  let body: StructuredWorkflowError;
  try {
    body = JSON.parse(error.body) as StructuredWorkflowError;
  } catch {
    return null;
  }

  const rawCode = body.error?.code ?? body.code;
  if (typeof rawCode !== "string" || !workflowSelectionErrorCodes.has(rawCode)) return null;
  const rawMessage = body.error?.message ?? body.message;
  const message =
    typeof rawMessage === "string" && rawMessage.trim() ? rawMessage.trim() : error.message;
  const recoverable = body.error?.recoverable ?? body.recoverable;

  return new WorkflowSelectionError(
    rawCode as WorkflowSelectionErrorCode,
    message,
    recoverable !== false,
    error.status,
  );
};
