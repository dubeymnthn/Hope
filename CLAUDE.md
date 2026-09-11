# CLAUDE.md

Project memory for the Autonomous Documentary Factory. This file records what was built,
why, and what a future session (Claude or human) needs to know before touching it. It is
not a spec re-statement — see the V2/V2.2 briefs (in conversation history) for the full
requirements. This is the "what actually happened and what to watch out for" record.

## What this project is

A local-only pipeline that turns a topic string into a verified ~10-minute documentary
MP4. Reasoning (research planning, research, evidence graph construction, argument,
script, visual evidence mapping, visual direction, design-strategy interpretation) is
performed by the Antigravity agent against task briefs the pipeline emits; TypeScript is
deterministic infrastructure only — validation, hashing, checkpointing, gap/completeness
scoring, rendering, QA. A local web UI (`studio/`, V2.4/V2.6) sits on top of this pipeline
as a control surface — it reads/writes the same artifacts through a typed API, it does not
replace or duplicate the pipeline. Since V2.6, Documentary Studio always requires a human
to approve research and script before TTS/visual production begins (see V2.6 below); the
CLI stays fully autonomous by default for backward compatibility.

```
TOPIC → RESEARCH PLAN → RESEARCH → EVIDENCE GRAPH → RESEARCH COMPLETENESS
      → [HUMAN: APPROVE RESEARCH] → ARGUMENT → SCRIPT → CLAIM GATE
      → [HUMAN: APPROVE SCRIPT] → VISUAL EVIDENCE MAP → [HUMAN: START PRODUCTION]
      → TTS → DESIGN STRATEGIST (optional, design.md only) → VISUAL DIRECTOR → ALIGNMENT
      → PARAMETERIZED SCENES → HYPERFRAMES → FFMPEG → CAPTIONS → MEDIA QA → MP4
```

## Session history

### V2 (first pass)

Took a V1 repo (6 hardcoded scenes, template-based) and rebuilt it into the pipeline
above. Key deliverables:

- `src/agents/agent-task.ts` — the gate. When a reasoning artifact is missing, writes a
  task brief (embeds the Zod schema + anti-fabrication rules) to `<workspace>/agent-tasks/`,
  records `awaiting_agent`, throws `AgentTaskPendingError`, exits 2. TypeScript never
  authors research/argument/script/visual-direction content.
- `src/agents/researcher.ts`, `argument.ts`, `script.ts`, `visual-director.ts` — the four
  gated stages, each `ensure()`-ing its artifact exists and validates before continuing.
- `src/scenes/primitives.ts` — data-driven visual primitives (chart, comparison, timeline,
  diagram, flow, typography, evidence, map, ambient). Dispatch is by `visualMode`, never by
  `scene.id`. A primitive that lacks verified data returns `insufficientData` and the
  generator degrades along a fallback chain rather than inventing a curve.
- Deleted `src/research/mock-research.ts` (fabricated research, `mock.example.com` URLs)
  and `src/visual/hyperframes-gen.ts`'s hardcoded battery/memory-topic compositions.
- Fixed real cross-platform blockers found by actually running the pipeline on Windows:
  `hyperframes` couldn't spawn (Node refuses `.cmd` without a shell) → invoke the
  package's `.mjs` entry via `process.execPath`; `worker-client.ts` hardcoded POSIX
  `.venv/bin/python`; HyperFrames couldn't find ffmpeg/ffprobe (shipped as npm packages,
  not system installs) → inject their dirs onto PATH.
- Built a Python 3.12 venv via `uv` (system Python was 3.14, which Chatterbox's deps
  cannot build on — `spacy-pkuseg` has no cp314 wheel and needs MSVC).
- Added a persistent Chatterbox `--serve` session (`ChatterboxSession` in
  `worker-client.ts`) so a 16-scene run loads the model once instead of 16 times.
- Produced and fully verified two documentaries end-to-end (batteries, semiconductor fab):
  8/8 V1 milestones, `test:v2` 65/65, `test:generalization` 26/26, media QA PASS on both.

### V2.2 (hardening pass, this session)

Given: "harden into production-ready, do not redesign, do not weaken validation." Added:

- **`src/system/runtime.ts`** — single source of truth for device/interpreter/binary
  resolution (`resolveTtsDevice`, `resolvePythonForDevice`, `resolveHyperframesEntry`,
  `preflight()`). Nothing else in the codebase should construct a venv path by hand.
  `TTS_DEVICE=cpu|xpu|cuda|mps`; unset auto-selects `xpu` only if `.venv-xpu` exists
  (explicit opt-in). `preflight()` runs before every production and fails fast with
  actionable fixes rather than an obscure spawn error mid-pipeline.
- **`scripts/bootstrap.mjs`** — cross-platform setup (`npm run setup:tts[:xpu]`). Uses
  `uv` to provision Python 3.12 (not system Python). No bash, no hardcoded POSIX paths.
- **Measured-rate duration planning** (`src/schemas/channel.ts` `resolvePlanningRate`,
  `TtsCalibrationSchema`; `src/orchestrator/duration-gate.ts` `assessDuration`). The
  planner reads `config.video.calibration.ttsWordsPerMinute` — a rate **measured from a
  real production**, recorded with provenance (measuredAt/measuredFrom/sampleWords/
  sampleSeconds/device) — never a hardcoded constant. After synthesis, measured duration
  is checked against `target ± targetToleranceMinutes` (soft) and
  `[minimumDurationMinutes, maximumDurationMinutes]` (hard). Outside the hard range the
  pipeline **blocks and asks the agent to revise** (with a word-delta hint at the
  measured rate) — it never pads, repeats, or stretches speech.
- **Beat-driven visual rhythm** (`src/schemas/storyboard.ts` `BeatChangeTypeEnum`,
  `BeatFocusSchema`; `src/scenes/scene-generator.ts` `buildBeatSchedule`,
  `distributeGroups`). Beats are no longer metadata — each one schedules a real GSAP
  timeline event. Primitives tag repeated element groups with `data-beat-seq="N"`;
  `distributeGroups()` spreads N groups across however many revealing beats a scene has
  (handles more-groups-than-beats and fewer-groups-than-beats) so every group is on
  screen by the last revealing beat. `changeType: hold` beats schedule nothing but
  require `holdJustification` past ~15s. Connectors (flow links, comparison dividers,
  graph edges) reveal with their destination, not before it.
- **Visual QA rhythm metrics** (`src/qa/visual-style.ts`): per-scene
  (`longestNoChangeInterval`, `visualStateChangeCount`, `focusChanges`, `changeTypes`,
  `justifiedLongBeats`/`unjustifiedLongBeats`) and whole-video (`first30.*`,
  `longestStaticInterval`, `visualModeCount`, `layoutSignatureCount`,
  `verifiedDataPointCount`). Distinguishes "slow by design" (justified) from
  "accidentally static" (unjustified past 20s) rather than a flat max-duration rule.
