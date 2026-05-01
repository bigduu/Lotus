import Dexie, { type Table } from "dexie";

export interface ScrollAnchorRecord {
  sessionId: string;
  anchorId: string;
  offsetPx: number;
  ts: number;
  indexHint?: number;
  createdAt?: string;
}

export interface ToolSessionCollapseRecord {
  id: string;
  sessionId: string;
  toolSessionId: string;
  isExpanded: boolean;
  expandedTools: string[];
  updatedAt: number;
}

export interface DiffCollapseRecord {
  sessionId: string;
  isExpanded: boolean;
  expandedFiles: string[];
  updatedAt: number;
}

export interface InputStateRecord {
  sessionId: string;
  reasoningEffort: string;
  content?: string;
  referenceText?: string | null;
  updatedAt: number;
}

export interface ModelOptionsCacheRecord {
  provider: string;
  options: { value: string; label: string }[];
  timestamp: number;
}

export class LotusStorageDb extends Dexie {
  scrollAnchors!: Table<ScrollAnchorRecord, string>;
  toolSessionCollapses!: Table<ToolSessionCollapseRecord, string>;
  diffCollapses!: Table<DiffCollapseRecord, string>;
  inputStates!: Table<InputStateRecord, string>;
  modelOptionsCaches!: Table<ModelOptionsCacheRecord, string>;

  constructor() {
    super("LotusStorage");
    this.version(1).stores({
      scrollAnchors: "sessionId, ts",
      toolSessionCollapses: "id, sessionId, updatedAt",
      diffCollapses: "sessionId, updatedAt",
      inputStates: "sessionId, updatedAt",
      modelOptionsCaches: "provider, timestamp",
    });
  }
}

export const storageDb = new LotusStorageDb();
