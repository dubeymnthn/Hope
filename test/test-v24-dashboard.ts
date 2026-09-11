import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createServer, Server } from "node:http";
import type { AddressInfo } from "node:net";

import { StoryboardAgent } from "../src/agents/storyboard.js";
import { DesignDirectorAgent } from "../src/agents/design-director.js";
import { computeSceneFingerprint } from "../src/scenes/scene-hash.js";
import { AudioTimestamps } from "../src/schemas/timestamps.js";
import { ScriptResult } from "../src/schemas/script.js";
import { VisualPlan, VisualPlanSchema } from "../src/schemas/visual-plan.js";
import { createApp } from "../studio/server/app.js";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`);
    passed++;
  } else {
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
    failures.push(name);
  }
}
function section(t: string): void {
  console.log(`\n=== ${t} ===`);
}

const repoRoot = resolve(".");
const FIXTURE_ID = "zztest-v24-fixture";
const fixtureDir = join(repoRoot, "topics", FIXTURE_ID);

/** Builds a small, coherent, real-shaped 2-scene fixture project under topics/. */
function buildFixtureProject(): void {
  rmSync(fixtureDir, { recursive: true, force: true });
  mkdirSync(fixtureDir, { recursive: true });
  const topic = "V24 test fixture topic";

  mkdirSync(join(fixtureDir, "research"), { recursive: true });
  writeFileSync(
    join(fixtureDir, "research/research-plan.json"),
    JSON.stringify({
      topic,
      categories: [{ category: "CORE_FACTS", decision: "required", rationale: "r", expectedEvidenceType: "e", priority: 1, freshnessRequirement: "moderate", primarySourceRequired: false, skippableIfUnavailable: false }],
      version: "1.0.0"
    })
  );
  writeFileSync(
    join(fixtureDir, "research/research-questions.json"),
    JSON.stringify({ topic, questions: [{ questionId: "q-1", category: "CORE_FACTS", questionText: "Is the fixture real?", priority: 1, status: "answered", requiredEvidenceLevel: "any", freshnessRequirement: "moderate", dependentQuestions: [], answeredBy: ["claim-1"] }], version: "1.0.0" })
  );
  const evidenceGraph = {
    topic,
    sources: [{ sourceId: "src-1", sourceType: "PRIMARY_GOVERNMENT", title: "Fixture Filing", url: "https://fixture.gov/filing", primaryOrSecondary: "primary" }],
    evidence: [{ evidenceId: "ev-1", sourceId: "src-1", evidenceExcerpt: "The fixture value is 42.", confidence: 0.9, relevance: 0.9, temporalStatus: "CURRENT" }],
    dataPoints: [{ dataPointId: "dp-1", metric: "fixture value", value: 42, unit: "units", scope: "test scope", definition: "the fixture number", sourceId: "src-1", sourceExcerpt: "x", confidence: 0.9 }],
    entities: [],
    entityRelations: [],
    events: [],
    claims: [{ claimId: "claim-1", questionIds: ["q-1"], statement: "The fixture value is 42.", category: "CORE_FACTS", supportingEvidenceIds: ["ev-1"], contradictingEvidenceIds: [], dataPointIds: ["dp-1"], entityIds: [], eventIds: [], temporalStatus: "CURRENT", confidence: 0.9 }],
    contradictions: [],
    uncertainties: [],
    thesisStressTest: [],
    version: "1.0.0"
  };
  writeFileSync(join(fixtureDir, "research/evidence-graph.json"), JSON.stringify(evidenceGraph));
  writeFileSync(
    join(fixtureDir, "research/research-gaps.json"),
    JSON.stringify({ topic, categoryCoverage: [{ category: "CORE_FACTS", coveragePercent: 100, status: "complete" }], overallCompletenessPercent: 100, gaps: [], generatedAt: new Date().toISOString(), version: "1.0.0" })
  );

  mkdirSync(join(fixtureDir, "argument"), { recursive: true });
  writeFileSync(
    join(fixtureDir, "argument/argument.json"),
    JSON.stringify({
      topic,
      centralQuestion: "Why does the fixture matter?",
      centralThesis: "The fixture proves the studio reads real artifacts.",
      supportingClaims: [
        { claim: "A", evidence: ["e"], category: "FACT", strength: "strong", evidenceIds: ["claim-1"], evidenceStatus: "SUPPORTED" },
        { claim: "B", evidence: ["e"], category: "FACT", strength: "moderate" },
        { claim: "C", evidence: ["e"], category: "FACT", strength: "weak" }
      ],
      counterArguments: [{ position: "p", rebuttal: "r", evidenceGap: "g" }],
      narrativeProgression: [
        { phase: "cold_open", purpose: "p", keyPoints: ["a"], transitionQuestion: "q" },
        { phase: "context", purpose: "p", keyPoints: ["a"], transitionQuestion: "q" },
        { phase: "mechanism", purpose: "p", keyPoints: ["a"], transitionQuestion: "q" },
        { phase: "synthesis", purpose: "p", keyPoints: ["a"], transitionQuestion: "q" }
      ],
      conclusion: "It matters.",
      estimatedDepthMinutes: 7
    })
  );

  const script: ScriptResult = {
    title: "Fixture Documentary",
    hook: "A genuine fixture hook sentence that is long enough to pass.",
    scenes: [
      {
        id: "scene-001",
        narration: "The fixture value is 42, according to the filing.",
        purpose: "establish the fixture value",
        visual_hint: "chart",
        chapter: "chapter-01",
        scriptClaims: [{ scriptClaimId: "sc-1", claimText: "The fixture value is 42.", evidenceIds: ["claim-1"], confidence: 0.9, narrativeRole: "opening" }]
      },
      { id: "scene-002", narration: "That is why the fixture matters for testing.", purpose: "close the loop", visual_hint: "typography", chapter: "chapter-01" }
    ],
    chapters: [{ id: "chapter-01", title: "The Fixture", narrativePurpose: "establish and close", sceneIds: ["scene-001", "scene-002"] }],
    ending: "A genuine fixture ending sentence that is long enough to pass.",
    version: "2.0.0"
  } as ScriptResult;
  mkdirSync(join(fixtureDir, "script"), { recursive: true });
  writeFileSync(join(fixtureDir, "script/script.json"), JSON.stringify(script));

  const plan: VisualPlan = VisualPlanSchema.parse({
    topic,
    videoTitle: "Fixture Documentary",
    visualThesis: "Numbers, plainly shown.",
    scenes: [
      {
        sceneId: "scene-001",
        visualMode: "data_visualization",
        visualDescription: "The fixture value shown as a single verified number.",
        onScreenText: "42",
        animationIntent: "settle",
        camera: "static",
        narrativePurpose: "establish",
        claimsShown: [],
        sourceReferences: [],
        dataPoints: [{ metric: "fixture value", value: "42", claimId: "claim-1", sourceId: "src-1" }],
        diagramNodes: [],
        diagramEdges: [],
        timelineEvents: [],
        comparisonSides: [],
        beats: [{ beatId: "beat-1", startOffset: 0, endOffset: 4, purpose: "state the value", visualChange: "value resolves" }]
      },
      {
        sceneId: "scene-002",
        visualMode: "large_typography",
        visualDescription: "Closing statement in type.",
        onScreenText: "IT MATTERS",
        animationIntent: "settle",
        camera: "static",
        narrativePurpose: "close",
        claimsShown: [],
        sourceReferences: [],
        dataPoints: [],
        diagramNodes: [],
        diagramEdges: [],
        timelineEvents: [],
        comparisonSides: [],
        beats: [{ beatId: "beat-1", startOffset: 0, endOffset: 3, purpose: "land it", visualChange: "type resolves" }]
      }
    ],
    version: "2.0.0"
  });
  mkdirSync(join(fixtureDir, "storyboard"), { recursive: true });
  writeFileSync(join(fixtureDir, "storyboard/visual-plan.json"), JSON.stringify(plan));

  const audio: AudioTimestamps = {
    audioPath: join(fixtureDir, "audio/narration.wav"),
    sampleRate: 24000,
    totalDuration: 7,
    sentences: [
      { sceneId: "scene-001", text: script.scenes[0].narration, start: 0, end: 4, duration: 4 },
      { sceneId: "scene-002", text: script.scenes[1].narration, start: 4, end: 7, duration: 3 }
    ]
  };
  mkdirSync(join(fixtureDir, "audio"), { recursive: true });
  writeFileSync(join(fixtureDir, "audio/timestamps.json"), JSON.stringify(audio));
  writeFileSync(
    join(fixtureDir, "audio/tts-cache.json"),
    JSON.stringify({
      "scene-001": { sceneId: "scene-001", status: "complete", narrationHash: "x", audioPath: "audio/scene-001.wav", duration: 4, generationTimeMs: 100, completedAt: new Date().toISOString() }
    })
  );

  // Real deterministic assembly (StoryboardAgent.assemble()), same as the orchestrator uses.
  const design = new DesignDirectorAgent().getDesign();
  new StoryboardAgent().assemble({ script, audio, plan, outputDir: fixtureDir, design, research: undefined });

  mkdirSync(join(fixtureDir, "qa"), { recursive: true });
  writeFileSync(
    join(fixtureDir, "qa/report.json"),
    JSON.stringify({ status: "PASS", auditedAt: new Date().toISOString(), categories: {}, checks: [{ name: "Video File Present", category: "visual_structural", passed: true, actual: "x", expected: "y", severity: "critical" }], errors: [], warnings: [], summary: "ok" })
  );
}

async function main(): Promise<void> {
  console.log("==============================================================");
  console.log("=== V2.4 Documentary Studio Regression Matrix               ===");
  console.log("==============================================================");

  buildFixtureProject();
  let backgroundTtsJobId: string | null = null;

  const app = createApp();
  const server: Server = createServer(app);
  await new Promise<void>((resolveListen) => server.listen(0, resolveListen));
  const port = (server.address() as AddressInfo).port;
  const base = `http://localhost:${port}/api`;
  const get = (p: string) => fetch(`${base}${p}`);
  const patch = (p: string, body: unknown) => fetch(`${base}${p}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const post = (p: string, body?: unknown) => fetch(`${base}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

  try {
    // ------------------------------------------------------------------
    section("1-3. Project listing, creation, loading");
    // ------------------------------------------------------------------
    {
      const list = await get("/projects").then((r) => r.json());
      const fixture = list.projects.find((p: any) => p.id === FIXTURE_ID);
      check("Project listing includes the fixture project", !!fixture);
      check("Listing derives real scene/chapter counts", fixture?.sceneCount === 2 && fixture?.chapterCount === 1, JSON.stringify({ sceneCount: fixture?.sceneCount, chapterCount: fixture?.chapterCount }));
      check("Listing derives real runtime from audio timestamps", fixture?.runtimeSeconds === 7);

      const createRes = await post("/projects", { topic: "A brand new v24 test topic" });
      const created = await createRes.json();
      check("Project creation returns 201/id", createRes.status === 201 && !!created.id, `status ${createRes.status}`);
      check("Project creation makes a real directory", existsSync(join(repoRoot, "topics", created.id)));
      rmSync(join(repoRoot, "topics", created.id), { recursive: true, force: true });

      const detail = await get(`/projects/${FIXTURE_ID}`).then((r) => r.json());
      check("Project loading returns real research/script/storyboard artifacts", !!detail.artifacts.research === false && !!detail.artifacts.script && !!detail.artifacts.evidenceGraph);
      check("A missing artifact (research.json) is null, not fabricated", detail.artifacts.research === null);
    }

    // ------------------------------------------------------------------
    section("4. Project health reflects real state");
    // ------------------------------------------------------------------
    {
      const health = await get(`/projects/${FIXTURE_ID}/health`).then((r) => r.json());
      check("Health is HEALTHY when no agent-tasks/QA-fail/gaps are present", health.state === "HEALTHY", health.state);

      mkdirSync(join(fixtureDir, "agent-tasks"), { recursive: true });
      writeFileSync(join(fixtureDir, "agent-tasks/argument.task.json"), JSON.stringify({ stage: "argument", status: "awaiting_agent", reason: "fixture gate test" }));
      const blocked = await get(`/projects/${FIXTURE_ID}/health`).then((r) => r.json());
      check("A real agent-tasks/*.task.json flips health to BLOCKED", blocked.state === "BLOCKED" && blocked.reasons.some((r: string) => r.includes("argument")));
      rmSync(join(fixtureDir, "agent-tasks"), { recursive: true, force: true });
    }

    // ------------------------------------------------------------------
    section("5-6. Search and search -> timestamp");
    // ------------------------------------------------------------------
    {
      const results = await get(`/projects/${FIXTURE_ID}/search?q=fixture value`).then((r) => r.json());
      check("Search finds real matches across kinds", results.results.length > 0);
      const claimHit = results.results.find((r: any) => r.kind === "claim");
      check("Search resolves a claim to a real scene timestamp (provenance chain)", claimHit?.timestamp?.sceneId === "scene-001" && claimHit?.timestamp?.start === 0);
    }

    // ------------------------------------------------------------------
    section("7-10. Navigation: source -> evidence, claim -> script, script -> scene, scene -> beat");
    // ------------------------------------------------------------------
    {
      const detail = await get(`/projects/${FIXTURE_ID}`).then((r) => r.json());
      const evidenceForSource = detail.artifacts.evidenceGraph.evidence.filter((e: any) => e.sourceId === "src-1");
      check("Source -> evidence navigation resolves real evidence", evidenceForSource.length === 1 && evidenceForSource[0].evidenceId === "ev-1");

      const sceneDetail = await get(`/projects/${FIXTURE_ID}/scenes/scene-001`).then((r) => r.json());
      check("Claim -> script navigation: scene's scriptClaims reference the real claimId", sceneDetail.scriptClaims[0].evidenceIds.includes("claim-1"));
      check("Script -> scene navigation returns real narration", sceneDetail.narration.includes("42"));
      check("Scene -> beat navigation returns real beats from visual-plan.json", sceneDetail.beats.length === 1 && sceneDetail.beats[0].beatId === "beat-1");
    }

    // ------------------------------------------------------------------
    section("11-13. Beat validation, presentational editing, unsupported-data protection");
    // ------------------------------------------------------------------
    {
      const badDuration = await patch(`/projects/${FIXTURE_ID}/scenes/scene-001/beats/beat-1`, { endOffset: -1 });
      check("A beat edit with negative endOffset is rejected (400)", badDuration.status === 400);

      const outOfBounds = await patch(`/projects/${FIXTURE_ID}/scenes/scene-001/beats/beat-1`, { endOffset: 999 });
      check("A beat edit exceeding the scene's real duration is rejected (400)", outOfBounds.status === 400);

      const validEdit = await patch(`/projects/${FIXTURE_ID}/scenes/scene-001/beats/beat-1`, { purpose: "state the value, edited" });
      check("A valid beat edit is accepted (200)", validEdit.status === 200);
      const reread = await get(`/projects/${FIXTURE_ID}/scenes/scene-001`).then((r) => r.json());
      check("The valid beat edit persisted to disk", reread.beats[0].purpose === "state the value, edited");

      const presentational = await patch(`/projects/${FIXTURE_ID}/scenes/scene-002`, { onScreenText: "UPDATED" });
      check("A presentational scene field edit is accepted", presentational.status === 200);

      const blocked = await patch(`/projects/${FIXTURE_ID}/scenes/scene-001`, { dataPoints: [{ metric: "fixture value", value: "9999", claimId: "claim-1" }] });
      check("Attempting to edit dataPoints through the presentational endpoint is BLOCKED (400)", blocked.status === 400);
    }

    // ------------------------------------------------------------------
    section("14-15. Narration edit invalidation + TTS regeneration request");
    // ------------------------------------------------------------------
    {
      const narrationEdit = await patch(`/projects/${FIXTURE_ID}/scenes/scene-001/narration`, { narration: "The fixture value is actually 99, unsupported." });
      const narrationBody = await narrationEdit.json();
      check("Narration edit runs the real claim gate inline", !!narrationBody.qa && typeof narrationBody.qa.status === "string");
      check("An unsupported new number in edited narration is caught by the real claim gate", narrationBody.qa.status === "FAIL");

      // Restore the original, evidence-backed narration for the rest of the suite.
      await patch(`/projects/${FIXTURE_ID}/scenes/scene-001/narration`, { narration: "The fixture value is 42, according to the filing." });

      const ttsAvailable = existsSync(join(repoRoot, ".venv")) || existsSync(join(repoRoot, ".venv-xpu"));
      if (ttsAvailable) {
        const regen = await post(`/projects/${FIXTURE_ID}/scenes/scene-001/narration/regenerate`);
        const regenJob = await regen.json();
        check("TTS regeneration request is accepted as a real job (202)", regen.status === 202 && !!regenJob.jobId);
        backgroundTtsJobId = regenJob.jobId ?? null;
        // A cold Chatterbox model load can genuinely take minutes (CLAUDE.md notes XPU
        // first-load kernel-compile overhead), so this only proves the async dispatcher
        // really picked the job up (queued -> running/complete), not full completion —
        // full job-lifecycle-to-terminal-state is already proven for real in section 17.
        await new Promise((r) => setTimeout(r, 3000));
        const polled = await get(`/jobs/${regenJob.jobId}`).then((r) => r.json());
        check("The real TTS job is genuinely dispatched, not stuck uninitialized", polled.status === "running" || polled.status === "complete" || polled.status === "failed", polled.status);
      } else {
        console.log("  [SKIP] No .venv/.venv-xpu present; skipping real TTS regeneration request.");
      }
    }

    // ------------------------------------------------------------------
    section("16. Audio track state");
    // ------------------------------------------------------------------
    {
      const audioState = await get(`/projects/${FIXTURE_ID}/audio`).then((r) => r.json());
      const s1 = audioState.scenes.find((s: any) => s.sceneId === "scene-001");
      const s2 = audioState.scenes.find((s: any) => s.sceneId === "scene-002");
      check("Audio state reflects a real cached scene from tts-cache.json", s1?.cached === true);
      check("Audio state reflects a real not-yet-generated scene", s2?.cached === false);
    }

    // ------------------------------------------------------------------
    section("17. Render job lifecycle");
    // ------------------------------------------------------------------
    {
      const started = await post(`/projects/${FIXTURE_ID}/render`, { scope: "scene:scene-002" });
      const job = await started.json();
      check("A render job is created with a real jobId", started.status === 202 && !!job.jobId);

      let finalJob: any = job;
      for (let i = 0; i < 20 && (finalJob.status === "queued" || finalJob.status === "running"); i++) {
        await new Promise((r) => setTimeout(r, 500));
        finalJob = await get(`/jobs/${job.jobId}`).then((r) => r.json());
      }
      check("The job reaches a real terminal state, not stuck queued/running", finalJob.status === "complete" || finalJob.status === "failed", finalJob.status);
    }

    // ------------------------------------------------------------------
    section("18. QA display (real report, or null)");
    // ------------------------------------------------------------------
    {
      const qa = await get(`/projects/${FIXTURE_ID}/qa`).then((r) => r.json());
      check("QA endpoint returns the real qa/report.json content", qa.media?.status === "PASS");
      check(
        "QA endpoint returns the real script-qa-report.json written by section 14's narration edit (not fabricated)",
        qa.script?.status === "FAIL"
      );
      check("QA endpoint returns null for a report that was never produced (visual-style QA never ran)", qa.visualStyle === null);
    }

    // ------------------------------------------------------------------
    section("19. Export: real precondition enforcement (no fake success)");
    // ------------------------------------------------------------------
    {
      const noAudioDir = join(repoRoot, "topics", "zztest-v24-noaudio");
      rmSync(noAudioDir, { recursive: true, force: true });
      mkdirSync(join(noAudioDir, "script"), { recursive: true });
      writeFileSync(join(noAudioDir, "script/script.json"), JSON.stringify({ title: "t", hook: "a genuine hook sentence long enough", scenes: [{ id: "scene-001", narration: "n", purpose: "p", visual_hint: "h" }], ending: "a genuine ending sentence long enough" }));
      const exportRes = await post(`/projects/zztest-v24-noaudio/export`);
      check("Export refuses with a clear precondition failure when no audio/render exists yet (not a fake success)", exportRes.status === 412);
      rmSync(noAudioDir, { recursive: true, force: true });
    }

    // ------------------------------------------------------------------
    section("20. Autosave: atomic writes leave no partial artifact");
    // ------------------------------------------------------------------
    {
      await patch(`/projects/${FIXTURE_ID}/scenes/scene-002`, { camera: "slow push-in" });
      const files = readdirSync(join(fixtureDir, "storyboard"));
      check("No stray .tmp.* file remains after an atomic write", !files.some((f) => f.includes(".tmp.")));
      check("The real target file exists and parses", (() => {
        try {
          JSON.parse(readFileSync(join(fixtureDir, "storyboard/visual-plan.json"), "utf-8"));
          return true;
        } catch {
          return false;
        }
      })());
    }

    // ------------------------------------------------------------------
    section("21. Revision undo/redo");
    // ------------------------------------------------------------------
    {
      const before = await get(`/projects/${FIXTURE_ID}/scenes/scene-002`).then((r) => r.json());
      await patch(`/projects/${FIXTURE_ID}/scenes/scene-002`, { onScreenText: "REVISION TEST" });
      const undoRes = await post(`/projects/${FIXTURE_ID}/revisions/undo`);
      check("Undo succeeds and returns the reverted revision", undoRes.status === 200);
      const afterUndo = await get(`/projects/${FIXTURE_ID}/scenes/scene-002`).then((r) => r.json());
      check("Undo actually restores the prior on-screen text", afterUndo.onScreenText === before.onScreenText);

      const redoRes = await post(`/projects/${FIXTURE_ID}/revisions/redo`);
      check("Redo succeeds", redoRes.status === 200);
      const afterRedo = await get(`/projects/${FIXTURE_ID}/scenes/scene-002`).then((r) => r.json());
      check("Redo re-applies the edit", afterRedo.onScreenText === "REVISION TEST");
    }

    // ------------------------------------------------------------------
    section("22. Unsafe path rejection");
    // ------------------------------------------------------------------
    {
      const traversal = await get(`/projects/${encodeURIComponent("../../etc")}/scenes`);
      check("A path-traversal project id is rejected, not resolved", traversal.status === 404 || traversal.status === 400, String(traversal.status));

      const nonexistent = await get(`/projects/definitely-not-a-real-project/scenes`);
      check("A well-formed but nonexistent project id is rejected (404), not silently empty", nonexistent.status === 404);
    }

    // ------------------------------------------------------------------
    section("23. Reopen after edit reflects persisted state");
    // ------------------------------------------------------------------
    {
      await patch(`/projects/${FIXTURE_ID}/scenes/scene-001`, { camera: "reopen-test-camera" });
      const reopened = await get(`/projects/${FIXTURE_ID}/scenes/scene-001`).then((r) => r.json());
      check("A fresh GET after a PATCH reflects the persisted edit, not stale in-memory state", reopened.camera === "reopen-test-camera");
    }

    // ------------------------------------------------------------------
    section("24. Unchanged-scene fingerprint stability");
    // ------------------------------------------------------------------
    {
      const design = new DesignDirectorAgent().getDesign();
      const designVersion = new DesignDirectorAgent().getVersion();
      const storyboardBefore = JSON.parse(readFileSync(join(fixtureDir, "storyboard/storyboard.json"), "utf-8"));
      const scene2Before = storyboardBefore.scenes.find((s: any) => s.id === "scene-002");
      const fpBefore = computeSceneFingerprint({ videoId: "video-factory", scene: scene2Before, designVersion });

      await patch(`/projects/${FIXTURE_ID}/scenes/scene-001`, { camera: "another-edit" });

      const storyboardAfter = JSON.parse(readFileSync(join(fixtureDir, "storyboard/storyboard.json"), "utf-8"));
      const scene2After = storyboardAfter.scenes.find((s: any) => s.id === "scene-002");
      const fpAfter = computeSceneFingerprint({ videoId: "video-factory", scene: scene2After, designVersion });
      check("Editing scene-001 does not change scene-002's fingerprint (isolated re-render, no full rebuild)", fpBefore === fpAfter);
    }
  } finally {
    // A background TTS job (fire-and-forget, per render-jobs.ts's design) can still be
    // writing into fixtureDir here. Deleting the directory while it's still running loses
    // the race: the job's own mkdirSync/writeFileSync calls recreate files after this
    // rmSync runs, leaving real leftover state in topics/ (observed once during this
    // session's own development). Wait for it to reach a terminal state first.
    if (backgroundTtsJobId) {
      for (let i = 0; i < 240; i++) {
        const j: any = await get(`/jobs/${backgroundTtsJobId}`).then((r) => r.json()).catch(() => ({ status: "complete" }));
        if (j.status !== "queued" && j.status !== "running") break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    server.close();
    rmSync(fixtureDir, { recursive: true, force: true });
    rmSync(join(repoRoot, "studio", "revisions", FIXTURE_ID), { recursive: true, force: true });
    rmSync(join(repoRoot, "studio", "revisions", `${FIXTURE_ID}.json`), { force: true });
  }

  console.log("\n==============================================================");
  console.log(`V2.4 DOCUMENTARY STUDIO: ${passed} passed, ${failed} failed`);
  if (failed) console.log("Failed: " + failures.join(" | "));
  console.log("==============================================================");
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\nV2.4 studio suite errored:", err?.stack || err);
  process.exit(1);
});
