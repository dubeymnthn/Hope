import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { hashArtifact } from "../agents/agent-task.js";
import { PipelineStateManager } from "./pipeline-state.js";
import { ProductionPhase } from "../schemas/production-state.js";
import { ScriptResult, ScriptResultSchema } from "../schemas/script.js";

function readOptionalScript(projectDir: string): ScriptResult | null {
  const abs = join(projectDir, "script/script.json");
  if (!existsSync(abs)) return null;
  try {
    return ScriptResultSchema.parse(JSON.parse(readFileSync(abs, "utf-8")));
  } catch {
    return null;
  }
}

/**
 * A human-review pause, not a failure — mirrors the existing `AgentTaskPendingError`
 * idiom (see CLAUDE.md V2.6): the pipeline is working correctly, it's just waiting on a
 * person instead of the Antigravity agent.
 */
export class ProductionGateError extends Error {
  public readonly phase: ProductionPhase;

  constructor(phase: ProductionPhase, reason: string) {
    super(`[PRODUCTION GATE: ${phase}] ${reason}`);
    this.name = "ProductionGateError";
    this.phase = phase;
  }
}

export function isProductionGate(err: unknown): err is ProductionGateError {
  return err instanceof ProductionGateError;
}

/** Combined content hash of the research artifacts a human can edit pre-approval. */
export function computeResearchStateHash(projectDir: string): string {
  const parts = ["research/evidence-graph.json", "research/research-questions.json"].map((rel) => {
    const abs = join(projectDir, rel);
    return existsSync(abs) ? hashArtifact(abs) : "missing";
  });
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export function computeScriptStateHash(projectDir: string): string {
  const abs = join(projectDir, "script/script.json");
  return existsSync(abs) ? hashArtifact(abs) : "missing";
}

/** Throws `ProductionGateError` unless research is approved at its current content. */
export function assertResearchApproved(state: PipelineStateManager, projectDir: string): void {
  const approvals = state.getApprovals();
  const liveHash = computeResearchStateHash(projectDir);
  if (!approvals.research || approvals.research.approvedArtifactHash !== liveHash) {
    state.setProductionPhase("RESEARCH_REVIEW");
    throw new ProductionGateError(
      "RESEARCH_REVIEW",
      approvals.research
        ? "Research changed since it was last approved. Re-review and approve it again before continuing to argument/script generation."
        : "Research is ready for review. Approve it in Documentary Studio (or pass --require-review off / --auto-approve) before continuing to argument/script generation."
    );
  }
}

/** Throws `ProductionGateError` unless script is approved AND no claim is flagged for provenance review. */
export function assertScriptApproved(state: PipelineStateManager, projectDir: string): void {
  const approvals = state.getApprovals();
  const liveHash = computeScriptStateHash(projectDir);
  if (!approvals.script || approvals.script.approvedArtifactHash !== liveHash) {
    state.setProductionPhase("SCRIPT_REVIEW");
    throw new ProductionGateError(
      "SCRIPT_REVIEW",
      approvals.script
        ? "Script changed since it was last approved. Re-review and approve it again before continuing to production."
        : "Script is ready for review. Approve it before continuing to production."
    );
  }

  const script = readOptionalScript(projectDir);
  const flagged: string[] = [];
  for (const scene of script?.scenes ?? []) {
    for (const claim of scene.scriptClaims ?? []) {
      if (claim.provenanceStatus === "PROVENANCE_REQUIRES_REVIEW") {
        flagged.push(`${scene.id}/${claim.scriptClaimId}`);
      }
    }
  }
  if (flagged.length > 0) {
    state.setProductionPhase("SCRIPT_REVIEW");
    throw new ProductionGateError(
      "SCRIPT_REVIEW",
      `${flagged.length} claim(s) require provenance review before the script can be approved: ${flagged.join(", ")}. ` +
        `Re-run claim validation, supply new evidence, or explicitly override with a justification.`
    );
  }
}
