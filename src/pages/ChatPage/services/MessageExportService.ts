import { FileOperationsService } from "./FileOperationsService";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeSanitize from "rehype-sanitize";
import i18n from "../../../shared/i18n";
import { createMarkdownComponents } from "../../../shared/components/Markdown/markdownComponents";

export type MessageExportFormat = "markdown" | "pdf";

const toMutableFilters = (
  filters: ReadonlyArray<{ name: string; extensions: ReadonlyArray<string> }>,
): { name: string; extensions: string[] }[] =>
  filters.map((f) => ({ name: f.name, extensions: [...f.extensions] }));

const sanitizeFilenamePart = (value: string): string => {
  // Keep filenames portable across OSes.
  const trimmed = value.trim().slice(0, 64);
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
  return safe || "message";
};

const PDF_EXPORT_TOKEN = {
  marginSM: 12,
  marginXS: 6,
  paddingXS: 6,
  paddingSM: 10,
  padding: 12,
  borderRadiusSM: 8,
  fontSizeSM: 12,
  colorPrimary: "#1677ff",
  colorPrimaryBg: "#e6f4ff",
  colorTextSecondary: "#595959",
  colorText: "#1f1f1f",
  colorLink: "#1677ff",
  colorBgContainer: "#ffffff",
  colorBorder: "#d9d9d9",
  boxShadowSecondary: "none",
} as const;

const MERMAID_LOADING_SELECTOR = '[data-mermaid-loading="true"]';

