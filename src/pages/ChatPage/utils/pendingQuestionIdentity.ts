export interface PendingQuestionIdentityInput {
  sessionId?: string | null;
  question?: string | null;
  options?: readonly string[] | null;
  allowCustom?: boolean | null;
  toolCallId?: string | null;
}

const normalizePendingQuestionOptions = (options?: readonly string[] | null): string[] =>
  Array.isArray(options) ? options.map((option) => String(option ?? "")) : [];

export const buildPendingQuestionIdentity = ({
  sessionId,
  question,
  options,
  allowCustom,
  toolCallId,
}: PendingQuestionIdentityInput): string =>
  JSON.stringify({
    sessionId: sessionId ?? null,
    question: question ?? "",
    options: normalizePendingQuestionOptions(options),
    allowCustom: allowCustom ?? true,
    toolCallId: toolCallId ?? null,
  });

export const arePendingQuestionIdentityInputsEqual = (
  a: PendingQuestionIdentityInput | null | undefined,
  b: PendingQuestionIdentityInput | null | undefined,
): boolean => {
  if (!a || !b) {
    return a === b;
  }

  if ((a.sessionId ?? null) !== (b.sessionId ?? null)) {
    return false;
  }

  if ((a.question ?? "") !== (b.question ?? "")) {
    return false;
  }

  if ((a.allowCustom ?? true) !== (b.allowCustom ?? true)) {
    return false;
  }

  if ((a.toolCallId ?? null) !== (b.toolCallId ?? null)) {
    return false;
  }

  const aOptions = normalizePendingQuestionOptions(a.options);
  const bOptions = normalizePendingQuestionOptions(b.options);
  if (aOptions.length !== bOptions.length) {
    return false;
  }

  return aOptions.every((option, index) => option === bOptions[index]);
};
