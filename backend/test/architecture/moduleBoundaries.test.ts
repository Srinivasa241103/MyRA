/**
 * FND-07 — the architectural test.
 *
 * Three things are checked, in this order:
 *
 *   1. The declaration itself is coherent — every module exists on disk, has a
 *      public surface, and the declared dependency graph is acyclic and never
 *      points upward.
 *   2. The real source agrees with it — no cycles, no undeclared edges, no
 *      internal imports across a boundary, no credential reachable from the
 *      agent/evidence/memory layers, no adapter reachable from outside the
 *      Tool Gateway.
 *   3. Each rule actually rejects a violation. Synthetic files carrying exactly
 *      the mistake a future package might make are fed through the same
 *      analyzer, and the expected violation must appear. Same reasoning as the
 *      FND-06 mutation guards: a checker that has never rejected anything is
 *      indistinguishable from one that cannot.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  buildImportGraph,
  collectSourceFiles,
  extractSpecifiers,
  findFileCycles,
  findModuleCycles,
  findViolations,
  formatViolations,
  type SourceFile,
  type Violation,
  type ViolationKind,
} from "../../architecture/importGraph.js";
import {
  CREDENTIAL_FREE_MODULES,
  isDependencyAllowed,
  moduleById,
  moduleForPath,
  V2_MODULES,
  type ModuleId,
} from "../../architecture/moduleBoundaries.js";

const BACKEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The real graph: everything under src/, plus the process entry point. */
const realGraph = buildImportGraph(
  collectSourceFiles(BACKEND_ROOT, ["src"], ["index.js"]),
);

/* -------------------------------------------------------------------------- */
/* 1. the declaration is coherent                                              */
/* -------------------------------------------------------------------------- */

test("every declared module exists and exposes a public surface", () => {
  for (const module of V2_MODULES) {
    assert.ok(
      existsSync(join(BACKEND_ROOT, module.directory)),
      `${module.id}: declared directory ${module.directory} does not exist`,
    );

    assert.ok(module.publicEntries.length > 0, `${module.id}: no public entry declared`);
    for (const entry of module.publicEntries) {
      assert.ok(
        existsSync(join(BACKEND_ROOT, entry)),
        `${module.id}: public entry ${entry} does not exist`,
      );
      assert.ok(
        entry.startsWith(`${module.directory}/`),
        `${module.id}: public entry ${entry} is outside the module`,
      );
    }
  }
});

test("the ten module boundaries the plan names are all declared", () => {
  const declaredDirectories = new Set(V2_MODULES.map((module) => module.directory));

  for (const name of [
    "agents",
    "freshness",
    "entities",
    "tools",
    "evidence",
    "actions",
    "memory",
    "connectors",
    "evaluation",
    "observability",
  ]) {
    assert.ok(
      declaredDirectories.has(`src/${name}`),
      `FND-07 requires a src/${name} module boundary`,
    );
  }
});

test("no declared dependency points upward", () => {
  for (const module of V2_MODULES) {
    for (const dependency of module.dependsOn) {
      const target = moduleById(dependency);
      assert.ok(
        target.layer <= module.layer,
        `${module.id} (L${module.layer}) declares a dependency on ` +
          `${target.id} (L${target.layer}) — that is an upward edge`,
      );
    }
  }
});

test("the declared dependency graph is acyclic", () => {
  const visiting = new Set<ModuleId>();
  const done = new Set<ModuleId>();
  const trail: ModuleId[] = [];

  const visit = (id: ModuleId): void => {
    if (done.has(id)) return;
    assert.ok(
      !visiting.has(id),
      `declared dependency cycle: ${[...trail, id].join(" -> ")}`,
    );

    visiting.add(id);
    trail.push(id);
    for (const dependency of moduleById(id).dependsOn) visit(dependency);
    trail.pop();
    visiting.delete(id);
    done.add(id);
  };

  for (const module of V2_MODULES) visit(module.id);
});

test("credential-free modules never declare a dependency on connectors", () => {
  for (const id of CREDENTIAL_FREE_MODULES) {
    assert.ok(
      !isDependencyAllowed(id, "connectors"),
      `${id} is declared credential-free but may depend on connectors`,
    );
  }

  // The one module that is allowed to: reaching a session is its job.
  assert.ok(isDependencyAllowed("toolAdapters", "connectors"));
});

