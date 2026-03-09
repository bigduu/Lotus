const MIN_DAYS = 1;
const MAX_DAYS = 365;

const clampDays = (value: number | undefined): number => {
  if (!Number.isFinite(value)) {
    return 30;
  }
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.floor(value ?? 30)));
};

const parseDate = (value: string | undefined): Date | null => {
  if (!value) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
};

const toDateKey = (date: Date): string => date.toISOString().slice(0, 10);

const shiftDays = (date: Date, offsetDays: number): Date => {
  const shifted = new Date(date.getTime());
  shifted.setUTCDate(shifted.getUTCDate() + offsetDays);
  return shifted;
};

const inclusiveDaySpan = (start: Date, end: Date): number => {
  const diffMs = end.getTime() - start.getTime();
  const days = Math.floor(diffMs / 86_400_000) + 1;
  return clampDays(days);
};

interface ResolveRangeInput {
  startDate?: string;
  endDate?: string;
  days?: number;
}

export interface ResolvedMetricsRange {
  startDate: string;
  endDate: string;
  days: number;
}

export const resolveMetricsRange = (
  input: ResolveRangeInput,
  now: Date = new Date(),
): ResolvedMetricsRange => {
  const resolvedDays = clampDays(input.days);
  const fallbackEnd = toDateKey(now);
  const parsedEnd = parseDate(input.endDate) ?? parseDate(fallbackEnd);

  if (!parsedEnd) {
    return {
      startDate: fallbackEnd,
      endDate: fallbackEnd,
      days: MIN_DAYS,
    };
  }

  const parsedStart = parseDate(input.startDate);
  if (parsedStart) {
    const end = parsedEnd < parsedStart ? parsedStart : parsedEnd;
    return {
      startDate: toDateKey(parsedStart),
      endDate: toDateKey(end),
      days: inclusiveDaySpan(parsedStart, end),
    };
  }

  const start = shiftDays(parsedEnd, -(resolvedDays - 1));
  return {
    startDate: toDateKey(start),
    endDate: toDateKey(parsedEnd),
    days: resolvedDays,
  };
};
