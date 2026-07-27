import { useEffect, useMemo } from "react";
import { Alert, Button, Flex, Space, Tag, Typography } from "antd";
import type { ConfigSectionId } from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";
import { redactConfigError } from "@shared/utils/configErrors";

const { Text } = Typography;

const STATUS_COLOR = {
  healthy: "success",
  missing: "default",
  degraded: "warning",
  invalid: "error",
} as const;

export const ConfigSectionStatus = ({ sections }: { sections: ConfigSectionId[] }) => {
  const allSections = useConfigSectionStore((state) => state.sections);
  const loadSection = useConfigSectionStore((state) => state.loadSection);
  const clearConflict = useConfigSectionStore((state) => state.clearConflict);
  const sectionKey = sections.join("|");
  const stableSections = useMemo(
    () => sectionKey.split("|").filter(Boolean) as ConfigSectionId[],
    [sectionKey],
  );
  const snapshots = stableSections.map((section) => ({
    section,
    snapshot: allSections[section],
  }));

  useEffect(() => {
    for (const section of stableSections) void loadSection(section).catch(() => undefined);
  }, [loadSection, stableSections]);

  const unhealthy = snapshots.filter(
    ({ snapshot }) =>
      snapshot.error ||
      snapshot.conflict ||
      (snapshot.envelope && snapshot.envelope.status !== "healthy"),
  );

  return (
    <Space direction="vertical" size={8} style={{ width: "100%", marginBottom: 12 }}>
      <Flex gap={6} wrap="wrap" align="center">
        {snapshots.map(({ section, snapshot }) => {
          const envelope = snapshot.envelope;
          return (
            <Tag
              key={section}
              color={
                envelope ? STATUS_COLOR[envelope.status] : snapshot.error ? "error" : "default"
              }
            >
              {section}: {snapshot.loading ? "loading" : (envelope?.status ?? "unavailable")}
              {envelope ? ` · r${envelope.revision}` : ""}
            </Tag>
          );
        })}
      </Flex>
      {snapshots.map(({ section, snapshot }) =>
        snapshot.envelope ? (
          <Text key={`${section}-meta`} type="secondary" style={{ fontSize: 12 }}>
            {section}: {snapshot.envelope.source_path} · {snapshot.envelope.source_kind} · loaded{" "}
            {snapshot.envelope.loaded_at}
          </Text>
        ) : null,
      )}
      {unhealthy.map(({ section, snapshot }) => {
        const conflict = snapshot.conflict;
        const detail = conflict
          ? `Your draft expected revision ${conflict.expectedRevision}; the server is at revision ${
              conflict.currentRevision ?? "unknown"
            }. Reload the latest snapshot, then compare or reapply your draft before saving again.`
          : (snapshot.error ?? snapshot.envelope?.last_error ?? "Section is not healthy.");
        return (
          <Alert
            key={`${section}-error`}
            type={snapshot.envelope?.status === "invalid" || conflict ? "error" : "warning"}
            showIcon
            message={
              conflict
                ? `${section} revision conflict`
                : `${section} configuration ${snapshot.envelope?.status ?? "unavailable"}`
            }
            description={redactConfigError(detail)}
            action={
              <Button
                size="small"
                onClick={() => {
                  clearConflict(section);
                  void loadSection(section, { force: true });
                }}
              >
                {conflict ? "Reload latest" : "Retry"}
              </Button>
            }
          />
        );
      })}
    </Space>
  );
};

export default ConfigSectionStatus;
