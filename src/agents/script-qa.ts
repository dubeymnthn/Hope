import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ScriptResult } from "../schemas/script.js";
import { ResearchResult } from "../schemas/research.js";
import { ArgumentResult } from "../schemas/argument.js";
import { ChannelConfig } from "../schemas/channel.js";
import { EvidenceGraph } from "../schemas/evidence-graph.js";

export interface ScriptQACheck {
  name: string;
  category: "evidence" | "editorial" | "language" | "duration";
  passed: boolean;
  message: string;
  details?: any;
}

export interface ScriptQAReport {
  status: "PASS" | "WARN" | "FAIL";
  evaluatedAt: string;
  totalScenes: number;
  totalWords: number;
  estimatedDurationMinutes: number;
  checks: ScriptQACheck[];
  errors: string[];
  warnings: string[];
}

/** Phrasings that mark generic machine-written prose. */
const AI_SLOP_PATTERNS: RegExp[] = [
  /\bdelve into\b/i,
  /\btapestry of\b/i,
  /\bbeacon of\b/i,
  /\bgame[- ]changer\b/i,
  /\bdive deep\b/i,
  /\brevolutioniz(e|ing) the way\b/i,
  /\bin (?:this|today's) fast[- ]paced world\b/i,
  /\bit(?:'s| is) important to (?:remember|note)\b/i,
  /\b(?:a|is a) testament to\b/i,
  /\bpaint(?:ing)? a vivid picture\b/i,
  /\bunleash(?:ing)? the power\b/i,
  /\bnavigate the complexit(?:y|ies)\b/i,
  /\bat the end of the day\b/i,
  /\bthe bottom line is\b/i,
  /\bwhen it comes to\b/i,
  /\bneedless to say\b/i,
  /\bbuckle up\b/i,
  /\blet that sink in\b/i,
  /\bstay tuned\b/i,
  /\bin this video\b/i,
  /\bwelcome back\b/i,
  /\bhey (?:guys|everyone)\b/i,
  /\bdon't forget to (?:like|subscribe)\b/i
];

/**
 * Numeric claims that carry a unit, percentage, currency or magnitude. Bare small
 * integers ("two reasons", "the first") are excluded: they are prose, not data.
 */
const QUANTITATIVE_CLAIM =
  /(?:[$£€]\s?\d[\d,.]*\s?(?:bn|billion|tn|trillion|m|million|k|thousand)?)|(?:\d[\d,.]*\s?(?:%|percent|percentage points?|x\b|bn\b|billion|tn\b|trillion|million|nm\b|gb\b|tb\b|kwh\b|gwh\b|mwh\b|weeks?|months?|years?|days?|hours?|tons?|tonnes?|degrees?))/gi;

function normalizeNumeric(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s,]/g, "")
    .replace(/percentage points?/g, "%")
    .replace(/percent/g, "%")
    .replace(/[$£€]/g, "")
    .replace(/billion/g, "bn")
    .replace(/trillion/g, "tn")
    .trim();
}

/** Word n-grams used for repetition detection. */
function ngrams(text: string, n: number): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join(" "));
  return out;
}

/**
 * Script QA gate.
 *
 * Runs before TTS so an unsound script never consumes synthesis time. Evidence failures
 * and structural failures are errors; style and duration observations are warnings, since
 * the spec requires warning on duration rather than padding or truncating.
 */
