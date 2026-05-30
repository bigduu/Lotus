/**
 * Common API Types
 *
 * Shared types used across API requests and responses.
 */

export interface ApiListResponse<T> {
  items: T[];
  total: number;
}

// Re-export commonly used types from feature modules
export * from "../chat/AgentService";
