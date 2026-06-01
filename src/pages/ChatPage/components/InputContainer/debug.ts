export const debugRespondFlow = (event: string, payload: Record<string, unknown>): void => {
  if (!import.meta.env.DEV) return;
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem("lotus_debug_respond") !== "1") return;
  console.warn(`[RespondFlow] ${event}`, payload);
};
