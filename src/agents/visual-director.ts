import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VisualPlan, VisualPlanSchema, VisualPlanScene } from "../schemas/visual-plan.js";
import { ResearchResult } from "../schemas/research.js";
import { ScriptResult } from "../schemas/script.js";
import { AudioTimestamps } from "../schemas/timestamps.js";
import { ChannelConfig } from "../schemas/channel.js";
import { VisualEvidenceMap } from "../schemas/visual-evidence-map.js";
import { EvidenceGraph } from "../schemas/evidence-graph.js";
import { ProjectDesignStrategy } from "../schemas/design-strategy.js";
import { resolveDesignForScene } from "../design/design-resolver.js";
import { AgentTaskGate, hashArtifact } from "./agent-task.js";

export interface VisualPlanVerification {
  plan: VisualPlan;
  artifactHash: string;
  dataIntegrity: {
    totalDataPoints: number;
    tracedDataPoints: number;
    untraceable: string[];
  };
}

/** Normalises a numeric-ish string for traceability comparison. */
function normalizeValue(v: string): string {
  return v.toLowerCase().replace(/[\s,_]/g, "").replace(/[$]/g, "").trim();
}

/**
 * Visual Direction stage.
 *
 * The Antigravity Visual Director reasons over research, argument, script, the real audio
 * alignment and the channel design, and authors storyboard/visual-plan.json. TypeScript
 * then renders that specification deterministically.
 *
 * This class requests the plan, validates it against the script and the real audio, and
 * enforces that every on-screen data point traces back to the research dossier.
 */
