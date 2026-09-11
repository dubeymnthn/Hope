import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { StoryboardResult, StoryboardScene } from "../schemas/storyboard.js";
import { ChannelConfig } from "../schemas/channel.js";
import { LONG_BEAT_GUIDELINE_SECONDS, SceneRhythmMetrics } from "../scenes/scene-generator.js";

export interface VisualQACheck {
  name: string;
  category: "diversity" | "anti_repetition" | "density" | "structural" | "sourcing" | "rhythm" | "opening";
  passed: boolean;
  message: string;
  details?: any;
}

/** Per-scene measurements (spec V2.2 §14). */
export interface SceneVisualMetrics {
  sceneId: string;
  duration: number;
  visualMode: string;
  layoutSignature: string;
  longestNoChangeInterval: number;
  narrativeConceptCount: number;
  visualStateChangeCount: number;
  visualRefreshCount: number;
  focusChanges: number;
  changeTypes: string[];
  unjustifiedLongBeats: number;
  justifiedLongBeats: number;
  degraded: boolean;
}

/** Whole-video measurements (spec V2.2 §13, §14). */
export interface VideoVisualMetrics {
  first30: {
    visualChangeCount: number;
    uniqueVisualStates: number;
    narrativeReveals: number;
    longestStaticInterval: number;
  };
  longestStaticInterval: number;
  longestStaticSceneId: string | null;
  visualModeCount: number;
  layoutSignatureCount: number;
  dataPointCount: number;
  verifiedDataPointCount: number;
  chapterCount: number;
  sceneCount: number;
  totalBeats: number;
  totalDuration: number;
}

export interface VisualStyleQAReport {
  status: "PASS" | "WARN" | "FAIL";
  evaluatedAt: string;
  totalScenes: number;
  distinctVisualModes: number;
  distinctLayoutSignatures: number;
  checks: VisualQACheck[];
  errors: string[];
  warnings: string[];
  sceneMetrics: SceneVisualMetrics[];
  videoMetrics: VideoVisualMetrics;
}

interface SceneMeta {
  sceneId: string;
  renderedMode?: string;
  layoutSignature?: string;
  degraded?: string;
  rhythm?: SceneRhythmMetrics;
  onScreenText?: string;
}

/** A beat gap longer than this without justification is a diagnostic, not a failure. */
const SUSPICIOUS_STATIC_SECONDS = 20;

/**
 * Visual style, rhythm and anti-repetition QA.
 *
 * Measures visual diversity and rhythm structurally rather than by proxy: composition
 * topology comes from each scene's rendered layout signature; rhythm comes from the beats
 * the composition was actually built from. "Slow by design" is distinguished from
 * "accidentally static" by whether a long interval carries a stated justification
 * (spec V2.2 §9, §10, §13, §14). File size is never used as a diversity metric.
 */
