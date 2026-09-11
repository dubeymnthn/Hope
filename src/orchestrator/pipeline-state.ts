import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";

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
  lastUpdated: z.string()
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

  public loadState(): PipelineStateData {
    if (!existsSync(this.stateFilePath)) {
      const defaultState: PipelineStateData = {
        version: "1.0.0",
        milestones: {},
        stages: {},
        lastUpdated: new Date().toISOString()
      };
      this.saveState(defaultState);
      return defaultState;
    }

    try {
      const raw = readFileSync(this.stateFilePath, "utf-8");
      const parsed = JSON.parse(raw);
      return PipelineStateDataSchema.parse(parsed);
    } catch (err) {
      console.warn(`[PipelineStateManager] Corrupt or invalid state at ${this.stateFilePath}, initializing fresh state.`);
      const defaultState: PipelineStateData = {
        version: "1.0.0",
        milestones: {},
        stages: {},
        lastUpdated: new Date().toISOString()
      };
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
}
