import React, { useEffect, useState } from "react";
import { useMermaidRenderState } from "./useMermaidRenderState";
import { rasterizeSvgToPng } from "./rasterizeSvg";
import { sanitizeSvgMarkup } from "./sanitizeSvg";

interface StaticMermaidChartProps {
  chart: string;
  /** Rasterization factor; higher = crisper PNG at the cost of size. */
  scale?: number;
}

/**
 * Chrome-less Mermaid renderer for static contexts (PDF export).
 *
 * Unlike the interactive <MermaidChart> (zoom/pan wrapper + controls), this
 * renders the diagram as a single high-DPI PNG <img> so html2canvas captures it
 * crisply instead of re-rasterizing the SVG at capture scale. It exposes
 * `data-mermaid-loading` so MessageExportService can wait for render completion.
 */
const StaticMermaidChart: React.FC<StaticMermaidChartProps> = ({ chart, scale = 3 }) => {
  const { renderState } = useMermaidRenderState(chart, true);
  const { svg, error } = renderState;

  const [png, setPng] = useState<{ url: string; width: number } | null>(null);
  const [rasterFailed, setRasterFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPng(null);
    setRasterFailed(false);

    if (!svg) return;

    void rasterizeSvgToPng(svg, scale).then((result) => {
      if (cancelled) return;
      if (result) {
        setPng({ url: result.url, width: result.width });
      } else {
        setRasterFailed(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [svg, scale]);

  // Still rendering the diagram, or rasterizing a successful render.
  const loading = !error && !png && !rasterFailed;

  if (error) {
    return (
      <pre
        data-mermaid-loading="false"
        style={{
          border: "1px solid #d9d9d9",
          borderRadius: 8,
          padding: 12,
          background: "#fafafa",
          color: "#1f1f1f",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: 12,
        }}
      >
        {`Mermaid render failed: ${error}\n\n${chart}`}
      </pre>
    );
  }

  if (png) {
    return (
      <div data-mermaid-loading="false" style={{ margin: "8px 0" }}>
        <img
          src={png.url}
          alt="Mermaid diagram"
          style={{
            width: png.width,
            maxWidth: "100%",
            height: "auto",
            display: "block",
          }}
        />
      </div>
    );
  }

  // Rasterization failed but the SVG rendered — inline the sanitized SVG so the
  // export still shows the diagram (html2canvas will rasterize it, less crisp).
  if (rasterFailed && svg) {
    return (
      <div
        data-mermaid-loading="false"
        style={{ margin: "8px 0" }}
        dangerouslySetInnerHTML={{ __html: sanitizeSvgMarkup(svg) }}
      />
    );
  }

  return <div data-mermaid-loading={loading ? "true" : "false"} style={{ minHeight: 24 }} />;
};

export default StaticMermaidChart;
