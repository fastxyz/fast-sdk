import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface BinderResult {
  routeViolations: Array<{ file: string; literal: string }>;
  adminExports: string[];
  stringLiterals: string[];
}

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : entry.isFile() && entry.name.endsWith(".ts")
        ? [path]
        : [];
  });
}

function isAdminRouteLiteral(value: string): boolean {
  return value.includes("/api/admin") || /\/admin(?:\/|$)/.test(value);
}

function routeLiterals(source: ts.SourceFile): string[] {
  const literals: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) literals.push(node.text);
    if (ts.isTemplateExpression(node)) {
      literals.push(node.head.text, ...node.templateSpans.map((span) => span.literal.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return literals;
}

function constantString(
  node: ts.Expression,
  checker: ts.TypeChecker,
  seen: Set<ts.Symbol> = new Set(),
): string | undefined {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) {
    return constantString(node.expression, checker, seen);
  }
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
    return constantString(node.expression, checker, seen);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = constantString(node.left, checker, new Set(seen));
    const right = constantString(node.right, checker, new Set(seen));
    return left === undefined || right === undefined ? undefined : left + right;
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const expression = constantString(span.expression, checker, new Set(seen));
      if (expression === undefined) return undefined;
      value += expression + span.literal.text;
    }
    return value;
  }
  if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
    let symbol = checker.getSymbolAtLocation(
      ts.isPropertyAccessExpression(node) ? node.name : node,
    );
    if (!symbol) return undefined;
    if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    if (seen.has(symbol)) return undefined;
    const nextSeen = new Set(seen).add(symbol);
    for (const declaration of symbol.declarations ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const value = constantString(declaration.initializer, checker, nextSeen);
        if (value !== undefined) return value;
      }
      if (ts.isPropertyAssignment(declaration)) {
        const value = constantString(declaration.initializer, checker, nextSeen);
        if (value !== undefined) return value;
      }
    }
  }
  return undefined;
}

function routeExpressions(source: ts.SourceFile, checker: ts.TypeChecker): string[] {
  const expressions = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isTemplateExpression(node)) {
      let segment = node.head.text;
      for (const span of node.templateSpans) {
        const expression = constantString(span.expression, checker);
        if (expression === undefined) {
          if (segment.length > 0) expressions.add(segment);
          segment = span.literal.text;
        } else {
          segment += expression + span.literal.text;
        }
      }
      if (segment.length > 0) expressions.add(segment);
    }
    if (ts.isExpression(node)) {
      const value = constantString(node, checker);
      if (value !== undefined) expressions.add(value);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...expressions];
}

function scanNoAdmin(root: string): BinderResult {
  const files = sourceFiles(root);
  const program = ts.createProgram(files, {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
  });
  const checker = program.getTypeChecker();
  const stringLiterals: string[] = [];
  const routeViolations: BinderResult["routeViolations"] = [];
  const violationKeys = new Set<string>();
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) throw new Error(`source file was not included in binder graph: ${file}`);
    const literalCandidates = routeLiterals(source);
    for (const literal of literalCandidates) {
      stringLiterals.push(literal);
    }
    for (const literal of [
      ...literalCandidates,
      ...routeExpressions(source, checker),
    ]) {
      if (!isAdminRouteLiteral(literal)) continue;
      const key = `${file}\0${literal}`;
      if (violationKeys.has(key)) continue;
      violationKeys.add(key);
      routeViolations.push({ file, literal });
    }
  }
  const index = program.getSourceFile(resolve(root, "index.ts"));
  if (!index) throw new Error("public index.ts was not included in the binder graph");
  const moduleSymbol = checker.getSymbolAtLocation(index);
  if (!moduleSymbol) throw new Error("public index.ts has no module symbol");
  const adminExports = checker
    .getExportsOfModule(moduleSymbol)
    .map((symbol) => symbol.getName())
    .filter((name) => /admin/i.test(name));

  return { routeViolations, adminExports, stringLiterals };
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = process.env.ID_SDK_BINDER_ROOT
  ? resolve(process.env.ID_SDK_BINDER_ROOT)
  : resolve(packageRoot, "src");

describe("non-admin public SDK binder", () => {
  it("contains no admin route reference or admin-named public export", () => {
    const result = scanNoAdmin(sourceRoot);
    expect(result.routeViolations).toEqual([]);
    expect(result.adminExports).toEqual([]);
  });

  it("has live positive controls without rejecting the reserved name", () => {
    const result = scanNoAdmin(sourceRoot);
    expect(result.stringLiterals).toContain("/api/claim");
    expect(result.stringLiterals).toContain("admin");
    expect(isAdminRouteLiteral("admin")).toBe(false);
    expect(isAdminRouteLiteral("/api/admin/reserve")).toBe(true);
  });

  it("runs the dynamic-template positive control through the real scanner", () => {
    const scratch = mkdtempSync(join(tmpdir(), "id-sdk-binder-dynamic-"));
    try {
      writeFileSync(resolve(scratch, "index.ts"), "export const ok = true;\n");
      writeFileSync(
        resolve(scratch, "client.ts"),
        "declare const action: string;\nexport const call = () => fetch(`/api/admin/${action}`);\n",
      );

      expect(scanNoAdmin(scratch).routeViolations).toEqual([
        expect.objectContaining({ literal: "/api/admin/" }),
      ]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("detects an admin route assembled through an imported constant", () => {
    const scratch = mkdtempSync(join(tmpdir(), "id-sdk-binder-"));
    try {
      writeFileSync(resolve(scratch, "index.ts"), 'export { call } from "./client.js";\n');
      writeFileSync(resolve(scratch, "routes.ts"), 'export const ADMIN = "admin/reserve";\n');
      writeFileSync(
        resolve(scratch, "client.ts"),
        'import { ADMIN } from "./routes.js";\nexport const call = () => fetch("/api/" + ADMIN);\n',
      );

      expect(scanNoAdmin(scratch).routeViolations).toEqual([
        expect.objectContaining({ literal: "/api/admin/reserve" }),
      ]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("detects a resolved admin prefix before a dynamic template span", () => {
    const scratch = mkdtempSync(join(tmpdir(), "id-sdk-binder-prefix-"));
    try {
      writeFileSync(resolve(scratch, "index.ts"), 'export { call } from "./client.js";\n');
      writeFileSync(resolve(scratch, "routes.ts"), 'export const ADMIN = "admin";\n');
      writeFileSync(
        resolve(scratch, "client.ts"),
        'import { ADMIN } from "./routes.js";\ndeclare const action: string;\nexport const call = () => fetch(`/api/${ADMIN}/${action}`);\n',
      );

      expect(scanNoAdmin(scratch).routeViolations).toEqual([
        expect.objectContaining({ literal: "/api/admin/" }),
      ]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("publishable package surface", () => {
  it("publishes only built output with typed ESM entrypoints and the tested Node 20 floor", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(packageRoot, "package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest.private).not.toBe(true);
    expect(manifest.license).toBe("Apache-2.0");
    expect(manifest.files).toEqual(["dist"]);
    expect(manifest.exports).toEqual({
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
    });
    expect(manifest.engines).toEqual({ node: ">=20.19.0" });
  });
});
