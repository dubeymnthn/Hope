import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, Server } from "node:http";
import type { AddressInfo } from "node:net";

import { PipelineStateManager } from "../src/orchestrator/pipeline-state.js";
import { ProductionGateError, isProductionGate, assertResearchApproved, assertScriptApproved, computeResearchStateHash, computeScriptStateHash } from "../src/orchestrator/production-gate.js";
import { EvidenceGraph } from "../src/schemas/evidence-graph.js";
import { ScriptResult } from "../src/schemas/script.js";
import { ArgumentResult } from "../src/schemas/argument.js";
import { VisualEvidenceMap } from "../src/schemas/visual-evidence-map.js";
import { computeStaleness } from "../src/research/staleness.js";
import { ScriptQAAgent, detectFactualDrift, sceneNarrationMatchesEvidence, resolveClaimNumbers } from "../src/agents/script-qa.js";
import { resolveDesignForScene } from "../src/design/design-resolver.js";
import { ProjectDesignStrategy } from "../src/schemas/design-strategy.js";
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

function mkWorkspace(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function fixtureGraph(overrides?: Partial<EvidenceGraph>): EvidenceGraph {
  const base: EvidenceGraph = {
    topic: "Fixture topic",
    sources: [{ sourceId: "src-1", sourceType: "PRIMARY_GOVERNMENT", title: "Fixture Filing", url: "https://fixture.gov/filing", primaryOrSecondary: "primary" }],
    evidence: [{ evidenceId: "ev-1", sourceId: "src-1", evidenceExcerpt: "The widget price is $42.", confidence: 0.9, relevance: 0.9, temporalStatus: "CURRENT" }],
    dataPoints: [{ dataPointId: "dp-1", metric: "widget price", value: 42, unit: "usd", scope: "unit price", definition: "the fixture number", sourceId: "src-1", sourceExcerpt: "x", confidence: 0.9 }],
    entities: [],
    entityRelations: [],
    events: [],
    claims: [
      {
        claimId: "claim-1",
        questionIds: [],
        statement: "The widget price is 42.",
        category: "CORE_FACTS",
        supportingEvidenceIds: ["ev-1"],
        contradictingEvidenceIds: [],
        dataPointIds: ["dp-1"],
        entityIds: [],
        eventIds: [],
        temporalStatus: "CURRENT",
        confidence: 0.9
      }
    ],
    contradictions: [],
    uncertainties: [],
    thesisStressTest: [],
    version: "1.0.0"
  };
  return { ...base, ...overrides };
}

function fixtureScript(overrides?: Partial<ScriptResult>): ScriptResult {
  const base: ScriptResult = {
    title: "Fixture Documentary",
    hook: "A genuine hook sentence that is long enough to pass the check.",
    scenes: [
      {
        id: "scene-001",
        narration: "The widget price is $42 this year.",
        purpose: "establish the premise",
        visual_hint: "chart",
        chapter: "chapter-01",
        claims: [],
        scriptClaims: [{ scriptClaimId: "sc-1", claimText: "The widget price is $42 as reported.", evidenceIds: ["claim-1"], confidence: 0.9, narrativeRole: "opening" }]
      }
    ],
    ending: "A genuine closing sentence that is long enough to pass the check.",
    version: "2.0.0"
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// 1. Production phase / pipeline-state additive schema + hash-based approval
// ---------------------------------------------------------------------------

function testPipelineState(): void {
  section("1. Production phase state + hash-based approval validity");
  const dir = mkWorkspace("v26-pstate");
  try {
    const statePath = join(dir, "pipeline-state.json");
    const state = new PipelineStateManager(statePath);

    check("Fresh state defaults to RESEARCHING", state.getProductionPhase() === "RESEARCHING");
    check("Fresh approvals are both null", state.getApprovals().research === null && state.getApprovals().script === null);
    check("Fresh revision counters are all zero", Object.values(state.getRevisionCounters()).every((v) => v === 0));

    state.setProductionPhase("RESEARCH_REVIEW");
    check("setProductionPhase persists across a fresh manager instance", new PipelineStateManager(statePath).getProductionPhase() === "RESEARCH_REVIEW");

    // Simulate an editable evidence graph + questions on disk, approve at that content hash.
    mkdirSync(join(dir, "research"), { recursive: true });
    const graph = fixtureGraph();
    writeFileSync(join(dir, "research/evidence-graph.json"), JSON.stringify(graph, null, 2));
    writeFileSync(join(dir, "research/research-questions.json"), JSON.stringify({ topic: "t", questions: [], version: "1.0.0" }));

    const hash1 = computeResearchStateHash(dir);
    state.approve("research", { approvedArtifactHash: hash1 });
    check("Approval is valid immediately after approving at the current hash", state.getApprovals().research?.approvedArtifactHash === hash1);
    check("assertResearchApproved does not throw right after approval", (() => {
      try {
        assertResearchApproved(state, dir);
        return true;
      } catch {
        return false;
      }
    })());

    // Edit the evidence graph (bump revision, hash changes) -> approval must invalidate.
    const editedGraph = { ...graph, evidence: [...graph.evidence, { evidenceId: "ev-2", sourceId: "src-1", evidenceExcerpt: "extra", confidence: 0.5, relevance: 0.5, temporalStatus: "CURRENT" as const }] };
    writeFileSync(join(dir, "research/evidence-graph.json"), JSON.stringify(editedGraph, null, 2));
    let threwAfterEdit = false;
    try {
      assertResearchApproved(state, dir);
    } catch (err) {
      threwAfterEdit = isProductionGate(err);
    }
    check("An edit after approval invalidates it (hash mismatch throws ProductionGateError)", threwAfterEdit);

    // "Undo" the edit (restore original content) -> approval must become valid again, since
    // validity is content-hash-based, not a monotonic counter (see production-gate.ts).
    writeFileSync(join(dir, "research/evidence-graph.json"), JSON.stringify(graph, null, 2));
    check("Restoring the original content re-validates the SAME approval (hash-based, not counter-based)", computeResearchStateHash(dir) === hash1);
    let okAfterRestore = true;
    try {
      assertResearchApproved(state, dir);
    } catch {
      okAfterRestore = false;
    }
    check("assertResearchApproved passes again after restoring the approved content", okAfterRestore);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 2. Script approval gate: PROVENANCE_REQUIRES_REVIEW blocks; clears when clean
// ---------------------------------------------------------------------------

function testScriptApprovalGate(): void {
  section("2. Script approval gate: hash validity + provenance-review block");
  const dir = mkWorkspace("v26-script-gate");
  try {
    mkdirSync(join(dir, "script"), { recursive: true });
    const script = fixtureScript();
    writeFileSync(join(dir, "script/script.json"), JSON.stringify(script, null, 2));

    const statePath = join(dir, "pipeline-state.json");
    const state = new PipelineStateManager(statePath);
    const hash = computeScriptStateHash(dir);
    state.approve("script", { approvedArtifactHash: hash });

    let ok = true;
    try {
      assertScriptApproved(state, dir);
    } catch {
      ok = false;
    }
    check("assertScriptApproved passes for an approved, unflagged script", ok);

    // Flag a claim for provenance review -> approval (even at the same content hash) must
    // now be refused; approving the FLAG state was never allowed to happen, but simulate
    // "approved earlier, flagged later" by re-approving at this exact (now-flagged) content.
    const flaggedScript: ScriptResult = JSON.parse(JSON.stringify(script));
    flaggedScript.scenes[0].scriptClaims![0].provenanceStatus = "PROVENANCE_REQUIRES_REVIEW";
    writeFileSync(join(dir, "script/script.json"), JSON.stringify(flaggedScript, null, 2));
    state.approve("script", { approvedArtifactHash: computeScriptStateHash(dir) });

    let threwForFlag = false;
    let gateError: ProductionGateError | null = null;
    try {
      assertScriptApproved(state, dir);
    } catch (err) {
      threwForFlag = isProductionGate(err);
      gateError = err as ProductionGateError;
    }
    check("A claim flagged PROVENANCE_REQUIRES_REVIEW blocks approval even at a matching content hash", threwForFlag);
    check("The gate error names the phase SCRIPT_REVIEW", gateError?.phase === "SCRIPT_REVIEW");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 3. E5 Claim Numeric Fidelity + scene-level narration/evidence fidelity
// ---------------------------------------------------------------------------

async function testClaimNumericFidelity(): Promise<void> {
  section("3. Claim Numeric Fidelity (E5) + scene narration fidelity (set/clear symmetry)");
  const graph = fixtureGraph();

  // A claim whose own text asserts a DIFFERENT number than its cited evidence supports.
  const badScript = fixtureScript();
  badScript.scenes[0].scriptClaims![0].claimText = "The widget price is $99 as reported.";
  const qaBad = await new ScriptQAAgent().evaluate({ script: badScript, evidenceGraph: graph, outputDir: mkWorkspace("v26-qa-bad") });
  const e5Bad = qaBad.checks.find((c) => c.name === "Claim Numeric Fidelity");
  check("E5 fails when a scriptClaim's own number doesn't match its cited evidence", e5Bad?.passed === false);
  check("A numeric mismatch is a blocking error, not a warning", qaBad.errors.some((e) => e.includes("cited evidence")));

  // A qualitative claim (no number in claimText) must never be flagged, even with a
  // numerically-loaded evidence graph available — no false positives.
  const qualScript = fixtureScript();
  qualScript.scenes[0].scriptClaims![0].claimText = "Widget prices are considered high by analysts.";
  const qaQual = await new ScriptQAAgent().evaluate({ script: qualScript, evidenceGraph: graph, outputDir: mkWorkspace("v26-qa-qual") });
  const e5Qual = qaQual.checks.find((c) => c.name === "Claim Numeric Fidelity");
  check("E5 does not flag a qualitative claim with no numeric assertion", e5Qual?.passed === true);

  // resolveClaimNumbers resolves through claimId -> dataPointIds -> DataPoint.value/unit.
  const resolved = resolveClaimNumbers(["claim-1"], graph);
  check("resolveClaimNumbers resolves a claim's dataPointIds to its real value/unit", resolved.has("42usd"));

  // Scene-level fidelity: the SAME check both sets and clears the flag (no self-defeating
  // clear-on-the-same-edit bug — see CLAUDE.md V2.6 notes).
  const goodScene = fixtureScript().scenes[0];
  check("sceneNarrationMatchesEvidence is true when narration's number matches the evidence", sceneNarrationMatchesEvidence(goodScene, graph));
  const badScene = { ...fixtureScript().scenes[0], narration: "The widget price is $99 this year." };
  check("sceneNarrationMatchesEvidence is false when narration's number contradicts the evidence", !sceneNarrationMatchesEvidence(badScene, graph));
  const qualitativeScene = { ...fixtureScript().scenes[0], narration: "Widget prices are a hot topic." };
  check("sceneNarrationMatchesEvidence is true (nothing to check) when narration has no number", sceneNarrationMatchesEvidence(qualitativeScene, graph));

  // detectFactualDrift: the coarser fallback for when no evidence graph is supplied.
  check("detectFactualDrift is false when narration numbers are unchanged", !detectFactualDrift("The price is 42.", "The price is 42, apparently."));
  check("detectFactualDrift is true when narration numbers change", detectFactualDrift("The price is 42%.", "The price is 90%."));
}

// ---------------------------------------------------------------------------
// 4. Staleness: deleting evidence a script claim/argument/visual-opportunity cites
// ---------------------------------------------------------------------------

function testStaleness(): void {
  section("4. Staleness: removing evidence flags exactly the affected downstream content");
  const graph = fixtureGraph();
  const script = fixtureScript();
  const argument: ArgumentResult = {
    topic: "t",
    centralQuestion: "q",
    centralThesis: "th",
    supportingClaims: [{ claim: "The widget price fell.", evidence: ["e"], category: "FACT", strength: "strong", evidenceIds: ["claim-1"] }],
    counterArguments: [{ position: "p", rebuttal: "r", evidenceGap: "g" }],
    narrativeProgression: [
      { phase: "a", purpose: "p", keyPoints: ["k"], transitionQuestion: "q" },
      { phase: "b", purpose: "p", keyPoints: ["k"], transitionQuestion: "q" },
      { phase: "c", purpose: "p", keyPoints: ["k"], transitionQuestion: "q" },
      { phase: "d", purpose: "p", keyPoints: ["k"], transitionQuestion: "q" }
    ],
    conclusion: "c",
    estimatedDepthMinutes: 8
  };
  const visualEvidenceMap: VisualEvidenceMap = {
    topic: "t",
    opportunities: [{ visualOpportunityId: "vo-1", claimId: "claim-1", evidenceIds: ["ev-1"], visualMode: "data_visualization", visualPurpose: "show_magnitude", dataRequirements: [], entityIds: [], timelineEventIds: [], geographicDataIds: [], animationPotential: "moderate", confidence: 0.8, rationale: "r" }],
    version: "1.0.0"
  };

  const cleanReport = computeStaleness({ evidenceGraph: graph, script, argument, visualEvidenceMap });
  check("A consistent graph reports zero stale items", cleanReport.affectedClaims.length === 0 && cleanReport.affectedScriptScenes.length === 0 && cleanReport.affectedArgumentSections.length === 0 && cleanReport.affectedVisualOpportunities.length === 0);

  // Remove ev-1 (the spec §10 "Evidence E-044 removed" scenario). claim-1 itself still
  // resolves (script/argument/visual-opportunity all cite the CLAIM id, not ev-1
  // directly) — only the evidence-graph claim that supportingEvidenceIds'd it, and the
  // visual opportunity that cites ev-1 directly, should be flagged.
  const withoutEvidence: EvidenceGraph = { ...graph, evidence: graph.evidence.filter((e) => e.evidenceId !== "ev-1") };
  const report = computeStaleness({ evidenceGraph: withoutEvidence, script, argument, visualEvidenceMap });
  check("Removing evidence flags the evidence-graph claim that cited it", report.affectedClaims.includes("claim-1"));
  check("Removing evidence does NOT flag the script scene (its scriptClaim cites the still-resolvable claim-1, not ev-1)", !report.affectedScriptScenes.includes("scene-001"));
  check("Removing evidence does NOT flag the argument section (it cites claim-1, not ev-1)", !report.affectedArgumentSections.includes("The widget price fell."));
  check("Removing evidence flags the visual opportunity that cites it directly", report.affectedVisualOpportunities.includes("vo-1"));
  check("Summary names the affected counts", report.summary.includes("claim(s)") && report.summary.includes("visual opportunity"));

  // Now remove claim-1 itself (the id script/argument/visual-opportunity actually reference).
  const withoutClaim: EvidenceGraph = { ...graph, claims: [] };
  const report2 = computeStaleness({ evidenceGraph: withoutClaim, script, argument, visualEvidenceMap });
  check("Removing the cited claim flags the script scene referencing it", report2.affectedScriptScenes.includes("scene-001"));
  check("Removing the cited claim flags the argument's supporting claim section", report2.affectedArgumentSections.includes("The widget price fell."));
  check("Removing the cited claim flags the visual opportunity referencing it", report2.affectedVisualOpportunities.includes("vo-1"));
}

// ---------------------------------------------------------------------------
// 5. design.md: global -> chapter -> scene override resolution
// ---------------------------------------------------------------------------

function testDesignResolver(): void {
  section("5. design.md: global -> chapter -> scene override resolution");
  const strategy: ProjectDesignStrategy = {
    topic: "t",
    global: { colorMood: "restrained editorial", visualRhythm: "slow, deliberate", preferredVisualModes: [], layoutPreferences: [], motionRules: [], mediaPreferences: [], chartRules: [], technicalDiagramRules: [], cameraLanguage: [], captionRules: [] },
    chapterOverrides: { "chapter-08": { visualRhythm: "energetic" } },
    sceneOverrides: { "scene-042": { colorMood: "technical blueprint" } },
    sourceDesignMdHash: "abc123",
    version: "1.0.0"
  };

  const globalOnly = resolveDesignForScene(strategy, "chapter-01", "scene-001");
  check("With no override, a scene resolves to the global preference", globalOnly.colorMood === "restrained editorial" && globalOnly.visualRhythm === "slow, deliberate");

  const chapterOverridden = resolveDesignForScene(strategy, "chapter-08", "scene-099");
  check("A chapter override wins over global for its field", chapterOverridden.visualRhythm === "energetic");
  check("A chapter override does not clobber unrelated global fields", chapterOverridden.colorMood === "restrained editorial");

  const sceneOverridden = resolveDesignForScene(strategy, "chapter-01", "scene-042");
  check("A scene override wins over global for its field", sceneOverridden.colorMood === "technical blueprint");

  const bothOverridden = resolveDesignForScene(strategy, "chapter-08", "scene-042");
  check("The most specific (scene) override wins when both chapter and scene override the same-ish scene", bothOverridden.colorMood === "technical blueprint" && bothOverridden.visualRhythm === "energetic");
}

// ---------------------------------------------------------------------------
// 6. Studio server routes: research/script review, production, design (real Express app)
// ---------------------------------------------------------------------------

async function testStudioRoutes(): Promise<void> {
  section("6. Studio server routes: research/script review workbench, production, design");

  const repoRoot = resolve(".");
  const FIXTURE_ID = "zztest-v26-fixture";
  const fixtureDir = join(repoRoot, "topics", FIXTURE_ID);
  rmSync(fixtureDir, { recursive: true, force: true });
  mkdirSync(fixtureDir, { recursive: true });

  mkdirSync(join(fixtureDir, "research"), { recursive: true });
  const graph = fixtureGraph({ topic: "V26 fixture topic" });
  writeFileSync(join(fixtureDir, "research/evidence-graph.json"), JSON.stringify(graph, null, 2));
  writeFileSync(
    join(fixtureDir, "research/research-questions.json"),
    JSON.stringify({ topic: "V26 fixture topic", questions: [{ questionId: "q-1", category: "CORE_FACTS", questionText: "Is the fixture real?", priority: 1, status: "answered", requiredEvidenceLevel: "any", freshnessRequirement: "moderate", dependentQuestions: [], answeredBy: ["claim-1"] }], version: "1.0.0" })
  );
  writeFileSync(
    join(fixtureDir, "research/research-plan.json"),
    JSON.stringify({ topic: "V26 fixture topic", categories: [{ category: "CORE_FACTS", decision: "required", rationale: "r", expectedEvidenceType: "e", priority: 1, freshnessRequirement: "moderate", primarySourceRequired: false, skippableIfUnavailable: false }], version: "1.0.0" })
  );
  writeFileSync(
    join(fixtureDir, "research/research-gaps.json"),
    JSON.stringify({ topic: "V26 fixture topic", categoryCoverage: [{ category: "CORE_FACTS", coveragePercent: 100, status: "complete" }], overallCompletenessPercent: 100, gaps: [], generatedAt: new Date().toISOString(), version: "1.0.0" })
  );

  mkdirSync(join(fixtureDir, "script"), { recursive: true });
  const script = fixtureScript({ title: "V26 Fixture Documentary" });
  writeFileSync(join(fixtureDir, "script/script.json"), JSON.stringify(script, null, 2));

  const app = createApp();
  const server: Server = createServer(app);
  await new Promise<void>((resolveFn) => server.listen(0, resolveFn));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}/api`;
  const get = (p: string) => fetch(`${base}${p}`);
  const patch = (p: string, body: unknown) => fetch(`${base}${p}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const post = (p: string, body?: unknown) => fetch(`${base}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const del = (p: string) => fetch(`${base}${p}`, { method: "DELETE" });
  const put = (p: string, body: unknown) => fetch(`${base}${p}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  try {
    // --- research: GET, question edit tags HUMAN_EDIT, evidence add/delete + impact ---
    const researchGet = await get(`/projects/${FIXTURE_ID}/research`).then((r) => r.json());
    check("GET /research returns the real plan/questions/evidenceGraph/gaps", !!researchGet.evidenceGraph && !!researchGet.questions);

    const qPatch = await patch(`/projects/${FIXTURE_ID}/research/questions/q-1`, { questionText: "Is the fixture genuinely real?" });
    const qPatchBody = await qPatch.json();
    const patchedQ = qPatchBody.questions.find((q: any) => q.questionId === "q-1");
    check("PATCH question tags editedBy HUMAN", patchedQ.editedBy === "HUMAN" && patchedQ.questionText === "Is the fixture genuinely real?");

    const irrelevant = await patch(`/projects/${FIXTURE_ID}/research/questions/q-1`, { relevant: false });
    const irrelevantBody = await irrelevant.json();
    check("A question can be marked irrelevant without deleting it", irrelevantBody.questions.find((q: any) => q.questionId === "q-1").relevant === false);

    const impact = await get(`/projects/${FIXTURE_ID}/research/evidence/ev-1/removal-impact`).then((r) => r.json());
    check("Evidence removal impact preview names the affected claim, without deleting anything yet", impact.affectedClaims.includes("claim-1"));
    const stillThere = await get(`/projects/${FIXTURE_ID}/research`).then((r) => r.json());
    check("A dry-run impact preview does not mutate the evidence graph", stillThere.evidenceGraph.evidence.some((e: any) => e.evidenceId === "ev-1"));

    const addEv = await post(`/projects/${FIXTURE_ID}/research/evidence`, { evidenceId: "ev-unverified", evidenceExcerpt: "A human typed this in without a source." });
    const addEvBody = await addEv.json();
    const newEv = addEvBody.evidence.find((e: any) => e.evidenceId === "ev-unverified");
    check("Evidence added without a real sourceId is tagged UNVERIFIED, never silently treated as verified", newEv?.provenance === "UNVERIFIED");

    const delEv = await del(`/projects/${FIXTURE_ID}/research/evidence/ev-unverified`);
    check("Evidence can be deleted", delEv.status === 200);

    // --- research approval ---
    const approveOk = await post(`/projects/${FIXTURE_ID}/research/approve`, {});
    check("Research approval succeeds against a complete, consistent fixture", approveOk.status === 200);

    // --- request more research reuses AgentTaskGate (a real brief gets written) ---
    const reqMore = await post(`/projects/${FIXTURE_ID}/research/request-more`, { instruction: "Find a second independent source for the widget price." });
    check("Request-more-research is accepted (202) and writes a real agent-task brief", reqMore.status === 202 && existsSync(join(fixtureDir, "agent-tasks")));

    // --- script review: narration edit -> factual drift flags provenance review ---
    const driftEdit = await patch(`/projects/${FIXTURE_ID}/scenes/scene-001/narration`, { narration: "The widget price is $199 this year." });
    const driftBody = await driftEdit.json();
    const flaggedClaim = driftBody.script.scenes[0].scriptClaims[0];
    check("A narration edit that contradicts the evidence flags the claim PROVENANCE_REQUIRES_REVIEW", flaggedClaim.provenanceStatus === "PROVENANCE_REQUIRES_REVIEW");
    check("The edited scene is tagged editedBy HUMAN and preserves the agent's original narration", driftBody.script.scenes[0].editedBy === "HUMAN" && driftBody.script.scenes[0].originalNarration?.includes("42"));

    const approveWhileFlagged = await post(`/projects/${FIXTURE_ID}/script-review/approve`, {});
    check("Script approval is refused while a claim is flagged for provenance review", approveWhileFlagged.status === 400);

    // Fix the narration back to a number the evidence supports -> the SAME check clears the flag (revalidation).
    const fixEdit = await patch(`/projects/${FIXTURE_ID}/scenes/scene-001/narration`, { narration: "The widget price is $42 this year, per the filing." });
    const fixBody = await fixEdit.json();
    check("Revalidating (editing back to a supported number) clears the provenance flag automatically", fixBody.script.scenes[0].scriptClaims[0].provenanceStatus === undefined);

    const approveScript = await post(`/projects/${FIXTURE_ID}/script-review/approve`, {});
    check("Script approval succeeds once the claim gate's evidence checks are clean", approveScript.status === 200);

    // --- claim override: explicit, justified, never a silent re-verification ---
    const overrideRes = await post(`/projects/${FIXTURE_ID}/script-review/scenes/scene-001/claims/sc-1/override`, { justification: "Confirmed manually against the source filing." });
    const overrideBody = await overrideRes.json();
    const overriddenClaim = overrideBody.scenes[0].scriptClaims[0];
    check("An explicit override sets HUMAN_OVERRIDDEN with a recorded justification, never silently", overriddenClaim.provenanceStatus === "HUMAN_OVERRIDDEN" && overriddenClaim.overrideReason?.length > 0);

    // --- production summary + gated job scopes ---
    const production = await get(`/projects/${FIXTURE_ID}/production`).then((r) => r.json());
    check("Production summary reports researchApprovalValid/scriptApprovalValid from real state", production.researchApprovalValid === true);
    check("Production dashboard reports all 8 spec stages", production.stages.length === 8);

    // --- design.md: PUT marks design stale, never touches research/script revisions ---
    const beforeCounters = await get(`/projects/${FIXTURE_ID}/production`).then((r) => r.json());
    const designPut = await put(`/projects/${FIXTURE_ID}/design`, { designMd: "# Visual Identity\nRestrained editorial documentary." });
    const designBody = await designPut.json();
    check("Saving design.md is reflected immediately", designBody.designMd?.includes("Restrained editorial"));
    check("design.md is stale (no strategy generated yet)", designBody.stale === true);
    const afterCounters = await get(`/projects/${FIXTURE_ID}/production`).then((r) => r.json());
    check("Saving design.md bumps ONLY the design revision counter", afterCounters.revisionCounters.design === beforeCounters.revisionCounters.design + 1);
    check("Saving design.md does NOT bump the research revision counter (spec §36)", afterCounters.revisionCounters.research === beforeCounters.revisionCounters.research);
    check("Saving design.md does NOT bump the script revision counter (spec §36)", afterCounters.revisionCounters.script === beforeCounters.revisionCounters.script);
  } finally {
    server.close();
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  testPipelineState();
  testScriptApprovalGate();
  await testClaimNumericFidelity();
  testStaleness();
  testDesignResolver();
  await testStudioRoutes();

  console.log("\n==============================================================");
  console.log(`V2.6 RESEARCH & SCRIPT WORKBENCH: ${passed} passed, ${failed} failed`);
  if (failed) console.log("Failed: " + failures.join(" | "));
  console.log("==============================================================");
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
