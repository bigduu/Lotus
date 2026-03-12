import { useCallback, useEffect, useRef, useState } from "react";

export type HistoryDirection = "previous" | "next";

interface NavigateResult {
  value: string | null;
  applied: boolean;
}

export const useChatInputHistory = (sessionId: string | null) => {
  const historyMapRef = useRef<Map<string, string[]>>(new Map());
  const navigationAppliedRef = useRef(false);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);

  useEffect(() => {
    setHistoryIndex(null);
    navigationAppliedRef.current = false;
  }, [sessionId]);

  const recordEntry = useCallback(
    (entry: string) => {
      if (!sessionId) {
        return;
      }
      const trimmed = entry.trim();
      if (!trimmed) {
        return;
      }

      const history = historyMapRef.current.get(sessionId) ?? [];
      if (history[history.length - 1] === trimmed) {
        return;
      }

      const updatedHistory = [...history, trimmed].slice(-50);
      historyMapRef.current.set(sessionId, updatedHistory);
      setHistoryIndex(null);
      navigationAppliedRef.current = false;
    },
    [sessionId],
  );

  const navigate = useCallback(
    (direction: HistoryDirection, currentValue: string): NavigateResult => {
      if (!sessionId) {
        return { value: null, applied: false };
      }

      const history = historyMapRef.current.get(sessionId) ?? [];
      if (history.length === 0) {
        return { value: null, applied: false };
      }

      const trimmedCurrent = currentValue.trim();

      if (direction === "previous") {
        if (trimmedCurrent.length > 0 && historyIndex === null) {
          return { value: null, applied: false };
        }

        const currentPosition = historyIndex ?? history.length;
        const nextIndex = Math.max(0, currentPosition - 1);
        if (nextIndex === historyIndex) {
          return { value: null, applied: false };
        }

        setHistoryIndex(nextIndex);
        navigationAppliedRef.current = true;
        return { value: history[nextIndex] ?? null, applied: true };
      }

      // direction === "next"
      if (historyIndex === null) {
        return { value: null, applied: false };
      }

      const nextIndex = historyIndex + 1;
      if (nextIndex >= history.length) {
        setHistoryIndex(null);
        navigationAppliedRef.current = true;
        return { value: "", applied: true };
      }

      setHistoryIndex(nextIndex);
      navigationAppliedRef.current = true;
      return { value: history[nextIndex] ?? null, applied: true };
    },
    [sessionId, historyIndex],
  );

  const acknowledgeManualInput = useCallback(() => {
    if (navigationAppliedRef.current) {
      navigationAppliedRef.current = false;
      return;
    }

    if (historyIndex !== null) {
      setHistoryIndex(null);
    }
  }, [historyIndex]);

  const clearHistory = useCallback(() => {
    if (!sessionId) {
      return;
    }
    historyMapRef.current.delete(sessionId);
    setHistoryIndex(null);
    navigationAppliedRef.current = false;
  }, [sessionId]);

  return {
    recordEntry,
    navigate,
    acknowledgeManualInput,
    clearHistory,
  };
};
