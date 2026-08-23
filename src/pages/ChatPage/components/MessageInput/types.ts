export type MessageRetryMode = "regenerate" | "error_retry";

/** Whether an attempted composer submission crossed its authoritative acceptance boundary. */
export type MessageSubmitOutcome = boolean | void;
