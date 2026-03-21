/**
 * Tool Service Types
 */

export type DisplayPreference = "Default" | "Collapsible" | "Hidden";

export interface ToolExecutionResult {
  tool_name: string;
  success: boolean;
  result: string;
  display_preference: DisplayPreference;
}
