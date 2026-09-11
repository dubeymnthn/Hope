# Autonomous Documentary Factory

A local-only pipeline that turns a topic into a verified ~10-minute documentary MP4.
Reasoning stages (research, argument, script, visual direction) are performed by the
Antigravity agent against task briefs the pipeline emits; TypeScript is deterministic
infrastructure — validation, hashing, checkpointing, rendering coordination and QA.

```
TOPIC → RESEARCH → ARGUMENT → SCRIPT → CLAIM GATE → TTS → ALIGNMENT
      → VISUAL DIRECTOR → PARAMETERIZED SCENES → HYPERFRAMES → FFMPEG → CAPTIONS → MEDIA QA → MP4
```

## Fresh-clone setup

```bash
npm install                 # Node deps, ffmpeg-static, ffprobe, HyperFrames, GSAP
npm run setup:tts           # Python 3.12 venv (.venv) + chatterbox-tts, via uv
npm run setup:tts:xpu       # optional: Intel Arc build in .venv-xpu
npm run runtime             # print the resolved environment; non-zero exit on problems
```

Requirements the bootstrap enforces rather than assumes:

| Component | Requirement | Why |
|---|---|---|
| Node | v20+ (tested v24) | HyperFrames is invoked through the Node binary, not a shell shim |
| Python | **3.10 – 3.12** via `uv` | Chatterbox's dependency tree has no wheels for 3.13/3.14 (`spacy-pkuseg` needs MSVC to build) |
| `uv` | on PATH | provisions the supported Python itself |
| ffmpeg / ffprobe | from npm packages | no system install; paths are injected into HyperFrames' environment |

The runtime resolver (`src/system/runtime.ts`) is the single place that knows how to
locate interpreters and binaries per platform. Nothing else constructs `.venv/bin/python`
or `Scripts/python.exe` by hand.

## Producing a documentary

```bash
npm run produce -- "<topic>" -w            # per-topic workspace in topics/<slug>/
npm run produce -- "<topic>" -w --plan-only # stop after the claim gate, before TTS
```

When a reasoning artifact is missing, the pipeline writes a brief to
`<workspace>/agent-tasks/<stage>.task.md` (embedding the Zod schema and the anti-fabrication
rules), records `awaiting_agent`, and exits **2**. The agent completes the work and the
pipeline is re-run; it resumes from that boundary.

### Device selection

`TTS_DEVICE=cpu` is the reference path. `TTS_DEVICE=xpu` uses `.venv-xpu`. Unset, an
existing `.venv-xpu` is treated as an opt-in. The preflight refuses unsupported devices
with an actionable message rather than falling back silently.

### Duration is measured, not padded

Scripts are planned against `config.video.calibration.ttsWordsPerMinute` — a rate
**measured from a real production** and recorded with its provenance (`measuredAt`,
`measuredFrom`, `sampleWords`, `sampleSeconds`, `device`). After synthesis, the measured
runtime is checked against the target band. Outside the acceptable range the pipeline
**stops and asks the agent to revise**; it never pads, repeats, or stretches speech.
Every run records its own measured rate in `audio/timestamps.json` for recalibration.

## Artifact policy (what survives a clone)

Every production lives entirely under its own `topics/<slug>/` workspace — there is no
shared root-level workspace. `topics/` itself is gitignored, so no production output is
committed; only the pipeline that produces it is.

| Class | Paths | Committed? |
|---|---|---|
| Source | `src/`, `studio/`, `test/`, `scripts/` | yes |
| Configuration | `config/`, `design/` | yes |
| Per-topic pipeline metadata | `topics/<slug>/{research,argument,script,storyboard}/*.json`, `topics/<slug>/audio/timestamps.json`, `topics/<slug>/audio/captions.srt`, `topics/<slug>/pipeline-state.json`, `topics/<slug>/qa/*.json` | **no** — regenerated per topic |
| Cache | `topics/<slug>/audio/*.wav`, `topics/<slug>/audio/tts-cache.json`, `topics/<slug>/compositions/`, `topics/<slug>/scenes/*.meta.json` | **no** — regenerated |
| Generated media | `topics/<slug>/renders/`, `topics/<slug>/final.mp4`, `topics/<slug>/qa/snapshots/` | **no** — regenerated |
| Studio state | `studio/revisions/` (per-project undo/redo log) | **no** — local-only |

WAVs are deliberately ephemeral: they are large and fully regenerable. After a fresh
clone, `npm run produce -- "<topic>" -w` starts a topic from nothing: the reasoning
stages gate on the Antigravity agent, and once those artifacts exist, narration is
re-synthesised scene by scene, checkpointing each WAV so an interruption resumes from
the next scene.

## Resume and invalidation

Every stage is resumable. TTS resumes at scene granularity from `audio/tts-cache.json`.
Version bumps invalidate only what they affect: `versions.visualGenerator` rebuilds
compositions and the render but leaves research, argument, script and narration cached.

## Documentary Studio (local web UI)

A local dashboard/editor sits on top of the pipeline — project library, script/research/
storyboard explorers, a scene+beat editor, search, QA, and export — reading and writing
the same artifacts above through a small Express API (`studio/server/`) rather than a
second pipeline.

```bash
npm run studio         # build the UI once, serve it + the API together on :4317
npm run studio:server  # API only (tsx watch), for backend iteration
npm run studio:web     # Vite dev server on :5173 with HMR, proxies /api to :4317
```

## Tests

```bash
npm run typecheck
npm run studio:web:typecheck
npm run milestones           # 8 V1 milestones
npm run test:v2              # V2 pipeline verification
npm run test:generalization  # two-topic structural divergence
npm run test:v22             # V2.2 regression matrix
npm run test:v23             # V2.3 research-intelligence regression matrix
npm run test:v24             # V2.4 documentary-studio regression matrix
npm run test:all
```
