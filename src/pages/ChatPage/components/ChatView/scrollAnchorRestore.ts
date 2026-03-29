const EPS = 1;
const STABLE_FRAMES = 3;
const RESTORE_TIMEOUT_MS = 2000;

function clampScrollTop(el: HTMLElement, target: number) {
  const max = Math.max(0, el.scrollHeight - el.clientHeight);
  return Math.min(Math.max(0, target), max);
}

export function restoreScrollAnchorUntilStable(args: {
  scrollEl: HTMLDivElement;
  getAnchorElement: () => HTMLElement | null;
  offsetPx: number;
  isCancelled: () => boolean;
}) {
  const { scrollEl, getAnchorElement, offsetPx, isCancelled } = args;

  return new Promise<void>((resolve) => {
    const startTs = performance.now();
    let stable = 0;
    let lastScrollTop = -1;
    let lastDesired = Number.NaN;

    const tick = () => {
      if (isCancelled()) {
        resolve();
        return;
      }

      const anchorEl = getAnchorElement();
      if (!anchorEl) {
        requestAnimationFrame(tick);
        return;
      }

      const containerRect = scrollEl.getBoundingClientRect();
      const anchorRect = anchorEl.getBoundingClientRect();
      const currentOffset = anchorRect.top - containerRect.top;

      // Desired: make anchor's top offset equal to saved offsetPx
      const desired = clampScrollTop(scrollEl, scrollEl.scrollTop + (currentOffset - offsetPx));

      if (Math.abs(scrollEl.scrollTop - desired) > EPS) {
        scrollEl.scrollTop = desired;
        stable = 0;
      } else {
        const desiredStable = Number.isFinite(lastDesired)
          ? Math.abs(desired - lastDesired) <= EPS
          : false;
        const scrollStable = Math.abs(scrollEl.scrollTop - lastScrollTop) <= EPS;
        stable = desiredStable && scrollStable ? stable + 1 : 0;
      }

      lastDesired = desired;
      lastScrollTop = scrollEl.scrollTop;

      const timedOut = performance.now() - startTs > RESTORE_TIMEOUT_MS;
      if (stable >= STABLE_FRAMES || timedOut) {
        resolve();
        return;
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  });
}
