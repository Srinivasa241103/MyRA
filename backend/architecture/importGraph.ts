/**
 * FND-07 — static import graph and boundary analysis.
 *
 * Deliberately dependency-free: a rule that only runs when an extra devtool is
 * installed and configured is a rule that stops running. This reads the source
 * text, extracts every import specifier, resolves the relative ones against the
 * files it was given, and reports where the code disagrees with
 * `moduleBoundaries.ts`.
 *
 * The analysis works on an injected file list rather than the disk, so the
 * architecture test can prove each rule *fails* on a synthetic violation — the
 * same reason the FND-06 baseline has mutation guards. A checker nobody has
 * seen reject anything is not a checker.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

import {
  CREDENTIAL_FREE_MODULES,
  CREDENTIAL_SPECIFIER_PATTERNS,
  FORBIDDEN_LEGACY_PATTERNS,
  isDependencyAllowed,
  isLegacyImportAllowed,
  isPublicEntry,
  moduleById,
  moduleForPath,
  type ModuleDeclaration,
  type ModuleId,
} from "./moduleBoundaries.js";

export interface SourceFile {
  /** Repo-relative, POSIX separators. */
  path: string;
  text: string;
}

export interface ImportEdge {
  from: string;
  /** The specifier exactly as written. */
  specifier: string;
  /** Repo-relative path when the specifier resolved to a file in the graph. */
  to: string | null;
  /**
   * Repo-relative path a relative specifier *points at*, whether or not the
   * file exists. Path-shaped rules (legacy, credentials) match on this so
   * "../../api/controllers/x.js" is recognised as `src/api/controllers/x.js`.
   */
  normalizedPath: string | null;
  /** True for bare package specifiers such as "zod" or "googleapis". */
  external: boolean;
}

export interface ImportGraph {
  files: readonly SourceFile[];
  edges: readonly ImportEdge[];
  edgesByFile: ReadonlyMap<string, ImportEdge[]>;
}

export type ViolationKind =
  | "undeclared-dependency"
  | "upward-dependency"
  | "internal-import"
  | "credential-dependency"
  | "forbidden-legacy"
  | "undeclared-legacy-dependency"
  | "adapter-escape"
  | "evaluation-imported";

export interface Violation {
  kind: ViolationKind;
  from: string;
  to: string;
  message: string;
}

/* -------------------------------------------------------------------------- */
/* reading source                                                              */
/* -------------------------------------------------------------------------- */

const SOURCE_EXTENSIONS = [".ts", ".js", ".mts", ".cts"];
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".git"]);

function toPosix(value: string): string {
  return value.split(sep).join(posix.sep);
}

function walk(rootDir: string, current: string, out: string[]): void {
  for (const entry of readdirSync(current)) {
    if (SKIPPED_DIRECTORIES.has(entry)) continue;

    const absolute = join(current, entry);
    if (statSync(absolute).isDirectory()) {
      walk(rootDir, absolute, out);
      continue;
    }

    if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
      out.push(toPosix(relative(rootDir, absolute)));
    }
  }
}

/**
 * Collect every source file under `roots` (repo-relative directories) plus any
 * individual `extraFiles`, e.g. the process entry point.
 */
export function collectSourceFiles(
  rootDir: string,
  roots: readonly string[],
  extraFiles: readonly string[] = [],
): SourceFile[] {
  const paths: string[] = [];
  for (const root of roots) walk(rootDir, join(rootDir, root), paths);
  paths.push(...extraFiles);

  return paths
    .sort()
    .map((path) => ({ path, text: readFileSync(join(rootDir, path), "utf8") }));
}

/* -------------------------------------------------------------------------- */
/* extracting imports                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Blank out comments and string bodies before matching imports, so prose in a
 * module's own documentation cannot be mistaken for an edge. Characters are
 * replaced rather than removed to keep offsets meaningful while scanning.
 */
function stripCommentsAndStrings(text: string): string {
  const out: string[] = [];
  let index = 0;

  while (index < text.length) {
    const character = text[index];
    const next = text[index + 1];

    if (character === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") {
        out.push(" ");
        index += 1;
      }
      continue;
    }

    if (character === "/" && next === "*") {
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
        out.push(text[index] === "\n" ? "\n" : " ");
        index += 1;
      }
      out.push(" ", " ");
      index += 2;
      continue;
    }

    if (character === "`") {
      // Template literals never carry an import specifier we care about.
      out.push("`");
      index += 1;
      while (index < text.length && text[index] !== "`") {
        out.push(text[index] === "\n" ? "\n" : " ");
        index += 1;
      }
      out.push("`");
      index += 1;
      continue;
    }

    out.push(character ?? "");
    index += 1;

    // Quoted strings are preserved verbatim: they are where specifiers live.
    if (character === '"' || character === "'") {
      while (index < text.length && text[index] !== character) {
        if (text[index] === "\\") {
          out.push(text[index] ?? "", text[index + 1] ?? "");
          index += 2;
          continue;
        }
        out.push(text[index] ?? "");
        index += 1;
      }
      out.push(text[index] ?? "");
      index += 1;
    }
  }

  return out.join("");
}

