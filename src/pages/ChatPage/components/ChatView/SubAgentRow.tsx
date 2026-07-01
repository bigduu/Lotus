import { memo } from "react";
import { Button, Dropdown, Flex, Tag, Typography, theme } from "antd";
import { useTranslation } from "react-i18next";

import type { SubagentProfile } from "@services/subagent/types";
import type { SessionPlacement } from "@services/chat/AgentService";
import { useChildPreviewState, getMergedChildPreview } from "../../streaming/useChildPreviewState";
import { renderSubagentTypeTag } from "./renderSubagentTypeTag";
import InlineMetaText from "@shared/components/InlineMetaText";
import { MachineTag } from "@shared/components/MachineTag";
import { ChildPreviewPopover } from "./ChildPreviewPopover";

const { Text } = Typography;
const { useToken } = theme;

export type SubAgentRetryMode = "regenerate" | "error_retry";

export interface SubAgentRowData {
  childSessionId: string;
  title?: string;
  status?: string;
  error?: string;
  lastHeartbeatAt?: string;
  lastEventAt?: string;
  outputPreview?: string;
  pinned?: boolean;
  updatedAt?: string;
  /**
   * Creation timestamp (ms epoch) from the backend session. Used for stable
   * sorting — unlike `updatedAt`/`lastEventAt`, it never changes as content
   * updates, so the sub-agent list order stays fixed once a child is created.
   */
  createdAt?: number;
  isRunning?: boolean;
  messageCount?: number;
  lastRunStatus?: string;
  lastRunError?: string;
  subagentType?: string | null;
  roundCount?: number;
  /** `"resident"` for a reusable resident agent, else one-shot. */
  lifecycle?: string | null;
  /** For a resident agent, its stable reuse key (e.g. "essayist"). */
  residentName?: string | null;
  /** Which machine this child ran on (deployment kind + host). */
  placement?: SessionPlacement | null;
}

export interface SubAgentRowProps {
  parentSessionId: string;
  item: SubAgentRowData;
  index: number;
  compact: boolean;
  isRetrying: boolean;
  isContinuing: boolean;
  isDeleting: boolean;
  subagentProfilesById: Map<string, SubagentProfile>;
  onOpenChild: (childSessionId: string) => void;
  onContinueChild: (childSessionId: string) => void;
  onRetryChild: (childSessionId: string, retryMode: SubAgentRetryMode) => void;
  onTogglePin: (childSessionId: string, pinned?: boolean) => void;
  onDeleteChild: (childSessionId: string) => void;
}

const normalizeSubAgentStatus = (status?: string): string => {
  const value = (status || "").trim().toLowerCase();
  if (!value) return "pending";
  if (value === "started" || value === "already_running") return "running";
  if (value === "success" || value === "done") return "completed";
  if (value === "canceled") return "cancelled";
  if (value === "queued" || value === "created") return "pending";
  return value;
};

