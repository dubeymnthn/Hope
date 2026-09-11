import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

/**
 * Agent Task Gate.
 *
 * The reasoning stages of this factory (research, argument, script, visual direction)
 * are performed by the Antigravity agent, NOT by TypeScript. TypeScript is forbidden
 * from synthesising the content of those artifacts (V2 spec section 37).
 *
 * This module is the contract boundary. When a reasoning artifact is absent or stale,
 * the gate:
 *   1. writes a complete, self-contained task brief the agent can execute,
 *   2. records `awaiting_agent` on the pipeline checkpoint,
 *   3. halts the pipeline with a typed error.
 *
 * The agent then performs the actual reasoning, writes the artifact, and the pipeline is
 * re-run: the gate validates the artifact and the pipeline proceeds. Nothing is fabricated
 * by TypeScript.
 */

export interface AgentTaskInput {
  label: string;
  path: string;
  /** Inline the file contents into the brief (use for small, essential artifacts). */
  inline?: boolean;
}

export interface AgentTaskSpec {
  /** Stage key, e.g. "research", "argument", "script", "visual-direction". */
  stage: string;
  title: string;
  mission: string;
  /** Path (relative to project dir) the agent must write. */
  artifactPath: string;
  /** Schema source files (relative to repo root) defining the output contract. */
  schemaFiles: string[];
  /** The exported zod schema name the artifact must satisfy. */
  schemaName: string;
  requirements: string[];
  prohibitions: string[];
  inputs: AgentTaskInput[];
  /** Extra key/value context surfaced to the agent (topic, target duration, etc). */
  context?: Record<string, string | number | boolean | undefined>;
  /** Reason the gate fired, e.g. "artifact missing" or "topic mismatch". */
  reason: string;
}

export class AgentTaskPendingError extends Error {
  public readonly stage: string;
  public readonly briefPath: string;
  public readonly artifactPath: string;

  constructor(params: { stage: string; briefPath: string; artifactPath: string; reason: string }) {
    super(
      [
        `[AGENT TASK PENDING: ${params.stage}] ${params.reason}`,
        "",
        `The Antigravity ${params.stage} agent must now perform this stage's reasoning.`,
        `  Task brief : ${params.briefPath}`,
        `  Write to   : ${params.artifactPath}`,
        "",
        "Read the brief, do the actual work, write the artifact, then re-run the pipeline.",
        "TypeScript must not author this artifact."
      ].join("\n")
    );
    this.name = "AgentTaskPendingError";
    this.stage = params.stage;
    this.briefPath = params.briefPath;
    this.artifactPath = params.artifactPath;
  }
}

export function isAgentTaskPending(err: unknown): err is AgentTaskPendingError {
  return err instanceof AgentTaskPendingError;
}

export class AgentTaskGate {
  private projectDir: string;
  private repoRoot: string;

  constructor(options?: { projectDir?: string; repoRoot?: string }) {
    this.projectDir = options?.projectDir ? resolve(options.projectDir) : process.cwd();
    this.repoRoot = options?.repoRoot ? resolve(options.repoRoot) : process.cwd();
  }

  public getBriefPath(stage: string): string {
    return join(this.projectDir, "agent-tasks", `${stage}.task.md`);
  }

  /**
   * Writes the task brief and halts the pipeline. Always throws.
   */
  public request(spec: AgentTaskSpec): never {
    const tasksDir = join(this.projectDir, "agent-tasks");
    mkdirSync(tasksDir, { recursive: true });

    const briefPath = this.getBriefPath(spec.stage);
    const artifactAbs = join(this.projectDir, spec.artifactPath);

    writeFileSync(briefPath, this.renderBrief(spec, artifactAbs), "utf-8");

    const machineSpec = {
      stage: spec.stage,
      status: "awaiting_agent",
      reason: spec.reason,
      artifactPath: spec.artifactPath,
      schemaName: spec.schemaName,
      schemaFiles: spec.schemaFiles,
      inputs: spec.inputs.map((i) => ({ label: i.label, path: i.path })),
      context: spec.context ?? {},
      requestedAt: new Date().toISOString()
    };
    writeFileSync(
      join(tasksDir, `${spec.stage}.task.json`),
      JSON.stringify(machineSpec, null, 2),
      "utf-8"
    );

    console.error(`\n[AGENT TASK] Stage "${spec.stage}" requires Antigravity reasoning.`);
    console.error(`[AGENT TASK] Reason: ${spec.reason}`);
    console.error(`[AGENT TASK] Brief written to: ${briefPath}`);

    throw new AgentTaskPendingError({
      stage: spec.stage,
      briefPath,
      artifactPath: artifactAbs,
      reason: spec.reason
    });
  }

