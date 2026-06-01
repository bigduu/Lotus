import { useAppStore } from "@shared/store/appStore";
import { useUILayoutStore } from "@shared/store/uiLayoutStore";

/**
 * Bind a session to the currently focused pane and keep the global session
 * selection aligned with that pane.
 */
export const assignSessionToActiveLeaf = (sessionId: string) => {
  if (!sessionId) return;

  const { activeLeafId, setLeafSessionId, setActiveLeafId } = useUILayoutStore.getState();
  setLeafSessionId(activeLeafId, sessionId);
  setActiveLeafId(activeLeafId);
  useAppStore.getState().selectSession(sessionId);
};