export const SubAgentRow = memo<SubAgentRowProps>(
  ({
    parentSessionId,
    item,
    index,
    compact,
    isRetrying,
    isContinuing,
    isDeleting,
    subagentProfilesById,
    onOpenChild,
    onContinueChild,
    onRetryChild,
    onTogglePin,
    onDeleteChild,
  }) => {
    const { token } = useToken();
    const { t } = useTranslation();
    const livePreviewState = useChildPreviewState(parentSessionId, item.childSessionId);
    const mergedOutputPreview = getMergedChildPreview(livePreviewState, item.outputPreview);

    const compactItemTagStyle = compact
      ? { marginInlineEnd: 0, flex: "0 0 auto", fontSize: 10, lineHeight: "16px", paddingInline: 6 }
      : { marginInlineEnd: 0, flex: "0 0 auto" };
    const compactActionButtonStyle = compact ? { paddingInline: 0, height: 22 } : undefined;

    const status = normalizeSubAgentStatus(item.status);
    const isRunning = status === "running";
    const isBusy = isRetrying || isContinuing || isDeleting;
    // A child worth offering a hover-preview for: one that has run or is running
    // (a brand-new pending child has nothing to show yet).
    const canPreviewChild = ["running", "completed", "cancelled", "error", "failed"].includes(
      status,
    );

    const getStatusLabel = (value: string) =>
      value === "running"
        ? t("chat.subAgents.statusRunning")
        : value === "completed"
          ? t("chat.subAgents.statusCompleted")
          : value === "pending"
            ? t("chat.subAgents.statusPending")
            : value === "cancelled"
              ? t("chat.subAgents.statusCancelled")
              : value === "error" || value === "failed"
                ? t("chat.subAgents.statusFailed")
                : value;

    const getStatusColor = (value: string) =>
      value === "running"
        ? token.colorPrimary
        : value === "completed"
          ? token.colorSuccess
          : value === "error" || value === "failed"
            ? token.colorError
            : value === "cancelled"
              ? token.colorWarning
              : token.colorTextSecondary;

    return (
      <Flex
        vertical
        gap={compact ? 6 : token.marginSM}
        className={compact ? undefined : "lotus-settings-list-item"}
        style={{
          width: "100%",
          minWidth: 0,
          padding: compact ? "6px 0" : token.paddingSM,
          borderRadius: compact ? 0 : token.borderRadiusSM,
          borderTop: compact && index > 0 ? `1px solid ${token.colorBorderSecondary}` : undefined,
          background: compact ? "transparent" : undefined,
        }}
      >
        <Flex vertical style={{ width: "100%", minWidth: 0 }}>
          <Flex align="center" gap={token.marginXS} wrap style={{ width: "100%", minWidth: 0 }}>
            <Text
              strong
              ellipsis
              style={{ minWidth: 0, flex: "1 1 180px", fontSize: compact ? 13 : undefined }}
            >
              {/* A resident agent is a stable identity reused across tasks, so
                  show its name (e.g. "essayist") rather than whichever task it
                  happens to be running right now. */}
              {(item.lifecycle === "resident" ? item.residentName : null) ||
                item.title ||
                t("chat.subAgents.fallbackTitle")}
            </Text>
            {compact ? (
              <InlineMetaText
                nowrap
                items={[
                  <span style={{ color: getStatusColor(status) }}>{getStatusLabel(status)}</span>,
                  item.pinned ? t("chat.subAgents.pinned") : null,
                  // Resident marker for compact mode (the purple badge only renders
                  // in the non-compact branch, so without this a resident is
                  // indistinguishable in compact view).
                  item.lifecycle === "resident" ? t("chat.subAgents.residentBadge") : null,
                  renderSubagentTypeTag(item.subagentType, subagentProfilesById, {
                    compact: true,
                  }),
                  item.placement ? <MachineTag placement={item.placement} compact /> : null,
                ]}
              />
            ) : (
              <>
                <Tag
                  color={
                    status === "running"
                      ? "processing"
                      : status === "completed"
                        ? "success"
                        : status === "error" || status === "failed"
                          ? "error"
                          : status === "cancelled"
                            ? "warning"
                            : "default"
                  }
                  style={compactItemTagStyle}
                >
                  {getStatusLabel(status)}
                </Tag>
                {item.pinned ? (
                  <Tag color="warning" style={compactItemTagStyle}>
                    {t("chat.subAgents.pinned")}
                  </Tag>
                ) : null}
                {item.lifecycle === "resident" ? (
                  <Tag color="purple" style={compactItemTagStyle}>
                    {t("chat.subAgents.residentBadge")}
                  </Tag>
                ) : null}
                {renderSubagentTypeTag(item.subagentType, subagentProfilesById)}
                {item.placement ? <MachineTag placement={item.placement} compact /> : null}
              </>
            )}
          </Flex>

          {compact ? (
            <InlineMetaText
              block
              items={[
                item.childSessionId.slice(0, 8),
                item.updatedAt,
                item.lastHeartbeatAt
                  ? `${t("chat.subAgents.heartbeat")}: ${item.lastHeartbeatAt}`
                  : null,
                typeof item.roundCount === "number"
                  ? `${t("chat.subAgents.round")} ${item.roundCount + 1}`
                  : null,
              ]}
            />
          ) : (
            <Text
              type="secondary"
              style={{
                display: "block",
                minWidth: 0,
                fontSize: 12,
                marginTop: 2,
              }}
            >
              {item.childSessionId.slice(0, 8)}
              {item.updatedAt ? ` • ${item.updatedAt}` : ""}
              {item.lastHeartbeatAt
                ? ` • ${t("chat.subAgents.heartbeat")}: ${item.lastHeartbeatAt}`
                : ""}
              {typeof item.roundCount === "number"
                ? ` • ${t("chat.subAgents.round")} ${item.roundCount + 1}`
                : ""}
            </Text>
          )}

          {mergedOutputPreview ? (
            <ChildPreviewPopover
              parentSessionId={parentSessionId}
              childSessionId={item.childSessionId}
              childTitle={item.title}
              status={status}
              onOpenChild={onOpenChild}
            >
              <Text
                type="secondary"
                style={{
                  display: "block",
                  minWidth: 0,
                  marginTop: compact ? 4 : token.marginXS,
                  fontSize: compact ? 11 : 13,
                  lineHeight: compact ? 1.35 : undefined,
                }}
                ellipsis
              >
                {mergedOutputPreview}
              </Text>
            </ChildPreviewPopover>
          ) : canPreviewChild ? (
            // No live preview tail (e.g. a completed child whose rolling preview
            // was cleared) — still offer a hover affordance. The popover seeds
            // from the child's transcript via its own event stream, so finished
            // children stay previewable without opening their session.
            <ChildPreviewPopover
              parentSessionId={parentSessionId}
              childSessionId={item.childSessionId}
              childTitle={item.title}
              status={status}
              onOpenChild={onOpenChild}
            >
              <Text
                type="secondary"
                italic
                style={{
                  display: "block",
                  minWidth: 0,
                  marginTop: compact ? 4 : token.marginXS,
                  fontSize: compact ? 11 : 12,
                  lineHeight: compact ? 1.35 : undefined,
                  opacity: 0.65,
                  cursor: "pointer",
                }}
              >
                {t("chat.subAgents.previewHint")}
              </Text>
            </ChildPreviewPopover>
          ) : null}

          {item.error ? (
            <Text
              type="danger"
              style={{
                display: "block",
                minWidth: 0,
                marginTop: compact ? 4 : token.marginXS,
                fontSize: compact ? 11 : undefined,
                lineHeight: compact ? 1.35 : undefined,
              }}
            >
              {item.error}
            </Text>
          ) : null}
        </Flex>

        <Flex
          gap={compact ? 4 : 8}
          wrap
          style={{ width: "100%", minWidth: 0, paddingTop: compact ? 2 : 0 }}
        >
          <Button
            size="small"
            type={compact ? "text" : "default"}
            style={compactActionButtonStyle}
            disabled={isBusy}
            onClick={() => onOpenChild(item.childSessionId)}
          >
            {t("chat.subAgents.open")}
          </Button>
          <Button
            size="small"
            type={compact ? "text" : "default"}
            style={compactActionButtonStyle}
            loading={isContinuing}
            disabled={isDeleting || isRetrying}
            data-testid={`sub-agent-continue-${item.childSessionId}`}
            onClick={() => onContinueChild(item.childSessionId)}
          >
            {t("chat.subAgents.continue")}
          </Button>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                { key: "regenerate", label: t("chat.actions.regenerate") },
                { key: "error_retry", label: t("chat.actions.retryFailed") },
              ],
              onClick: ({ key }) => {
                onRetryChild(item.childSessionId, key as SubAgentRetryMode);
              },
            }}
            disabled={isDeleting || isRunning || isContinuing}
          >
            <Button
              size="small"
              type={compact ? "text" : "default"}
              style={compactActionButtonStyle}
              loading={isRetrying}
              disabled={isDeleting || isRunning || isContinuing}
              data-testid={`sub-agent-retry-${item.childSessionId}`}
            >
              {t("chat.subAgents.retry")}
            </Button>
          </Dropdown>
          {typeof item.pinned === "boolean" ? (
            <Button
              size="small"
              type={compact ? "text" : "default"}
              style={compactActionButtonStyle}
              disabled={isBusy}
              onClick={() => onTogglePin(item.childSessionId, item.pinned)}
            >
              {item.pinned ? t("chat.actions.unpin") : t("chat.actions.pin")}
            </Button>
          ) : null}
          <Button
            danger
            type={compact ? "text" : "default"}
            style={compactActionButtonStyle}
            size="small"
            loading={isDeleting}
            disabled={isRetrying}
            data-testid={`sub-agent-delete-${item.childSessionId}`}
            onClick={() => onDeleteChild(item.childSessionId)}
          >
            {t("common.delete")}
          </Button>
        </Flex>
      </Flex>
    );
  },
  (prev, next) =>
    prev.parentSessionId === next.parentSessionId &&
    prev.item === next.item &&
    prev.index === next.index &&
    prev.compact === next.compact &&
    prev.isRetrying === next.isRetrying &&
    prev.isContinuing === next.isContinuing &&
    prev.isDeleting === next.isDeleting &&
    prev.subagentProfilesById === next.subagentProfilesById &&
    prev.onOpenChild === next.onOpenChild &&
    prev.onContinueChild === next.onContinueChild &&
    prev.onRetryChild === next.onRetryChild &&
    prev.onTogglePin === next.onTogglePin &&
    prev.onDeleteChild === next.onDeleteChild,
);
