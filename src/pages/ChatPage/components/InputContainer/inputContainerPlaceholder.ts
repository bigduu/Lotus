import { TFunction } from "i18next";

export const getInputContainerPlaceholder = ({
  referenceText,
  isToolSpecificMode,
  isRestrictConversation,
  allowedTools,
  autoToolPrefix,
  t,
}: {
  referenceText: string | null;
  isToolSpecificMode: boolean;
  isRestrictConversation: boolean;
  allowedTools: string[];
  autoToolPrefix?: string;
  t: TFunction;
}) => {
  if (referenceText) {
    return t("chat.input.placeholderWithReference");
  }

  if (isToolSpecificMode) {
    if (isRestrictConversation) {
      return t("chat.input.toolCallsOnly", { tools: allowedTools.join(", ") });
    }
    if (autoToolPrefix) {
      return t("chat.input.autoPrefixMode", { prefix: autoToolPrefix });
    }
    return t("chat.input.toolSpecificMode", { tools: allowedTools.join(", ") });
  }

  return t("chat.input.placeholderWithWorkflows");
};