const SPECIFIER_PATTERNS = [
  /\bimport\s+type\s+[\s\S]*?\s+from\s*["']([^"']+)["']/g,
  /\bimport\s+[\s\S]*?\s+from\s*["']([^"']+)["']/g,
  /\bexport\s+[\s\S]*?\s+from\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];

export function extractSpecifiers(text: string): string[] {
  const source = stripCommentsAndStrings(text);
  const found = new Set<string>();

  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match) {
      if (match[1]) found.add(match[1]);
      match = pattern.exec(source);
    }
  }

  return [...found];
}

/* -------------------------------------------------------------------------- */
/* resolving                                                                   */
/* -------------------------------------------------------------------------- */

function normalizeRelative(fromPath: string, specifier: string): string {
  return posix.normalize(posix.join(posix.dirname(fromPath), specifier));
}

function resolveRelative(
  fromPath: string,
  specifier: string,
  known: ReadonlySet<string>,
): string | null {
  const base = normalizeRelative(fromPath, specifier);

  // NodeNext sources import "./x.js" even when the file on disk is "./x.ts".
  const candidates = base.endsWith(".js")
    ? [base.replace(/\.js$/, ".ts"), base]
    : base.endsWith(".ts")
    ? [base]
    : [
      `${base}.ts`,
      `${base}.js`,
      `${base}/index.ts`,
      `${base}/index.js`,
      base,
    ];

  return candidates.find((candidate) => known.has(candidate)) ?? null;
}

export function buildImportGraph(files: readonly SourceFile[]): ImportGraph {
  const known = new Set(files.map((file) => file.path));
  const edges: ImportEdge[] = [];
  const edgesByFile = new Map<string, ImportEdge[]>();

  for (const file of files) {
    const fileEdges: ImportEdge[] = [];

    for (const specifier of extractSpecifiers(file.text)) {
      const external = !specifier.startsWith(".");
      const edge: ImportEdge = {
        from: file.path,
        specifier,
        to: external ? null : resolveRelative(file.path, specifier, known),
        normalizedPath: external ? null : normalizeRelative(file.path, specifier),
        external,
      };
      fileEdges.push(edge);
      edges.push(edge);
    }

    edgesByFile.set(file.path, fileEdges);
  }

  return { files, edges, edgesByFile };
}

/* -------------------------------------------------------------------------- */
/* cycles                                                                      */
/* -------------------------------------------------------------------------- */

function detectCycles<T>(
  nodes: readonly T[],
  neighbours: (node: T) => readonly T[],
  key: (node: T) => string,
): T[][] {
  const cycles: T[][] = [];
  const state = new Map<string, "visiting" | "done">();
  const stack: T[] = [];
  const seenCycles = new Set<string>();

  const visit = (node: T): void => {
    const id = key(node);
    const status = state.get(id);

    if (status === "done") return;
    if (status === "visiting") {
      const start = stack.findIndex((entry) => key(entry) === id);
      const cycle = stack.slice(start).concat(node);
      const signature = cycle.map(key).join(" -> ");
      if (!seenCycles.has(signature)) {
        seenCycles.add(signature);
        cycles.push(cycle);
      }
      return;
    }

    state.set(id, "visiting");
    stack.push(node);
    for (const neighbour of neighbours(node)) visit(neighbour);
    stack.pop();
    state.set(id, "done");
  };

  for (const node of nodes) visit(node);
  return cycles;
}

/** Import cycles between files, restricted to files owned by a V2 module. */
export function findFileCycles(graph: ImportGraph): string[][] {
  const v2Files = graph.files
    .map((file) => file.path)
    .filter((path) => moduleForPath(path) !== null);
  const v2Set = new Set(v2Files);

  return detectCycles(
    v2Files,
    (path) =>
      (graph.edgesByFile.get(path) ?? [])
        .map((edge) => edge.to)
        .filter((target): target is string => target !== null && v2Set.has(target)),
    (path) => path,
  );
}

/** Import cycles between V2 modules (a cycle of length two is A ↔ B). */
export function findModuleCycles(graph: ImportGraph): ModuleId[][] {
  const adjacency = new Map<ModuleId, Set<ModuleId>>();

  for (const edge of graph.edges) {
    if (!edge.to) continue;
    const from = moduleForPath(edge.from);
    const to = moduleForPath(edge.to);
    if (!from || !to || from.id === to.id) continue;

    const targets = adjacency.get(from.id) ?? new Set<ModuleId>();
    targets.add(to.id);
    adjacency.set(from.id, targets);
  }

  const ids = [...new Set(graph.files
    .map((file) => moduleForPath(file.path)?.id)
    .filter((id): id is ModuleId => id !== undefined))];

  return detectCycles(
    ids,
    (id) => [...(adjacency.get(id) ?? [])],
    (id) => id,
  );
}

/* -------------------------------------------------------------------------- */
/* boundary rules                                                              */
/* -------------------------------------------------------------------------- */

