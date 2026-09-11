import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { ProductionPhaseEnum, ApprovalsSchema, RevisionCountersSchema } from "../schemas/production-state.js";

export const MilestoneStateSchema = z.object({
  status: z.enum(["pending", "in_progress", "complete", "failed"]),
  artifact: z.string().optional(),
  completedAt: z.string().optional(),
  artifactHash: z.string().optional(),
  validationVersion: z.string().optional(),
  metadata: z.record(z.any()).optional()
});

export type MilestoneState = z.infer<typeof MilestoneStateSchema>;

export const PipelineStateDataSchema = z.object({
  version: z.string().default("1.0.0"),
  milestones: z.record(MilestoneStateSchema).default({}),
  stages: z.record(z.string()).default({}),
  lastUpdated: z.string(),
  // --- V2.6: production phase / human-approval state (additive, see CLAUDE.md V2.6) ---
  productionPhase: ProductionPhaseEnum.default("RESEARCHING"),
  approvals: ApprovalsSchema.default({ research: null, script: null }),
  revisionCounters: RevisionCountersSchema.default({ research: 0, argument: 0, script: 0, design: 0 })
});

export type PipelineStateData = z.infer<typeof PipelineStateDataSchema>;

export class PipelineStateManager {
  private stateFilePath: string;

  constructor(filePath?: string) {
    this.stateFilePath = filePath ? resolve(filePath) : resolve(process.cwd(), "pipeline-state.json");
  }

  public getStateFilePath(): string {
    return this.stateFilePath;
  }

  private freshState(): PipelineStateData {
    // Parsing an (almost) empty object through the schema applies every field's `.default()`
    // in one place, so a new additive field never needs to be duplicated into a literal here.
    return PipelineStateDataSchema.parse({ lastUpdated: new Date().toISOString() });
  }

  public loadState(): PipelineStateData {
    if (!existsSync(this.stateFilePath)) {
      const defaultState = this.freshState();
      this.saveState(defaultState);
      return defaultState;
    }

    try {
      const raw = readFileSync(this.stateFilePath, "utf-8");
      const parsed = JSON.parse(raw);
      return PipelineStateDataSchema.parse(parsed);
    } catch (err) {
      console.warn(`[PipelineStateManager] Corrupt or invalid state at ${this.stateFilePath}, initializing fresh state.`);
      const defaultState = this.freshState();
      this.saveState(defaultState);
      return defaultState;
    }
  }

  public saveState(state: PipelineStateData): void {
    state.lastUpdated = new Date().toISOString();
    const dir = dirname(this.stateFilePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Atomic write pattern: write to temporary sibling file, then renameSync
    const tmpPath = `${this.stateFilePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    const payload = JSON.stringify(state, null, 2);

    writeFileSync(tmpPath, payload, "utf-8");
    renameSync(tmpPath, this.stateFilePath);
  }

  public getMilestone(name: string): MilestoneState | undefined {
    const state = this.loadState();
    return state.milestones[name];
  }

  public isMilestoneComplete(name: string): boolean {
    const milestone = this.getMilestone(name);
    return milestone?.status === "complete";
  }

  public setMilestone(name: string, data: MilestoneState): void {
    const state = this.loadState();
    state.milestones[name] = data;
    this.saveState(state);
  }

  // --- V2.6: production phase / human-approval state ---

  public getProductionPhase() {
    return this.loadState().productionPhase;
  }

  public setProductionPhase(phase: PipelineStateData["productionPhase"]): void {
    const state = this.loadState();
    state.productionPhase = phase;
    this.saveState(state);
  }

  public getApprovals() {
    return this.loadState().approvals;
  }

  /** Records an approval at the artifact's current content hash (see CLAUDE.md V2.6: hash-, not counter-based). */
  public approve(kind: "research" | "script", params: { approvedArtifactHash: string }): void {
    const state = this.loadState();
    state.approvals[kind] = {
      approvedAt: new Date().toISOString(),
      approvedArtifactHash: params.approvedArtifactHash,
      atRevision: state.revisionCounters[kind === "research" ? "research" : "script"]
    };
    this.saveState(state);
  }

  /** Invalidates a recorded approval without touching revision counters (e.g. an explicit re-review request). */
  public clearApproval(kind: "research" | "script"): void {
    const state = this.loadState();
    state.approvals[kind] = null;
    this.saveState(state);
  }

  public getRevisionCounters() {
    return this.loadState().revisionCounters;
  }

  public bumpRevision(kind: keyof PipelineStateData["revisionCounters"]): number {
    const state = this.loadState();
    state.revisionCounters[kind] += 1;
    this.saveState(state);
    return state.revisionCounters[kind];
  }
}
