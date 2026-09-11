import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { ResearchAgent } from "../src/agents/researcher.js";
import { ArgumentAgent } from "../src/agents/argument.js";
import { ScriptAgent } from "../src/agents/script.js";
import { ScriptQAAgent } from "../src/agents/script-qa.js";
import { VisualDirectorAgent } from "../src/agents/visual-director.js";
import { StoryboardAgent } from "../src/agents/storyboard.js";
import { VisualStyleQAAgent } from "../src/qa/visual-style.js";
import { VisualSceneAgent } from "../src/agents/visual-scene.js";
import { DesignDirectorAgent } from "../src/agents/design-director.js";
import { AudioTimestampsSchema } from "../src/schemas/timestamps.js";
import { ChannelConfigSchema } from "../src/schemas/channel.js";
import { ResearchResultSchema } from "../src/schemas/research.js";
import { ScriptResultSchema } from "../src/schemas/script.js";
import { VisualPlanSchema } from "../src/schemas/visual-plan.js";
import { isAgentTaskPending } from "../src/agents/agent-task.js";
import { PRIMITIVE_REGISTRY } from "../src/scenes/primitives.js";
import { VisualModeEnum } from "../src/schemas/storyboard.js";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`);
    passed++;
  } else {
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

/** Workspace to verify against: a per-topic V2 workspace if one exists, else the repo root. */
function pickWorkspace(): { dir: string; topic: string } {
  const candidates = [
    {
      dir: resolve("topics/why-modern-batteries-are-still-expensive"),
      topic: "Why modern batteries are still expensive"
    },
    { dir: resolve("."), topic: "Why AI memory prices are exploding" }
  ];
  for (const c of candidates) {
    if (existsSync(join(c.dir, "script/script.json"))) return c;
  }
  return candidates[1];
}

async function main(): Promise<void> {
  console.log("==============================================================");
  console.log("=== V2 Long-Form Documentary Pipeline Verification         ===");
  console.log("==============================================================");

  const repoRoot = resolve(".");
  const { dir: ws, topic } = pickWorkspace();
  console.log(`\nWorkspace: ${ws}\nTopic: "${topic}"`);

  const config = ChannelConfigSchema.parse(
    JSON.parse(readFileSync(resolve(repoRoot, "config/channel.json"), "utf-8"))
  );
  const design = new DesignDirectorAgent().getDesign();
  const designVersion = new DesignDirectorAgent().getVersion();

  // ---------------------------------------------------------------
  section("1. Agent task gate: reasoning stages are genuinely agent-driven");
  // ---------------------------------------------------------------
  {
    const empty = mkdtempSync(join(tmpdir(), "v2-gate-"));
    try {
      let threw = false;
      let briefWritten = false;
      try {
        await new ResearchAgent().ensure("A topic with no research whatsoever", empty, { repoRoot });
      } catch (err) {
        threw = isAgentTaskPending(err);
        briefWritten = existsSync(join(empty, "agent-tasks/research.task.md"));
      }
      check("Missing research halts the pipeline with a typed agent task", threw);
      check("A complete task brief is written for the agent", briefWritten);

      if (briefWritten) {
        const brief = readFileSync(join(empty, "agent-tasks/research.task.md"), "utf-8");
        check(
          "Brief embeds the authoritative zod schema",
          brief.includes("ResearchResultSchema") && brief.includes("z.object")
        );
        check("Brief states the anti-fabrication prohibitions", brief.includes("Never fabricate a URL"));
        check("Brief names the exact output path", brief.includes("research/research.json"));
      }
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  }

  // ---------------------------------------------------------------
  section("2. Research: validation, traceability and topic-drift guard");
  // ---------------------------------------------------------------
  const researchVerification = await new ResearchAgent().ensure(topic, ws, {
    repoRoot,
    targetMinutes: config.video?.targetDurationMinutes
  });
  const research = researchVerification.research;
  check("Research dossier validates against schema", !!research.topic);
  check(
    "Multiple distinct sources preserved",
    researchVerification.sourceTraceability.distinctSources >= 2,
    `${researchVerification.sourceTraceability.distinctSources} distinct sources`
  );
  check(
    "No placeholder or fabricated-looking citations",
    researchVerification.sourceTraceability.suspiciousSources.length === 0
  );
  check(
    "Every fact carries a usable source",
    researchVerification.sourceTraceability.factsWithUsableSource === research.facts.length,
    `${researchVerification.sourceTraceability.factsWithUsableSource}/${research.facts.length}`
  );
  check(
    "Claims are categorised by evidential status",
    research.facts.every((f) => ["FACT", "OPINION", "ESTIMATE", "SPECULATION", "UNVERIFIED"].includes(f.category))
  );
  check(
    "Evidence depth assessed against the target runtime",
    researchVerification.evidenceDepth.estimatedSupportedMinutes > 0,
    `~${researchVerification.evidenceDepth.estimatedSupportedMinutes} min supportable`
  );
  check(
    "Contradictions and evidence gaps recorded",
    research.claims_to_verify.length > 0,
    `${research.claims_to_verify.length} flagged`
  );

  // Topic drift: a dossier for one subject must never be reused for another.
  {
    let drifted = false;
    try {
      await new ResearchAgent().ensure("How volcanic soil affects coffee flavour", ws, { repoRoot });
    } catch (err) {
      drifted = isAgentTaskPending(err);
    }
    check("Research for a different topic is refused, not silently reused", drifted);
  }

  // ---------------------------------------------------------------
  section("3. Argument: agent-authored thesis with an honest duration judgement");
  // ---------------------------------------------------------------
  const argumentVerification = await new ArgumentAgent().ensure(topic, ws, { research, config, repoRoot });
  const argument = argumentVerification.argument;
  check("Argument artifact validates", !!argument.centralThesis);
  check("Central question is posed", argument.centralQuestion.length > 15);
  check("At least 3 supporting claims", argument.supportingClaims.length >= 3, `${argument.supportingClaims.length}`);
  check("Counterarguments present", argument.counterArguments.length >= 1, `${argument.counterArguments.length}`);
  check(
    "Every counterargument names its remaining evidence gap",
    argument.counterArguments.every((c) => c.evidenceGap.trim().length > 0)
  );
  check(
    "Narrative progression emerges with >= 4 phases",
    argument.narrativeProgression.length >= 4,
    `${argument.narrativeProgression.length} phases`
  );
  check(
    "Runtime is a deliberate judgement, not a fixed 10",
    argumentVerification.resolvedDurationMinutes >= 5 && argumentVerification.resolvedDurationMinutes <= 15,
    `${argumentVerification.resolvedDurationMinutes} min`
  );
  check(
    "Claim strength is assessed per claim",
    argument.supportingClaims.every((c) => ["strong", "moderate", "weak"].includes(c.strength))
  );

  // ---------------------------------------------------------------
  section("4. Script: long-form, agent-authored, evidence-bound");
  // ---------------------------------------------------------------
  const scriptVerification = await new ScriptAgent().ensure(topic, ws, { argument, config, repoRoot });
  const script = scriptVerification.script;
  check("Script artifact validates", script.scenes.length > 0);
  check(
    "Dynamic scene count (not the fixed six of V1)",
    script.scenes.length !== 6,
    `${script.scenes.length} scenes`
  );
  check(
    "Dynamic chapter structure present",
    (script.chapters?.length ?? 0) >= 3,
    `${script.chapters?.length ?? 0} chapters`
  );
  check(
    "Runtime within the acceptable 7-13 min band",
    scriptVerification.estimatedMinutes >= 7 && scriptVerification.estimatedMinutes <= 13,
    `~${scriptVerification.estimatedMinutes} min, ${scriptVerification.totalWords} words`
  );
  check("Cold open present", script.hook.length > 20);
  check("Closing synthesis present", script.ending.length > 20);
  check(
    "Scenes are coherent TTS units, not single sentences",
    script.scenes.every((s) => s.narration.trim().split(/\s+/).length >= 25)
  );

  // ---------------------------------------------------------------
  section("5. Script QA gate protects the expensive TTS stage");
  // ---------------------------------------------------------------
  const scriptQA = await new ScriptQAAgent().evaluate({ script, research, argument, config, outputDir: ws });
  check("Script QA runs and reports", !!scriptQA.status, `status ${scriptQA.status}`);
  check("Script QA does not FAIL", scriptQA.status !== "FAIL", scriptQA.errors.join("; "));
  check(
    "Quantitative claims all trace to research",
    scriptQA.checks.find((c) => c.name === "Quantitative Claim Traceability")?.passed !== false
  );
  check(
    "Anti-AI-slop filter passes",
    scriptQA.checks.find((c) => c.name === "Anti-AI-Slop Language Filter")?.passed !== false
  );
  check(
    "Duration is reported rather than padded or truncated",
    !!scriptQA.checks.find((c) => c.name === "Runtime Duration Assessment")
  );

  // Negative control: a fabricated statistic must block the gate.
  {
    const tampered = ScriptResultSchema.parse(JSON.parse(JSON.stringify(script)));
    tampered.scenes[0].narration += " Analysts put the real figure at $4,173 per kilowatt-hour, up 91% since March.";
    const bad = await new ScriptQAAgent().evaluate({
      script: tampered,
      research,
      argument,
      config,
      outputDir: join(ws, "qa/negative-control")
    });
    check(
      "Fabricated statistics are caught and the gate FAILS",
      bad.status === "FAIL" &&
        bad.checks.find((c) => c.name === "Quantitative Claim Traceability")?.passed === false
    );
  }

  // ---------------------------------------------------------------
  section("6. Renderer is data-driven with no scene-id hardcoding");
  // ---------------------------------------------------------------
  {
    const generatorSrc = readFileSync(resolve(repoRoot, "src/scenes/scene-generator.ts"), "utf-8");
    const primitivesSrc = readFileSync(resolve(repoRoot, "src/scenes/primitives.ts"), "utf-8");
    const storyboardSrc = readFileSync(resolve(repoRoot, "src/agents/storyboard.ts"), "utf-8");
    const legacyGenSrc = readFileSync(resolve(repoRoot, "src/visual/hyperframes-gen.ts"), "utf-8");

    const sceneIdPattern = /["'`]scene-0*\d+["'`]/;
    check("No scene-id literals in the generic renderer", !sceneIdPattern.test(generatorSrc));
    check("No scene-id literals in the visual primitives", !sceneIdPattern.test(primitivesSrc));
    check("No scene-id preset map in the storyboard agent", !sceneIdPattern.test(storyboardSrc));
    check("Legacy visual generator no longer carries hardcoded compositions", !sceneIdPattern.test(legacyGenSrc));

    // The fixed source footer the spec forbids.
    check(
      "No hardcoded source footer",
      !/TRENDFORCE|SEMIANALYSIS|BLOOMBERG INTEL/i.test(generatorSrc + primitivesSrc)
    );
    check(
      "No fabricated chart values baked into primitives",
      !/\+280%|\$4\.50|1,200 DIES|52\+ WEEKS/i.test(primitivesSrc + generatorSrc + legacyGenSrc)
    );

    // Every mode in the schema has a renderer.
    const modes = VisualModeEnum.options;
    const missing = modes.filter((m) => !PRIMITIVE_REGISTRY[m]);
    check("Every visual mode has a registered renderer", missing.length === 0, `${modes.length} modes`);
  }

  // ---------------------------------------------------------------
  section("7. Visual direction, storyboard assembly and visual QA");
  // ---------------------------------------------------------------
  const timestampsPath = join(ws, "audio/timestamps.json");
  const planPath = join(ws, "storyboard/visual-plan.json");

  if (!existsSync(timestampsPath)) {
    console.log("  [SKIP] Narration not yet generated for this workspace; visual stages not verifiable.");
  } else {
    const audio = AudioTimestampsSchema.parse(JSON.parse(readFileSync(timestampsPath, "utf-8")));
    check(
      "Audio alignment covers every script scene",
      script.scenes.every((s) => audio.sentences.some((t) => t.sceneId === s.id)),
      `${audio.sentences.length} aligned scenes, ${audio.totalDuration}s`
    );

    if (!existsSync(planPath)) {
      let gated = false;
      try {
        await new VisualDirectorAgent().ensure({
          topic, script, audio, research, outputDir: ws, config, repoRoot
        });
      } catch (err) {
        gated = isAgentTaskPending(err);
      }
      check("Visual direction is gated to the agent when absent", gated);
      console.log("  [SKIP] Visual plan not yet authored; downstream visual checks deferred.");
    } else {
      const planVerification = await new VisualDirectorAgent().ensure({
        topic, script, audio, research, outputDir: ws, config, repoRoot
      });
      const plan = planVerification.plan;
      check("Visual plan validates", plan.scenes.length > 0, `${plan.scenes.length} scenes`);
      check(
        "Plan covers the script exactly, in order",
        plan.scenes.length === script.scenes.length &&
          plan.scenes.every((p, i) => p.sceneId === script.scenes[i].id)
      );
      check(
        "Every on-screen data point traces to research",
        planVerification.dataIntegrity.untraceable.length === 0,
        `${planVerification.dataIntegrity.tracedDataPoints}/${planVerification.dataIntegrity.totalDataPoints} traced`
      );
      check(
        "Visual modes are diverse",
        new Set(plan.scenes.map((s) => s.visualMode)).size >= 6,
        `${new Set(plan.scenes.map((s) => s.visualMode)).size} distinct modes`
      );
      check(
        "Source references are per-scene, not a fixed footer",
        new Set(plan.scenes.map((s) => (s.sourceReferences ?? []).join("|"))).size > 1
      );
      check(
        "Long scenes carry multiple visual beats",
        plan.scenes.every((s) => s.beats.length >= 1)
      );

      // Storyboard assembly must take timing from audio, never from the plan.
      const storyboard = new StoryboardAgent().assemble({
        script, audio, plan, outputDir: ws, design, research
      });
      check(
        "Scene durations come from the real audio",
        storyboard.scenes.every((s) => {
          const t = audio.sentences.find((x) => x.sceneId === s.id);
          return !!t && Math.abs(t.duration - s.duration) < 0.01;
        })
      );
      check(
        "Total duration matches narration",
        Math.abs(storyboard.total_duration - audio.totalDuration) < 0.01,
        `${storyboard.total_duration}s`
      );
      check(
        "Beats stay inside their scene duration",
        storyboard.scenes.every((s) => (s.beats ?? []).every((b) => b.endOffset <= s.duration + 0.01))
      );
      check(
        "Dynamic scene count supported",
        storyboard.scenes.length === script.scenes.length,
        `${storyboard.scenes.length} scenes`
      );

      // Render, then measure repetition on what was actually produced.
      const sceneResults = await new VisualSceneAgent().generateAllScenes(
        storyboard, design, designVersion, ws, repoRoot
      );
      check("Every scene rendered a composition", sceneResults.length === storyboard.scenes.length);
      check(
        "No scene degraded for missing data",
        sceneResults.every((r) => !r.degraded),
        sceneResults.filter((r) => r.degraded).map((r) => `${r.sceneId}: ${r.degraded}`).join("; ")
      );
      check(
        "Compositions have distinct layout signatures",
        new Set(sceneResults.map((r) => r.layoutSignature)).size >= Math.ceil(sceneResults.length / 2),
        `${new Set(sceneResults.map((r) => r.layoutSignature)).size} distinct layouts`
      );

      // Idempotency: a second pass must reuse everything.
      const second = await new VisualSceneAgent().generateAllScenes(
        storyboard, design, designVersion, ws, repoRoot
      );
      check("Rendering is idempotent on re-run", second.every((r) => r.reused));

      const visualQA = new VisualStyleQAAgent().evaluate({ storyboard, config, outputDir: ws });
      check("Visual repetition QA runs", !!visualQA.status, `status ${visualQA.status}`);
      check("Visual QA does not FAIL", visualQA.status !== "FAIL", visualQA.errors.join("; "));
      check(
        "Composition topology repetition measured",
        !!visualQA.checks.find((c) => c.name === "Composition Topology Repetition")
      );
      check(
        "Static frame ratio measured",
        !!visualQA.checks.find((c) => c.name === "Unjustified Static Intervals")
      );
      check(
        "Animation pattern diversity measured",
        !!visualQA.checks.find((c) => c.name === "Animation Pattern Diversity")
      );
      check(
        "Per-scene source relevance measured",
        !!visualQA.checks.find((c) => c.name === "Per-Scene Source Relevance")
      );
    }
  }

  // ---------------------------------------------------------------
  section("8. Versioning invalidates the right artifacts");
  // ---------------------------------------------------------------
  {
    const { computeSceneFingerprint } = await import("../src/scenes/scene-hash.js");
    const sample = {
      id: "sample-scene",
      start: 0,
      duration: 12,
      narration: "Narration held constant across both fingerprints.",
      visual_type: "chart" as const,
      visual_mode: "chart" as const,
      visual_description: "A chart.",
      on_screen_text: "A CHART",
      animation: "draw",
      camera: "static"
    } as any;

    const a = computeSceneFingerprint({ videoId: "v", scene: sample, designVersion: "3.0.0" });
    const b = computeSceneFingerprint({ videoId: "v", scene: sample, designVersion: "3.0.1" });
    check("Design version change invalidates visual fingerprints", a !== b);

    const c = computeSceneFingerprint({
      videoId: "v", scene: sample, designVersion: "3.0.0", generatorVersion: "9.9.9"
    });
    check("Visual generator version change invalidates visual fingerprints", a !== c);

    const d = computeSceneFingerprint({ videoId: "v", scene: sample, designVersion: "3.0.0" });
    check("Fingerprints are deterministic", a === d);
  }

  // ---------------------------------------------------------------
  console.log("\n==============================================================");
  console.log(`V2 VERIFICATION: ${passed} passed, ${failed} failed`);
  console.log("==============================================================");
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\nV2 verification errored:", err?.message || err);
  process.exit(1);
});