function matchesAny(specifier: string, patterns: readonly string[]): string | null {
  return patterns.find((pattern) => specifier.includes(pattern)) ?? null;
}

function describe(module: ModuleDeclaration): string {
  return `${module.id} (L${module.layer})`;
}

export function findViolations(graph: ImportGraph): Violation[] {
  const violations: Violation[] = [];
  const adapters = moduleById("toolAdapters");
  const tools = moduleById("tools");

  for (const edge of graph.edges) {
    const fromModule = moduleForPath(edge.from);

    // Credential and legacy rules are checked on the raw specifier so a bare
    // package import ("googleapis") is caught alongside a relative one.
    if (fromModule && CREDENTIAL_FREE_MODULES.includes(fromModule.id)) {
      const pattern = matchesAny(edge.specifier, CREDENTIAL_SPECIFIER_PATTERNS);
      if (pattern) {
        violations.push({
          kind: "credential-dependency",
          from: edge.from,
          to: edge.specifier,
          message:
            `${describe(fromModule)} must not reach credentials directly; ` +
            `"${edge.specifier}" matches "${pattern}". Go through the Tool Gateway.`,
        });
      }
    }

    if (fromModule) {
      const legacyTarget = edge.to ?? edge.normalizedPath ?? edge.specifier;
      const legacy = matchesAny(edge.specifier, FORBIDDEN_LEGACY_PATTERNS) ??
        matchesAny(legacyTarget, FORBIDDEN_LEGACY_PATTERNS);
      if (legacy) {
        violations.push({
          kind: "forbidden-legacy",
          from: edge.from,
          to: legacyTarget,
          message:
            `${describe(fromModule)} must not import legacy path "${legacy}". ` +
            "V2 modules are imported by the Express layer, not the reverse.",
        });
      }
    }

    if (!edge.to) continue;
    const toModule = moduleForPath(edge.to);

    if (!toModule) {
      // A V2 module reaching into the V1 codebase. Shared infrastructure is
      // fine; anything else has to be named in the module's legacyAllowlist, so
      // that "the agent imports GmailDataSource directly" is a decision someone
      // wrote down rather than an import someone autocompleted.
      if (
        fromModule &&
        edge.to.startsWith("src/") &&
        !isLegacyImportAllowed(fromModule, edge.to)
      ) {
        violations.push({
          kind: "undeclared-legacy-dependency",
          from: edge.from,
          to: edge.to,
          message:
            `${describe(fromModule)} may not import "${edge.to}". Use shared ` +
            "infrastructure (src/config, src/utils, src/database, src/schemas), " +
            `or add the prefix to ${fromModule.id}'s legacyAllowlist deliberately.`,
        });
      }
      continue;
    }

    // Nothing in the running system may depend on the evaluation harness.
    if (toModule.id === "evaluation" && fromModule?.id !== "evaluation") {
      violations.push({
        kind: "evaluation-imported",
        from: edge.from,
        to: edge.to,
        message:
          "The evaluation harness must not be reachable from the running system.",
      });
      continue;
    }

    // Adapters live below the gateway: only tools/** may reach them.
    if (
      toModule.id === adapters.id &&
      fromModule?.id !== adapters.id &&
      fromModule?.id !== tools.id
    ) {
      violations.push({
        kind: "adapter-escape",
        from: edge.from,
        to: edge.to,
        message:
          "Provider adapters sit below the Tool Gateway; reach them through " +
          "src/tools/index.ts so policy, redaction, and idempotency still apply.",
      });
      continue;
    }

    if (!fromModule) {
      // Legacy or entry-point code reaching into a V2 module: allowed, but only
      // through that module's declared public surface.
      if (!isPublicEntry(edge.to)) {
        violations.push({
          kind: "internal-import",
          from: edge.from,
          to: edge.to,
          message:
            `"${edge.to}" is internal to ${toModule.id}; import ` +
            `${toModule.publicEntries.join(" or ")} instead.`,
        });
      }
      continue;
    }

    if (fromModule.id === toModule.id) continue;

    if (!isDependencyAllowed(fromModule.id, toModule.id)) {
      const upward = toModule.layer > fromModule.layer;
      violations.push({
        kind: upward ? "upward-dependency" : "undeclared-dependency",
        from: edge.from,
        to: edge.to,
        message: upward
          ? `${describe(fromModule)} must not depend upward on ${describe(toModule)}.`
          : `${describe(fromModule)} → ${describe(toModule)} is not declared in ` +
            "moduleBoundaries.ts. Add the edge deliberately or remove the import.",
      });
      continue;
    }

    if (!isPublicEntry(edge.to)) {
      violations.push({
        kind: "internal-import",
        from: edge.from,
        to: edge.to,
        message:
          `"${edge.to}" is internal to ${toModule.id}; import ` +
          `${toModule.publicEntries.join(" or ")} instead.`,
      });
    }
  }

  return violations;
}

export function formatViolations(violations: readonly Violation[]): string {
  return violations
    .map((violation) => `  [${violation.kind}] ${violation.from} → ${violation.to}\n    ${violation.message}`)
    .join("\n");
}
