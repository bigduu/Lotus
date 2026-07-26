import { useEffect, useRef, useState } from "react";

/**
 * Throttles a rapidly-changing value to at most one state update per
 * `intervalMs` (leading + trailing edge). Used to keep expensive renders
 * (full Markdown re-parses) below the per-frame streaming cadence (#166):
 * the first update lands immediately, bursts coalesce into one trailing
 * flush, and the final value always renders once the input settles.
 */
export const useThrottledValue = <T>(value: T, intervalMs: number): T => {
  const [throttled, setThrottled] = useState(value);
  const lastFlushAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef(value);
  latestRef.current = value;

  useEffect(() => {
    const now = Date.now();
    const elapsed = now - lastFlushAtRef.current;

    if (elapsed >= intervalMs) {
      // Leading edge: enough time passed since the last flush — render now.
      lastFlushAtRef.current = now;
      setThrottled(value);
      return;
    }

    if (timerRef.current === null) {
      // Trailing edge: one pending flush that picks up the latest value.
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        lastFlushAtRef.current = Date.now();
        setThrottled(latestRef.current);
      }, intervalMs - elapsed);
    }
  }, [value, intervalMs]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  return throttled;
};