export class VisualDirectorAgent {
  public async ensure(params: {
    topic: string;
    script: ScriptResult;
    audio: AudioTimestamps;
    research: ResearchResult;
    outputDir?: string;
    config?: ChannelConfig;
    repoRoot?: string;
    /** V2.3: recommended visual modes per claim, when the visual-evidence-map stage has run. */
    visualEvidenceMap?: VisualEvidenceMap;
    /** V2.3: when supplied, dataPoints[].claimId/sourceId are checked against real graph ids. */
    evidenceGraph?: EvidenceGraph;
    /** V2.6: editorial/visual PREFERENCE only (never facts) — see design-strategy.ts. */
    designStrategy?: ProjectDesignStrategy | null;
  }): Promise<VisualPlanVerification> {
    const { topic, script, audio, research, config, visualEvidenceMap, evidenceGraph, designStrategy } = params;
    const outputDir = params.outputDir ?? process.cwd();

    const storyboardDir = join(outputDir, "storyboard");
    const planPath = join(storyboardDir, "visual-plan.json");
    const gate = new AgentTaskGate({ projectDir: outputDir, repoRoot: params.repoRoot });

    // Surface the real per-scene durations so the director can place beats truthfully.
    mkdirSync(storyboardDir, { recursive: true });
    const timingPath = join(storyboardDir, "scene-timing.json");
    const timing = audio.sentences.map((s) => ({
      sceneId: s.sceneId,
      start: s.start,
      duration: s.duration,
      narration: s.text
    }));
    writeFileSync(timingPath, JSON.stringify({ totalDuration: audio.totalDuration, scenes: timing }, null, 2), "utf-8");

    // V2.6: TypeScript resolves global->chapter->scene design overrides deterministically
    // (same "prepare deterministic context for the agent" role as scene-timing.json above)
    // rather than asking the agent to re-derive override precedence itself.
    let resolvedDesignPath: string | undefined;
    if (designStrategy) {
      resolvedDesignPath = join(storyboardDir, "resolved-design-by-scene.json");
      const resolved = Object.fromEntries(
        script.scenes.map((s) => [s.id, resolveDesignForScene(designStrategy, s.chapter, s.id)])
      );
      writeFileSync(resolvedDesignPath, JSON.stringify(resolved, null, 2), "utf-8");
    }

    if (!existsSync(planPath)) {
      this.requestPlan(gate, topic, script, config, "storyboard/visual-plan.json does not exist yet.", visualEvidenceMap, !!designStrategy);
    }

    let validated: VisualPlan;
    try {
      validated = VisualPlanSchema.parse(JSON.parse(readFileSync(planPath, "utf-8")));
    } catch (err: any) {
      this.requestPlan(
        gate,
        topic,
        script,
        config,
        `Existing storyboard/visual-plan.json is invalid and was rejected: ${err.message}`,
        visualEvidenceMap,
        !!designStrategy
      );
    }

    const plan = validated!;

    // --- Structural validation against the script ---
    const scriptIds = script.scenes.map((s) => s.id);
    const planIds = plan.scenes.map((s) => s.sceneId);
    const missing = scriptIds.filter((id) => !planIds.includes(id));
    const extra = planIds.filter((id) => !scriptIds.includes(id));

    if (missing.length > 0 || extra.length > 0) {
      this.requestPlan(
        gate,
        topic,
        script,
        config,
        `Visual plan does not cover the script exactly.` +
          (missing.length ? ` Missing scenes: ${missing.join(", ")}.` : "") +
          (extra.length ? ` Unknown scenes: ${extra.join(", ")}.` : ""),
        visualEvidenceMap,
        !!designStrategy
      );
    }

    // --- Data integrity: no fabricated chart data (spec section 22) ---
    const researchValues = new Set<string>();
    const researchMetrics: string[] = [];
    for (const stat of research.statistics) {
      researchValues.add(normalizeValue(stat.value));
      researchMetrics.push(stat.metric.toLowerCase());
    }
    // Numbers appearing in fact statements are also legitimate provenance.
    for (const fact of research.facts) {
      for (const m of fact.statement.matchAll(/[-+]?\$?\d[\d,.]*\s?(?:%|percent|x|bn|billion|m|million|k|weeks?|days?|months?|years?|nm|gb|tb)?/gi)) {
        researchValues.add(normalizeValue(m[0]));
      }
    }

    const untraceable: string[] = [];
    let totalDataPoints = 0;
    let tracedDataPoints = 0;

    for (const scene of plan.scenes) {
      for (const dp of scene.dataPoints ?? []) {
        totalDataPoints++;
        const nv = normalizeValue(dp.value);
        const valueTraced =
          researchValues.has(nv) ||
          Array.from(researchValues).some((rv) => rv.length > 1 && (rv.includes(nv) || nv.includes(rv)));
        const metricTraced = researchMetrics.some(
          (rm) => rm.includes(dp.metric.toLowerCase()) || dp.metric.toLowerCase().includes(rm)
        );

        if (valueTraced || metricTraced) {
          tracedDataPoints++;
        } else {
          untraceable.push(`${scene.sceneId}: "${dp.metric}" = "${dp.value}"`);
        }
      }
    }

    if (untraceable.length > 0) {
      throw new Error(
        `[VISUAL DIRECTOR] Chart data integrity FAILED: ${untraceable.length} on-screen data point(s) ` +
          `cannot be traced to research/research.json. The renderer must never display invented data ` +
          `(spec section 22). Either correct these values, cite the supporting research, or choose a ` +
          `visual mode that does not require chart data.\n` +
          untraceable.map((u) => `  - ${u}`).join("\n")
      );
    }

    // --- V2.3: when an evidence graph is available, a dataPoint that SETS claimId/sourceId
    // must resolve into a real graph id (the fields stay optional; this only fires when the
    // director actually used them, so it never affects a plan authored before V2.3 existed). ---
    if (evidenceGraph) {
      const graphClaimIds = new Set(evidenceGraph.claims.map((c) => c.claimId));
      const graphSourceIds = new Set(evidenceGraph.sources.map((s) => s.sourceId));
      const unresolvedIds: string[] = [];
      for (const scene of plan.scenes) {
        for (const dp of scene.dataPoints ?? []) {
          if (dp.claimId && !graphClaimIds.has(dp.claimId)) {
            unresolvedIds.push(`${scene.sceneId}: dataPoint "${dp.metric}" has unknown claimId "${dp.claimId}"`);
          }
          if (dp.sourceId && !graphSourceIds.has(dp.sourceId)) {
            unresolvedIds.push(`${scene.sceneId}: dataPoint "${dp.metric}" has unknown sourceId "${dp.sourceId}"`);
          }
        }
      }
      if (unresolvedIds.length > 0) {
        throw new Error(
          `[VISUAL DIRECTOR] Chart data integrity FAILED: ${unresolvedIds.length} dataPoint(s) cite a ` +
            `claimId/sourceId that does not exist in research/evidence-graph.json.\n` +
            unresolvedIds.map((u) => `  - ${u}`).join("\n")
        );
      }
    }

    console.log(`[VISUAL-DIRECTOR] Verified visual plan for "${plan.topic}"`);
    console.log(`  - Visual thesis: ${plan.visualThesis}`);
    console.log(`  - Scenes planned: ${plan.scenes.length}`);
    console.log(`  - Distinct visual modes: ${new Set(plan.scenes.map((s) => s.visualMode)).size}`);
    console.log(`  - Total visual beats: ${plan.scenes.reduce((a, s) => a + s.beats.length, 0)}`);
    console.log(`  - On-screen data points traced to research: ${tracedDataPoints}/${totalDataPoints}`);

    return {
      plan,
      artifactHash: hashArtifact(planPath),
      dataIntegrity: { totalDataPoints, tracedDataPoints, untraceable }
    };
  }

