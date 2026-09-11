import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { StoryboardScene, VisualMode, VisualBeat } from "../schemas/storyboard.js";
import { ChannelDesign } from "../schemas/design.js";
import { computeSceneFingerprint } from "./scene-hash.js";
import {
  PRIMITIVE_REGISTRY,
  FALLBACK_CHAIN,
  PrimitiveOutput,
  esc,
  hashInt
} from "./primitives.js";

export interface GenerationResult {
  sceneId: string;
  htmlPath: string;
  metaPath: string;
  fingerprint: string;
  reused: boolean;
  /** Mode actually rendered, which may differ from the requested mode after degradation. */
  renderedMode?: VisualMode;
  /** Structural signature of the composition, consumed by anti-repetition QA. */
  layoutSignature?: string;
  degraded?: string;
  /** Beat-driven visual state metrics, consumed by visual QA (spec V2.2 §14). */
  rhythm?: SceneRhythmMetrics;
}

/**
 * What the composition actually does over time, measured from the beats it was built
 * from rather than asserted. Visual QA reads this from each scene's meta file.
 */
export interface SceneRhythmMetrics {
  beatCount: number;
  /** Beats whose changeType is not `hold` (or that lack a type but carry a visualChange). */
  visualStateChangeCount: number;
  /** Distinct named visual states across the scene's beats. */
  uniqueVisualStates: number;
  /** Longest run, in seconds, where the composition's state does not change. */
  longestNoChangeInterval: number;
  /** Beats over the ~15s guideline that carry an explicit justification. */
  justifiedLongBeats: number;
  /** Beats over the ~15s guideline with no justification: diagnostics, not failures. */
  unjustifiedLongBeats: number;
  /** Beats where `focus.primary` differs from the previous beat. */
  focusChanges: number;
  changeTypes: string[];
  /** Element groups the primitive exposed for beat-sequenced reveal. */
  beatSequencedGroups: number;
}

/** Beats past this length must say why the viewer needs the time (spec V2.2 §10). */
export const LONG_BEAT_GUIDELINE_SECONDS = 15;

/**
 * Scene composition generator.
 *
 * Renders a StoryboardScene into a self-contained HyperFrames composition. All creative
 * decisions arrive in the scene data from the Antigravity Visual Director; this class only
 * decides HOW to draw the requested mode (spec sections 12, 15, 27).
 *
 * V2.2: beats are no longer metadata. Each beat schedules a visual state change on the
 * GSAP timeline — element groups tagged `data-beat-seq` reveal on their beat, `highlight`
 * beats shift emphasis, `zoom`/`pan` beats move the camera for that beat only — so the
 * frame evolves with the narration instead of animating once and holding (spec §9-§12).
 */
