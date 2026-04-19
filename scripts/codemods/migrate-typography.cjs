/**
 * Codemod: redirect antd Typography import → our shadcn-style replacement.
 *
 * Run with:
 *   npx jscodeshift -t scripts/codemods/migrate-typography.cjs --extensions=tsx,ts --parser=tsx src/
 *
 * Behavior: splits `Typography` out of any `from "antd"` named import and adds
 * `import { Typography } from "@/components/ui/typography"`. Downstream JSX
 * (`<Typography.Title>`, destructured Title/Text/Paragraph/Link, etc.) keeps
 * working because our replacement exposes the same API surface.
 */
module.exports = function transformer(file, api) {
  const j = api.jscodeshift;
  const root = j(file.source);
  let touched = false;

  root
    .find(j.ImportDeclaration, { source: { value: "antd" } })
    .forEach((path) => {
      const specifiers = path.node.specifiers || [];
      const typoSpec = specifiers.find(
        (s) => s.type === "ImportSpecifier" && s.imported.name === "Typography",
      );
      if (!typoSpec) return;

      // remove Typography from antd
      path.node.specifiers = specifiers.filter((s) => s !== typoSpec);
      touched = true;

      const newImport = j.importDeclaration(
        [j.importSpecifier(j.identifier("Typography"))],
        j.literal("@/components/ui/typography"),
      );
      j(path).insertAfter(newImport);

      if (path.node.specifiers.length === 0) {
        j(path).remove();
      }
    });

  return touched ? root.toSource({ quote: "double" }) : null;
};