test("paths resolve to the most specific module that owns them", () => {
  assert.equal(moduleForPath("src/agents/contracts/domain/run.ts")?.id, "contracts");
  assert.equal(moduleForPath("src/agents/nodes/supervisor.ts")?.id, "agents");
  assert.equal(moduleForPath("src/tools/adapters/gmail/send.ts")?.id, "toolAdapters");
  assert.equal(moduleForPath("src/tools/core/gateway.ts")?.id, "tools");
  assert.equal(moduleForPath("src/RAG/retrieval/retriever.ts"), null);
});

/* -------------------------------------------------------------------------- */
/* 2. the source agrees with the declaration                                   */
/* -------------------------------------------------------------------------- */

test("every relative import in src/ resolves to a real file", () => {
  const unresolved = realGraph.edges
    .filter((edge) => !edge.external && edge.to === null)
    .map((edge) => `${edge.from} -> ${edge.specifier}`);

  assert.deepEqual(
    unresolved,
    [],
    "an unresolvable import means the analysis below is running on a partial graph",
  );
});

test("V2 modules have no circular imports", () => {
  const fileCycles = findFileCycles(realGraph);
  assert.deepEqual(
    fileCycles.map((cycle) => cycle.join(" -> ")),
    [],
    "circular imports inside the V2 modules",
  );

  const moduleCycles = findModuleCycles(realGraph);
  assert.deepEqual(
    moduleCycles.map((cycle) => cycle.join(" -> ")),
    [],
    "circular dependencies between V2 modules",
  );
});

test("the source contains no module-boundary violations", () => {
  const violations = findViolations(realGraph);
  assert.equal(
    violations.length,
    0,
    violations.length > 0
      ? `module boundary violations:\n${formatViolations(violations)}`
      : "",
  );
});

test("agents, evidence, and memory cannot reach a credential", () => {
  const violations = findViolations(realGraph).filter(
    (violation) => violation.kind === "credential-dependency",
  );

  assert.deepEqual(violations, [], formatViolations(violations));
});

test("nothing outside the Tool Gateway imports a provider adapter", () => {
  const violations = findViolations(realGraph).filter(
    (violation) => violation.kind === "adapter-escape",
  );

  assert.deepEqual(violations, [], formatViolations(violations));
});

test("legacy code enters a V2 module only through its public surface", () => {
  const violations = findViolations(realGraph).filter(
    (violation) => violation.kind === "internal-import",
  );

  assert.deepEqual(violations, [], formatViolations(violations));
});

test("the existing application still reaches the V2 modules it needs", () => {
  // Guards the rewiring done in FND-07: if these edges vanish, the boot path or
  // the health endpoints stopped using the observability plane.
  const targets = realGraph.edges
    .filter((edge) => edge.to !== null)
    .map((edge) => `${edge.from} -> ${edge.to}`);

  for (const expected of [
    "index.js -> src/observability/index.ts",
    "src/app.js -> src/observability/index.ts",
    "src/api/routes/health.ts -> src/observability/index.ts",
    "src/database/foundation/agentRunRepository.ts -> src/agents/contracts/index.ts",
  ]) {
    assert.ok(targets.includes(expected), `expected edge missing: ${expected}`);
  }
});

/* -------------------------------------------------------------------------- */
/* 3. the rules reject violations                                              */
/* -------------------------------------------------------------------------- */

/** Analyze a synthetic tree alongside the real public entries it may import. */
function analyze(files: SourceFile[]): Violation[] {
  const publicEntries: SourceFile[] = V2_MODULES.flatMap((module) =>
    module.publicEntries.map((path) => ({ path, text: "export {};\n" }))
  );
  const supplied = new Set(files.map((file) => file.path));

  return findViolations(
    buildImportGraph([
      ...publicEntries.filter((entry) => !supplied.has(entry.path)),
      ...files,
    ]),
  );
}

function kinds(violations: readonly Violation[]): ViolationKind[] {
  return [...new Set(violations.map((violation) => violation.kind))].sort();
}

