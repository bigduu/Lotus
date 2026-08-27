import React, { useMemo } from "react";
import { Alert, Button, Flex, Spin, Tag, theme, Typography } from "antd";
import {
  BranchesOutlined,
  CloseCircleOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import type {
  WorkflowPlan,
  WorkflowRunSnapshot,
  WorkflowRunStatus,
  WorkflowStepStatus,
} from "../../../features/workflows";
import type { UseWorkflowRunsResult } from "../../../features/workflows/useWorkflowRuns";

const { Text } = Typography;

type DisplayStatus = WorkflowStepStatus | "unreported";

const STATUS_COLORS: Record<DisplayStatus, string> = {
  queued: "default",
  running: "processing",
  suspended: "warning",
  succeeded: "success",
  failed: "error",
  cancelled: "default",
  skipped: "default",
  unreported: "default",
};

const isCancellable = (status: WorkflowRunStatus): boolean =>
  status === "queued" || status === "running" || status === "suspended";

const collectPlanStepIds = (plan: WorkflowPlan, ids = new Set<string>()): Set<string> => {
  switch (plan.type) {
    case "step":
      ids.add(plan.step);
      return ids;
    case "sequence":
    case "parallel":
      plan.nodes.forEach((node) => collectPlanStepIds(node, ids));
      return ids;
    case "map":
      return collectPlanStepIds(plan.body, ids);
    case "retry":
      return collectPlanStepIds(plan.node, ids);
  }
};

const StatusTag: React.FC<{ status: DisplayStatus; announce?: boolean }> = ({
  status,
  announce = false,
}) => {
  const { t } = useTranslation();
  return (
    <Tag
      color={STATUS_COLORS[status]}
      style={{ marginInlineEnd: 0 }}
      role={announce ? "status" : undefined}
      aria-live={announce ? "polite" : undefined}
      aria-atomic={announce ? "true" : undefined}
    >
      {t(`inspector.workflowRuns.status.${status}`)}
    </Tag>
  );
};

const StepRow: React.FC<{
  run: WorkflowRunSnapshot;
  stepId: string;
  runtimeInstance?: boolean;
  treeLevel?: number;
}> = ({ run, stepId, runtimeInstance = false, treeLevel }) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const planned = run.planned_steps[stepId];
  const step = run.steps[stepId];
  const retryCount = step ? Math.max(0, step.attempts - 1) : 0;

  return (
    <div
      data-testid={`workflow-step-${stepId}`}
      role={runtimeInstance ? "listitem" : "treeitem"}
      aria-level={runtimeInstance ? undefined : treeLevel}
      style={{
        marginTop: 4,
        padding: `${token.paddingXXS}px ${token.paddingXS}px`,
        borderRadius: token.borderRadiusSM,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
      }}
    >
      <Flex vertical gap={3}>
        <Flex align="center" justify="space-between" gap={6} wrap>
          <Flex align="center" gap={6} style={{ minWidth: 0 }}>
            <Text code ellipsis={{ tooltip: stepId }} style={{ maxWidth: 180, fontSize: 11 }}>
              {stepId}
            </Text>
            {planned ? (
              <Tag bordered={false} style={{ marginInlineEnd: 0 }}>
                {t(`inspector.workflowRuns.kind.${planned.kind}`)}
              </Tag>
            ) : runtimeInstance ? (
              <Tag bordered={false} style={{ marginInlineEnd: 0 }}>
                {t("inspector.workflowRuns.runtimeInstance")}
              </Tag>
            ) : null}
          </Flex>
          <StatusTag status={step?.status ?? "unreported"} />
        </Flex>
        {step ? (
          <Flex gap={8} wrap>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t("inspector.workflowRuns.attempts", { count: step.attempts })}
            </Text>
            {retryCount > 0 ? (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t("inspector.workflowRuns.retries", { count: retryCount })}
              </Text>
            ) : null}
          </Flex>
        ) : null}
        {step?.failure ? (
          <Text type="danger" style={{ fontSize: 11 }}>
            {step.failure.message}
          </Text>
        ) : null}
      </Flex>
    </div>
  );
};