  private readSchemaSource(relPath: string): string {
    const abs = resolve(this.repoRoot, relPath);
    if (!existsSync(abs)) return `// (schema file not found: ${relPath})`;
    return readFileSync(abs, "utf-8");
  }

  private renderBrief(spec: AgentTaskSpec, artifactAbs: string): string {
    const lines: string[] = [];
    const fence = "```";

    lines.push(`# AGENT TASK: ${spec.title}`);
    lines.push("");
    lines.push(`**Stage:** \`${spec.stage}\``);
    lines.push(`**Status:** \`awaiting_agent\``);
    lines.push(`**Gate reason:** ${spec.reason}`);
    lines.push(`**Requested at:** ${new Date().toISOString()}`);
    lines.push("");
    lines.push("> This brief was generated by the deterministic TypeScript pipeline.");
    lines.push("> The reasoning for this stage must be performed by the Antigravity agent.");
    lines.push("> TypeScript will only validate, hash and checkpoint the result.");
    lines.push("");

    lines.push("## Mission");
    lines.push("");
    lines.push(spec.mission.trim());
    lines.push("");

    if (spec.context && Object.keys(spec.context).length > 0) {
      lines.push("## Parameters");
      lines.push("");
      lines.push("| Key | Value |");
      lines.push("|---|---|");
      for (const [k, v] of Object.entries(spec.context)) {
        if (v === undefined) continue;
        lines.push(`| ${k} | ${String(v)} |`);
      }
      lines.push("");
    }

    lines.push("## Required output");
    lines.push("");
    lines.push(`Write valid JSON satisfying \`${spec.schemaName}\` to:`);
    lines.push("");
    lines.push(`${fence}text`);
    lines.push(spec.artifactPath);
    lines.push(fence);
    lines.push("");
    lines.push(`Absolute path: \`${artifactAbs}\``);
    lines.push("");

    lines.push("## Requirements");
    lines.push("");
    for (const r of spec.requirements) lines.push(`- ${r}`);
    lines.push("");

    lines.push("## Hard prohibitions");
    lines.push("");
    for (const p of spec.prohibitions) lines.push(`- ${p}`);
    lines.push("");

    if (spec.inputs.length > 0) {
      lines.push("## Inputs");
      lines.push("");
      for (const input of spec.inputs) {
        const abs = join(this.projectDir, input.path);
        const exists = existsSync(abs);
        lines.push(`### ${input.label}`);
        lines.push("");
        lines.push(`Path: \`${input.path}\`${exists ? "" : " **(missing)**"}`);
        lines.push("");
        if (input.inline && exists) {
          lines.push(`${fence}json`);
          lines.push(readFileSync(abs, "utf-8").trim());
          lines.push(fence);
          lines.push("");
        }
      }
    }

    lines.push("## Output contract (authoritative zod schema)");
    lines.push("");
    lines.push(
      `The artifact is parsed with \`${spec.schemaName}\`. Validation is strict: ` +
        "missing or mistyped fields reject the artifact and the pipeline halts again."
    );
    lines.push("");
    for (const sf of spec.schemaFiles) {
      lines.push(`<details><summary><code>${sf}</code></summary>`);
      lines.push("");
      lines.push(`${fence}typescript`);
      lines.push(this.readSchemaSource(sf).trim());
      lines.push(fence);
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }

    lines.push("## Completion protocol");
    lines.push("");
    lines.push("1. Perform the actual reasoning/research for this stage.");
    lines.push(`2. Write the JSON artifact to \`${spec.artifactPath}\`.`);
    lines.push("3. Re-run the pipeline. The gate validates the artifact and continues.");
    lines.push("");

    return lines.join("\n");
  }
}

/** Stable hash of an artifact file, used for checkpointing and downstream invalidation. */
export function hashArtifact(absPath: string): string {
  const raw = readFileSync(absPath, "utf-8");
  // Hash the canonical parsed form so formatting changes do not invalidate downstream work.
  try {
    return createHash("sha256").update(JSON.stringify(JSON.parse(raw))).digest("hex");
  } catch {
    return createHash("sha256").update(raw).digest("hex");
  }
}
