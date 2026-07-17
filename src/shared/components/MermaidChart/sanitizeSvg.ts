import DOMPurify from "dompurify";

/**
 * Security boundary for Mermaid SVG output before it is injected into the live
 * document via `dangerouslySetInnerHTML`. See issue #38.
 *
 * Mermaid chart *text* is attacker-influenceable (LLM output under prompt
 * injection, or a tool returning a ```mermaid block), and mermaid's own CSS
 * generation has a gap: every diagram-native style rule is namespaced under
 * `#<svgId>` by its stylis-based compiler, EXCEPT the `themeCSS` config key
 * (settable per-diagram via a `%%{init:{"themeCSS":"..."}}%%` directive or YAML
 * frontmatter), which mermaid splices into the `<style>` block as raw,
 * unscoped text (mermaidAPI.ts `createCssStyles`) and only checks for
 * balanced braces — not selector scope or URLs. Inline SVG `<style>` is NOT
 * scoped by the browser to the SVG subtree, so an unscoped selector
 * (`body{...}`, `.ant-btn-dangerous{...}`) reaches the whole host document,
 * including chrome like the in-chat permission Approve/Deny UI.
 *
 * Defense in depth, in order:
 *  1. mermaidConfig.ts / useMermaidTheme.ts lock `themeCSS` (+ themeVariables,
 *     fontFamily) via mermaid's `secure` config list, so `%%{init}%%` can never
 *     set them in the first place. This closes the root cause.
 *  2. This module assumes that lock can be bypassed (defense in depth, not
 *     "trust the first layer"): it strips exfil vectors (`url()`, `@import`)
 *     from every `<style>` block, and drops any style rule whose selector
 *     isn't scoped under the diagram's own root id — mirroring the scoping
 *     mermaid's own compiler is supposed to guarantee. `@keyframes` blocks are
 *     kept (they only define a named animation; they can't select or style
 *     anything by themselves, and every rule that could reference one by name
 *     is itself scope-checked).
 */

const escapeForRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const INTERNAL_URL_REF = /^#/;

/** Strip `@import` and any non-fragment `url()` from raw CSS text, before it
 * ever touches a live CSSStyleSheet — so the browser never gets a chance to
 * fetch an attacker-controlled resource while we're inspecting the rules. */
const stripCssExfilVectors = (cssText: string): string => {
  let next = cssText.replace(/@import[^;]*;?/gi, "");
  next = next.replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (match, _quote, target: string) =>
    INTERNAL_URL_REF.test(target.trim()) ? match : "none",
  );
  return next;
};

/**
 * Keep only the CSS rules that are provably scoped to `#svgId` (or are a
 * harmless `@keyframes` definition). Parses via a `<style>` element's own
 * CSSOM (`.sheet.cssRules`) — briefly attached to the document so the browser
 * actually parses it — rather than a fragile regex over selector text. URLs
 * are already stripped by this point, so attaching is safe (nothing to fetch).
 */
const scopeCssToSvgRoot = (cssText: string, svgId: string): string => {
  const styleEl = document.createElement("style");
  styleEl.textContent = cssText;
  document.head.appendChild(styleEl);

  try {
    const sheet = styleEl.sheet;
    if (!sheet) return "";

    const scopedSelectorRe = new RegExp(`^#${escapeForRegExp(svgId)}(?![\\w-])`);
    const kept: string[] = [];

    // Use constructor.name rather than `instanceof CSSKeyframesRule` /
    // `instanceof CSSStyleRule`: some DOM implementations (e.g. jsdom, used
    // in this project's test env) don't expose every CSSRule subclass as a
    // global constructor, even though the rule instances themselves report
    // the right constructor name.
    for (const rule of Array.from(sheet.cssRules)) {
      const kind = rule.constructor.name;
      if (kind === "CSSKeyframesRule") {
        kept.push(rule.cssText);
        continue;
      }
      if (kind === "CSSStyleRule" && "selectorText" in rule) {
        const selectorText = (rule as CSSStyleRule).selectorText;
        const parts = selectorText.split(",").map((s) => s.trim());
        if (parts.length > 0 && parts.every((p) => scopedSelectorRe.test(p))) {
          kept.push(rule.cssText);
        }
        continue;
      }
      // Any other at-rule (@import, @media, @font-face, @supports, ...) is
      // either already stripped above or not something mermaid's own
      // diagrams legitimately emit — drop it rather than risk an
      // unscoped/global effect.
    }

    return kept.join("\n");
  } catch {
    // Unparseable as CSS after our own stripping — fail closed.
    return "";
  } finally {
    document.head.removeChild(styleEl);
  }
};

/** Post-process every `<style>` element in an already-DOMPurify-sanitized SVG
 * string: strip exfil vectors, then enforce that every surviving rule is
 * scoped to the SVG's own root id. Returns the input unchanged if there's no
 * `<style>` to harden, or if the root SVG has no id to scope against (fails
 * closed by dropping styles rather than risk an unscoped rule). */
const hardenInlineStyles = (svgMarkup: string): string => {
  if (!svgMarkup.includes("<style")) return svgMarkup;

  const doc = new DOMParser().parseFromString(svgMarkup, "image/svg+xml");
  if (doc.querySelector("parsererror")) return svgMarkup;

  const styleEls = doc.querySelectorAll("style");
  if (styleEls.length === 0) return svgMarkup;

  const svgId = doc.documentElement.getAttribute("id");

  styleEls.forEach((styleEl) => {
    const stripped = stripCssExfilVectors(styleEl.textContent ?? "");
    styleEl.textContent = svgId ? scopeCssToSvgRoot(stripped, svgId) : "";
  });

  return new XMLSerializer().serializeToString(doc.documentElement);
};

export const sanitizeSvgMarkup = (svgMarkup: string): string =>
  hardenInlineStyles(
    DOMPurify.sanitize(svgMarkup, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: ["style"],
      ADD_ATTR: ["dominant-baseline"],
    }),
  );
