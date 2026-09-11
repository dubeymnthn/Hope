import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface MetricEntry {
  timestamp: string;
  agent: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  estimatedCostUsd: number;
}

export interface MetricsSummary {
  totalCalls: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalDurationMs: number;
  totalEstimatedCostUsd: number;
  entries: MetricEntry[];
}

export class MetricsTracker {
  private static metricsPath: string = resolve(process.cwd(), "metrics/usage.json");

  public static setMetricsPath(path: string): void {
    this.metricsPath = path;
  }

  public static record(entry: Omit<MetricEntry, "timestamp" | "totalTokens">): void {
    try {
      const fullEntry: MetricEntry = {
        ...entry,
        totalTokens: entry.promptTokens + entry.completionTokens,
        timestamp: new Date().toISOString()
      };

      mkdirSync(dirname(this.metricsPath), { recursive: true });

      let data: MetricsSummary = {
        totalCalls: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        totalDurationMs: 0,
        totalEstimatedCostUsd: 0,
        entries: []
      };

      if (existsSync(this.metricsPath)) {
        try {
          data = JSON.parse(readFileSync(this.metricsPath, "utf-8"));
        } catch {
          // ignore parsing error and reset
        }
      }

      data.entries.push(fullEntry);
      data.totalCalls = data.entries.length;
      data.totalPromptTokens += fullEntry.promptTokens;
      data.totalCompletionTokens += fullEntry.completionTokens;
      data.totalTokens += fullEntry.totalTokens;
      data.totalDurationMs += fullEntry.durationMs;
      data.totalEstimatedCostUsd += fullEntry.estimatedCostUsd;

      writeFileSync(this.metricsPath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.warn("[METRICS] Failed to record usage metrics:", err);
    }
  }

  public static getSummary(): MetricsSummary {
    if (existsSync(this.metricsPath)) {
      try {
        return JSON.parse(readFileSync(this.metricsPath, "utf-8"));
      } catch {
        // ignore
      }
    }
    return {
      totalCalls: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalDurationMs: 0,
      totalEstimatedCostUsd: 0,
      entries: []
    };
  }
}
