import React from "react";
import { Tag } from "antd";

/**
 * Render the backend-provided `subagent_type` as a cosmetic label.
 * Empty values are omitted for legacy/root sessions and children without a
 * label; non-empty values are displayed verbatim after trimming whitespace.
 */
export const renderSubagentTypeTag = (
  subagentType: string | null | undefined,
  options?: { compact?: boolean },
): React.ReactNode => {
  const id = subagentType?.trim();
  if (!id) return null;

  const compact = options?.compact ?? false;

  if (compact) {
    return (
      <span
        data-testid={`sub-agent-role-tag-${id}`}
        style={{
          color: "inherit",
          lineHeight: "inherit",
          whiteSpace: "nowrap",
        }}
      >
        {id}
      </span>
    );
  }

  return (
    <Tag style={{ marginInlineEnd: 0, flex: "0 0 auto" }} data-testid={`sub-agent-role-tag-${id}`}>
      {id}
    </Tag>
  );
};
