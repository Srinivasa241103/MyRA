/**
 * FND-07 — the V2 module boundary, declared once.
 *
 * This file is the architecture. `test/architecture/moduleBoundaries.test.ts`
 * reads it, walks every import in `src/`, and fails the build when the code and
 * this declaration disagree. Nothing at runtime imports it, so the declaration
 * can never drift into being load-bearing for behaviour.
 *
 * The layering, top to bottom:
 *
 *   L5  evaluation                       offline harness; nothing may import it
 *   L4  agents                           the LangGraph runtime
 *   L3  actions                          proposal → approval → execute → receipt
 *   L2  tools                            the Tool Gateway
 *   L1  evidence, memory, entities, freshness, tools/adapters
 *   L0  contracts, connectors, observability
 *
 * A module may depend only on the modules named in its `dependsOn`. Layers are
 * carried alongside so the test can report a violation as "upward dependency"
 * rather than just "undeclared edge" — the two are different mistakes.
 *
 * Why the direction matters more than the folder names:
 *   - `connectors` sits at the bottom because it holds OAuth credentials. If
 *     `agents`, `evidence`, or `memory` could import it, a refresh token would
 *     be one autocomplete away from a prompt.
 *   - `tools/adapters` sits below `tools` because the gateway is where policy,
 *     redaction, and idempotency live. An adapter that could call the gateway
 *     could also route around it.
 *   - `agents/contracts` is layer 0 even though it lives inside `src/agents/`.
 *     Everything speaks that vocabulary; nothing should have to depend on the
 *     graph to do so.
 */

export type ModuleId =
  | "contracts"
  | "observability"
  | "connectors"
  | "freshness"
  | "entities"
  | "evidence"
  | "memory"
  | "toolAdapters"
  | "tools"
  | "actions"
  | "agents"
  | "evaluation";

export interface ModuleDeclaration {
  id: ModuleId;
  /** Repo-relative directory, POSIX separators, no trailing slash. */
  directory: string;
  layer: number;
  /**
   * Files outside the module may import only these paths. Everything else in
   * the directory is internal.
   */
  publicEntries: string[];
  /** The only V2 modules this one may import. */
  dependsOn: ModuleId[];
  /**
   * Legacy (non-module) `src/` prefixes this module may import, on top of the
   * shared infrastructure every module gets. Kept per-module and deliberately
   * short: this is where the V1 codebase is allowed to leak into V2, so each
   * entry should name the package that will eventually remove it.
   */
  legacyAllowlist?: string[];
  purpose: string;
  /** Package ids that will fill this module in, for the record. */
  populatedBy: string;
}

/**
 * Ordered bottom-up. `moduleForPath` matches the longest directory prefix, so
 * `src/agents/contracts` resolves to `contracts` and `src/agents/nodes` to
 * `agents` — order here is for readability only.
 */
export const V2_MODULES: readonly ModuleDeclaration[] = [
  {
    id: "contracts",
    directory: "src/agents/contracts",
    layer: 0,
    publicEntries: ["src/agents/contracts/index.ts"],
    dependsOn: [],
    purpose: "Shared flow and domain contracts; the vocabulary every module speaks.",
    populatedBy: "FND-01, FND-02",
  },
  {
    id: "observability",
    directory: "src/observability",
    layer: 0,
    publicEntries: ["src/observability/index.ts"],
    dependsOn: [],
    purpose: "Health plane today; tracing, metrics, and the action audit next.",
    populatedBy: "FND-05, OBS-01, OBS-02",
  },
  {
    id: "connectors",
    directory: "src/connectors",
    layer: 0,
    publicEntries: ["src/connectors/index.ts"],
    dependsOn: ["contracts", "observability"],
    purpose: "Connector installations, OAuth credentials, scopes, MCP sessions.",
    populatedBy: "CON-01…CON-05",
  },
  {
    id: "freshness",
    directory: "src/freshness",
    layer: 1,
    publicEntries: ["src/freshness/index.ts"],
    dependsOn: ["contracts", "observability"],
    purpose: "Deterministic live-vs-indexed decision, write-behind, hydration.",
    populatedBy: "FRS-01…FRS-03",
  },
  {
    id: "entities",
    directory: "src/entities",
    layer: 1,
    publicEntries: ["src/entities/index.ts"],
    dependsOn: ["contracts", "observability"],
    legacyAllowlist: ["src/RAG/retrieval"],
    purpose: "Cross-source entity resolution shared by retrieval, scheduling, memory.",
    populatedBy: "ENT-01",
  },
  {
    id: "evidence",
    directory: "src/evidence",
    layer: 1,
    publicEntries: ["src/evidence/index.ts"],
    dependsOn: ["contracts", "observability", "freshness", "entities"],
    purpose: "Evidence ledger and citation contract; normalization before synthesis.",
    populatedBy: "EVD-01…EVD-03",
  },
  {
    id: "memory",
    directory: "src/memory",
    layer: 1,
    publicEntries: ["src/memory/index.ts"],
    dependsOn: ["contracts", "observability", "evidence", "entities"],
    purpose: "STM, canonical long-term memory, curator, conflict resolution.",
    populatedBy: "MEM-01…MEM-09",
  },
  {
    id: "toolAdapters",
    directory: "src/tools/adapters",
    layer: 1,
    publicEntries: ["src/tools/adapters/index.ts"],
    dependsOn: ["contracts", "observability", "connectors"],
    legacyAllowlist: ["src/RAG", "src/service/sources", "src/service/normalizers"],
    purpose: "Provider implementations of the gateway's tool shape.",
    populatedBy: "TOL-02, CON-01…CON-05",
  },
  {
    id: "tools",
    directory: "src/tools",
    layer: 2,
    publicEntries: ["src/tools/index.ts"],
    dependsOn: [
      "contracts",
      "observability",
      "connectors",
      "toolAdapters",
      "evidence",
      "memory",
      "entities",
      "freshness",
    ],
    purpose: "The Tool Gateway: registry, policy, validation, evidence normalization.",
    populatedBy: "TOL-01…TOL-04",
  },
  {
    id: "actions",
    directory: "src/actions",
    layer: 3,
    publicEntries: ["src/actions/index.ts"],
    dependsOn: ["contracts", "observability", "tools", "evidence"],
    purpose: "Action proposals, approval binding, idempotent execution, receipts.",
    populatedBy: "CAL-05…CAL-08, COM-*",
  },
  {
    id: "agents",
    directory: "src/agents",
    layer: 4,
    publicEntries: ["src/agents/index.ts"],
    dependsOn: [
      "contracts",
      "observability",
      "tools",
      "actions",
      "evidence",
      "memory",
      "entities",
      "freshness",
    ],
    purpose: "Supervisor graph, nodes, capability subagents, deterministic policies.",
    populatedBy: "AGT-01…AGT-07",
  },
  {
    id: "evaluation",
    directory: "src/evaluation",
    layer: 5,
    publicEntries: ["src/evaluation/index.ts"],
    dependsOn: [
      "contracts",
      "observability",
      "agents",
      "actions",
      "tools",
      "evidence",
      "memory",
      "entities",
      "freshness",
    ],
    legacyAllowlist: ["src/RAG"],
    purpose: "Golden datasets, deterministic evaluators, semantic judges, runners.",
    populatedBy: "QLT-01…QLT-05",
  },
] as const;