export class MessageExportService {
  static async exportMessageText(args: {
    format: MessageExportFormat;
    content: string;
    sessionId?: string | null;
    messageId?: string | null;
    filenamePrefix?: string;
  }): Promise<{ success: boolean; filename?: string; error?: string }> {
    const {
      format,
      content,
      sessionId = null,
      messageId = null,
      filenamePrefix,
    } = args;

    const prefix =
      filenamePrefix ||
      [
        "chat-message",
        sessionId ? sanitizeFilenamePart(sessionId.slice(0, 8)) : null,
        messageId ? sanitizeFilenamePart(messageId.slice(0, 8)) : null,
      ]
        .filter(Boolean)
        .join("-");

    const defaultPath =
      format === "markdown"
        ? FileOperationsService.generateTimestampedFilename(prefix, "md")
        : FileOperationsService.generateTimestampedFilename(prefix, "pdf");

    if (format === "markdown") {
      const result = await FileOperationsService.saveTextFile(
        content,
        toMutableFilters(FileOperationsService.FILTERS.MARKDOWN),
        defaultPath,
      );
      return result.success
        ? { success: true, filename: result.filename }
        : { success: false, error: result.error };
    }

    // pdf
    try {
      const pdfBytes = await this.generatePdfFromText(content);
      const result = await FileOperationsService.saveBinaryFile(
        pdfBytes,
        toMutableFilters(FileOperationsService.FILTERS.PDF),
        defaultPath,
      );
      return result.success
        ? { success: true, filename: result.filename }
        : { success: false, error: result.error };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : i18n.t("chat.messageActions.exportFailed"),
      };
    }
  }

  private static async generatePdfFromText(
    content: string,
  ): Promise<Uint8Array> {
    // PDF export should match the markdown renderer used in MessageCard,
    // including custom code/mermaid rendering.
    if (typeof document === "undefined") {
      throw new Error(i18n.t("chat.messageActions.pdfUnavailable"));
    }

    const html2canvas = (await import("html2canvas")).default;
    const { jsPDF } = await import("jspdf");
    const { createRoot } = await import("react-dom/client");
    const { flushSync } = await import("react-dom");

    const markdownComponents = createMarkdownComponents(PDF_EXPORT_TOKEN, {
      mermaidRenderMode: "eager",
    });

    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.left = "0";
    overlay.style.top = "0";
    overlay.style.right = "0";
    overlay.style.bottom = "0";
    overlay.style.zIndex = "2147483647";
    overlay.style.background = "rgba(0,0,0,0.15)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.fontFamily =
      "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";
    overlay.style.fontSize = "14px";
    overlay.style.color = "#111";

    const overlayCard = document.createElement("div");
    overlayCard.style.background = "#fff";
    overlayCard.style.border = "1px solid rgba(0,0,0,0.12)";
    overlayCard.style.borderRadius = "10px";
    overlayCard.style.padding = "12px 14px";
    overlayCard.style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)";
    overlayCard.textContent = i18n.t("chat.messageActions.exportingPdf");
    overlay.appendChild(overlayCard);

    const container = document.createElement("div");
    container.style.position = "fixed";
    // NOTE: html2canvas can produce empty renders when the element is far offscreen.
    // Keep it at (0,0) but behind the app so users don't notice it.
    container.style.left = "0";
    container.style.top = "0";
    container.style.zIndex = "2147483646";
    container.style.pointerEvents = "none";
    // A4 width in px at 96dpi: 8.27in * 96 = ~794px
    container.style.width = "794px";
    container.style.background = "#fff";
    container.style.color = "#111";
    container.style.padding = "24px";
    container.style.boxSizing = "border-box";
    container.style.fontFamily =
      "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";
    container.style.fontSize = "14px";
    container.style.lineHeight = "1.35";

    const style = document.createElement("style");
    style.textContent = `
      .md-export { color: #111; }
      .md-export h1 { font-size: 24px; margin: 0 0 16px; }
      .md-export h2 { font-size: 18px; margin: 18px 0 12px; }
      .md-export h3 { font-size: 16px; margin: 14px 0 10px; }
      .md-export [data-mermaid-controls="true"] { display: none !important; }
    `;
    container.appendChild(style);

    const rootHost = document.createElement("div");
    rootHost.className = "md-export";
    container.appendChild(rootHost);

    // Attach both elements so layout/paint happens reliably in WebView engines.
    document.body.appendChild(container);
    document.body.appendChild(overlay);

    const root = createRoot(rootHost);
    flushSync(() => {
      root.render(
        React.createElement(
          ReactMarkdown as unknown as React.ComponentType<any>,
          {
            remarkPlugins: [remarkGfm, remarkBreaks],
            rehypePlugins: [rehypeSanitize],
            components: markdownComponents,
          },
          content || "",
        ),
      );
    });

    try {
      await this.waitForExportRenderReady(container);
      const canvas = await this.renderCanvasWithFallback(
        html2canvas,
        container,
      );

      // Render canvas into A4 pages (pt units).
      const doc = new jsPDF({
        unit: "pt",
        format: "a4",
        orientation: "portrait",
      });
      const pageWidthPt = doc.internal.pageSize.getWidth();
      const pageHeightPt = doc.internal.pageSize.getHeight();
      const marginPt = 24;
      const contentWidthPt = pageWidthPt - marginPt * 2;
      const contentHeightPt = pageHeightPt - marginPt * 2;

      const pxPerPt = canvas.width / contentWidthPt;
      const sliceHeightPx = Math.max(1, Math.floor(contentHeightPt * pxPerPt));

      let offsetY = 0;
      let pageIndex = 0;
      while (offsetY < canvas.height) {
        const computedSliceHeight = this.computeSmartSliceHeight(
          canvas,
          offsetY,
          sliceHeightPx,
        );
        const sliceHeight = Math.max(
          1,
          Math.min(computedSliceHeight, canvas.height - offsetY),
        );

        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = sliceHeight;

        const ctx = sliceCanvas.getContext("2d");
        if (!ctx) throw new Error("PDF render failed (no canvas context)");

        // White background to avoid transparency issues.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        ctx.drawImage(
          canvas,
          0,
          offsetY,
          canvas.width,
          sliceHeight,
          0,
          0,
          canvas.width,
          sliceHeight,
        );

        const imgData = sliceCanvas.toDataURL("image/jpeg", 0.92);
        const sliceHeightPt = sliceHeight / pxPerPt;

        if (pageIndex > 0) doc.addPage();
        doc.addImage(
          imgData,
          "JPEG",
          marginPt,
          marginPt,
          contentWidthPt,
          sliceHeightPt,
        );

        offsetY += sliceHeight;
        pageIndex += 1;
      }

      const buffer = doc.output("arraybuffer") as ArrayBuffer;
      return new Uint8Array(buffer);
    } finally {
      root.unmount();
      overlay.remove();
      container.remove();
    }
  }

  private static async waitForExportRenderReady(
    container: HTMLElement,
  ): Promise<void> {
    // Ensure layout + fonts settle before capture.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    await (document as any).fonts?.ready?.catch?.(() => undefined);

    const start = Date.now();
    const timeoutMs = 6000;
    while (Date.now() - start < timeoutMs) {
      const pendingMermaid = container.querySelector(MERMAID_LOADING_SELECTOR);
      if (!pendingMermaid) {
        // Give one more frame to flush post-render layout changes.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }

  private static async renderCanvasWithFallback(
    html2canvas: (
      element: HTMLElement,
      options: Record<string, unknown>,
    ) => Promise<HTMLCanvasElement>,
    container: HTMLElement,
  ): Promise<HTMLCanvasElement> {
    const baseOptions = {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      allowTaint: true,
    };

    try {
      const canvas = await html2canvas(container, {
        ...baseOptions,
        foreignObjectRendering: true,
      });
      if (canvas.width && canvas.height) {
        return canvas;
      }
    } catch (error) {
      console.warn(
        "PDF capture with foreignObjectRendering=true failed:",
        error,
      );
    }

    const fallbackCanvas = await html2canvas(container, {
      ...baseOptions,
      foreignObjectRendering: false,
    });

    if (!fallbackCanvas.width || !fallbackCanvas.height) {
      throw new Error("PDF render failed (empty canvas)");
    }

    return fallbackCanvas;
  }

  private static computeSmartSliceHeight(
    canvas: HTMLCanvasElement,
    offsetY: number,
    targetSliceHeight: number,
  ): number {
    const remainingHeight = canvas.height - offsetY;
    if (remainingHeight <= targetSliceHeight) {
      return remainingHeight;
    }

    const preferredBreakY = offsetY + targetSliceHeight;
    const minSliceHeight = Math.max(1, Math.floor(targetSliceHeight * 0.72));
    const searchRadius = Math.max(8, Math.floor(targetSliceHeight * 0.12));
    const minBreakY = Math.max(
      offsetY + minSliceHeight,
      preferredBreakY - searchRadius,
    );
    const maxBreakY = Math.min(
      canvas.height - 1,
      preferredBreakY + searchRadius,
    );

    const breakY = this.findWhitespaceBreakY(
      canvas,
      preferredBreakY,
      minBreakY,
      maxBreakY,
    );
    if (breakY === null || breakY <= offsetY) {
      return targetSliceHeight;
    }

    return breakY - offsetY;
  }

  private static findWhitespaceBreakY(
    canvas: HTMLCanvasElement,
    preferredBreakY: number,
    minBreakY: number,
    maxBreakY: number,
  ): number | null {
    if (minBreakY > maxBreakY || canvas.width <= 0) {
      return null;
    }

    try {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx || typeof ctx.getImageData !== "function") {
        return null;
      }

      const height = maxBreakY - minBreakY + 1;
      const imageData = ctx.getImageData(
        0,
        minBreakY,
        canvas.width,
        height,
      ).data;
      const rowStride = canvas.width * 4;
      const sampleStep = Math.max(1, Math.floor(canvas.width / 320));
      const whiteThreshold = 245;
      const alphaThreshold = 16;
      const maxInkRatioForWhitespace = 0.03;

      let bestY: number | null = null;
      let bestInkRatio = Number.POSITIVE_INFINITY;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let row = 0; row < height; row += 1) {
        let inkSamples = 0;
        let totalSamples = 0;
        const rowOffset = row * rowStride;

        for (let x = 0; x < canvas.width; x += sampleStep) {
          const index = rowOffset + x * 4;
          const alpha = imageData[index + 3];
          totalSamples += 1;

          if (alpha <= alphaThreshold) {
            continue;
          }

          const r = imageData[index];
          const g = imageData[index + 1];
          const b = imageData[index + 2];
          if (r < whiteThreshold || g < whiteThreshold || b < whiteThreshold) {
            inkSamples += 1;
          }
        }

        if (totalSamples === 0) {
          continue;
        }

        const inkRatio = inkSamples / totalSamples;
        const y = minBreakY + row;
        const distance = Math.abs(y - preferredBreakY);
        const isBetter =
          inkRatio < bestInkRatio ||
          (inkRatio === bestInkRatio && distance < bestDistance);

        if (isBetter) {
          bestInkRatio = inkRatio;
          bestDistance = distance;
          bestY = y;
        }
      }

      if (bestY === null || bestInkRatio > maxInkRatioForWhitespace) {
        return null;
      }

      return bestY;
    } catch {
      // Cross-origin images can taint canvas and block pixel reads.
      return null;
    }
  }
}