- **Structured (not substring) validator**: `researcher.ts`'s placeholder-citation check
  used to false-positive on legitimate text containing "N/A" as a substring (e.g.
  "High-NA/Low-NA optics"). Now checks the URL's hostname against a reserved-domain list
  and requires the WHOLE title/url field to be a null-like token, not a substring match.
- **Scene fingerprint hardened** (`src/scenes/scene-hash.ts`): now includes beats,
  data points, diagram nodes/edges, timeline events, comparison sides, camera, chapter —
  previously a plan edit to those fields could silently reuse a stale composition.
- **Stage-report orchestrator** (`src/orchestrator/orchestrator.ts`): every stage times
  itself and reports `[STAGE] status detail (Xs)`; a final report block prints all
  stages, wall-clock, planning vs measured wpm, device, duration verdict, visual rhythm
  and variety summary. `isAgentTaskPending` halts are reported too (not swallowed).
- Deleted dead code: `src/utils/hash.ts`, `src/alignment/provider.ts` (unreferenced,
  superseded by `scene-hash.ts` and inline alignment in `storyboard.ts`).
- New test suite `test/test-v22-regression.ts` (95 checks) covering all of the above,
  including *positive* regression cases (legitimate "N/A"/"NASA (Na)" text must be
  ACCEPTED, not just that fabricated citations are rejected).