const PlanNode: React.FC<{
  run: WorkflowRunSnapshot;
  plan: WorkflowPlan;
  path: string;
  depth?: number;
}> = ({ run, plan, path, depth = 0 }) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  if (plan.type === "step") {
    return <StepRow run={run} stepId={plan.step} treeLevel={depth + 1} />;
  }

  const children =
    plan.type === "sequence" || plan.type === "parallel"
      ? plan.nodes
      : plan.type === "map"
        ? [plan.body]
        : [plan.node];
  const label =
    plan.type === "retry"
      ? t("inspector.workflowRuns.group.retry", { count: plan.max_attempts })
      : t(`inspector.workflowRuns.group.${plan.type}`);

  return (
    <div
      data-testid={`workflow-plan-${path}`}
      role="treeitem"
      aria-level={depth + 1}
      style={{
        marginTop: 4,
        marginInlineStart: depth === 0 ? 0 : token.marginXS,
        paddingInlineStart: token.paddingXS,
        borderInlineStart: `2px solid ${token.colorBorderSecondary}`,
      }}
    >
      <Text type="secondary" style={{ fontSize: 11 }}>
        {label}
      </Text>
      <div role="group">
        {children.map((child, index) => (
          <PlanNode
            key={`${path}-${index}`}
            run={run}
            plan={child}
            path={`${path}-${index}`}
            depth={depth + 1}
          />
        ))}
      </div>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <Flex align="center" justify="space-between" gap={8}>
    <Text type="secondary" style={{ fontSize: 11 }}>
      {label}
    </Text>
    <Text style={{ fontSize: 11, textAlign: "right" }}>{value}</Text>
  </Flex>
);

