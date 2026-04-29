import React from "react";
import { Tag } from "antd";

import type { SubagentProfile } from "../../../../services/subagent/types";

/**
 * Render a small Tag showing the subagent profile (role) of a child session.
 *
 * Resolution order:
 *   1. If `subagentType` is null/empty → render nothing (legacy/root sessions
 *      that pre-date subagent profiles or are not children).
 *   2. If the catalogue has a matching profile → use its `display_name`,
 *      `ui.icon` and `ui.color` for nice presentation.
 *   3. Otherwise → fall back to rendering the raw id (catalogue may still
 *      be loading, or backend supplied an id we don't know about).
 */
export const renderSubagentTypeTag = (
  subagentType: string | null | undefined,
  byId: Map<string, SubagentProfile>,
): React.ReactNode => {
  const id = subagentType?.trim();
  if (!id) return null;

  const profile = byId.get(id);
  const label = profile?.display_name?.trim() || id;
  const icon = profile?.ui?.icon?.trim();
  // AntD Tag accepts the raw color name strings (e.g. "blue", "purple").
  // If the profile didn't supply one, omit the color prop entirely so the
  // tag renders in the default neutral palette.
  const color = profile?.ui?.color?.trim() || undefined;

  return (
    <Tag
      color={color}
      style={{ marginInlineEnd: 0, flex: "0 0 auto" }}
      data-testid={`sub-session-role-tag-${id}`}
    >
      {icon ? `${icon} ${label}` : label}
    </Tag>
  );
};