- Produced and verified a third documentary (Panama Canal) end-to-end under V2.2:
  duration planner used the measured 189 wpm calibration, script landed at 8.62 min
  against a 9 min target (within band — first production to land in-band), claim gate
  caught a real fabricated-looking number (`1.35 degrees` vs research's `1.35 C`) before
  TTS, TTS survived a mid-run interruption (orphaned worker process, GPU contention with
  a concurrent CPU render — see gotchas below) and resumed correctly, beat scheduler
  verified against real frames, media QA PASS with 11 visual modes / 16 layouts / 29/29
  data points traced.

### V2.3 (research intelligence / evidence graph / visual evidence mapping, this session)

Given: "the research agent must decide what it needs to know before it decides what to
write" — deepen the research phase from one flat dossier into a planned, structured,
gap-measured process, without redesigning the working rendering/TTS/QA/checkpointing
machinery. Every change is additive: new files, or new optional fields/params on existing
`ensure()` options bags, so old topic workspaces and all three prior test suites needed
zero edits (one unrelated pre-existing test bug was fixed in passing — see below). Added:

- **Four new gated stages**, same `AgentTaskGate` pattern as every existing stage (brief +
  embedded zod schema + `AgentTaskPendingError`, agent-task.ts itself untouched):
  `research-planner` (`src/agents/research-planner.ts`, two sequential gates —
  `research/research-plan.json` then `research/research-questions.json`, since questions
  are generated per category the plan actually selected), `evidence-graph`
  (`src/agents/evidence-graph.ts` → `research/evidence-graph.json`), `visual-evidence-map`
  (`src/agents/visual-evidence-mapper.ts` → `visual-evidence/visual-evidence-map.json`,
  runs after the claim gate/before TTS since it needs no audio timing). `research.json`
  and `ResearchAgent` are **unchanged** — the evidence graph deepens the same dossier, it
  does not replace the gate.
- **`src/schemas/evidence-graph.ts`** — the structural core: `Source` (12-value
  `SourceTypeEnum`, primary/secondary), `Evidence` (8-value `TemporalStatusEnum` —
  HISTORICAL/CURRENT/RECENT/ANNOUNCED/PLANNED/UNDER_DEVELOPMENT/FORECAST/SPECULATIVE,
  never mixed silently), `DataPoint` (numbers carry `scope`+`definition` so a cell price
  can never be silently merged with a pack price — only a shared `comparableGroup` opts
  two data points into being treated as comparable), `Entity`/`EntityRelation` (11-verb
  supply-chain/ownership graph), `Event`, `Contradiction`/`Uncertainty` (4-type
  `DisagreementTypeEnum`), `Claim` (traces to evidence/data/entities/events by id), and
  `thesisStressTest: ThesisCandidate[]` (spec's thesis-stress-test lives here, not as a
  separate artifact). `src/research/evidence-graph-integrity.ts` enforces referential
  integrity (every `*Id` resolves) and reuses `researcher.ts`'s `isPlaceholderCitation`
  rather than reimplementing it — one citation validator, not two.
- **`src/research/gap-detection.ts`** — deterministic, not agent-authored (mirrors
  `duration-gate.ts`'s role: a policy layer over agent output, not a content author).
  `computeResearchGaps()` walks the plan/questions/graph and flags each of the 9 spec gap
  types (UNANSWERED, WEAKLY_SUPPORTED, SECONDARY_ONLY, STALE, CONTRADICTED, AMBIGUOUS,
  DEFINITION_MISMATCH, MISSING_PRIMARY_SOURCE, INSUFFICIENT_QUANTITATIVE_EVIDENCE) plus
  per-category coverage and an overall completeness percent — no arbitrary search-count
  threshold. `assessResearchCompleteness()` blocks the pipeline only when a *required,
  non-skippable* category has zero supporting claims (same revise-and-resubmit shape as
  the duration gate); everything else is reported, not enforced. Writes
  `research/research-gaps.json` + `research/research-report.md`.
- **Argument/Script/claim-gate/Visual-Director all gained optional new inputs**, not new
  requirements: `argument.ts` can take `evidenceGraph`/`researchGaps`/`plan`/`questions`;
  `SupportingClaimSchema` gained an optional `evidenceStatus` (SUPPORTED/PLAUSIBLE/
  UNCERTAIN/DISPUTED/UNSUPPORTED); `script.ts` can take `evidenceGraph` so the agent
  populates the new `ScriptClaimSchema` (`scriptClaims[].evidenceIds`) instead of only
  free-text `claims`; `script-qa.ts` gained check **E4 "Claim -> Evidence Traceability"**
  (orphan-claim detection) that only activates when a scene has `scriptClaims` AND an
  evidence graph was supplied — inert on every pre-V2.3 workspace; `visual-director.ts`
  can take `visualEvidenceMap`/`evidenceGraph`, and its existing chart-data-integrity
  check now also resolves `dataPoints[].claimId/sourceId` against real graph ids when one
  is supplied. `VisualModeEnum` (`storyboard.ts`) gained `entity_network`, `before_after`,
  `geographic_flow`, `quantitative_transformation` — all **aliased** to existing
  `primitives.ts` renderers (`renderTechnicalDiagram`/`renderComparison`/`renderMap`/
  `renderDataVisualization`), no new rendering surface.
- **`src/search/index.ts`** — local, dependency-free search/index (no DB; reads JSON
  fresh per call, correct for a local single-topic tool). `buildSearchIndex()` reads
  evidence-graph/questions/script/visual-plan/timestamps into flat `SearchRecord[]`, then
  backfills `refs.sceneId` onto claim/evidence/dataPoint records via `scriptClaims` and
  `visual-plan.json`'s `dataPoints[].claimId` — the provenance chain from spec §30
  (source → evidence → claim → script sentence → scene → timestamp). `search()` does
  exact-phrase/substring/numeric-aware matching; `resolveToTimestamp()` cross-references
  `audio/timestamps.json`. Thin CLI: `npm run search -- "<query>" -d <workspace>`.
- **New test suite `test/test-v23-research.ts`** (80 checks, fixture-based — no live
  external-agent calls) covering schema validation, gate behaviour (missing-artifact →
  `AgentTaskPendingError`, structurally-broken → hard rejection, valid → accepted) for all
  three new agents, all 9 gap types reachable, a hand-computed completeness-scoring worked
  example (50%/100%/75% traced by hand against the algorithm), blocking-vs-skippable
  research-completeness behaviour, orphan-claim detection, and the search index.
- Fixed one **pre-existing, unrelated** bug found while verifying `test:all` stays green:
  `test-v2-pipeline.ts` asserted a QA check named `"Static Frame Ratio"`, which
  `visual-style.ts` had renamed to `"Unjustified Static Intervals"` during V2.2, before
  this session. One-line string fix, zero behavioural change; `test:v2` is 65/65 again.
- The five regressions the V2.3 brief listed as "currently failing" (POSIX `/dev/null`,
  High-NA/Low-NA validator, NASA/(Na)/N/A-in-title, single-source dossier, proportional
  chart bars) were **already fixed** in V2.2 and covered by passing tests — nothing to do
  there; reused their validators (`isPlaceholderCitation`, `parseMagnitude`) rather than
  writing new ones.
- **Deliberately deferred** (explicit user scope decision, not an oversight): the brief's
  §32 "three real end-to-end topic productions across different domains" — this pass
  built the architecture and a synthetic-fixture regression suite; producing real
  documentaries through the new gates (research-planner → evidence-graph →
  visual-evidence-map, each a real Antigravity round-trip) is its own future session, the
  same way each prior real production was.
- **Known consequence, not a bug**: because the four new stages are inserted before
  `argument` in `orchestrator.ts`, re-running `npm run produce` against any of the three
  already-completed topics will now halt asking for `research-plan.json` etc., since those
  don't exist for them. Their existing `final.mp4`/artifacts are untouched; this only
  affects trying to push a *finished* topic through the pipeline again in the future.

### V2.4 (Documentary Studio: local dashboard + editor, this session)

Given: turn the CLI-only pipeline into a local web app a human can inspect and edit
without touching the CLI, as a control surface over the existing pipeline, not a second
pipeline. The repo had **zero** frontend/server infrastructure before this session — this
is a from-scratch addition living entirely under `studio/`, importing from `src/` but
never the reverse (`src/` has no dependency on `studio/`; the CLI is unaffected).

- **Stack**: Express (API) + React 19/Vite (frontend, `studio/web/`) + SSE (live job
  events). Served locally in a normal browser tab, not Electron. `npm run studio` builds
  the frontend once and starts the server on one port (default 4317); `npm run
  studio:server` + `npm run studio:web` run them separately with Vite HMR + a dev proxy
  for iteration.
- **`studio/server/services/workspace.ts`** is the *only* place a `projectId` from the
  network becomes a filesystem path — `[a-z0-9-]+` pattern, re-checked against
  `resolve()`'s output to defeat `..` traversal, must resolve to a real, existing
  `topics/<id>` (or the legacy root workspace) directory. Every route goes through
  `middleware/project-guard.ts`, which uses this exclusively.
- **`studio/server/services/artifact-reader.ts`** — safe optional reads for every V2/V2.3
  artifact; a missing or schema-invalid file returns `null`, never a fabricated stand-in.
  The generic `readOptional<S extends z.ZodTypeAny>(path, schema): z.infer<S> | null`
  helper matters: typing it as `z.ZodType<T>` instead infers the pre-default INPUT shape,
  not the OUTPUT shape, and silently produces the wrong type for every schema using
  `.optional().default(...)` — a real bug hit and fixed during this session.
- **Editing is additive, not a new validation system**: `beat-editor.ts` validates and
  writes `storyboard/visual-plan.json` (rejects negative/out-of-bounds beat durations
  against the scene's REAL duration from `storyboard.json`/`audio/timestamps.json`, never
  invented), then immediately re-runs the real `StoryboardAgent.assemble()` so
  `storyboard.json` never goes stale relative to a plan edit. `narration-editor.ts` edits
  `script/script.json` and re-runs the real `ScriptQAAgent.evaluate()` inline — same class
  the orchestrator uses — so a narration edit that breaks evidence traceability is caught
  immediately, not silently accepted. Narration edits are **self-invalidating for TTS**:
  `VoiceAgent`'s per-scene cache in `audio/tts-cache.json` is keyed on
  `sha256(narration.trim())` (already existed, `voice.ts`), so a text edit alone makes the
  next real TTS run resynthesize exactly that scene and reuse every other scene's audio —
  no new invalidation logic was needed.
- **No new dependency-graph engine** (spec §31 asked to reuse fingerprints, not build a
  generic one): scene "staleness" in the UI is computed by reading the *real* stored
  fingerprint in `scenes/<id>.meta.json` and comparing it against a fresh
  `computeSceneFingerprint()` call over the current `storyboard.json` scene — the same
  function `scene-generator.ts` already uses to decide reuse-vs-rebuild.
- **`dataPoints`/`claimsShown`/`sourceReferences`/etc. cannot be edited through the
  presentational scene-patch endpoint** (`beat-editor.ts`'s `FORBIDDEN_SCENE_KEYS`) — a
  request containing any of them is rejected with 400, not silently ignored. This is the
  literal enforcement of spec §41 "unsupported data protection": the UI cannot be used to
  put a fabricated number in front of a real chart primitive.
- **`src/renderers/renderer.ts`/`hyperframes.ts`** gained an additive `composition?`
  `RenderOptions` field, wiring the `hyperframes` CLI's own pre-existing `-c/--composition`
  flag (discovered via `hyperframes render --help`, not new render-engine work) — lets the
  studio render one changed scene as a fast preview clip
  (`renders/preview-<sceneId>.mp4`) without a full documentary re-render. This is a
  preview only: `FFmpegService` muxing and both QA agents remain whole-video operations,
  so **export still requires a full render** — the export endpoint enforces this as a real
  412 precondition failure, it does not pretend a scene preview is the deliverable.
- **`src/orchestrator/orchestrator.ts`** gained an additive `onEvent?: (e: StageEvent) =>
  void` on `OrchestratorOptions`, fired alongside (not instead of) every existing
  `console.log` in `timed()` and the research-completeness stage. The CLI is unaffected
  when `onEvent` is omitted. `studio/server/services/render-jobs.ts` wraps `run()` with
  this hook to publish real SSE events — no simulated progress anywhere (spec §34-35
  explicitly forbids inventing a percentage the underlying process doesn't expose).
- **Revisions are a linear undo/redo log, not git** (`studio/server/services/
  revisions.ts`): `studio/revisions/<projectId>.json` + before/after snapshot files per
  edit, outside every topic workspace. `editArtifactWithRevision()` is the one function
  every write-endpoint goes through, so every edit is autosaved (atomic tmp-file-then-
  `renameSync`, the same pattern `agent-task.ts`/`pipeline-state.ts` already use) and
  undoable by construction — no endpoint writes an artifact directly.
- **Media serving is an explicit allowlist** (`routes/media.ts`): only `final.mp4`,
  `audio/narration.wav`, `audio/captions.srt`, and `renders/preview-<sceneId>.mp4` (scene
  id validated against the same `[a-z0-9-]+` pattern) are ever streamed — never an
  arbitrary path from the request.
- **New test suite `test/test-v24-dashboard.ts`** (43 checks) starts the real Express app
  (`studio/server/app.ts` — a pure factory with no `listen()` call, so tests can import it
  directly) on an ephemeral port and hits it with `fetch` against a real 2-scene fixture
  workspace built under `topics/` (cleaned up in `finally`) — no mocking, no snapshot
  testing. Covers all 24 items from the brief's §46 list, including one genuinely real
  TTS-regeneration call (skipped gracefully when neither `.venv` nor `.venv-xpu` exists)
  and one genuinely real scene-preview HyperFrames render. **Caution for future sessions**:
  a real, un-awaited TTS job can keep a Chatterbox/XPU model-load running in the
  background for well over a minute after the test process's own checks finish — the test
  only waits ~3s to confirm the job actually dispatched (queued→running), not full
  completion, specifically to avoid `test:v24` taking minutes; verified after the fact
  that the worker still closes cleanly via `VoiceAgent`'s own `finally` block and leaves no
  orphaned `python` process, but don't assume that's guaranteed if you change this test.
- **Frontend scope actually built**: project library + new-project dialog (real
  `?generate=true` job), full editor (scene browser / HTML5 `<video>` preview wired to a
  real playhead / real VIDEO+NARRATION+CAPTIONS timeline tracks / tabbed inspector with
  live beat + narration editing + a real provenance-chain walk), Research/Script/
  Storyboard/Audio/Sources pages reading real V2.3 artifacts, a Ctrl+K search palette and
  a Search page both wired to the real `src/search/index.ts`, a QA page on real reports, an
  Export page that only shows a result after the backend's real ffprobe+QA pass. No router
  dependency added — a ~40-line hash router (`studio/web/src/router.tsx`) was enough for
  this app's shape.
- **Explicit scope reductions** (all named in the brief as acceptable when the underlying
  capability doesn't exist yet, not silent gaps): no MUSIC/SFX timeline tracks or mixing
  (this pipeline produces no such artifact); no per-element drag-and-drop visual editing
  (generated compositions carry no stable per-element ids yet) — visual editing works at
  the primitive-parameter level (beat timing/purpose/state, onScreenText, camera,
  animationIntent) instead; no new factual-claim authoring through the UI (still only the
  real gated pipeline can add evidence-backed claims).

### V2.5 (Documentary Studio High-Fidelity UI Design System & Component Overhaul, this session)

Given: the exported high-fidelity design specification in `C:\Users\manthan.dubey\Desktop\Desktop-first-Web-Application-Ui-Called-Documentary` (an OpenDesign/CJX handoff with comprehensive visual tokens, typography, pro-NLE component styles, and 8 screens built for this exact documentary pipeline). Port the design system, typography, components, and responsive layouts into `studio/web`, replacing the previous rudimentary dark-mode prototype with the production-grade visual contract while keeping 100% backend API connectivity and tests green.

- **Design System & Typography**:
  - `studio/web/index.html` loads the Google Fonts triple: `Source Serif 4` (editorial hero/titles), `Inter` (UI typography), and `JetBrains Mono` (timecodes, IDs, metrics); `<html>` tagged with `data-theme="dark"`.
  - `studio/web/src/styles/tokens.css` defines the exact token contract: surfaces (`--bg: #0E0F11`, `--panel: #161719`, `--surface-2: #1D1F22`, `--surface-3: #24262A`, `--border: #2A2C30`, `--border-strong: #3A3D42`), warm copper/amber accent (`--accent: #C68A4E`, `--accent-muted: #C68A4E33`), semantic status colors (green `#5FAE7A`, amber `#D9B65B`, red `#D9685F`, blue `#6C9BFF`), 4px spacing scale, and backward-compatible variable bridges.
  - Modular stylesheets ported directly from the handoff: `tokens.css`, `components.css`, `editor.css`, `research-script.css`, `audio-qa-export.css` in `studio/web/src/styles/`, imported via `studio/web/src/styles.css`.
  - `studio/web/src/components/Icons.tsx`: fully typed React SVG icon library matching `shell.js` and `editor.js` (nav, utility, status, transport, and visual mode glyphs).
- **Application Shell (`App.tsx`)**:
  - Topbar (`--topbar-h: 48px`): wordmark, breadcrumbs (`/ <projectId> / <Page>`), and a search pill button with `Ctrl+K` kbd chip.
  - Left navigation rail: smooth collapsible toggle (200px ↔ 56px) with active indicator bars and icons across all 12 modules.
  - Global `Ctrl+K` and `/` hotkeys summoning the search palette overlay.
- **Upgraded Screen Surfaces**:
  - `ProjectsPage.tsx`: Recent projects card grid with thumbnail glyphs, runtime/scene/chapter metadata, last-modified relative dates, QA status badges, and "+ New Project" modal.
  - `OverviewPage.tsx`: New screen matching `overview.html` (display serif hero, production status checklist with checkmarks, production metadata panel with animated sparkbars for coverage & diversity, Open Editor CTA).
  - `EditorPage.tsx`: 3-column top grid + full-width bottom timeline:
    - `SceneBrowser.tsx`: Compact/Expanded density toggle, chapter headers with numbers, visual mode icons, durations, and QA status dots.
    - `Preview.tsx`: Stage wash, mode badge, glyph, title, custom transport bar (Previous, Play/Pause with Spacebar shortcut, Next, timecode, volume slider, fullscreen).
    - `Inspector.tsx`: Tabs for Scene and Beat, summary metadata, visual mode indicator, camera direction, live narration editor with auto-invalidation, and Provenance cascade (`ProvenancePanel.tsx`: Claim → Evidence → Source).
    - `Timeline.tsx`: Zoom slider & readout, time ruler with tick marks, 5 tracks (Video, Narration, Music, SFX, Captions), chapter flags, and scrubbable playhead handle.
  - `ResearchPage.tsx` & `SourcesPage.tsx`: 3-column research shell (Coverage sparkbars, Claims & Evidence list with status badges, Evidence Inspector with quotes, URLs, reliability ratings, temporal status).
  - `ScriptPage.tsx`: Editorial reading format with scene dividers, timestamps, narration paragraphs, and clickable evidence reference chips with popover modal.
  - `AudioPage.tsx`: Multi-track timeline workspace with mixer headers (Mute/Solo, volume sliders), audio clips, and narration transcript inspector with voice resynthesis.
  - `QAPage.tsx`: Overall Gate status banner (Pass / Warning / Fail) and categorized checklist cards with status icons.
  - `ExportPage.tsx`: Export form (Resolution, Framerate, Captions, Chapters), live render progress, and project summary card.
  - `SearchPalette.tsx`: Fast modal overlay with categorized live search (Research, Claims, Script, Scenes, Sources).

### V2.6 (Research & Script Review Workbench — human-approval gate, this session)

Given: a spec titled "V2.5" in the brief (renamed V2.6 here since V2.5 was already used
this session for the UI overhaul) requiring that research and script become editable and
require explicit human approval before TTS/visual production begins, plus an optional
per-project `design.md` visual-style brief. Explored the existing pipeline/studio-server/
studio-frontend architecture with three Explore agents, then had a Plan agent critique the
draft design before implementing — it caught three real bugs (a CLI backward-compat
break, an undo-doesn't-restore-approval bug, and a claim-numeric-fidelity gap), all fixed
below before writing any code.

- **Production phase state machine** (`src/schemas/production-state.ts`
  `ProductionPhaseEnum` — RESEARCHING → RESEARCH_REVIEW → RESEARCH_APPROVED →
  ARGUMENT_GENERATING → SCRIPT_REVIEW → SCRIPT_APPROVED → PRODUCTION_READY →
  TTS_GENERATING → VISUAL_GENERATING → RENDERING → QA → EXPORTED). `pipeline-state.json`
  gained additive `productionPhase`/`approvals`/`revisionCounters` fields + matching
  `PipelineStateManager` methods (`setProductionPhase`, `approve`, `bumpRevision`, etc).
  **Approval validity is content-hash-based, not counter-based**: `approvals.research`
  stores `{approvedAt, approvedArtifactHash, atRevision}`, and `assertResearchApproved`/
  `assertScriptApproved` (`src/orchestrator/production-gate.ts`) compare the live hash of
  the editable artifacts (evidence-graph.json+research-questions.json / script.json)
  against it — this was the Plan-agent's catch: a monotonic counter can't "self-heal" on
  undo (an edit bumps it, but reverting the edit via `editArtifactWithRevision`'s undo
  can't un-bump it), while a content hash naturally re-validates once the file matches
  what was approved again.
- **Gate enforcement mirrors the existing `AgentTaskPendingError` idiom**: new
  `ProductionGateError` (same file) is a "human is reviewing, not a failure" pause, caught
  the same places `AgentTaskPendingError` already is — `orchestrator.ts`'s outer catch
  (prints the stage report) and (new) `render-jobs.ts`'s `runJob()`, which previously had
  **no internal try/catch at all** (only the outer fire-and-forget `.catch()` at
  `startJob()`, which unconditionally marked a job `"failed"` — the Plan agent caught this
  too). `runJob()` now catches `ProductionGateError`→`job.status="blocked"` and
  `AgentTaskPendingError`→`"awaiting_agent"` (both new `JobStatus` values), only rethrowing
  genuine errors to the outer catch.
- **CLI stays fully autonomous by default; Documentary Studio always gates** (the third
  Plan-agent catch: defaulting the new `autoApprove`/`startProduction` orchestrator
  options to `false` would have silently broken every existing `npm run produce`
  invocation). `src/cli.ts` passes `autoApprove:true, startProduction:true` unless a new
  `--require-review` flag is given; `render-jobs.ts`'s `runJob()` (Studio's only caller)
  always passes `autoApprove:false`, and only sets `startProduction:true` for the new
  `scope:"produce"` (the "Start Production" button) — `scope:"full"` advances the
  pipeline exactly as far as current approvals allow and pauses at the next gate. Gate
  insertion points in `orchestrator.ts`: after research-completeness (before `argument`),
  after the claim-gate (before `visual-evidence-map` — confirmed against the spec's own
  pipeline order, so visual-evidence-map itself is NOT a second human checkpoint), and
  after visual-evidence-map (`PRODUCTION_READY`, before `tts`). Confirmed via grep that
  none of the 5 pre-existing test suites call `OrchestratorAgent`/`.run()` at all, so this
  carried zero direct regression risk to them — though it did surface a *pre-existing*
  `test:v24` fragility once the CLI-vs-Studio approval flow made a real TTS job dispatch
  and complete for real on this machine for the first time (see test notes below).
- **The real fabrication-risk gap the Plan agent found**: the existing claim-gate checks
  (E1: number appears somewhere in research.json; E4: `scriptClaims[].evidenceIds`
  resolve to *existing* ids) never verified a claim's own cited evidence actually supports
  *that specific number* — a retyped or fabricated figure citing real-but-unrelated
  evidence would pass both. New check **E5 "Claim Numeric Fidelity"** in `script-qa.ts`
  (reuses the existing `QUANTITATIVE_CLAIM`/`normalizeNumeric`, now also exported as
  `resolveClaimNumbers`/`extractNumbers`/`numbersMatch` for reuse) resolves each
  `scriptClaim.evidenceIds` through `Claim.dataPointIds`→`DataPoint.value/unit` and direct
  `Evidence.dataValue/unit`, and fails (blocking, not a warning) if the claim's own
  `claimText` asserts a number none of that resolves to. Claims with no structured number
  to check against are skipped — no false positives on qualitative claims.
- **Provenance tagging is additive-only, undefined-safe**: `Evidence`/`DataPoint`/`Claim`
  (`evidence-graph.ts`) gained optional `provenance?: AGENT_GENERATED|HUMAN_EDIT|
  UNVERIFIED` (undefined ⇒ treated as agent-generated, no fixture rewrite forced);
  `ResearchQuestion` gained optional `editedBy?`/`relevant?` — **`relevant` is plain
  `.optional()`, deliberately NOT `.default(true)`**: a schema default there would make
  the OUTPUT type require the field, breaking every existing `ResearchQuestion` object
  literal in `test-v23-research.ts` (`z.infer` on a `.default()` field is optional on
  input, required on output) — hit and fixed during this session, read as
  `relevant !== false` everywhere, never `=== true`. `ScriptClaim` gained
  `provenanceStatus?` (…|PROVENANCE_REQUIRES_REVIEW|HUMAN_OVERRIDDEN) and
  `overrideReason?`/`overriddenAt?`; `ScriptScene` gained `editedBy?`/`originalNarration?`.
- **`PROVENANCE_REQUIRES_REVIEW` actually blocks something** (the Plan agent's other half
  of the E5 finding: "a flag a human can approve straight past is worse than no flag") —
  `assertScriptApproved` refuses approval while any claim carries that status.
  `sceneNarrationMatchesEvidence(scene, evidenceGraph)` (`script-qa.ts`) is the SAME check
  used to both SET the flag (narration edit) and CLEAR it (a later edit that revalidates
  cleanly) — this symmetry mattered: an earlier draft flagged on narration drift but
  cleared based on a DIFFERENT check (`claimText` fidelity, which narration edits never
  touch), so the flag it just set was immediately cleared by its own qa call on the same
  request. `narration-editor.ts`'s `patchNarration` now reads the evidence graph once,
  before the edit, and uses this one function for both directions; `detectFactualDrift` is
  kept as a coarser fallback (numbers-changed-at-all) only for when no evidence graph
  exists. Clearing the flag legitimately also requires an explicit, justified override
  (`POST .../claims/:id/override` → `HUMAN_OVERRIDDEN`, never a silent re-verification).
- **Staleness reuses the existing referential-integrity pattern, not a new dependency
  graph** (`src/research/staleness.ts` `computeStaleness()` — same role as
  `gap-detection.ts`): builds the same `knownIds` union E4 already builds, walks
  evidence-graph claims / script scriptClaims / argument supportingClaims / visual
  opportunities for ids that no longer resolve, and reports exactly which of each are
  affected (spec's own "Evidence E-044 removed → 4 claims, 1 argument section, 3 script
  scenes, 2 visual opportunities" example, worked out by hand in `test:v26`).
- **`design.md` is a distinct, higher-altitude concept from `design/channel-design.json`'s
  `ChannelDesignSchema`, not a duplicate of it** (a Plan-agent-flagged risk):
  `ChannelDesignSchema` is literal, channel-wide, deterministic rendering tokens (hex
  colors, font families, easing curves); the new `ProjectDesignStrategy`
  (`src/schemas/design-strategy.ts`, per-project) is editorial PREFERENCE only — it can
  never carry a hex color or font name, and never overrides `ChannelDesignSchema`. New
  gated agent `DesignStrategistAgent` (`src/agents/design-strategist.ts`, same
  `AgentTaskGate` pattern) only fires when `<project>/design.md` exists; a
  `sourceDesignMdHash` field detects when design.md changed and needs re-interpretation.
  `src/design/design-resolver.ts` `resolveDesignForScene()` does the global→chapter→scene
  "most specific wins" merge (spec §4) as a plain per-field override, not a templating
  engine. `visual-director.ts` gained an additive optional `designStrategy` input;
  TypeScript pre-resolves it per scene into `storyboard/resolved-design-by-scene.json`
  (same "deterministic context file for the agent" role as the existing
  `scene-timing.json`) rather than asking the agent to re-derive override precedence.
  Changing design.md bumps `revisionCounters.design` only — never research/argument/
  script (spec §36's hard rule; verified in `test:v26`). **Deliberately scoped down**:
  spec §37's "render sample HyperFrame compositions to preview the design language" isn't
  achievable without fabricating scene timing/beat data that doesn't exist yet at this
  point in the pipeline (no storyboard/audio timing exists before TTS) — the Design page
  shows the structured `design-strategy.json` as data, not a rendered preview.
- **Studio server**: new `routes/research.ts` + `services/research-editor.ts` (question
  edit/add, evidence edit/add/delete + dry-run removal-impact preview, approve,
  request-more-research — the last reuses `AgentTaskGate` as-is, no new mechanism), new
  `routes/script-review.ts` + `services/script-review.ts` (scene delete/move, claim
  override, approve — re-runs the claim gate but blocks only on its `evidence`-category
  checks, not the full report; unrelated editorial/duration findings the orchestrator's
  own claim-gate stage already assessed at generation time shouldn't re-block a human
  clicking Approve), new `routes/production.ts` + `services/production-state.ts` (the
  spec §27 8-stage dashboard + `POST /start`), new `routes/design.ts` +
  `services/design-service.ts`. `narration-editor.ts` extended in place (tags
  `editedBy:"HUMAN"`, preserves `originalNarration` once, sets/clears provenance via
  `sceneNarrationMatchesEvidence`). `render-jobs.ts`'s `"tts"`/`"full"`/`"produce"` scopes
  all assert approval first; new `JobStatus` values `"blocked"`/`"awaiting_agent"`;
  `http-errors.ts` maps `ProductionGateError`→412. `project-health.ts` gained a
  `NEEDS_REVIEW` signal for `RESEARCH_REVIEW`/`SCRIPT_REVIEW`/`PRODUCTION_READY` phases —
  fixed a real pre-existing bug in passing: its stale-agent-brief filter required
  `t?.artifactPath` truthy, so a task record with no `artifactPath` at all (a hand-built
  fixture, or any malformed/older record) was silently treated as non-blocking; now a
  missing `artifactPath` is treated conservatively as still-blocking (can't verify
  completion), only a *named* artifact that already exists downgrades it.
- **Studio frontend**: `ResearchPage.tsx`/`ScriptPage.tsx` upgraded from pure display to
  real editing in place (question edit/mark-irrelevant, evidence delete with a real
  staleness-impact confirm dialog, request-more-research modal, approve banners; inline
  narration editing, provenance badges incl. `PROVENANCE_REQUIRES_REVIEW`/
  `HUMAN_OVERRIDDEN`, override modal, request-revision modal, approve banner).
  `OverviewPage.tsx`'s production checklist replaced with the real 8-stage
  `ProductionSummary` + a "Start Production" button that only appears at
  `PRODUCTION_READY`. New `DesignPage.tsx` (design.md editor + structured strategy
  viewer) and nav entry. `ProjectsPage.tsx`'s new-project dialog gained an optional
  design.md field. **Explicit frontend scope reductions** (backend supports these, UI
  does not yet): attach/detach evidence to a specific claim, source-metadata correction —
  named here rather than silently deferred, matching this project's usual practice.
- **New test suite `test/test-v26-workbench.ts`** (57 checks): hash-based approval
  validity round-tripping through an edit-then-restore, the script approval gate's
  provenance block, E5/`sceneNarrationMatchesEvidence`/`detectFactualDrift` (including the
  set/clear symmetry test that would have caught the self-defeating-clear bug above), the
  hand-traced staleness example, the design override resolver, and a real-Express-app
  section covering the full research/script review → approve → production/design flow
  end to end. Fixture gotcha worth remembering: the shared `QUANTITATIVE_CLAIM` regex's
  `\d[\d,.]*` greedily swallows a sentence-final period right after a number (e.g.
  `"$42."` extracts as `"42."`, not `"42"`), so fixture claim/narration text that asserts
  a number should not end the sentence immediately after the digits.
- **Existing suites required minimal, justified updates, not workarounds**: `test:v2`,
  `test:generalization`, `test:v22`, `test:v23` needed zero changes.
  `test-v24-dashboard.ts`'s TTS-regeneration section now (a) asserts the *new* mandatory
  block before approval, (b) approves research+script for real before continuing, and (c)
  waits for that job to reach a terminal state before section 16+ start their own jobs
  against the same fixture project — `hasActiveJob`'s per-project concurrency guard
  correctly refuses a second job while the first is still running, which this machine's
  real `.venv-xpu` now genuinely triggers (previously the suite never got far enough to
  dispatch a real job before this session's fixes). `test:v24` is 46/46 (was 43/43).
- **Pre-existing, unrelated gap found, not fixed**: `npm run milestones` (legacy V1
  milestone1-8 tests) fails at milestone3 onward — they hardcode `research/research.json`
  at the **repo root**, which the "Repo cleanup" entry below removed as part of a
  documented, deliberate policy change (no shared root-level workspace). This is not in
  `test:all` and untouched by V2.6; flagged here so a future session doesn't waste time
  assuming it's a regression from this one.
- **Deliberately deferred** (explicit scope decision, not an oversight): the brief's §41
  24-step manual acceptance walkthrough needs real Antigravity research/argument/script
  generation and a real TTS pass — the same limitation V2.3 hit for its own real-topic
  productions. A fixture-driven walkthrough of the same shape is what `test:v26`'s Express
  section exercises instead.

### Repo cleanup

The repo root had a full leftover V1 demo production ("Why AI Memory Prices Are
Exploding") committed at top level — `research/`, `argument/`, `script/`, `storyboard/`,
`audio/`, `compositions/`, `scenes/`, `qa/`, `index.html`, `hyperframes.json`,
`pipeline-state.json` — plus two files with zero references anywhere in the codebase
(`prompts/*.md`, `assets/gsap.min.js`). All removed (`git rm`); verified first that no
test or source file reads any of it (everything real uses `topics/<slug>/` or a temp
fixture dir). `README.md`'s artifact-policy table updated to match — there is no
shared root-level workspace anymore, only `topics/<slug>/`. `config/` and `design/` were
**not** touched — those are real shared infrastructure (channel config, design tokens),
not per-production output.

## Directory map

```
src/agents/            researcher, research-planner, evidence-graph, argument, script,
                        visual-evidence-mapper, visual-director, design-strategist — the 8
                        gated stages + agent-task.ts (the gate), script-qa.ts (claim gate,
                        incl. E5 numeric fidelity + sceneNarrationMatchesEvidence), qa.ts
                        (media QA), storyboard.ts (deterministic assembly), voice.ts (TTS
                        orchestration), visual-scene.ts, design-director.ts
src/research/           evidence-graph-integrity.ts (referential integrity, reused citation
                        validator), gap-detection.ts (deterministic gap/completeness scoring),
                        staleness.ts (V2.6: computeStaleness, reuses the knownIds pattern)
src/orchestrator/       orchestrator.ts (the pipeline), duration-gate.ts, pipeline-state.ts
                        (+ V2.6 productionPhase/approvals/revisionCounters), production-gate.ts
                        (V2.6: ProductionGateError, assertResearchApproved/assertScriptApproved)
src/design/             design-resolver.ts (V2.6: global->chapter->scene override merge)
src/search/             index.ts (local search index + provenance backfill), cli.ts
src/scenes/             primitives.ts (visual modes), scene-generator.ts (beat scheduler +
                        HTML/GSAP emission), scene-hash.ts (fingerprinting)
src/schemas/            zod schemas — research, research-plan, research-questions,
                        evidence-graph, research-gaps, visual-evidence-map, argument, script,
                        storyboard, visual-plan, channel (config + calibration),
                        timestamps (+ measurement block), production-state.ts (V2.6 phase/
                        approval), design-strategy.ts (V2.6, distinct from design.ts's
                        ChannelDesignSchema — see V2.6 notes), staleness.ts, research-addendum.ts
src/system/             runtime.ts (env/device/binary resolution — the single source of truth)
src/tts/                chatterbox.ts, worker-client.ts (+ ChatterboxSession), chatterbox_worker.py
src/renderers/          hyperframes.ts (spawns via process.execPath, injects ffmpeg PATH)
src/qa/                 visual-style.ts (rhythm + repetition QA)
src/media/              ffmpeg.ts, subtitles.ts
scripts/bootstrap.mjs   cross-platform TTS env setup (npm run setup:tts[:xpu])
test/                   milestone1-8 (V1, see gotcha re: root research/ dependency),
                        test-v2-pipeline.ts (65 checks), test-generalization.ts (26 checks),
                        test-v22-regression.ts (95 checks), test-v23-research.ts (80 checks,
                        fixture-based), test-v24-dashboard.ts (46 checks, real Express app +
                        fixture project), test-v26-workbench.ts (57 checks, V2.6 gate/
                        provenance/staleness + real Express app)
topics/<slug>/          per-topic workspaces (research/argument/script/storyboard/audio/
                        visual-evidence/renders/qa/final.mp4) — produced via
                        npm run produce -- "<topic>" -w
studio/server/          Express API (V2.4/V2.6) — routes/ (projects, scenes, search, audio,
                        qa, render, export, revisions, settings, media, + V2.6 research,
                        script-review, production, design), services/ (workspace.ts is the
                        only place a projectId becomes a filesystem path; artifact-reader.ts,
                        project-health.ts, scene-view.ts, beat-editor.ts, narration-editor.ts,
                        render-jobs.ts, revisions.ts, events.ts, + V2.6 research-editor.ts,
                        script-review.ts, production-state.ts, design-service.ts),
                        app.ts (pure factory, importable by tests), index.ts (listen() entry)
studio/web/             React 19 / Vite frontend (V2.4/V2.5/V2.6) — src/styles/ (tokens.css,
                        components.css, editor.css, research-script.css, audio-qa-export.css),
                        src/pages/ (Projects, Overview, Editor, Research, Script, Design (V2.6),
                        Storyboard, Audio, Sources, Search, QA, Export, Settings), src/components/
                        (Icons, SceneBrowser, Preview, Timeline, Inspector, ProvenancePanel,
                        SearchPalette, JobsPanel, HealthBadge), src/router.tsx (hash router)
studio/revisions/       per-project undo/redo log + snapshots (gitignored, outside topics/)
```

## Environment (do not re-discover this)

- **Node**: v24, run via `tsx`.
- **Python**: `.venv` (CPU, reference path) and `.venv-xpu` (Intel Arc via torch XPU
  build) are BOTH `uv`-provisioned Python **3.12**. System Python on this machine is
  3.14 — Chatterbox cannot build on it. `SUPPORTED_PYTHON` range in `runtime.ts` is
  3.10–3.12. Never assume system `python`/`python3` is usable.
- **TTS device**: `TTS_DEVICE=cpu` (measured ~4.0–4.5x real-time) or `TTS_DEVICE=xpu`
  (measured ~3.1x real-time in-pipeline, ~2.1x in an isolated warmed benchmark — slower
  than CPU on short clips due to per-call kernel-compile overhead, faster on real
  documentary-length scenes). Chatterbox checkpoints are serialized as CUDA tensors;
  `chatterbox_worker.py` patches `torch.load`'s `map_location` for any non-cpu device or
  deserialization fails. `cuda` is a recognized device value but this machine's NVIDIA
  adapter is a legacy part with no modern CUDA runtime — preflight refuses it.
- **HyperFrames**: spawn via `process.execPath` + the package's `bin/hyperframes.mjs`,
  never the `.bin/hyperframes` shim (unspawnable on Windows: no shell, no `.cmd`
  handling in `execFile`).
- **ffmpeg/ffprobe**: come from `ffmpeg-static` / `@ffprobe-installer/ffprobe` npm
  packages, not a system install. `HyperFramesRenderer.buildEnv()` injects their
  directories onto the child process PATH.
- **Config calibration**: `config/channel.json` → `video.calibration` currently holds a
  real measurement (189 wpm, from the battery production's 1366 words / 433.2s on CPU).
  Recalibrate by writing a new block from any production's
  `audio/timestamps.json.measurement` — see `calibrationFromMeasurement()` in
  `duration-gate.ts`. Don't hand-edit the number without updating provenance fields.

## Known gotchas (hit these once already)

1. **Two TTS worker processes on the same GPU will silently corrupt timing, not
   correctness.** Killing a background `npm run produce` job does not always kill the
   spawned Python child — check `Get-Process python` before starting a second run
   against the same device. The resume logic (probe + narration-hash check) correctly
   adopts a WAV written by an orphaned process, so output is not silently wrong, but
   generation-time measurements from that window are garbage (one scene was observed at
   23x real-time — a symptom of GPU contention, not a real regression).
2. **A CPU-heavy stage (e.g. HyperFrames render) and an XPU TTS run compete for the same
   physical package** — expect XPU throughput to be visibly worse while a CPU render is
   in flight. Sequence them if timing matters.
3. **The `highlight`/`compare` beat emphasis re-highlights the *last revealed group*,
   not necessarily the group matching the plan's `focus.primary` label.** This is
   correct-but-imprecise: known refinement, not a correctness bug. If a Visual Director
   plan's `focus.primary` needs to map to a *specific* earlier-revealed group rather than
   the most recent one, `buildBeatSchedule` in `scene-generator.ts` needs a focus→group
   lookup, which doesn't exist yet.
4. **Scene fingerprints are formatting-independent but field-complete** — if you add a
   new field to `StoryboardScene` that affects rendering, add it to
   `computeSceneFingerprint()` in `scene-hash.ts` or edits to it will silently reuse
   stale compositions.
5. `.wav` files are gitignored by design (ephemeral cache, see README "Artifact policy").
   A fresh clone has no narration audio; `npm run produce` regenerates it scene-by-scene
   from the committed `script/script.json` — this is expected, not a bug.
6. **The V2.3 research-intelligence stages are mandatory going forward, not opt-in.**
   `orchestrator.ts` calls `research-planner`/`evidence-graph`/`research-completeness`
   unconditionally before `argument`, same as every other stage's `ensure()` already
   worked. There is no bypass flag. A topic workspace produced before this session (or
   any workspace missing `research/research-plan.json`) will halt on its next `produce`
   run asking for the new artifacts — this is intended (see V2.3 session notes), not a
   regression in the three already-completed productions' existing output.
7. **The V2.3 test suite is fixture-only** — it proves the schemas/gates/deterministic
   scoring work correctly against hand-built data, not that a real Antigravity research
   pass through the new stages produces a good documentary. That end-to-end validation
   (three real topics across different domains, per spec §32) is still open; see the
   V2.3 session notes above.
8. **V2.6: TTS/visual production is gated behind human approval by default in Documentary
   Studio, but NOT in the CLI.** `npm run produce` behaves exactly as before (fully
   autonomous) unless you pass `--require-review`. Studio always gates — a "Generate"
   click now naturally pauses at `RESEARCH_REVIEW`/`SCRIPT_REVIEW`/`PRODUCTION_READY`
   instead of running straight through to a finished MP4; this is intended, not a hang.
9. **Approval validity is a content hash, not "has this ever been approved."** Editing
   `research/evidence-graph.json`, `research/research-questions.json`, or
   `script/script.json` after approving invalidates that approval immediately (checked in
   `assertResearchApproved`/`assertScriptApproved`); restoring the exact prior content
   (including via revision undo) re-validates it. Don't try to track approval validity by
   a version/revision number — `revisionCounters.*` is display-only.
10. **`npm run milestones` (legacy V1) is currently broken from milestone3 onward** — it
    hardcodes `research/research.json` at the repo root, which the "Repo cleanup" entry
    below intentionally removed. Not caused by V2.6, not in `test:all`; needs its own
    future fix (either restore a root fixture or point the legacy tests at a workspace).

## Running things

```bash
npm install && npm run setup:tts            # first-time setup (CPU path)
npm run setup:tts:xpu                        # optional: Intel Arc path
npm run runtime                              # verify environment resolves cleanly
npm run produce -- "<topic>" -w              # produce a documentary in topics/<slug>/ (autonomous)
npm run produce -- "<topic>" -w --plan-only  # stop after the claim gate, before TTS
npm run produce -- "<topic>" -w --require-review  # V2.6: pause for human research/script approval
npm run search -- "<query>" -d topics/<slug> # search a workspace's research/script/index
npm run studio                               # build the web UI once, serve it + the API on :4317
npm run studio:server                        # API only (tsx watch), for backend iteration
npm run studio:web                           # Vite dev server on :5173, proxies /api to :4317
npm run test:all                             # typecheck + web typecheck + test:v2/generalization/v22/v23/v24/v26
```

## Verified state as of end of this session

- `npm run typecheck` — clean (includes `studio/server/**/*`)
- `npm run studio:web:typecheck` — clean (zero TypeScript errors across all upgraded pages/components)
- `npm run studio:web:build` — clean production Vite build
- `npm run test:v2` — 65/65
- `npm run test:generalization` — 26/26
- `npm run test:v22` — 95/95
- `npm run test:v23` — 80/80 (V2.3, fixture-based)
- `npm run test:v24` — 46/46 (V2.4 Express API + real fixture project; includes a real TTS
  run through to completion and a real HyperFrames scene render on this machine's
  `.venv-xpu`, plus 3 new V2.6-aware assertions — see V2.6 session notes)
- `npm run test:v26` — 57/57 (V2.6: gate/approval/provenance/staleness + real Express app)
- `npm run test:all` — exits 0, all 8 checks (typecheck, web typecheck, v2, generalization,
  v22, v23, v24, v26) green
- `npm run milestones` (legacy V1) — **broken from milestone3 onward**, pre-existing and
  unrelated to V2.6 (see gotcha #10); not part of `test:all`.
- `npm run studio` build + serve verified, including the V2.6 Research/Script review
  workbenches (question/evidence edit, approve, request-more-research), the Design page,
  and the Overview page's real 8-stage production dashboard + Start Production button.
- Three independently produced, fully rendered documentaries with media QA PASS (from
  before this session; not re-run through the V2.3/V2.6 gates — see gotchas #6/#8):
  - `topics/why-modern-batteries-are-still-expensive/final.mp4` (433.2s / 7.2min)
  - `topics/how-a-semiconductor-fab-actually-works/final.mp4`
  - `topics/why-the-panama-canal-ran-out-of-water/final.mp4` (517.4s / 8.6min)
- No real production has yet been run through the new research-planner/evidence-graph/
  visual-evidence-map gates, nor through the new V2.6 human-approval workflow end to end
  with real Antigravity-authored research/script — deliberately deferred, see V2.3 and
  V2.6 session notes.
- Working tree is **uncommitted** — review before committing.