/**
 * Modules that must never touch a credential, a provider SDK, or the connector
 * layer. `tools/adapters` is absent on purpose — reaching a session is its job.
 */
export const CREDENTIAL_FREE_MODULES: readonly ModuleId[] = [
  "agents",
  "contracts",
  "evidence",
  "memory",
  "entities",
  "freshness",
  "actions",
];

/**
 * Import specifiers that mean "this file can obtain a user's credentials".
 * Matched as substrings against the raw specifier, so both the package name and
 * the repo path forms are caught.
 */
export const CREDENTIAL_SPECIFIER_PATTERNS: readonly string[] = [
  "googleapis",
  "google-auth-library",
  "@google-cloud/local-auth",
  "credentialRepository",
  "service/oauth",
  "googleOAuthService",
];

/**
 * Legacy paths no V2 module may import. The first two are plan §14.4 ("do not
 * restore the old hard-coded Calendar and email graphs", "do not build new
 * routing on the legacy intent-category model"); the rest keep the V2 stack out
 * of the Express layer, which depends on it rather than the other way round.
 */
export const FORBIDDEN_LEGACY_PATTERNS: readonly string[] = [
  "src/agent/",
  "intentRouter",
  "src/api/controllers",
  "src/api/routes",
  "src/app.js",
];

/**
 * Shared infrastructure every module may use. These are not V2 modules and are
 * not layered — they are the platform the layering sits on. Anything under
 * `src/` that is neither a V2 module, nor listed here, nor in a module's own
 * `legacyAllowlist`, is off limits: that is what stops an agent from importing
 * `src/service/sources/GmailDataSource.js` and routing around the gateway.
 */
export const SHARED_INFRASTRUCTURE_PREFIXES: readonly string[] = [
  "src/config",
  "src/utils",
  "src/database",
  "src/schemas",
];

const MODULES_BY_DEPTH = [...V2_MODULES].sort(
  (left, right) => right.directory.length - left.directory.length,
);

/** The V2 module owning a repo-relative file path, or null for legacy code. */
export function moduleForPath(filePath: string): ModuleDeclaration | null {
  const normalized = filePath.replace(/\\/g, "/");

  return MODULES_BY_DEPTH.find((module) =>
    normalized === module.directory || normalized.startsWith(`${module.directory}/`)
  ) ?? null;
}

export function moduleById(id: ModuleId): ModuleDeclaration {
  const found = V2_MODULES.find((module) => module.id === id);
  if (!found) throw new Error(`Unknown module id: ${id}`);
  return found;
}

/** True when `importer` is allowed to import `target`, per the declaration. */
export function isDependencyAllowed(importer: ModuleId, target: ModuleId): boolean {
  if (importer === target) return true;
  return moduleById(importer).dependsOn.includes(target);
}

export function isPublicEntry(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return V2_MODULES.some((module) => module.publicEntries.includes(normalized));
}

export function isSharedInfrastructure(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return SHARED_INFRASTRUCTURE_PREFIXES.some((prefix) =>
    normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}

/** True when `module` may import the given non-module `src/` path. */
export function isLegacyImportAllowed(
  module: ModuleDeclaration,
  filePath: string,
): boolean {
  if (isSharedInfrastructure(filePath)) return true;

  const normalized = filePath.replace(/\\/g, "/");
  return (module.legacyAllowlist ?? []).some((prefix) =>
    normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}