export class SceneCompositionGenerator {
  async generateScene(
    scene: StoryboardScene,
    options: {
      design: ChannelDesign;
      designVersion: string;
      outputDir: string;
      videoId?: string;
      /** Where node_modules lives, when outputDir is a per-topic directory. */
      repoRoot?: string;
    }
  ): Promise<GenerationResult> {
    const { design, designVersion, outputDir, videoId = "video-factory" } = options;
    const repoRoot = options.repoRoot ? resolve(options.repoRoot) : process.cwd();

    const compositionsDir = join(outputDir, "compositions");
    const scenesMetaDir = join(outputDir, "scenes");
    mkdirSync(compositionsDir, { recursive: true });
    mkdirSync(scenesMetaDir, { recursive: true });

    this.ensureGsap(outputDir, repoRoot);

    const fingerprint = computeSceneFingerprint({ videoId, scene, designVersion });
    const htmlPath = join(compositionsDir, `${scene.id}.html`);
    const metaPath = join(scenesMetaDir, `${scene.id}.meta.json`);

    // Idempotency: reuse an existing composition when the fingerprint matches exactly.
    if (existsSync(htmlPath) && existsSync(metaPath)) {
      try {
        const existingMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
        if (existingMeta.fingerprint === fingerprint) {
          console.log(`[SCENE-GEN] Scene ${scene.id} unchanged (${fingerprint.slice(0, 12)}). Reusing.`);
          return {
            sceneId: scene.id,
            htmlPath,
            metaPath,
            fingerprint,
            reused: true,
            renderedMode: existingMeta.renderedMode,
            layoutSignature: existingMeta.layoutSignature,
            degraded: existingMeta.degraded,
            rhythm: existingMeta.rhythm
          };
        }
      } catch {
        // Unreadable metadata: fall through and regenerate.
      }
    }

    const requestedMode = (scene.visual_mode || scene.visual_type) as VisualMode;
    const { output, renderedMode, degraded } = this.renderWithFallback(scene, design, requestedMode);

    console.log(
      `[SCENE-GEN] Composing ${scene.id} [${renderedMode}]` +
        (degraded ? ` (degraded from ${requestedMode}: ${degraded})` : "")
    );

    const shellVariant = hashInt(`${scene.id}:${renderedMode}`) % 3;
    const layoutSignature = `${output.signature}|shell=${shellVariant}`;
    const beats = this.normalizeBeats(scene);
    const rhythm = this.measureRhythm(beats, output.html);

    const fullHtml = this.buildDocument({ scene, design, output, renderedMode, shellVariant, beats });
    writeFileSync(htmlPath, fullHtml, "utf-8");

    writeFileSync(
      metaPath,
      JSON.stringify(
        {
          sceneId: scene.id,
          fingerprint,
          requestedMode,
          renderedMode,
          layoutSignature,
          degraded,
          duration: scene.duration,
          beats: beats.length,
          rhythm,
          dataPoints: scene.data_points?.length ?? 0,
          sourceReferences: scene.source_references?.length ?? 0,
          onScreenText: scene.on_screen_text,
          renderedAt: new Date().toISOString()
        },
        null,
        2
      ),
      "utf-8"
    );

    return {
      sceneId: scene.id,
      htmlPath,
      metaPath,
      fingerprint,
      reused: false,
      renderedMode,
      layoutSignature,
      degraded,
      rhythm
    };
  }

  /**
   * Renders the requested mode, degrading along the fallback chain when the mode's data
   * is missing. Degrading is always preferable to inventing data to fill a chart.
   */
  private renderWithFallback(
    scene: StoryboardScene,
    design: ChannelDesign,
    requestedMode: VisualMode
  ): { output: PrimitiveOutput; renderedMode: VisualMode; degraded?: string } {
    const attempt = (mode: VisualMode) => {
      const primitive = PRIMITIVE_REGISTRY[mode];
      if (!primitive) return null;
      return primitive({ scene, design, variant: hashInt(scene.id + mode) });
    };

    const first = attempt(requestedMode);
    if (first && !first.insufficientData) {
      return { output: first, renderedMode: requestedMode };
    }

    const reason = first?.insufficientData ?? `no primitive registered for "${requestedMode}"`;

    for (const fallback of FALLBACK_CHAIN) {
      if (fallback === requestedMode) continue;
      const out = attempt(fallback);
      if (out && !out.insufficientData) {
        console.warn(`[SCENE-GEN] ${scene.id}: ${reason} Falling back to "${fallback}".`);
        return { output: out, renderedMode: fallback, degraded: reason };
      }
    }

    throw new Error(
      `[SCENE-GEN] Scene ${scene.id} cannot be rendered: ${reason} and every fallback also ` +
        `lacked usable content. The Visual Director must supply data for this scene.`
    );
  }

  /** Sorted, clamped beats; a scene with none gets a single establishing beat. */
  private normalizeBeats(scene: StoryboardScene): VisualBeat[] {
    const dur = scene.duration;
    const sorted = [...(scene.beats ?? [])]
      .sort((a, b) => a.startOffset - b.startOffset)
      .map((b) => ({
        ...b,
        startOffset: Math.max(0, Math.min(b.startOffset, dur)),
        endOffset: Math.max(0, Math.min(b.endOffset, dur))
      }))
      .filter((b) => b.endOffset > b.startOffset);
    if (sorted.length === 0) {
      return [
        {
          beatId: "beat-1",
          startOffset: 0,
          endOffset: dur,
          purpose: scene.narrative_purpose ?? "Establish",
          visualChange: scene.visual_description,
          changeType: "establish"
        }
      ];
    }
    return sorted;
  }

