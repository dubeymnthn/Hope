import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { StoryboardResult, VisualMode } from "../schemas/storyboard.js";
import { ChannelConfig } from "../schemas/channel.js";

export interface VisualQACheck {
  name: string;
  category: "diversity" | "anti_repetition" | "density" | "structural";
  passed: boolean;
  message: string;
  details?: any;
}

export interface VisualStyleQAReport {
  status: "PASS" | "WARN" | "FAIL";
  evaluatedAt: string;
  totalScenes: number;
  distinctVisualModes: number;
  checks: VisualQACheck[];
  errors: string[];
  warnings: string[];
}

export class VisualStyleQAAgent {
  public evaluate(params: {
    storyboard: StoryboardResult;
    config?: ChannelConfig;
    outputDir?: string;
  }): VisualStyleQAReport {
    const { storyboard, config, outputDir = process.cwd() } = params;
    console.log(`[VISUAL-QA] Auditing visual mode diversity and anti-slop layout repetition for ${storyboard.scenes.length} scenes...`);

    const checks: VisualQACheck[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    const scenes = storyboard.scenes;
    const maxConsecutive = config?.editorial?.maxConsecutiveSameVisualMode ?? 2;

    // 1. Max Consecutive Same Visual Mode Check
    let currentStreak = 1;
    let maxFoundStreak = 1;
    let offendingMode: string | null = null;

    for (let i = 1; i < scenes.length; i++) {
      const prevMode = scenes[i - 1].visual_mode || scenes[i - 1].visual_type;
      const currMode = scenes[i].visual_mode || scenes[i].visual_type;

      if (prevMode === currMode) {
        currentStreak++;
        if (currentStreak > maxFoundStreak) {
          maxFoundStreak = currentStreak;
          offendingMode = currMode;
        }
      } else {
        currentStreak = 1;
      }
    }

    const consecutivePass = maxFoundStreak <= maxConsecutive;
    checks.push({
      name: "Consecutive Visual Mode Limit",
      category: "anti_repetition",
      passed: consecutivePass,
      message: consecutivePass
        ? `No visual mode repeated more than ${maxConsecutive} times consecutively (max found: ${maxFoundStreak})`
        : `Visual mode "${offendingMode}" repeated ${maxFoundStreak} times consecutively (exceeds limit of ${maxConsecutive})`,
      details: { maxConsecutive, maxFoundStreak, offendingMode }
    });
    if (!consecutivePass) {
      warnings.push(`Consecutive visual mode repetition: "${offendingMode}" repeated ${maxFoundStreak} times`);
    }

    // 2. Visual Mode Diversity Check (min distinct modes)
    const distinctModes = new Set(scenes.map((s) => s.visual_mode || s.visual_type));
    const requiredDistinct = scenes.length >= 6 ? 4 : Math.max(2, Math.floor(scenes.length / 2));
    const diversityPass = distinctModes.size >= requiredDistinct;

    checks.push({
      name: "Visual Mode Palette Diversity",
      category: "diversity",
      passed: diversityPass,
      message: `Used ${distinctModes.size} distinct visual modes across ${scenes.length} scenes (minimum required: ${requiredDistinct})`,
      details: { distinctModes: Array.from(distinctModes), requiredDistinct }
    });
    if (!diversityPass) {
      errors.push(`Insufficient visual diversity: only ${distinctModes.size} distinct modes used (expected >= ${requiredDistinct})`);
    }

    // 3. Excessive Text-Only Scene Ratio
    const textOnlyScenes = scenes.filter((s) => {
      const mode = s.visual_mode || s.visual_type;
      return mode === "text" || mode === "large_typography";
    });
    const textRatio = textOnlyScenes.length / scenes.length;
    const textRatioPass = textRatio <= 0.40;

    checks.push({
      name: "Non-Text Visual Dominance",
      category: "density",
      passed: textRatioPass,
      message: `${Math.round((1 - textRatio) * 100)}% of scenes utilize substantive diagrams, charts, or comparisons (text-only: ${textOnlyScenes.length}/${scenes.length})`,
      details: { textOnlyScenesCount: textOnlyScenes.length, textRatio: Math.round(textRatio * 100) / 100 }
    });
    if (!textRatioPass) {
      warnings.push(`High ratio of text-only scenes (${Math.round(textRatio * 100)}% > 40%). Increase diagrams, timelines, or charts.`);
    }

    // 4. On-Screen Callout Conciseness (Anti-Wall-of-Text)
    const verboseHits = scenes.filter((s) => s.on_screen_text.split(/\s+/).length > 10);
    const concisenessPass = verboseHits.length === 0;
    checks.push({
      name: "Typographic Callout Impact",
      category: "density",
      passed: concisenessPass,
      message: concisenessPass ? "All on-screen typography hits are punchy and concise (<= 10 words)" : `${verboseHits.length} scenes have overly wordy on-screen text callouts`,
      details: { verboseCount: verboseHits.length }
    });
    if (!concisenessPass) {
      warnings.push(`${verboseHits.length} scenes have excessively long on-screen text callouts`);
    }

    // 5. Verification of Compositions on Disk
    const missingComps: string[] = [];
    for (const scene of scenes) {
      const compPath = join(outputDir, "compositions", `${scene.id}.html`);
      if (!existsSync(compPath) || statSync(compPath).size < 200) {
        missingComps.push(scene.id);
      }
    }
    const compFilesPass = missingComps.length === 0;
    checks.push({
      name: "Composition Artifact Presence",
      category: "structural",
      passed: compFilesPass,
      message: compFilesPass ? `All ${scenes.length} HTML composition artifacts present and populated` : `Missing composition files for: ${missingComps.join(", ")}`,
      details: { missingComps }
    });
    if (!compFilesPass) {
      errors.push(`Missing composition artifacts on disk: ${missingComps.join(", ")}`);
    }

    const status: "PASS" | "WARN" | "FAIL" = errors.length > 0 ? "FAIL" : warnings.length > 0 ? "WARN" : "PASS";

    const report: VisualStyleQAReport = {
      status,
      evaluatedAt: new Date().toISOString(),
      totalScenes: scenes.length,
      distinctVisualModes: distinctModes.size,
      checks,
      errors,
      warnings
    };

    // Save report files
    const qaDir = join(outputDir, "qa");
    mkdirSync(qaDir, { recursive: true });
    writeFileSync(join(qaDir, "visual-style-report.json"), JSON.stringify(report, null, 2), "utf-8");

    const mdLines = [
      `# Visual Style & Anti-Repetition QA Report`,
      ``,
      `**Overall Status:** \`${report.status}\` | **Total Scenes:** ${scenes.length} | **Distinct Modes:** ${distinctModes.size}`,
      `*Evaluated at:* ${report.evaluatedAt}`,
      ``,
      `## Verification Matrix`,
      `| Category | Check | Status | Details |`,
      `|---|---|---|---|`,
      ...checks.map((c) => `| ${c.category.toUpperCase()} | ${c.name} | ${c.passed ? "✅ PASS" : "⚠️ WARN"} | ${c.message} |`),
      ``,
      ...(errors.length > 0 ? [`## Critical Errors`, ...errors.map((e) => `- ❌ ${e}`), ``] : []),
      ...(warnings.length > 0 ? [`## Style Warnings`, ...warnings.map((w) => `- ⚠️ ${w}`), ``] : [])
    ];
    writeFileSync(join(qaDir, "visual-style-report.md"), mdLines.join("\n"), "utf-8");

    console.log(`[VISUAL-QA] Visual QA finished with status: ${status} (${errors.length} errors, ${warnings.length} warnings).`);
    return report;
  }
}