const WorkflowRunCard: React.FC<{
  run: WorkflowRunSnapshot;
  cancelling: boolean;
  cancelFailed: boolean;
  onCancel: (runId: string) => Promise<void>;
}> = ({ run, cancelling, cancelFailed, onCancel }) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const staticStepIds = useMemo(() => collectPlanStepIds(run.plan), [run.plan]);
  const runtimeSteps = Object.keys(run.steps)
    .filter((stepId) => !staticStepIds.has(stepId))
    .sort((left, right) => left.localeCompare(right));

  return (
    <div
      data-testid={`workflow-run-${run.run_id}`}
      style={{
        padding: `${token.paddingXS}px`,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorFillQuaternary,
      }}
    >
      <Flex vertical gap={6}>
        <Flex align="center" justify="space-between" gap={8} wrap>
          <Flex align="center" gap={6} style={{ minWidth: 0 }}>
            {run.status === "running" || run.status === "queued" ? (
              <PlayCircleOutlined style={{ color: token.colorPrimary }} />
            ) : run.status === "suspended" ? (
              <PauseCircleOutlined style={{ color: token.colorWarning }} />
            ) : run.status === "failed" || run.status === "cancelled" ? (
              <CloseCircleOutlined style={{ color: token.colorError }} />
            ) : (
              <BranchesOutlined style={{ color: token.colorSuccess }} />
            )}
            <Text strong ellipsis={{ tooltip: run.workflow_id }} style={{ maxWidth: 180 }}>
              {run.workflow_id}
            </Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              r{run.workflow_revision}
            </Text>
          </Flex>
          <StatusTag status={run.status} announce />
        </Flex>

        <Flex vertical gap={2}>
          <Metric
            label={t("inspector.workflowRuns.steps")}
            value={`${run.usage.steps} / ${run.budget.max_steps}`}
          />
          <Metric
            label={t("inspector.workflowRuns.retriesLabel")}
            value={`${run.usage.retries} / ${run.budget.max_retries}`}
          />
          <Metric label={t("inspector.workflowRuns.childAgents")} value={run.child_agent_count} />
          <Metric
            label={t("inspector.workflowRuns.agentUsage")}
            value={`${run.usage.agents} / ${run.budget.max_agents}`}
          />
          <Metric
            label={t("inspector.workflowRuns.tokens")}
            value={
              run.budget.max_tokens === undefined
                ? run.usage.tokens
                : `${run.usage.tokens} / ${run.budget.max_tokens}`
            }
          />
          <Metric
            label={t("inspector.workflowRuns.costMicros")}
            value={
              run.budget.max_cost_micros === undefined
                ? run.usage.cost_micros
                : `${run.usage.cost_micros} / ${run.budget.max_cost_micros}`
            }
          />
          <Metric
            label={t("inspector.workflowRuns.concurrencyLimit")}
            value={run.budget.max_concurrency}
          />
          <Metric
            label={t("inspector.workflowRuns.nestingLimit")}
            value={run.budget.max_nesting_depth}
          />
          <Metric
            label={t("inspector.workflowRuns.wallTimeLimit")}
            value={`${run.budget.wall_time_ms} ms`}
          />
        </Flex>

        {run.suspension ? (
          <Text type="warning" style={{ fontSize: 11 }}>
            {t(
              `inspector.workflowRuns.suspension.${
                run.suspension.type === "tool_running" && run.suspension.killed
                  ? "tool_stopped"
                  : run.suspension.type
              }`,
            )}
          </Text>
        ) : null}
        {run.failure ? (
          <Alert
            type="error"
            showIcon
            message={run.failure.message}
            description={run.failure.code}
            style={{ fontSize: 11 }}
          />
        ) : null}

        <div role="tree" aria-label={t("inspector.workflowRuns.planTree")}>
          <PlanNode run={run} plan={run.plan} path="root" />
        </div>

        {runtimeSteps.length > 0 ? (
          <Flex vertical gap={2} data-testid={`workflow-runtime-steps-${run.run_id}`}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t("inspector.workflowRuns.runtimeInstances")}
            </Text>
            <div role="list" aria-label={t("inspector.workflowRuns.runtimeInstances")}>
              {runtimeSteps.map((stepId) => (
                <StepRow key={stepId} run={run} stepId={stepId} runtimeInstance />
              ))}
            </div>
          </Flex>
        ) : null}

        {cancelFailed ? (
          <Alert type="warning" showIcon message={t("inspector.workflowRuns.cancelFailed")} />
        ) : null}
        {isCancellable(run.status) ? (
          <Button
            danger
            size="small"
            loading={cancelling}
            disabled={cancelling}
            onClick={() => void onCancel(run.run_id)}
          >
            {t("inspector.workflowRuns.cancel")}
          </Button>
        ) : null}
      </Flex>
    </div>
  );
};

export const WorkflowRunsPanel: React.FC<{ workflowRuns: UseWorkflowRunsResult }> = ({
  workflowRuns,
}) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const { runs, status, cancellingRunIds, cancelErrorRunIds, cancel, refresh } = workflowRuns;

  if (runs.length === 0 && (status === "idle" || status === "ready")) return null;

  return (
    <Flex vertical gap={6} data-testid="workflow-runs-panel">
      <Flex align="center" justify="space-between" gap={8}>
        <Flex align="center" gap={6}>
          <BranchesOutlined style={{ color: token.colorPrimary }} />
          <Text strong style={{ fontSize: 12 }}>
            {t("inspector.workflowRuns.title")}
          </Text>
          {status === "loading" ? <Spin size="small" /> : null}
        </Flex>
        {status === "unavailable" || status === "out_of_sync" ? (
          <Button size="small" type="text" onClick={() => void refresh()}>
            {t("inspector.workflowRuns.refresh")}
          </Button>
        ) : null}
      </Flex>
      {status === "unavailable" || status === "out_of_sync" ? (
        <Alert
          type="warning"
          showIcon
          message={t(`inspector.workflowRuns.${status}`)}
          style={{ fontSize: 11 }}
        />
      ) : null}
      {runs.map((run) => (
        <WorkflowRunCard
          key={run.run_id}
          run={run}
          cancelling={cancellingRunIds.has(run.run_id)}
          cancelFailed={cancelErrorRunIds.has(run.run_id)}
          onCancel={cancel}
        />
      ))}
    </Flex>
  );
};

export default WorkflowRunsPanel;
