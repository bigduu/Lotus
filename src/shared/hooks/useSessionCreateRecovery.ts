import { useCallback } from "react";
import { App as AntdApp } from "antd";
import { useTranslation } from "react-i18next";

import {
  isChatSessionCreateRecoveryError,
  type ChatSessionCreateRecoveryError,
} from "@shared/store/appStore/slices/chatSessionSlice/sessionCreateRecovery";

export interface SessionCreateRecoveryPresentationOptions {
  /** Runs once, only after Bamboo returns the recovered session ID. */
  onRecovered?: (sessionId: string) => void | Promise<void>;
  onDefinitiveError?: (error: unknown) => void;
}

/**
 * Presents an ambiguous create as a warning with an explicit same-operation
 * retry. It never invokes caller side effects until recovery has a session ID.
 */
export function useSessionCreateRecovery() {
  const { modal } = AntdApp.useApp();
  const { t } = useTranslation();

  return useCallback(
    (error: unknown, options: SessionCreateRecoveryPresentationOptions = {}): boolean => {
      if (!isChatSessionCreateRecoveryError(error)) {
        return false;
      }

      const showRecovery = (current: ChatSessionCreateRecoveryError): void => {
        modal.confirm({
          title: t("chat.sessionCreateRecovery.title"),
          content: current.message,
          okText: t("chat.sessionCreateRecovery.retry"),
          cancelText: t("common.close"),
          onOk: async () => {
            let sessionId: string;
            try {
              sessionId = await current.retry();
            } catch (retryError) {
              if (isChatSessionCreateRecoveryError(retryError)) {
                // Let the current modal close before presenting the next
                // bounded recovery result for the same idempotency key.
                globalThis.setTimeout(() => showRecovery(retryError), 0);
                return;
              }

              if (options.onDefinitiveError) {
                options.onDefinitiveError(retryError);
              } else {
                modal.error({
                  title: t("chat.sidebar.createFailedTitle"),
                  content:
                    retryError instanceof Error
                      ? retryError.message
                      : t("chat.sidebar.createFailedUnknown"),
                });
              }
              return;
            }

            await options.onRecovered?.(sessionId);
          },
        });
      };

      showRecovery(error);
      return true;
    },
    [modal, t],
  );
}
