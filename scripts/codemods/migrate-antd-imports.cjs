/**
 * Generic codemod: split multiple antd named imports out to separate paths.
 *
 * Configured inline below. To add more components, just extend the MAPPINGS.
 *
 * Run with:
 *   npx jscodeshift -t scripts/codemods/migrate-antd-imports.cjs --extensions=tsx,ts --parser=tsx src/
 */

const MAPPINGS = {
  Space: "@/components/ui/space",
  Flex: "@/components/ui/flex",
  Card: "@/components/ui/card",
};

module.exports = function transformer(file, api) {
  const j = api.jscodeshift;
  const root = j(file.source);
  let touched = false;

  root.find(j.ImportDeclaration, { source: { value: "antd" } }).forEach((path) => {
    const specifiers = path.node.specifiers || [];
    const toExtract = [];
    const remaining = [];
    for (const s of specifiers) {
      if (s.type === "ImportSpecifier" && MAPPINGS[s.imported.name]) {
        toExtract.push(s);
      } else {
        remaining.push(s);
      }
    }
    if (toExtract.length === 0) return;

    touched = true;
    path.node.specifiers = remaining;

    // group by destination path
    const byDest = new Map();
    for (const s of toExtract) {
      const dest = MAPPINGS[s.imported.name];
      if (!byDest.has(dest)) byDest.set(dest, []);
      byDest.get(dest).push(s);
    }
    for (const [dest, specs] of byDest.entries()) {
      const newImport = j.importDeclaration(
        specs.map((s) => j.importSpecifier(j.identifier(s.imported.name))),
        j.literal(dest),
      );
      j(path).insertAfter(newImport);
    }

    if (path.node.specifiers.length === 0) {
      j(path).remove();
    }
  });

  return touched ? root.toSource({ quote: "double" }) : null;
};
