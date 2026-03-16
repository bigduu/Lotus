export const createSliceHarness = <T extends object>(
  createSlice: (set: (partial: unknown) => void, get: () => T, api: unknown) => T,
  initialState: Partial<T> = {},
) => {
  let state = { ...initialState } as T;

  const set = (partial: unknown) => {
    const next =
      typeof partial === "function"
        ? (partial as (current: T) => Partial<T> | T)(state)
        : (partial as Partial<T>);
    state = { ...state, ...next };
  };

  const get = () => state;

  state = {
    ...state,
    ...createSlice(set, get, {}),
  };

  return {
    getState: () => state,
    setState: (next: Partial<T>) => {
      state = { ...state, ...next };
    },
  };
};
