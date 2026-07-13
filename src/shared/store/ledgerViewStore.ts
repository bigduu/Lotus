import { create } from "zustand";

export type LedgerViewKey = "agenda" | "records";

export const DEFAULT_LEDGER_VIEW_KEY: LedgerViewKey = "agenda";

interface LedgerViewState {
  isOpen: boolean;
  view: LedgerViewKey;
  /** Overdue + today agenda item count, shown on the drawer trigger badge. */
  badgeCount: number;
  open: (view?: LedgerViewKey) => void;
  close: () => void;
  setView: (view: LedgerViewKey) => void;
  setBadgeCount: (badgeCount: number) => void;
}

export const useLedgerViewStore = create<LedgerViewState>((set) => ({
  isOpen: false,
  view: DEFAULT_LEDGER_VIEW_KEY,
  badgeCount: 0,
  open: (view) => set((state) => ({ isOpen: true, view: view ?? state.view })),
  close: () => set({ isOpen: false }),
  setView: (view) => set({ view }),
  setBadgeCount: (badgeCount) => set({ badgeCount }),
}));
