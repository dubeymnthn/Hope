import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { ResearchResultSchema } from "../src/schemas/research.js";
import { ArgumentResultSchema } from "../src/schemas/argument.js";
import { ScriptResultSchema } from "../src/schemas/script.js";
import { StoryboardResultSchema } from "../src/schemas/storyboard.js";

/**
 * Generalization test (spec section 34).
 *
 * Verifies the factory produces materially different documentaries for materially
 * different topics. "The same templates with different text" must fail this test, so
 * every check compares structure — argument shape, chapter counts, pacing, visual modes,
 * composition topology — rather than merely asserting that both runs produced output.
 */

interface TopicWorkspace {
  slug: string;
  label: string;
  dir: string;
}

const TOPICS: TopicWorkspace[] = [
  {
    slug: "why-modern-batteries-are-still-expensive",
    label: "Why modern batteries are still expensive",
    dir: resolve("topics/why-modern-batteries-are-still-expensive")
  },
  {
    slug: "how-a-semiconductor-fab-actually-works",
    label: "How a semiconductor fab actually works",
    dir: resolve("topics/how-a-semiconductor-fab-actually-works")
  }
];

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

function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

function contentWords(text: string): Set<string> {
  const stop = new Set([
    "the", "and", "that", "this", "with", "from", "have", "which", "their", "there",
    "would", "could", "about", "into", "than", "then", "these", "those", "been",
    "being", "because", "while", "where", "what", "when", "they", "them", "your",
    "more", "most", "some", "such", "only", "also", "does", "did", "not", "but",
    "for", "are", "was", "were", "its", "it's", "one", "two", "how", "why", "still"
  ]);
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stop.has(w))
  );
}

function load<T>(schema: { parse: (x: unknown) => T }, path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return schema.parse(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    return null;
  }
}