  private requestPlan(
    gate: AgentTaskGate,
    topic: string,
    script: ScriptResult,
    config: ChannelConfig | undefined,
    reason: string,
    visualEvidenceMap?: VisualEvidenceMap,
    hasDesignStrategy?: boolean
  ): never {
    const maxConsecutive = config?.editorial?.maxConsecutiveSameVisualMode ?? 2;
    const visualEvidenceGuidance = visualEvidenceMap
      ? `\n\nA visual evidence map has already reasoned about the best way to show each major claim's ` +
        `evidence (visual-evidence/visual-evidence-map.json, attached below). Treat its \`visualMode\`/` +
        `\`visualPurpose\`/\`rationale\` recommendations as authoritative guidance for the matching ` +
        `scenes, unless a scene's real narration genuinely calls for something else.`
      : "";
    const designGuidance = hasDesignStrategy
      ? `\n\nA project design strategy has been interpreted from this project's design.md ` +
        `(storyboard/resolved-design-by-scene.json, attached below — already resolved global -> ` +
        `chapter -> scene per scene, the most specific value per field). Treat it as editorial ` +
        `PREFERENCE only: it may steer which \`visualMode\`/pacing/camera/caption choices you make for ` +
        `a scene, but it never introduces a fact, number or claim, and it never overrides a hard ` +
        `evidentiary requirement above.`
      : "";

    return gate.request({
      stage: "visual-direction",
      title: `Visual direction for "${topic}"`,
      reason,
      artifactPath: "storyboard/visual-plan.json",
      schemaName: "VisualPlanSchema",
      schemaFiles: ["src/schemas/visual-plan.ts", "src/schemas/storyboard.ts"],
      mission:
        `Direct the visuals for this documentary. You decide WHAT each scene should show and why; ` +
        `TypeScript then renders your specification deterministically with HTML/CSS/SVG/GSAP.\n\n` +
        `Work from the argument, the script, the research and the REAL audio timings in ` +
        `storyboard/scene-timing.json. Every scene in the script needs exactly one entry, using ` +
        `the same scene ids, in order.\n\n` +
        `Aim for the visual language of investigative journalism and high-quality technical ` +
        `explainers: purposeful diagrams, charts, timelines, comparisons, cross-sections, ` +
        `supply-chain flows, evidence documents, restrained motion, strong composition and clear ` +
        `visual hierarchy. Every element on screen must communicate something.\n\n` +
        `Give longer scenes multiple beats so the frame evolves with the narration. Place beats ` +
        `using the real scene durations, and let timing be editorial rather than a subtitle-driven ` +
        `slideshow.${visualEvidenceGuidance}${designGuidance}`,
      context: {
        topic,
        sceneCount: script.scenes.length,
        maxConsecutiveSameVisualMode: maxConsecutive,
        sceneIds: script.scenes.map((s) => s.id).join(", ")
      },
      requirements: [
        "Cover every script scene exactly once, using the script's scene ids, in order.",
        "Choose `visualMode` from the schema enum so it carries that scene's actual meaning.",
        `Do not use the same visual mode more than ${maxConsecutive} times consecutively.`,
        "Across the documentary, use a genuinely diverse set of modes suited to the content.",
        "Populate the mode's supporting data: diagramNodes/diagramEdges for diagrams and flows, timelineEvents for timelines, comparisonSides for comparisons, dataPoints for charts.",
        "Every dataPoint value must come from research/research.json; cite claimId and sourceId.",
        "Set `sourceReferences` per scene to ONLY the sources relevant to that scene; leave it empty when none apply.",
        "Define beats within each scene's real duration from storyboard/scene-timing.json.",
        "Give longer scenes (over ~12s) several beats so the visual state progresses.",
        "Keep `onScreenText` to a punchy 3-6 words, or empty when typography would add nothing.",
        "Write `visualThesis` explaining how the visual language serves this specific argument.",

        // --- V2.2: beats follow meaning, not a clock (spec §9-§12) ---
        "Every beat must CHANGE THE VIEWER'S REASON TO LOOK. Set `changeType` to the editorial function it performs: establish, reveal, transform, compare, zoom, pan, highlight, build, remove, reframe, resolve or transition.",
        "Set `narrationReference` on each beat to the narration idea it answers. Move the visual when the narration moves: abstract->concrete becomes more concrete; a comparison compares; cause->effect reveals the causal link; a contradiction shows both sides; scale communicates scale; a consequence reveals the consequence; a resolved question delivers the payoff.",
        "Name each beat's `visualState` so successive beats are distinguishable states, not restatements of one image.",
        "Set `focus.primary` on every beat to the single element the eye lands on first; use `focus.secondary` and `focus.supporting` so nothing competes. If a viewer could not say what matters, the beat has failed.",
        "Prefer progressive construction across a scene: establish -> context -> transform -> reveal -> compare -> consequence -> resolve. Do not maximise cut count; maximise information per visual state.",
        "Typical beat lengths run 2-4s, 5-8s, 8-12s or 12-18s. A beat longer than ~15s, or any `hold`, requires `holdJustification` explaining why the viewer needs the time (dense information, reading time, deliberate atmosphere, anticipation before a reveal).",
        "Treat the first 30 seconds as a special system: it must establish a strong fact, a contradiction, a surprising number or an unanswered question with visible progression. No title cards, logo animation or slow decorative setup.",
        "Narration may lead or trail a visual change. Do not force every visual transition onto a sentence boundary; let visual continuity sometimes carry the viewer into the next idea.",
        "Vary chapter openings and closings; do not reuse one opening composition for every chapter."
      ],
      prohibitions: [
        "Never invent a statistic, value, or chart series that research does not support.",
        "Never attach a source footer listing sources unrelated to that scene.",
        "Never display a confidence percentage; confidence is not a rendered quantity.",
        "Never rely on neon glow, HUD frames, fake telemetry, decorative particles or meaningless gradients for meaning.",
        "Never repeat one layout, animation pattern or composition across the documentary.",
        "Never specify a chart when the underlying data does not exist: choose another mode instead.",
        "Never place a beat outside its scene's real duration.",
        "Never leave the composition visually static for 20-30 seconds without an explicit `holdJustification`; an unexplained static screen is a presentation deck, not a documentary.",
        "Never add decorative motion that carries no semantic change.",
        "Never write two consecutive beats whose `visualState` is the same image restated."
      ],
      inputs: [
        { label: "Script (narration and scene ids)", path: "script/script.json", inline: true },
        { label: "Editorial argument", path: "argument/argument.json", inline: true },
        { label: "Research dossier (the only permitted data source)", path: "research/research.json", inline: true },
        { label: "REAL audio timings per scene (authoritative)", path: "storyboard/scene-timing.json", inline: true },
        ...(visualEvidenceMap ? [{ label: "Visual evidence map (recommended modes per claim)", path: "visual-evidence/visual-evidence-map.json", inline: true }] : []),
        ...(hasDesignStrategy ? [{ label: "Resolved design preference per scene (editorial only, never facts)", path: "storyboard/resolved-design-by-scene.json", inline: true }] : []),
        { label: "Channel visual design tokens", path: "design/channel-design.json" }
      ]
    });
  }
}