test("control: a compliant synthetic tree produces no violations", () => {
  const violations = analyze([
    {
      path: "src/agents/nodes/supervisor.ts",
      text: `import { gateway } from "../../tools/index.js";
             import type { AgentRun } from "../contracts/index.js";
             import { trace } from "../../observability/index.js";`,
    },
    {
      path: "src/tools/core/gateway.ts",
      text: `import { adapters } from "../adapters/index.js";
             import { ledger } from "../../evidence/index.js";`,
    },
    {
      path: "src/tools/adapters/gmail/sendEmail.ts",
      text: `import { getSession } from "../../../connectors/index.js";`,
    },
  ]);

  assert.deepEqual(violations, [], formatViolations(violations));
});

test("an agent importing googleapis is rejected", () => {
  const violations = analyze([
    {
      path: "src/agents/nodes/scheduler.ts",
      text: `import { google } from "googleapis";`,
    },
  ]);

  assert.deepEqual(kinds(violations), ["credential-dependency"]);
  assert.match(violations[0]?.message ?? "", /Tool Gateway/);
});

test("a memory module reading the credential repository is rejected", () => {
  const violations = analyze([
    {
      path: "src/memory/curator/curator.ts",
      text: `import { credentialRepository } from "../../database/credentialRepository.js";`,
    },
  ]);

  assert.deepEqual(kinds(violations), ["credential-dependency"]);
});

test("evidence reaching the OAuth service is rejected", () => {
  const violations = analyze([
    {
      path: "src/evidence/evidenceLedger.ts",
      text: `import { GoogleAuthService } from "../service/oauth/googleOAuthService.js";`,
    },
  ]);

  assert.deepEqual(kinds(violations), ["credential-dependency"]);
});

test("an agent reaching the connector layer directly is rejected", () => {
  const violations = analyze([
    {
      path: "src/agents/nodes/research.ts",
      text: `import { getSession } from "../../connectors/index.js";`,
    },
  ]);

  assert.ok(kinds(violations).includes("undeclared-dependency"));
});

test("a provider adapter calling back up into the gateway is rejected", () => {
  const violations = analyze([
    {
      path: "src/tools/adapters/mcp/slack.ts",
      text: `import { gateway } from "../../index.js";`,
    },
  ]);

  assert.deepEqual(kinds(violations), ["upward-dependency"]);
});

test("an agent importing a provider adapter directly is rejected", () => {
  const violations = analyze([
    {
      path: "src/agents/nodes/communication.ts",
      text: `import { gmailAdapter } from "../../tools/adapters/index.js";`,
    },
  ]);

  assert.deepEqual(kinds(violations), ["adapter-escape"]);
  assert.match(violations[0]?.message ?? "", /below the Tool Gateway/);
});

test("reaching into another module's internals is rejected", () => {
  const violations = analyze([
    {
      path: "src/agents/nodes/synthesis.ts",
      text: `import { ledger } from "../../evidence/evidenceLedger.js";`,
    },
    { path: "src/evidence/evidenceLedger.ts", text: "export const ledger = {};\n" },
  ]);

  assert.deepEqual(kinds(violations), ["internal-import"]);
  assert.match(violations[0]?.message ?? "", /src\/evidence\/index\.ts/);
});

test("a legacy file reaching into a module's internals is rejected", () => {
  const violations = analyze([
    {
      path: "src/api/controllers/agentController.js",
      text: `import { graph } from "../../agents/graph.js";`,
    },
    { path: "src/agents/graph.ts", text: "export const graph = {};\n" },
  ]);

  assert.deepEqual(kinds(violations), ["internal-import"]);
});

test("an agent importing a Google data source directly is rejected", () => {
  // The specifier matches no credential pattern and the path is not an Express
  // route, so only the legacy-allowlist rule stands between the agent and a
  // provider client that bypasses the gateway entirely.
  const violations = analyze([
    {
      path: "src/agents/nodes/fetch.ts",
      text: `import GmailDataSource from "../../service/sources/GmailDataSource.js";`,
    },
    { path: "src/service/sources/GmailDataSource.js", text: "export default class {}\n" },
  ]);

  assert.deepEqual(kinds(violations), ["undeclared-legacy-dependency"]);
  assert.match(violations[0]?.message ?? "", /legacyAllowlist/);
});