  /** Measures what the beats actually do, for visual QA (spec V2.2 §14). */
  private measureRhythm(beats: VisualBeat[], html: string): SceneRhythmMetrics {
    const isChange = (b: VisualBeat) => b.changeType !== "hold";
    const states = new Set(beats.map((b) => (b.visualState || b.visualChange || "").trim()).filter(Boolean));

    let longest = 0;
    let runStart = beats[0]?.startOffset ?? 0;
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      const next = beats[i + 1];
      // A hold extends the current no-change run; any other beat starts a new one.
      if (!isChange(b) && i > 0) {
        // continue run
      } else {
        runStart = b.startOffset;
      }
      const runEnd = next ? next.startOffset : b.endOffset;
      longest = Math.max(longest, runEnd - runStart);
    }

    let justified = 0;
    let unjustified = 0;
    for (const b of beats) {
      const len = b.endOffset - b.startOffset;
      if (len > LONG_BEAT_GUIDELINE_SECONDS || b.changeType === "hold") {
        if (b.holdJustification && b.holdJustification.trim().length > 0) justified++;
        else unjustified++;
      }
    }

    let focusChanges = 0;
    for (let i = 1; i < beats.length; i++) {
      const prev = beats[i - 1].focus?.primary?.trim();
      const cur = beats[i].focus?.primary?.trim();
      if (prev && cur && prev !== cur) focusChanges++;
    }

    const groups = new Set(Array.from(html.matchAll(/data-beat-seq="(\d+)"/g)).map((m) => m[1])).size;

    return {
      beatCount: beats.length,
      visualStateChangeCount: beats.filter(isChange).length,
      uniqueVisualStates: states.size,
      longestNoChangeInterval: Math.round(longest * 100) / 100,
      justifiedLongBeats: justified,
      unjustifiedLongBeats: unjustified,
      focusChanges,
      changeTypes: [...new Set(beats.map((b) => b.changeType).filter((t): t is NonNullable<typeof t> => !!t))],
      beatSequencedGroups: groups
    };
  }

  private buildDocument(params: {
    scene: StoryboardScene;
    design: ChannelDesign;
    output: PrimitiveOutput;
    renderedMode: VisualMode;
    shellVariant: number;
    beats: VisualBeat[];
  }): string {
    const { scene, design, output, renderedMode, shellVariant, beats } = params;
    const hasHeadline = scene.on_screen_text.trim().length > 0;
    const sources = scene.source_references ?? [];

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${esc(scene.id)}${hasHeadline ? ` - ${esc(scene.on_screen_text)}` : ""}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: ${design.colors.background};
      color: ${design.colors.text};
      font-family: ${design.typography.fontFamilyBody};
      -webkit-font-smoothing: antialiased;
    }

    #root {
      width: ${design.canvas.width}px;
      height: ${design.canvas.height}px;
      position: relative;
      overflow: hidden;
      display: grid;
      grid-template-rows: auto 1fr auto;
      row-gap: 34px;
      padding: ${design.canvas.safeZone.top}px ${design.canvas.safeZone.right}px ${design.canvas.safeZone.bottom}px ${design.canvas.safeZone.left}px;
      background-color: ${design.colors.background};
    }

    /* Shell variants shift emphasis and alignment so compositions do not share one
       layout signature across the documentary (spec sections 20, 24). */
    .shell-0 .s-head { align-items: flex-start; }
    .shell-1 .s-head { align-items: flex-start; border-left: 2px solid ${design.colors.primary}; padding-left: 24px; }
    .shell-2 { grid-template-rows: 1fr auto auto; }
    .shell-2 .s-head { order: 2; }
    .shell-2 .s-stage { order: 1; }

    .s-head { display: flex; flex-direction: column; gap: 12px; z-index: 5; }
    .s-eyebrow {
      font-family: ${design.typography.fontFamilyCode};
      font-size: 14px; letter-spacing: 0.16em; text-transform: uppercase;
      color: ${design.colors.textFaint};
    }
    .s-headline {
      font-family: ${design.typography.fontFamilyDisplay};
      font-size: ${design.typography.scale.h2};
      font-weight: ${design.typography.weights.bold};
      line-height: 1.12; letter-spacing: -0.015em;
      color: ${design.colors.text}; max-width: 30ch;
    }
    .s-stage { display: flex; align-items: center; min-height: 0; z-index: 4; }
    .s-foot {
      display: flex; justify-content: space-between; align-items: flex-end;
      border-top: 1px solid ${design.colors.surfaceBorder}; padding-top: 16px;
      font-family: ${design.typography.fontFamilyCode}; font-size: 13px;
      color: ${design.colors.textFaint}; letter-spacing: 0.05em; z-index: 5;
    }
    .s-sources { max-width: 70%; }

    /* Beat emphasis: a highlighted group reads first; everything else recedes. This is
       eye-trace by contrast, not decoration (spec V2.2 §11). */
    .beat-dim { opacity: 0.38; }
    .beat-emphasis { opacity: 1; }

    ${output.css}
  </style>
  <script src="assets/gsap.min.js"></script>
