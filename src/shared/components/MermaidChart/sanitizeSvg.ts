import DOMPurify from "dompurify";

/**
 * Sanitize Mermaid's SVG output before injecting it via dangerouslySetInnerHTML.
 *
 * Mermaid runs in securityLevel:'strict' with htmlLabels:false, so its markup is
 * pure SVG (no <foreignObject>). This strips any unexpected scriptable content
 * while preserving the inline <style> block that colors the diagram.
 */
export const sanitizeSvgMarkup = (svgMarkup: string): string =>
  DOMPurify.sanitize(svgMarkup, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["style"],
    ADD_ATTR: ["dominant-baseline"],
  });