function main(): void {
  console.log("==============================================================");
  console.log("=== Generalization Test: materially different topics       ===");
  console.log("==============================================================");

  const loaded = TOPICS.map((t) => ({
    ...t,
    research: load(ResearchResultSchema, join(t.dir, "research/research.json")),
    argument: load(ArgumentResultSchema, join(t.dir, "argument/argument.json")),
    script: load(ScriptResultSchema, join(t.dir, "script/script.json")),
    storyboard: load(StoryboardResultSchema, join(t.dir, "storyboard/storyboard.json"))
  }));

  console.log("\n=== Artifact presence ===");
  for (const t of loaded) {
    check(`${t.slug}: research present`, !!t.research);
    check(`${t.slug}: argument present`, !!t.argument);
    check(`${t.slug}: script present`, !!t.script);
  }

  const [a, b] = loaded;
  if (!a.research || !b.research || !a.argument || !b.argument || !a.script || !b.script) {
    console.log("\nCannot compare: both topics need research, argument and script artifacts.");
    process.exit(1);
  }

  // ---------------------------------------------------------------
  console.log("\n=== Research diverges ===");
  check(
    "Topics are distinct subjects",
    a.research.topic !== b.research.topic,
    `"${a.research.topic}" vs "${b.research.topic}"`
  );
  {
    const sourcesA = new Set(a.research.sources.map((s) => s.url));
    const sourcesB = new Set(b.research.sources.map((s) => s.url));
    const overlap = jaccard(sourcesA, sourcesB);
    check(
      "Source sets are independent",
      overlap === 0,
      `${sourcesA.size} vs ${sourcesB.size} sources, overlap ${(overlap * 100).toFixed(0)}%`
    );
  }
  {
    const ov = jaccard(contentWords(a.research.angle), contentWords(b.research.angle));
    check("Editorial angles are distinct", ov < 0.2, `angle overlap ${(ov * 100).toFixed(0)}%`);
  }

  // ---------------------------------------------------------------
  console.log("\n=== Argument diverges ===");
  {
    const ov = jaccard(contentWords(a.argument.centralThesis), contentWords(b.argument.centralThesis));
    check("Central theses are substantially different", ov < 0.2, `thesis overlap ${(ov * 100).toFixed(0)}%`);
  }
  check(
    "Narrative progression shapes differ",
    a.argument.narrativeProgression.length !== b.argument.narrativeProgression.length,
    `${a.argument.narrativeProgression.length} vs ${b.argument.narrativeProgression.length} phases`
  );
  {
    const phasesA = new Set(a.argument.narrativeProgression.map((p) => p.phase));
    const phasesB = new Set(b.argument.narrativeProgression.map((p) => p.phase));
    const ov = jaccard(phasesA, phasesB);
    check(
      "Phase vocabularies are topic-specific, not a fixed template",
      ov < 0.6,
      `phase-name overlap ${(ov * 100).toFixed(0)}%`
    );
  }
  check(
    "Runtime judgement is not a fixed constant",
    a.argument.estimatedDepthMinutes !== b.argument.estimatedDepthMinutes,
    `${a.argument.estimatedDepthMinutes} min vs ${b.argument.estimatedDepthMinutes} min`
  );

  // ---------------------------------------------------------------
  console.log("\n=== Script structure and pacing diverge ===");
  check(
    "Scene counts differ",
    a.script.scenes.length !== b.script.scenes.length,
    `${a.script.scenes.length} vs ${b.script.scenes.length} scenes`
  );
  check(
    "Chapter counts differ",
    (a.script.chapters?.length ?? 0) !== (b.script.chapters?.length ?? 0),
    `${a.script.chapters?.length ?? 0} vs ${b.script.chapters?.length ?? 0} chapters`
  );
  {
    const titlesA = new Set((a.script.chapters ?? []).map((c) => c.title.toLowerCase()));
    const titlesB = new Set((b.script.chapters ?? []).map((c) => c.title.toLowerCase()));
    check("No chapter title is reused across topics", jaccard(titlesA, titlesB) === 0);
  }
  {
    const wordsA = a.script.scenes.reduce((s, x) => s + x.narration.trim().split(/\s+/).length, 0);
    const wordsB = b.script.scenes.reduce((s, x) => s + x.narration.trim().split(/\s+/).length, 0);
    check(
      "Total narration length differs meaningfully",
      Math.abs(wordsA - wordsB) > 100,
      `${wordsA} vs ${wordsB} words`
    );
  }
  {
    // No narration passage may be shared between the two documentaries.
    const grams = (s: string[]) =>
      new Set(
        s.flatMap((n) => {
          const w = n.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
          return w.map((_, i) => (i + 8 <= w.length ? w.slice(i, i + 8).join(" ") : "")).filter(Boolean);
        })
      );
    const gA = grams(a.script.scenes.map((s) => s.narration));
    const gB = grams(b.script.scenes.map((s) => s.narration));
    const shared = [...gA].filter((g) => gB.has(g));
    check("No narration passage is shared between topics", shared.length === 0, shared.slice(0, 3).join(" | "));
  }

  // ---------------------------------------------------------------
  console.log("\n=== Visual treatment diverges ===");
  if (!a.storyboard || !b.storyboard) {
    const missing = [!a.storyboard ? a.slug : null, !b.storyboard ? b.slug : null].filter(Boolean);
    console.log(`  [SKIP] Storyboard not yet produced for: ${missing.join(", ")}.`);
    console.log("         Visual-mode divergence is verified once both topics reach the storyboard stage.");
  } else {
    const modesA = new Set(a.storyboard.scenes.map((s) => s.visual_mode || s.visual_type));
    const modesB = new Set(b.storyboard.scenes.map((s) => s.visual_mode || s.visual_type));
    check("Topic A uses a broad visual vocabulary", modesA.size >= 5, `${modesA.size} modes`);
    check("Topic B uses a broad visual vocabulary", modesB.size >= 5, `${modesB.size} modes`);
    check(
      "Visual mode mixes are not identical",
      jaccard(modesA, modesB) < 0.85,
      `mode overlap ${(jaccard(modesA, modesB) * 100).toFixed(0)}%`
    );
    check(
      "Scene counts differ in the storyboard too",
      a.storyboard.scenes.length !== b.storyboard.scenes.length,
      `${a.storyboard.scenes.length} vs ${b.storyboard.scenes.length}`
    );

    // Composition topology, read from what the renderer actually produced.
    const sigs = (t: TopicWorkspace, ids: string[]) =>
      new Set(
        ids
          .map((id) => {
            const p = join(t.dir, "scenes", `${id}.meta.json`);
            if (!existsSync(p)) return "";
            try {
              return JSON.parse(readFileSync(p, "utf-8")).layoutSignature || "";
            } catch {
              return "";
            }
          })
          .filter(Boolean)
      );
    const sigA = sigs(a, a.storyboard.scenes.map((s) => s.id));
    const sigB = sigs(b, b.storyboard.scenes.map((s) => s.id));
    if (sigA.size > 0 && sigB.size > 0) {
      check("Topic A composition topologies are varied", sigA.size >= 4, `${sigA.size} distinct layouts`);
      check("Topic B composition topologies are varied", sigB.size >= 4, `${sigB.size} distinct layouts`);
      check(
        "The two topics do not share one composition template set",
        jaccard(sigA, sigB) < 0.85,
        `layout overlap ${(jaccard(sigA, sigB) * 100).toFixed(0)}%`
      );
    } else {
      console.log("  [SKIP] Composition metadata not present for both topics yet.");
    }

    // Data shown on screen must be topic-specific.
    const dataA = new Set(
      a.storyboard.scenes.flatMap((s) => (s.data_points ?? []).map((d) => `${d.metric}=${d.value}`))
    );
    const dataB = new Set(
      b.storyboard.scenes.flatMap((s) => (s.data_points ?? []).map((d) => `${d.metric}=${d.value}`))
    );
    if (dataA.size > 0 || dataB.size > 0) {
      check(
        "No on-screen data point is shared between topics",
        jaccard(dataA, dataB) === 0,
        `${dataA.size} vs ${dataB.size} data points`
      );
    }
  }

  console.log("\n==============================================================");
  console.log(`GENERALIZATION: ${passed} passed, ${failed} failed`);
  console.log("==============================================================");
  if (failed > 0) process.exit(1);
}

main();