</head>
<body>
  <div id="root" class="shell-${shellVariant}" data-composition-id="${esc(scene.id)}" data-start="0" data-duration="${scene.duration}" data-fps="${design.canvas.fps}" data-width="${design.canvas.width}" data-height="${design.canvas.height}">

    <header class="s-head">
      ${scene.chapter ? `<div class="s-eyebrow" id="s-eyebrow">${esc(scene.chapter)}</div>` : ""}
      ${hasHeadline ? `<h1 class="s-headline" id="s-headline">${esc(scene.on_screen_text)}</h1>` : ""}
    </header>

    <main class="s-stage" id="s-stage">
      ${output.html}
    </main>

    <footer class="s-foot">
      ${sources.length > 0 ? `<div class="s-sources">${esc(sources.join("  ·  "))}</div>` : "<div></div>"}
      <div></div>
    </footer>
  </div>

  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    window.__timelines["${esc(scene.id)}"] = tl;
    const EASE = "${design.motion.easeDefault}";

    // Hold the full scene duration so the composition never ends before the narration.
    tl.to({}, { duration: ${scene.duration} }, 0);

    ${hasHeadline ? `tl.from("#s-headline", { opacity: 0, y: 16, duration: 0.7, ease: EASE }, 0.05);` : ""}
    ${scene.chapter ? `tl.from("#s-eyebrow", { opacity: 0, duration: 0.5 }, 0);` : ""}

    // ---- Primitive entrance (its own internal choreography) ----
${output.gsap}

${this.buildBeatSchedule(beats, scene, design, output.html)}
  </script>
