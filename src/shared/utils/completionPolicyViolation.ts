export const isCompletionPolicyViolationError = (errorMessage: string | null | undefined): boolean => {
  const normalized = (errorMessage ?? "").trim().toLowerCase();
  return (
    normalized.includes("completion policy violation") &&
    normalized.includes("conclusion_with_options")
  );
};

export const formatCompletionPolicyViolationMessage = (fallback?: string): string => {
  const raw = (fallback ?? "").trim();
  const detail = raw ? `\n\nRaw error: ${raw}` : "";
  return [
    "Bamboo stopped this completion because Copilot conclusion_with_options confirmation is enabled for this session.",
    "The assistant tried to finish with plain text instead of calling conclusion_with_options.",
    "Next steps: retry the request, shorten or clarify the prompt, or temporarily disable the Copilot conclusion_with_options enhancement for this session if you do not want enforced confirmation.",
  ].join(" ") + detail;
};