export class ScriptQAAgent {
  public async evaluate(params: {
    script: ScriptResult;
    research?: ResearchResult;
    argument?: ArgumentResult;
    config?: ChannelConfig;
    outputDir?: string;
    /** V2.3: when supplied, enables the "Claim -> Evidence Traceability" orphan-claim check. */
    evidenceGraph?: EvidenceGraph;
  }): Promise<ScriptQAReport> {
    const { script, research, argument, config, evidenceGraph, outputDir = process.cwd() } = params;
    console.log(`[SCRIPT-QA] Auditing "${script.title}" before synthesis...`);

    const checks: ScriptQACheck[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    const wpm = config?.video?.wordsPerMinuteEstimate ?? 150;
    const totalWords = script.scenes.reduce(
      (sum, s) => sum + s.narration.trim().split(/\s+/).filter(Boolean).length,
      0
    );
    const estimatedMinutes = Math.round((totalWords / wpm) * 10) / 10;
    const allNarration = script.scenes.map((s) => s.narration).join(" ");

    // ================= EVIDENCE =================

    // E1. Quantitative claims must trace to the research dossier.
    if (research) {
      const supported = new Set<string>();
      for (const stat of research.statistics) {
        supported.add(normalizeNumeric(stat.value));
        for (const m of `${stat.value} ${stat.context} ${stat.metric}`.matchAll(QUANTITATIVE_CLAIM)) {
          supported.add(normalizeNumeric(m[0]));
        }
      }
      for (const fact of research.facts) {
        for (const m of fact.statement.matchAll(QUANTITATIVE_CLAIM)) {
          supported.add(normalizeNumeric(m[0]));
        }
      }
      for (const ev of research.timeline) {
        for (const m of `${ev.date} ${ev.event} ${ev.significance}`.matchAll(QUANTITATIVE_CLAIM)) {
          supported.add(normalizeNumeric(m[0]));
        }
      }

      const unsupported: string[] = [];
      for (const scene of script.scenes) {
        for (const m of scene.narration.matchAll(QUANTITATIVE_CLAIM)) {
          const claim = normalizeNumeric(m[0]);
          const traced =
            supported.has(claim) ||
            Array.from(supported).some(
              (s) => s.length > 1 && (s.includes(claim) || claim.includes(s))
            );
          if (!traced) unsupported.push(`${scene.id}: "${m[0].trim()}"`);
        }
      }

      const evidencePass = unsupported.length === 0;
      checks.push({
        name: "Quantitative Claim Traceability",
        category: "evidence",
        passed: evidencePass,
        message: evidencePass
          ? "Every quantitative claim in the narration traces to the research dossier"
          : `${unsupported.length} quantitative claim(s) do not appear in the research dossier`,
        details: unsupported
      });
      if (!evidencePass) {
        errors.push(
          `Unsupported quantitative claims in narration (possible fabrication): ` +
            unsupported.slice(0, 8).join("; ") +
            (unsupported.length > 8 ? ` and ${unsupported.length - 8} more` : "")
        );
      }

      // E2. Research metrics actually reaching the narration.
      let used = 0;
      for (const stat of research.statistics) {
        const v = normalizeNumeric(stat.value);
        if (v && normalizeNumeric(allNarration).includes(v)) used++;
      }
      checks.push({
        name: "Research Metric Utilisation",
        category: "evidence",
        passed: true,
        message: `${used}/${research.statistics.length} research statistics appear in the narration`,
        details: { used, available: research.statistics.length }
      });

      // E3. Speculation must not be stated as settled fact.
      const speculative = research.facts.filter(
        (f) => f.category === "SPECULATION" || f.category === "UNVERIFIED"
      );
      const hedges = /\b(may|might|could|appears|suggests?|reportedly|estimated|likely|expected|if\b|unclear|unconfirmed|analysts? (?:believe|expect))\b/i;
      const unhedged: string[] = [];
      for (const spec of speculative) {
        const key = spec.statement
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length > 5)
          .slice(0, 4);
        if (key.length < 2) continue;
        for (const scene of script.scenes) {
          const n = scene.narration.toLowerCase();
          const overlap = key.filter((w) => n.includes(w)).length;
          if (overlap >= Math.max(2, key.length - 1) && !hedges.test(scene.narration)) {
            unhedged.push(`${scene.id} states "${spec.statement.slice(0, 70)}..." without hedging`);
            break;
          }
        }
      }
      const hedgePass = unhedged.length === 0;
      checks.push({
        name: "Speculation Hedging",
        category: "evidence",
        passed: hedgePass,
        message: hedgePass
          ? "Speculative and unverified research is not presented as settled fact"
          : `${unhedged.length} scene(s) present speculative material without hedging`,
        details: unhedged
      });
      if (!hedgePass) warnings.push(...unhedged);
    }

    // E4. Claim -> Evidence Traceability (V2.3 spec §25): no orphan factual claims.
    // Only active when a scene actually populates structured scriptClaims AND an evidence
    // graph was supplied — fully inert for any workspace predating V2.3 (all three existing
    // topic productions), so this check cannot affect test:v2/test:generalization/test:v22.
    const scenesWithScriptClaims = script.scenes.filter((s) => (s.scriptClaims?.length ?? 0) > 0);
    if (evidenceGraph && scenesWithScriptClaims.length > 0) {
      const knownIds = new Set<string>([
        ...evidenceGraph.claims.map((c) => c.claimId),
        ...evidenceGraph.evidence.map((e) => e.evidenceId)
      ]);
      const orphans: string[] = [];
      for (const scene of scenesWithScriptClaims) {
        for (const sc of scene.scriptClaims ?? []) {
          const unresolved = sc.evidenceIds.filter((id) => !knownIds.has(id));
          if (unresolved.length > 0) {
            orphans.push(`${scene.id}/${sc.scriptClaimId}: unresolved evidenceIds ${unresolved.join(", ")}`);
          }
        }
      }
      const traceabilityPass = orphans.length === 0;
      checks.push({
        name: "Claim -> Evidence Traceability",
        category: "evidence",
        passed: traceabilityPass,
        message: traceabilityPass
          ? "Every scriptClaim resolves into the evidence graph"
          : `${orphans.length} scriptClaim(s) reference evidence ids not present in the evidence graph`,
        details: orphans
      });
      if (!traceabilityPass) {
        errors.push(
          `Orphan factual claims (evidenceIds not in research/evidence-graph.json): ` +
            orphans.slice(0, 8).join("; ") +
            (orphans.length > 8 ? ` and ${orphans.length - 8} more` : "")
        );
      }
    }

    // ================= EDITORIAL =================

    const hookPass = !!script.hook && script.hook.trim().length >= 20;
    checks.push({
      name: "Cold Open Hook",
      category: "editorial",
      passed: hookPass,
      message: hookPass ? "Cold open states a premise" : "Missing or inadequate cold open hook"
    });
    if (!hookPass) errors.push("Missing or inadequate cold open hook");

    const endingPass = !!script.ending && script.ending.trim().length >= 20;
    checks.push({
      name: "Closing Synthesis",
      category: "editorial",
      passed: endingPass,
      message: endingPass ? "Closing takeaway present" : "Script lacks a concluding synthesis"
    });
    if (!endingPass) errors.push("Missing closing synthesis");

    const sceneCountPass = script.scenes.length >= 4;
    checks.push({
      name: "Narrative Beat Density",
      category: "editorial",
      passed: sceneCountPass,
      message: `${script.scenes.length} narrative scenes`,
      details: { sceneCount: script.scenes.length }
    });
    if (!sceneCountPass) errors.push(`Too few narrative scenes (${script.scenes.length} < 4)`);

    // Central question should be posed in the narration, not only in the argument artifact.
    if (argument) {
      const qWords = argument.centralQuestion
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 4);
      const nl = allNarration.toLowerCase();
      const overlap = qWords.filter((w) => nl.includes(w)).length;
      const questionPass = qWords.length === 0 || overlap / qWords.length >= 0.4;
      checks.push({
        name: "Central Question Present In Narration",
        category: "editorial",
        passed: questionPass,
        message: questionPass
          ? "The central question is posed in the narration"
          : "The narration never clearly poses the central question",
        details: { overlap, keywords: qWords.length }
      });
      if (!questionPass) {
        warnings.push("The central question from the argument is not clearly posed in the narration");
      }

      // Counterarguments should be engaged somewhere in the script.
      let engaged = 0;
      for (const ca of argument.counterArguments) {
        const cw = ca.position
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length > 5);
        if (cw.length === 0) continue;
        if (cw.filter((w) => allNarration.toLowerCase().includes(w)).length / cw.length >= 0.3) engaged++;
      }
      const caPass = argument.counterArguments.length === 0 || engaged > 0;
      checks.push({
        name: "Counterargument Engagement",
        category: "editorial",
        passed: caPass,
        message: caPass
          ? `${engaged}/${argument.counterArguments.length} counterarguments engaged in the narration`
          : "No counterargument from the argument artifact is engaged in the narration",
        details: { engaged, total: argument.counterArguments.length }
      });
      if (!caPass) warnings.push("The script does not engage any of the identified counterarguments");
    }

    // Repetition: a repeated long phrase is the signature of padding.
    const seen = new Map<string, string[]>();
    for (const scene of script.scenes) {
      for (const g of ngrams(scene.narration, 7)) {
        if (!seen.has(g)) seen.set(g, []);
        seen.get(g)!.push(scene.id);
      }
    }
    const repeated = [...seen.entries()].filter(([, ids]) => new Set(ids).size > 1);
    const repetitionPass = repeated.length === 0;
    checks.push({
      name: "Phrase Repetition",
      category: "editorial",
      passed: repetitionPass,
      message: repetitionPass
        ? "No 7-word phrase repeats across scenes"
        : `${repeated.length} long phrase(s) repeat across scenes`,
      details: repeated.slice(0, 6).map(([g, ids]) => `"${g}" in ${[...new Set(ids)].join(", ")}`)
    });
    if (!repetitionPass) {
      warnings.push(
        `Repeated phrasing across scenes (${repeated.length} instances) suggests padding or restated explanation`
      );
    }

    // Duplicate scene purposes indicate the same beat written twice.
    const purposes = script.scenes.map((s) => s.purpose.toLowerCase().trim());
    const dupPurposes = purposes.filter((p, i) => purposes.indexOf(p) !== i);
    const purposePass = dupPurposes.length === 0;
    checks.push({
      name: "Distinct Scene Purposes",
      category: "editorial",
      passed: purposePass,
      message: purposePass
        ? "Every scene has a distinct editorial purpose"
        : `${dupPurposes.length} scene(s) duplicate another scene's purpose`,
      details: [...new Set(dupPurposes)]
    });
    if (!purposePass) warnings.push("Some scenes share an identical editorial purpose");

    // ================= LANGUAGE =================

    const slopMatches: string[] = [];
    for (const scene of script.scenes) {
      for (const pattern of AI_SLOP_PATTERNS) {
        const m = scene.narration.match(pattern);
        if (m) slopMatches.push(`${scene.id}: "${m[0]}"`);
      }
    }
    const slopPass = slopMatches.length === 0;
    checks.push({
      name: "Anti-AI-Slop Language Filter",
      category: "language",
      passed: slopPass,
      message: slopPass
        ? "No generic AI filler phrasing detected"
        : `${slopMatches.length} generic phrase(s) detected`,
      details: slopMatches
    });
    if (!slopPass) {
      if (config?.editorial?.antiSlopMode) {
        errors.push(`Generic AI phrasing detected: ${slopMatches.slice(0, 6).join("; ")}`);
      } else {
        warnings.push(...slopMatches);
      }
    }

    // Rhetorical question density.
    const questionCount = (allNarration.match(/\?/g) || []).length;
    const questionRatio = script.scenes.length > 0 ? questionCount / script.scenes.length : 0;
    const questionPass2 = questionRatio <= 1.0;
    checks.push({
      name: "Rhetorical Question Restraint",
      category: "language",
      passed: questionPass2,
      message: `${questionCount} questions across ${script.scenes.length} scenes (${questionRatio.toFixed(2)} per scene)`,
      details: { questionCount, questionRatio: Math.round(questionRatio * 100) / 100 }
    });
    if (!questionPass2) {
      warnings.push(`High rhetorical question density (${questionCount}); it reads as a verbal tic`);
    }

    // Sentence rhythm variation.
    const sentences = script.scenes.flatMap((s) =>
      s.narration.split(/(?<=[.?!])\s+/).filter((x) => x.trim().length > 0)
    );
    const lengths = sentences.map((st) => st.trim().split(/\s+/).filter(Boolean).length);
    const shortCount = lengths.filter((l) => l <= 8).length;
    const longCount = lengths.filter((l) => l >= 20).length;
    const mean = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
    const variance = lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, lengths.length);
    const stdev = Math.sqrt(variance);
    const rhythmPass = lengths.length < 6 || (shortCount > 0 && longCount > 0 && stdev >= 4);
    checks.push({
      name: "Spoken Sentence Rhythm",
      category: "language",
      passed: rhythmPass,
      message: rhythmPass
        ? `Varied rhythm: ${shortCount} short, ${longCount} long, stdev ${stdev.toFixed(1)} words`
        : `Uniform rhythm: ${shortCount} short, ${longCount} long, stdev ${stdev.toFixed(1)} words`,
      details: { sentences: lengths.length, shortCount, longCount, stdev: Math.round(stdev * 10) / 10 }
    });
    if (!rhythmPass) {
      warnings.push("Sentence rhythm is uniform; mix punchy statements with longer explanatory sentences");
    }

    // Overlong sentences are hard for a TTS voice to deliver.
    const overlong = sentences.filter((s) => s.trim().split(/\s+/).length > 45);
    const overlongPass = overlong.length === 0;
    checks.push({
      name: "TTS Deliverability",
      category: "language",
      passed: overlongPass,
      message: overlongPass
        ? "No sentence exceeds 45 words"
        : `${overlong.length} sentence(s) exceed 45 words and will read poorly aloud`,
      details: overlong.map((s) => s.slice(0, 80) + "...")
    });
    if (!overlongPass) warnings.push(`${overlong.length} sentences are too long to narrate naturally`);

    // ================= DURATION =================

    const minMins = config?.video?.minimumDurationMinutes ?? 7;
    const maxMins = config?.video?.maximumDurationMinutes ?? 13;
    let durationPass = true;
    let durationMsg = `${totalWords} words, ~${estimatedMinutes} min, within the ${minMins}-${maxMins} min range`;

    if (estimatedMinutes < minMins) {
      durationPass = false;
      durationMsg = `Script runs ~${estimatedMinutes} min, below the ${minMins} min target. Not padded; reported as-is.`;
      warnings.push(durationMsg);
    } else if (estimatedMinutes > maxMins) {
      durationPass = false;
      durationMsg = `Script runs ~${estimatedMinutes} min, above the ${maxMins} min limit. Not truncated; consider tightening.`;
      warnings.push(durationMsg);
    }

    checks.push({
      name: "Runtime Duration Assessment",
      category: "duration",
      passed: durationPass,
      message: durationMsg,
      details: { totalWords, estimatedMinutes, minMins, maxMins }
    });

    const status: "PASS" | "WARN" | "FAIL" =
      errors.length > 0 ? "FAIL" : warnings.length > 0 ? "WARN" : "PASS";

    const report: ScriptQAReport = {
      status,
      evaluatedAt: new Date().toISOString(),
      totalScenes: script.scenes.length,
      totalWords,
      estimatedDurationMinutes: estimatedMinutes,
      checks,
      errors,
      warnings
    };

    const qaDir = join(outputDir, "qa");
    mkdirSync(qaDir, { recursive: true });
    writeFileSync(join(qaDir, "script-qa-report.json"), JSON.stringify(report, null, 2), "utf-8");

    const md = [
      `# Script Editorial & Evidence QA Report`,
      ``,
      `**Status:** \`${report.status}\` | **Words:** ${totalWords} | **Estimated runtime:** ~${estimatedMinutes} min | **Scenes:** ${script.scenes.length}`,
      `*Evaluated at:* ${report.evaluatedAt}`,
      ``,
      `## Verification matrix`,
      `| Category | Check | Result | Measurement |`,
      `|---|---|---|---|`,
      ...checks.map(
        (c) => `| ${c.category.toUpperCase()} | ${c.name} | ${c.passed ? "PASS" : "ATTENTION"} | ${c.message} |`
      ),
      ``,
      ...(errors.length > 0 ? [`## Blocking errors`, ...errors.map((e) => `- ${e}`), ``] : []),
      ...(warnings.length > 0 ? [`## Warnings`, ...warnings.map((w) => `- ${w}`), ``] : [])
    ];
    writeFileSync(join(qaDir, "script-qa-report.md"), md.join("\n"), "utf-8");

    console.log(
      `[SCRIPT-QA] ${status}: ${errors.length} error(s), ${warnings.length} warning(s), ` +
        `~${estimatedMinutes} min of narration.`
    );
    return report;
  }
}