test("a tool adapter wrapping the existing RAG stack is allowed", () => {
  const violations = analyze([
    {
      path: "src/tools/adapters/rag/searchTool.ts",
      text: `import Retriever from "../../../RAG/retrieval/retriever.js";`,
    },
    { path: "src/RAG/retrieval/retriever.ts", text: "export default class {}\n" },
  ]);

  assert.deepEqual(violations, [], formatViolations(violations));
});

test("shared infrastructure stays open to every module", () => {
  const violations = analyze([
    {
      path: "src/freshness/freshnessContract.ts",
      text: `import { logger } from "../utils/logger.js";
             import { getPool } from "../config/dbConfig.js";`,
    },
    { path: "src/utils/logger.ts", text: "export const logger = {};\n" },
    { path: "src/config/dbConfig.ts", text: "export const getPool = () => null;\n" },
  ]);

  assert.deepEqual(violations, [], formatViolations(violations));
});

test("a V2 module importing the Express layer is rejected", () => {
  const violations = analyze([
    {
      path: "src/agents/nodes/run.ts",
      text: `import { chatController } from "../../api/controllers/chatController.js";`,
    },
  ]);

  assert.ok(kinds(violations).includes("forbidden-legacy"));
});

test("a V2 module importing the removed legacy agent graphs is rejected", () => {
  const violations = analyze([
    {
      path: "src/agents/nodes/route.ts",
      text: `import { intentRouter } from "../../agent/intentRouter.js";`,
    },
  ]);

  assert.ok(kinds(violations).includes("forbidden-legacy"));
});

test("the running system importing the evaluation harness is rejected", () => {
  const violations = analyze([
    {
      path: "src/agents/nodes/verify.ts",
      text: `import { judge } from "../../evaluation/index.js";`,
    },
  ]);

  assert.deepEqual(kinds(violations), ["evaluation-imported"]);
});

test("a cycle between two V2 modules is detected", () => {
  const graph = buildImportGraph([
    {
      path: "src/evidence/index.ts",
      text: `import { store } from "../memory/index.js";\nexport {};\n`,
    },
    {
      path: "src/memory/index.ts",
      text: `import { ledger } from "../evidence/index.js";\nexport {};\n`,
    },
  ]);

  const cycles = findModuleCycles(graph).map((cycle) => cycle.join(" -> "));
  assert.equal(cycles.length, 1);
  assert.match(cycles[0] ?? "", /evidence -> memory -> evidence|memory -> evidence -> memory/);
});

test("a cycle between two files inside one module is detected", () => {
  const graph = buildImportGraph([
    { path: "src/memory/curator.ts", text: `import { rank } from "./classifier.js";` },
    { path: "src/memory/classifier.ts", text: `import { curate } from "./curator.js";` },
  ]);

  assert.equal(findFileCycles(graph).length, 1);
  assert.deepEqual(findModuleCycles(graph), [], "a self-edge is not a module cycle");
});

/* -------------------------------------------------------------------------- */
/* the scanner itself                                                          */
/* -------------------------------------------------------------------------- */

test("import extraction covers every form the codebase uses", () => {
  const specifiers = extractSpecifiers(`
    import defaultExport from "./a.js";
    import { named, other as alias } from "./b.js";
    import type { OnlyAType } from "./c.js";
    import {
      multi,
      line,
    } from "./d.js";
    import "./side-effect.js";
    export { re } from "./e.js";
    export * from "./f.js";
    const lazy = await import("./g.js");
    const cjs = require("./h.js");
  `);

  assert.deepEqual(specifiers.sort(), [
    "./a.js",
    "./b.js",
    "./c.js",
    "./d.js",
    "./e.js",
    "./f.js",
    "./g.js",
    "./h.js",
    "./side-effect.js",
  ]);
});

test("prose and strings are not mistaken for imports", () => {
  const specifiers = extractSpecifiers(`
    /**
     * Never do: import { google } from "googleapis";
     */
    // import { bad } from "./commented-out.js";
    const message = \`import { x } from "./template.js"\`;
    import { real } from "./real.js";
  `);

  assert.deepEqual(specifiers, ["./real.js"]);
});