</body>
</html>`;
  }

  /**
   * Turns beats into timeline events so the visual state evolves with the narration
   * (spec V2.2 §9-§12).
   *
   *  - Element groups tagged data-beat-seq="N" are hidden at t=0 and revealed at beat N's
   *    start, so a five-row chart builds row by row as the narration reaches each value
   *    instead of appearing all at once and holding for 25 seconds.
   *  - `highlight` / `compare` beats dim everything except the group for that beat.
   *  - `zoom` / `pan` beats move the camera for that beat only; other beats stay still.
   *  - `hold` beats schedule nothing: a hold is a deliberate absence of change.
   *
   * When a primitive exposes fewer groups than there are beats, later beats fall back to
   * emphasis shifts so there is still a visible reason to look.
   */
  /**
   * Distributes the primitive's element groups across the reveal beats so that every
   * group is on screen by the time the last revealing beat lands, whether the primitive
   * exposed more groups than there are beats or fewer. Returns, per beat, the inclusive
   * range [from, to) of group sequence numbers that beat reveals; `to` of the final
   * revealing beat always equals the group count.
   */
  static distributeGroups(groupCount: number, beats: VisualBeat[]): Array<[number, number]> {
    const revealing = beats.map((b, i) => i).filter((i) => beats[i].changeType !== "hold");
    const ranges: Array<[number, number]> = beats.map(() => [0, 0]);
    if (groupCount <= 0 || revealing.length === 0) return ranges;
    const n = revealing.length;
    revealing.forEach((beatIdx, k) => {
      const from = Math.round((k * groupCount) / n);
      const to = k === n - 1 ? groupCount : Math.round(((k + 1) * groupCount) / n);
      ranges[beatIdx] = [from, Math.max(from, to)];
    });
    return ranges;
  }

  private buildBeatSchedule(beats: VisualBeat[], scene: StoryboardScene, design: ChannelDesign, html: string): string {
    if (beats.length <= 1) {
      return `    // single beat: the primitive's entrance is the establishing state`;
    }

    // Group count is known at generation time, so the group→beat mapping is computed here
    // and emitted as data. The runtime never has to guess how many groups exist.
    const groupCount = new Set(Array.from(html.matchAll(/data-beat-seq="(\d+)"/g)).map((m) => m[1])).size;
    const ranges = SceneCompositionGenerator.distributeGroups(groupCount, beats);

    const lines: string[] = [];
    lines.push(`    // ---- Beat schedule (${beats.length} beats, ${groupCount} element groups) ----`);
    lines.push(`    const groups = Array.from(document.querySelectorAll("[data-beat-seq]"));`);
    lines.push(`    const seqOf = (g) => Number(g.getAttribute("data-beat-seq"));`);
    lines.push(`    const inRange = (from, to) => groups.filter(g => seqOf(g) >= from && seqOf(g) < to);`);
    lines.push(`    // Per-beat reveal ranges [from, to) over group sequence numbers.`);
    lines.push(`    const RANGES = ${JSON.stringify(ranges)};`);
    lines.push(``);
    // Everything beyond the first beat's range is held back until its beat arrives.
    // The primitive's own entrance still animates the first range.
    const firstTo = ranges[0]?.[1] ?? 0;
    if (groupCount > firstTo) {
      lines.push(`    { const later = inRange(${firstTo}, ${groupCount}); if (later.length) gsap.set(later, { opacity: 0 }); }`);
      lines.push(``);
    }

    beats.forEach((b, i) => {
      const t = Math.max(0, Math.round(b.startOffset * 100) / 100);
      const len = Math.max(0.2, b.endOffset - b.startOffset);
      const type = b.changeType ?? (i === 0 ? "establish" : "reveal");
      const [from, to] = ranges[i];
      // Groups revealed by the end of this beat; emphasis never touches anything beyond it.
      const revealedThrough = Math.max(to, ...ranges.slice(0, i + 1).map((r) => r[1]));
      const label = `${b.beatId} ${type}${b.narrationReference ? ` — ${b.narrationReference}` : ""}`;
      lines.push(`    // beat ${i + 1}/${beats.length} @ ${t}s (${len.toFixed(1)}s): ${this.jsComment(label)} | reveals [${from},${to})`);

      if (type === "hold") {
        lines.push(`    // hold: no visual change by design${b.holdJustification ? ` (${this.jsComment(b.holdJustification)})` : ""}`);
        return;
      }

      if (i > 0 && to > from) {
        lines.push(`    tl.to(inRange(${from}, ${to}), { opacity: 1, y: 0, duration: 0.6, ease: EASE, stagger: 0.08 }, ${t});`);
      } else if (i > 0 && groupCount > 0) {
        // More beats than groups: nothing new to reveal, so this beat shifts emphasis to
        // the most recently revealed group instead so there is still a reason to look.
        lines.push(`    tl.to(inRange(0, ${revealedThrough}), { opacity: 0.38, duration: 0.5 }, ${t});`);
        lines.push(`    tl.to(inRange(${Math.max(0, revealedThrough - 1)}, ${revealedThrough}), { opacity: 1, duration: 0.5 }, ${t});`);
      }

      switch (type) {
        case "highlight":
        case "compare": {
          // Dim only what is already on screen, then lift this beat's groups.
          const focusFrom = to > from ? from : Math.max(0, revealedThrough - 1);
          const focusTo = to > from ? to : revealedThrough;
          lines.push(`    if (${revealedThrough} > 1) {`);
          lines.push(`      tl.to(inRange(0, ${revealedThrough}), { opacity: 0.38, duration: 0.45, ease: EASE }, ${t + 0.1});`);
          lines.push(`      tl.to(inRange(${focusFrom}, ${focusTo}), { opacity: 1, duration: 0.45, ease: EASE }, ${t + 0.1});`);
          lines.push(`    }`);
          break;
        }
        case "resolve":
        case "reframe":
          // Bring everything revealed so far back to equal weight for the payoff.
          lines.push(`    tl.to(inRange(0, ${revealedThrough}), { opacity: 1, duration: 0.6, ease: EASE }, ${t});`);
          break;
        case "zoom":
          lines.push(`    tl.fromTo("#s-stage", { scale: 1 }, { scale: 1.04, duration: ${len.toFixed(2)}, ease: "none" }, ${t});`);
          break;
        case "pan":
          lines.push(`    tl.fromTo("#s-stage", { xPercent: -0.8 }, { xPercent: 0.8, duration: ${len.toFixed(2)}, ease: "none" }, ${t});`);
          break;
        case "remove": {
          const prevFrom = ranges[i - 1]?.[0] ?? 0;
          const prevTo = ranges[i - 1]?.[1] ?? 0;
          if (prevTo > prevFrom) lines.push(`    tl.to(inRange(${prevFrom}, ${prevTo}), { opacity: 0.2, duration: 0.5, ease: EASE }, ${t});`);
          break;
        }
        default:
          break;
      }
    });

    // Scene-level camera directive applies only when no beat took the camera.
    const beatTookCamera = beats.some((b) => b.changeType === "zoom" || b.changeType === "pan");
    if (!beatTookCamera) {
      lines.push(``);
      lines.push(this.buildCameraMotion(scene, design));
    }

    return lines.join("\n");
  }

  private jsComment(s: string): string {
    return s.replace(/\*\//g, "* /").replace(/\r?\n/g, " ").slice(0, 160);
  }

  /**
   * Camera motion is applied only when the Visual Director asked for it. A default
   * push-in on every scene is exactly the templated look the spec forbids.
   */
  private buildCameraMotion(scene: StoryboardScene, design: ChannelDesign): string {
    const camera = (scene.camera || "static").toLowerCase();
    if (camera.includes("static")) return "    // camera: static (no motion)";

    const dur = scene.duration;
    if (camera.includes("push") || camera.includes("zoom-in") || camera.includes("zoom in")) {
      return `    tl.fromTo("#s-stage", { scale: 1 }, { scale: 1.035, duration: ${dur}, ease: "none" }, 0);`;
    }
    if (camera.includes("pull") || camera.includes("zoom-out") || camera.includes("zoom out")) {
      return `    tl.fromTo("#s-stage", { scale: 1.035 }, { scale: 1, duration: ${dur}, ease: "none" }, 0);`;
    }
    if (camera.includes("pan right")) {
      return `    tl.fromTo("#s-stage", { xPercent: -1.2 }, { xPercent: 1.2, duration: ${dur}, ease: "none" }, 0);`;
    }
    if (camera.includes("pan left")) {
      return `    tl.fromTo("#s-stage", { xPercent: 1.2 }, { xPercent: -1.2, duration: ${dur}, ease: "none" }, 0);`;
    }
    if (camera.includes("drift down")) {
      return `    tl.fromTo("#s-stage", { yPercent: -1 }, { yPercent: 1, duration: ${dur}, ease: "none" }, 0);`;
    }
    if (camera.includes("drift up")) {
      return `    tl.fromTo("#s-stage", { yPercent: 1 }, { yPercent: -1, duration: ${dur}, ease: "none" }, 0);`;
    }
    return "    // camera: unrecognised directive, held static";
  }

  /** Copies the GSAP bundle next to the compositions so renders need no network. */
  private ensureGsap(outputDir: string, repoRoot: string): void {
    const assetsDir = join(outputDir, "assets");
    mkdirSync(assetsDir, { recursive: true });
    const localGsap = join(assetsDir, "gsap.min.js");
    if (existsSync(localGsap)) return;

    for (const candidate of [
      resolve(outputDir, "node_modules/gsap/dist/gsap.min.js"),
      resolve(repoRoot, "node_modules/gsap/dist/gsap.min.js")
    ]) {
      if (existsSync(candidate)) {
        copyFileSync(candidate, localGsap);
        return;
      }
    }
    console.warn(`[SCENE-GEN] GSAP bundle not found; compositions will not animate.`);
  }
}