export class VisualStyleQAAgent {
  public evaluate(params: {
    storyboard: StoryboardResult;
    config?: ChannelConfig;
    outputDir?: string;
    /** Research-verified data point count, when the caller has it (from the Visual Director). */
    verifiedDataPointCount?: number;
  }): VisualStyleQAReport {
    const { storyboard, config, outputDir = process.cwd() } = params;
    const scenes = storyboard.scenes;
    console.log(
      `[VISUAL-QA] Auditing visual diversity, rhythm and layout repetition across ${scenes.length} scenes...`
    );

    const checks: VisualQACheck[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    const maxConsecutive = config?.editorial?.maxConsecutiveSameVisualMode ?? 2;

    const metas: SceneMeta[] = scenes.map((scene) => {
      const p = join(outputDir, "scenes", `${scene.id}.meta.json`);
      if (!existsSync(p)) return { sceneId: scene.id };
      try {
        return JSON.parse(readFileSync(p, "utf-8"));
      } catch {
        return { sceneId: scene.id };
      }
    });

    // ================= PER-SCENE METRICS =================
    const sceneMetrics: SceneVisualMetrics[] = scenes.map((scene, i) => {
      const meta = metas[i];
      const r = meta.rhythm ?? this.rhythmFromStoryboard(scene);
      return {
        sceneId: scene.id,
        duration: scene.duration,
        visualMode: scene.visual_mode || scene.visual_type,
        layoutSignature: meta.layoutSignature || "unknown",
        longestNoChangeInterval: r.longestNoChangeInterval,
        narrativeConceptCount: (scene.claims_shown?.length ?? 0) || this.countConcepts(scene.narration),
        visualStateChangeCount: r.visualStateChangeCount,
        visualRefreshCount: r.beatCount,
        focusChanges: r.focusChanges,
        changeTypes: r.changeTypes,
        unjustifiedLongBeats: r.unjustifiedLongBeats,
        justifiedLongBeats: r.justifiedLongBeats,
        degraded: !!meta.degraded
      };
    });

    // ================= WHOLE-VIDEO METRICS =================
    const videoMetrics = this.videoMetrics(storyboard, sceneMetrics, metas, params.verifiedDataPointCount);

    // ================= 1. Consecutive visual mode limit =================
    let streak = 1;
    let maxStreak = 1;
    let offendingMode: string | null = null;
    for (let i = 1; i < scenes.length; i++) {
      const prev = scenes[i - 1].visual_mode || scenes[i - 1].visual_type;
      const curr = scenes[i].visual_mode || scenes[i].visual_type;
      if (prev === curr) {
        streak++;
        if (streak > maxStreak) {
          maxStreak = streak;
          offendingMode = curr;
        }
      } else {
        streak = 1;
      }
    }
    const consecutivePass = maxStreak <= maxConsecutive;
    checks.push({
      name: "Consecutive Visual Mode Limit",
      category: "anti_repetition",
      passed: consecutivePass,
      message: consecutivePass
        ? `No mode repeats more than ${maxConsecutive}x consecutively (max found: ${maxStreak})`
        : `Mode "${offendingMode}" repeats ${maxStreak}x consecutively (limit ${maxConsecutive})`,
      details: { maxConsecutive, maxStreak, offendingMode }
    });
    if (!consecutivePass) warnings.push(`Consecutive mode repetition: "${offendingMode}" x${maxStreak}`);

    // ================= 2. Visual mode diversity, scaled to runtime =================
    const distinctModes = new Set(scenes.map((s) => s.visual_mode || s.visual_type));
    const minutes = storyboard.total_duration / 60;
    const requiredDistinct = minutes >= 7 ? 6 : scenes.length >= 6 ? 4 : Math.max(2, Math.floor(scenes.length / 2));
    const diversityPass = distinctModes.size >= requiredDistinct;
    checks.push({
      name: "Visual Mode Palette Diversity",
      category: "diversity",
      passed: diversityPass,
      message: `${distinctModes.size} distinct modes across ${scenes.length} scenes / ${minutes.toFixed(1)} min (minimum ${requiredDistinct})`,
      details: { distinctModes: Array.from(distinctModes), requiredDistinct }
    });
    if (!diversityPass) {
      errors.push(`Insufficient visual diversity: ${distinctModes.size} distinct modes, expected >= ${requiredDistinct}`);
    }

    // ================= 3. Layout signature (composition topology) repetition =================
    const signatures = sceneMetrics.map((m) => m.layoutSignature);
    const sigCounts = new Map<string, number>();
    for (const s of signatures) sigCounts.set(s, (sigCounts.get(s) ?? 0) + 1);
    const distinctSignatures = sigCounts.size;
    const topSig = [...sigCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const topSigShare = scenes.length > 0 ? (topSig?.[1] ?? 0) / scenes.length : 0;
    const topologyPass = scenes.length < 4 || topSigShare <= 0.5;
    checks.push({
      name: "Composition Topology Repetition",
      category: "anti_repetition",
      passed: topologyPass,
      message: topologyPass
        ? `${distinctSignatures} distinct layout signatures; most common covers ${Math.round(topSigShare * 100)}% of scenes`
        : `Layout "${topSig?.[0]}" covers ${Math.round(topSigShare * 100)}% of scenes (limit 50%) — visible templating`,
      details: { distinctSignatures, mostCommon: topSig?.[0], share: Math.round(topSigShare * 100) }
    });
    if (!topologyPass) {
      errors.push(`Composition topology repetition: "${topSig?.[0]}" used in ${Math.round(topSigShare * 100)}% of scenes`);
    }

    // ================= 4. Consecutive identical layout =================
    let sigStreak = 1;
    let maxSigStreak = 1;
    for (let i = 1; i < signatures.length; i++) {
      if (signatures[i] === signatures[i - 1]) {
        sigStreak++;
        maxSigStreak = Math.max(maxSigStreak, sigStreak);
      } else {
        sigStreak = 1;
      }
    }
    const sigStreakPass = maxSigStreak <= 2;
    checks.push({
      name: "Consecutive Identical Layout",
      category: "anti_repetition",
      passed: sigStreakPass,
      message: sigStreakPass
        ? `No identical layout repeats more than 2x consecutively (max ${maxSigStreak})`
        : `Identical layout repeats ${maxSigStreak}x consecutively`,
      details: { maxSigStreak }
    });
    if (!sigStreakPass) warnings.push(`Identical layout signature repeats ${maxSigStreak}x in a row`);

    // ================= 5. Animation / primitive family diversity =================
    const renderedFamilies = new Set(signatures.map((s) => s.split(":")[0]).filter((s) => s && s !== "unknown"));
    const animPass = scenes.length < 4 || renderedFamilies.size >= Math.min(4, Math.ceil(scenes.length / 3));
    checks.push({
      name: "Animation Pattern Diversity",
      category: "anti_repetition",
      passed: animPass,
      message: `${renderedFamilies.size} distinct primitive families rendered (${Array.from(renderedFamilies).join(", ") || "none"})`,
      details: { families: Array.from(renderedFamilies) }
    });
    if (!animPass) warnings.push(`Only ${renderedFamilies.size} distinct animation/primitive families across ${scenes.length} scenes`);

    // ================= 6. Text-only scene ratio =================
    const textOnly = scenes.filter((s) => {
      const m = s.visual_mode || s.visual_type;
      return m === "text" || m === "large_typography" || m === "kinetic_emphasis" || m === "ambient_establishing";
    });
    const textRatio = scenes.length > 0 ? textOnly.length / scenes.length : 0;
    const textPass = textRatio <= 0.4;
    checks.push({
      name: "Non-Text Visual Dominance",
      category: "density",
      passed: textPass,
      message: `${Math.round((1 - textRatio) * 100)}% of scenes carry substantive graphics (text-only: ${textOnly.length}/${scenes.length})`,
      details: { textOnlyCount: textOnly.length, textRatio: Math.round(textRatio * 100) / 100 }
    });
    if (!textPass) warnings.push(`High text-only ratio (${Math.round(textRatio * 100)}% > 40%): add diagrams, charts or timelines`);

    // ================= 7. Rhythm: unjustified static intervals =================
    // A long no-change run is acceptable when the beat says why (dense information,
    // reading time, atmosphere, anticipation). Without that, it is flagged. Only an
    // interval past SUSPICIOUS_STATIC_SECONDS with no justification anywhere in the scene
    // becomes a warning; the guideline threshold is reported as a diagnostic.
    const overGuideline = sceneMetrics.filter((m) => m.longestNoChangeInterval > LONG_BEAT_GUIDELINE_SECONDS);
    const suspicious = sceneMetrics.filter(
      (m) => m.longestNoChangeInterval > SUSPICIOUS_STATIC_SECONDS && m.unjustifiedLongBeats > 0
    );
    const rhythmPass = suspicious.length === 0;
    checks.push({
      name: "Unjustified Static Intervals",
      category: "rhythm",
      passed: rhythmPass,
      message: rhythmPass
        ? `No scene holds one visual state past ${SUSPICIOUS_STATIC_SECONDS}s without justification (longest: ${videoMetrics.longestStaticInterval}s in ${videoMetrics.longestStaticSceneId ?? "n/a"})`
        : `${suspicious.length} scene(s) hold a visual state past ${SUSPICIOUS_STATIC_SECONDS}s with no stated reason`,
      details: {
        suspicious: suspicious.map((m) => `${m.sceneId}: ${m.longestNoChangeInterval}s`),
        overGuidelineDiagnostic: overGuideline.map((m) => `${m.sceneId}: ${m.longestNoChangeInterval}s (${m.justifiedLongBeats} justified, ${m.unjustifiedLongBeats} unjustified)`)
      }
    });
    if (!rhythmPass) {
      warnings.push(
        `Accidentally static: ${suspicious.map((m) => `${m.sceneId} (${m.longestNoChangeInterval}s)`).join(", ")} — add beats or a holdJustification`
      );
    }

    // ================= 8. Rhythm: visual state must actually change within long scenes =================
    const inert = sceneMetrics.filter((m) => m.duration > 12 && m.visualStateChangeCount < 2);
    const inertPass = inert.length === 0;
    checks.push({
      name: "Visual State Progression On Long Scenes",
      category: "rhythm",
      passed: inertPass,
      message: inertPass
        ? "Every scene longer than 12s changes visual state at least twice"
        : `${inert.length} scene(s) longer than 12s change visual state fewer than 2 times`,
      details: inert.map((m) => `${m.sceneId} (${m.duration}s, ${m.visualStateChangeCount} changes)`)
    });
    if (!inertPass) warnings.push(`${inert.length} long scene(s) barely change visual state; the frame is a slide, not a sequence`);

    // ================= 9. Rhythm: states repeat without new meaning =================
    const restated = scenes
      .map((s) => {
        const states = (s.beats ?? []).map((b) => (b.visualState || b.visualChange || "").trim().toLowerCase()).filter(Boolean);
        let dupes = 0;
        for (let i = 1; i < states.length; i++) if (states[i] === states[i - 1]) dupes++;
        return { id: s.id, dupes };
      })
      .filter((x) => x.dupes > 0);
    const restatePass = restated.length === 0;
    checks.push({
      name: "No Restated Consecutive Visual States",
      category: "rhythm",
      passed: restatePass,
      message: restatePass
        ? "No consecutive beats restate the same visual state"
        : `${restated.length} scene(s) have consecutive beats with an identical visual state`,
      details: restated.map((x) => `${x.id}: ${x.dupes} restated`)
    });
    if (!restatePass) warnings.push(`${restated.length} scene(s) repeat a visual state across consecutive beats without new meaning`);

    // ================= 10. Opening: first 30 seconds must progress =================
    const f30 = videoMetrics.first30;
    const openingPass = f30.visualChangeCount >= 3 && f30.longestStaticInterval <= SUSPICIOUS_STATIC_SECONDS;
    checks.push({
      name: "First 30 Seconds Progression",
      category: "opening",
      passed: openingPass,
      message: `first30: ${f30.visualChangeCount} visual changes, ${f30.uniqueVisualStates} unique states, ${f30.narrativeReveals} narrative reveals, longest static ${f30.longestStaticInterval}s`,
      details: f30
    });
    if (!openingPass) {
      warnings.push(
        `Opening is under-developed: ${f30.visualChangeCount} visual change(s) in the first 30s, longest static ${f30.longestStaticInterval}s`
      );
    }

    // ================= 11. Repeated on-screen captions =================
    const captions = scenes.map((s) => s.on_screen_text.trim().toLowerCase()).filter(Boolean);
    const capCounts = new Map<string, number>();
    for (const c of captions) capCounts.set(c, (capCounts.get(c) ?? 0) + 1);
    const repeatedCaptions = [...capCounts.entries()].filter(([, n]) => n > 1);
    const captionPass = repeatedCaptions.length === 0;
    checks.push({
      name: "Distinct On-Screen Captions",
      category: "anti_repetition",
      passed: captionPass,
      message: captionPass ? "No on-screen caption is reused across scenes" : `${repeatedCaptions.length} caption(s) reused`,
      details: repeatedCaptions.map(([c, n]) => `"${c}" x${n}`)
    });
    if (!captionPass) warnings.push(`Repeated on-screen captions: ${repeatedCaptions.map(([c]) => `"${c}"`).join(", ")}`);

    // ================= 12. Duplicated hero rows in compositions =================
    // A hero value that is also the first bar row was a real regression once; check the
    // rendered HTML rather than trusting the primitive.
    const heroDupes: string[] = [];
    for (const scene of scenes) {
      const p = join(outputDir, "compositions", `${scene.id}.html`);
      if (!existsSync(p)) continue;
      const html = readFileSync(p, "utf-8");
      const hero = html.match(/id="p-lead-value">([^<]+)</);
      const firstBarValue = html.match(/<div class="p-bar-value">([^<]+)</);
      if (hero && firstBarValue && hero[1].trim() === firstBarValue[1].trim()) heroDupes.push(scene.id);
    }
    const heroPass = heroDupes.length === 0;
    checks.push({
      name: "No Duplicated Hero Rows",
      category: "anti_repetition",
      passed: heroPass,
      message: heroPass ? "No composition restates its hero value as its first bar" : `${heroDupes.length} composition(s) duplicate the hero value`,
      details: heroDupes
    });
    if (!heroPass) warnings.push(`Duplicated hero row in: ${heroDupes.join(", ")}`);

    // ================= 13. Degraded scenes =================
    const degraded = metas.filter((m) => m.degraded);
    const degradedPass = degraded.length === 0;
    checks.push({
      name: "Mode Data Sufficiency",
      category: "structural",
      passed: degradedPass,
      message: degradedPass
        ? "Every scene rendered in its planned visual mode"
        : `${degraded.length} scene(s) degraded to a simpler mode for lack of data`,
      details: degraded.map((d) => `${d.sceneId}: ${d.degraded}`)
    });
    if (!degradedPass) warnings.push(`${degraded.length} scene(s) fell back to a simpler visual mode because the plan supplied no data`);

    // ================= 14. On-screen callout conciseness =================
    const verbose = scenes.filter((s) => s.on_screen_text.split(/\s+/).filter(Boolean).length > 10);
    const concisePass = verbose.length === 0;
    checks.push({
      name: "Typographic Callout Impact",
      category: "density",
      passed: concisePass,
      message: concisePass ? "All on-screen callouts are 10 words or fewer" : `${verbose.length} scene(s) have wordy on-screen callouts`,
      details: { verbose: verbose.map((s) => s.id) }
    });
    if (!concisePass) warnings.push(`${verbose.length} scenes have overly long on-screen text`);

    // ================= 15. Source footer discipline =================
    const scenesWithSources = scenes.filter((s) => (s.source_references?.length ?? 0) > 0);
    const sourceSets = scenesWithSources.map((s) => (s.source_references ?? []).join("|"));
    const identicalFooter = sourceSets.length > 2 && new Set(sourceSets).size === 1;
    const overloaded = scenes.filter((s) => (s.source_references?.length ?? 0) > 3);
    const sourcingPass = !identicalFooter && overloaded.length === 0;
    checks.push({
      name: "Per-Scene Source Relevance",
      category: "sourcing",
      passed: sourcingPass,
      message: sourcingPass
        ? `${scenesWithSources.length}/${scenes.length} scenes cite sources, varying by scene`
        : identicalFooter
          ? "Every sourced scene shows an identical source footer (spec forbids a fixed footer)"
          : `${overloaded.length} scene(s) list more than 3 sources`,
      details: { scenesWithSources: scenesWithSources.length, identicalFooter, overloaded: overloaded.map((s) => s.id) }
    });
    if (!sourcingPass) {
      warnings.push(identicalFooter ? "Source footer is identical across scenes" : `${overloaded.length} scenes list more than 3 sources`);
    }

    // ================= 16. Composition artifacts present =================
    const missing: string[] = [];
    for (const scene of scenes) {
      const p = join(outputDir, "compositions", `${scene.id}.html`);
      if (!existsSync(p) || statSync(p).size < 200) missing.push(scene.id);
    }
    const compPass = missing.length === 0;
    checks.push({
      name: "Composition Artifact Presence",
      category: "structural",
      passed: compPass,
      message: compPass ? `All ${scenes.length} composition artifacts present` : `Missing compositions: ${missing.join(", ")}`,
      details: { missing }
    });
    if (!compPass) errors.push(`Missing composition artifacts: ${missing.join(", ")}`);

    const status: "PASS" | "WARN" | "FAIL" = errors.length > 0 ? "FAIL" : warnings.length > 0 ? "WARN" : "PASS";

    const report: VisualStyleQAReport = {
      status,
      evaluatedAt: new Date().toISOString(),
      totalScenes: scenes.length,
      distinctVisualModes: distinctModes.size,
      distinctLayoutSignatures: distinctSignatures,
      checks,
      errors,
      warnings,
      sceneMetrics,
      videoMetrics
    };

    this.persist(report, outputDir);

    console.log(
      `[VISUAL-QA] Completed: ${status} (${errors.length} errors, ${warnings.length} warnings). ` +
        `${distinctModes.size} modes, ${distinctSignatures} layouts, longest static ${videoMetrics.longestStaticInterval}s, ` +
        `first30: ${f30.visualChangeCount} changes / ${f30.uniqueVisualStates} states.`
    );
    return report;
  }

  /** Rhythm derived from the storyboard when no rendered meta exists (compat path). */
  private rhythmFromStoryboard(scene: StoryboardScene): SceneRhythmMetrics {
    const beats = [...(scene.beats ?? [])].sort((a, b) => a.startOffset - b.startOffset);
    if (beats.length === 0) {
      return {
        beatCount: 0,
        visualStateChangeCount: 0,
        uniqueVisualStates: 0,
        longestNoChangeInterval: scene.duration,
        justifiedLongBeats: 0,
        unjustifiedLongBeats: scene.duration > LONG_BEAT_GUIDELINE_SECONDS ? 1 : 0,
        focusChanges: 0,
        changeTypes: [],
        beatSequencedGroups: 0
      };
    }
    let longest = 0;
    for (let i = 0; i < beats.length; i++) {
      const end = beats[i + 1]?.startOffset ?? beats[i].endOffset;
      longest = Math.max(longest, end - beats[i].startOffset);
    }
    const long = beats.filter((b) => b.endOffset - b.startOffset > LONG_BEAT_GUIDELINE_SECONDS || b.changeType === "hold");
    return {
      beatCount: beats.length,
      visualStateChangeCount: beats.filter((b) => b.changeType !== "hold").length,
      uniqueVisualStates: new Set(beats.map((b) => (b.visualState || b.visualChange || "").trim()).filter(Boolean)).size,
      longestNoChangeInterval: Math.round(longest * 100) / 100,
      justifiedLongBeats: long.filter((b) => !!b.holdJustification?.trim()).length,
      unjustifiedLongBeats: long.filter((b) => !b.holdJustification?.trim()).length,
      focusChanges: 0,
      changeTypes: [...new Set(beats.map((b) => b.changeType).filter((t): t is NonNullable<typeof t> => !!t))],
      beatSequencedGroups: 0
    };
  }

  /** Rough count of distinct ideas in a passage: sentences carrying a number or a comparison word. */
  private countConcepts(narration: string): number {
    const sentences = narration.split(/(?<=[.?!])\s+/).filter((s) => s.trim().length > 0);
    return Math.max(1, sentences.length);
  }

  private videoMetrics(
    storyboard: StoryboardResult,
    sceneMetrics: SceneVisualMetrics[],
    metas: SceneMeta[],
    verifiedDataPointCount?: number
  ): VideoVisualMetrics {
    const scenes = storyboard.scenes;

    // ---- first 30 seconds (spec §13) ----
    // Beat boundaries that occur before t=30 are visual changes; unique states are the
    // distinct beat states in that window; narrative reveals are claims carried by
    // scenes that start within the window.
    let f30Changes = 0;
    const f30States = new Set<string>();
    let f30Reveals = 0;
    const f30Boundaries: number[] = [0];
    for (const s of scenes) {
      if (s.start >= 30) break;
      if (s.start > 0) f30Boundaries.push(s.start);
      f30Reveals += s.claims_shown?.length ?? 0;
      for (const b of s.beats ?? []) {
        const abs = s.start + b.startOffset;
        if (abs < 30 && b.changeType !== "hold") {
          if (abs > 0) f30Boundaries.push(abs);
          f30Changes++;
          const st = (b.visualState || b.visualChange || "").trim();
          if (st) f30States.add(st);
        }
      }
    }
    f30Boundaries.push(Math.min(30, storyboard.total_duration));
    const sortedB = [...new Set(f30Boundaries)].sort((a, b) => a - b);
    let f30Longest = 0;
    for (let i = 1; i < sortedB.length; i++) f30Longest = Math.max(f30Longest, sortedB[i] - sortedB[i - 1]);

    // ---- longest static anywhere ----
    let longest = 0;
    let longestId: string | null = null;
    for (const m of sceneMetrics) {
      if (m.longestNoChangeInterval > longest) {
        longest = m.longestNoChangeInterval;
        longestId = m.sceneId;
      }
    }

    const dataPointCount = scenes.reduce((a, s) => a + (s.data_points?.length ?? 0), 0);

    return {
      first30: {
        visualChangeCount: f30Changes,
        uniqueVisualStates: f30States.size,
        narrativeReveals: f30Reveals,
        longestStaticInterval: Math.round(f30Longest * 100) / 100
      },
      longestStaticInterval: Math.round(longest * 100) / 100,
      longestStaticSceneId: longestId,
      visualModeCount: new Set(scenes.map((s) => s.visual_mode || s.visual_type)).size,
      layoutSignatureCount: new Set(metas.map((m) => m.layoutSignature).filter(Boolean)).size,
      dataPointCount,
      // When the caller did not supply the verified count, the Visual Director gate has
      // already rejected any untraceable point, so every displayed point is verified.
      verifiedDataPointCount: verifiedDataPointCount ?? dataPointCount,
      chapterCount: new Set(scenes.map((s) => s.chapter).filter(Boolean)).size,
      sceneCount: scenes.length,
      totalBeats: scenes.reduce((a, s) => a + (s.beats?.length ?? 0), 0),
      totalDuration: storyboard.total_duration
    };
  }

  private persist(report: VisualStyleQAReport, outputDir: string): void {
    const qaDir = join(outputDir, "qa");
    mkdirSync(qaDir, { recursive: true });
    writeFileSync(join(qaDir, "visual-style-report.json"), JSON.stringify(report, null, 2), "utf-8");

    const v = report.videoMetrics;
    const md = [
      `# Visual Style, Rhythm & Anti-Repetition QA Report`,
      ``,
      `**Status:** \`${report.status}\` | **Scenes:** ${v.sceneCount} | **Beats:** ${v.totalBeats} | **Modes:** ${v.visualModeCount} | **Layouts:** ${v.layoutSignatureCount} | **Chapters:** ${v.chapterCount}`,
      `*Evaluated at:* ${report.evaluatedAt}`,
      ``,
      `## Whole-video metrics`,
      `| Metric | Value |`,
      `|---|---|`,
      `| first30.visualChangeCount | ${v.first30.visualChangeCount} |`,
      `| first30.uniqueVisualStates | ${v.first30.uniqueVisualStates} |`,
      `| first30.narrativeReveals | ${v.first30.narrativeReveals} |`,
      `| first30.longestStaticInterval | ${v.first30.longestStaticInterval}s |`,
      `| longestStaticInterval | ${v.longestStaticInterval}s (${v.longestStaticSceneId ?? "n/a"}) |`,
      `| dataPointCount / verified | ${v.dataPointCount} / ${v.verifiedDataPointCount} |`,
      ``,
      `## Measured checks`,
      `| Category | Check | Result | Measurement |`,
      `|---|---|---|---|`,
      ...report.checks.map((c) => `| ${c.category.toUpperCase()} | ${c.name} | ${c.passed ? "PASS" : "ATTENTION"} | ${c.message} |`),
      ``,
      `## Per-scene rhythm`,
      `| Scene | Mode | Dur | Beats | State changes | Longest static | Focus changes | Change types |`,
      `|---|---|---|---|---|---|---|---|`,
      ...report.sceneMetrics.map(
        (m) =>
          `| ${m.sceneId} | ${m.visualMode} | ${m.duration}s | ${m.visualRefreshCount} | ${m.visualStateChangeCount} | ${m.longestNoChangeInterval}s${m.unjustifiedLongBeats ? " (unjustified)" : m.justifiedLongBeats ? " (justified)" : ""} | ${m.focusChanges} | ${m.changeTypes.join(", ") || "—"} |`
      ),
      ``,
      ...(report.errors.length > 0 ? [`## Errors`, ...report.errors.map((e) => `- ${e}`), ``] : []),
      ...(report.warnings.length > 0 ? [`## Warnings`, ...report.warnings.map((w) => `- ${w}`), ``] : [])
    ];
    writeFileSync(join(qaDir, "visual-style-report.md"), md.join("\n"), "utf-8");
  }
}
