import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EvidenceGraph, EvidenceGraphSchema } from "../schemas/evidence-graph.js";
import { ResearchQuestionSet, ResearchQuestionSetSchema } from "../schemas/research-questions.js";
import { ScriptResult, ScriptResultSchema } from "../schemas/script.js";
import { VisualPlan, VisualPlanSchema } from "../schemas/visual-plan.js";
import { AudioTimestamps, AudioTimestampsSchema } from "../schemas/timestamps.js";

/**
 * Local, dependency-free search/index over a topic workspace's already-authored
 * artifacts (V2.3 spec sections 28-30). No database: this reads the JSON files fresh on
 * every call, which is the correct scale for a local, single-user, one-topic-at-a-time
 * tool — the "no Postgres/Redis" constraint isn't a workaround here, it's simply enough.
 *
 * This also doubles as the data model a future local dashboard (spec §28) would read:
 * every record carries stable ids and, where resolvable, a `sceneId` back-reference so a
 * UI can jump straight from a search hit to the documentary timestamp that uses it.
 */

export type SearchRecordKind =
  | "claim"
  | "evidence"
  | "source"
  | "entity"
  | "datapoint"
  | "event"
  | "question"
  | "contradiction"
  | "scene"
  | "chapter";

export interface SearchRecord {
  kind: SearchRecordKind;
  id: string;
  text: string;
  refs: Record<string, string>;
}

function readJson<T>(path: string, schema: { parse: (v: unknown) => T }): T | null {
  if (!existsSync(path)) return null;
  try {
    return schema.parse(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    return null;
  }
}

/** Builds the full searchable record set from whatever artifacts currently exist. */
export function buildSearchIndex(workspaceDir: string): SearchRecord[] {
  const records: SearchRecord[] = [];
  const byId = new Map<string, SearchRecord>();
  const add = (r: SearchRecord) => {
    records.push(r);
    byId.set(`${r.kind}:${r.id}`, r);
  };

  const graph = readJson<EvidenceGraph>(join(workspaceDir, "research/evidence-graph.json"), EvidenceGraphSchema);
  if (graph) {
    for (const s of graph.sources) {
      add({ kind: "source", id: s.sourceId, text: `${s.title} ${s.publisher ?? ""} ${s.organization ?? ""} ${s.url}`, refs: { sourceId: s.sourceId } });
    }
    for (const e of graph.evidence) {
      add({
        kind: "evidence",
        id: e.evidenceId,
        text: `${e.evidenceExcerpt} ${e.claim ?? ""} ${e.dataValue ?? ""} ${e.unit ?? ""}`.trim(),
        refs: { evidenceId: e.evidenceId, sourceId: e.sourceId }
      });
    }
    for (const c of graph.claims) {
      add({ kind: "claim", id: c.claimId, text: c.statement, refs: { claimId: c.claimId, category: c.category } });
    }
    for (const d of graph.dataPoints) {
      add({
        kind: "datapoint",
        id: d.dataPointId,
        text: `${d.metric} ${d.value}${d.unit} ${d.scope} ${d.definition}`,
        refs: { dataPointId: d.dataPointId, sourceId: d.sourceId }
      });
    }
    for (const en of graph.entities) {
      add({ kind: "entity", id: en.entityId, text: `${en.name} ${en.description ?? ""}`, refs: { entityId: en.entityId, type: en.type } });
    }
    for (const ev of graph.events) {
      add({ kind: "event", id: ev.eventId, text: `${ev.title} ${ev.description} ${ev.date}`, refs: { eventId: ev.eventId } });
    }
    for (const ct of graph.contradictions) {
      add({ kind: "contradiction", id: ct.contradictionId, text: ct.description, refs: { claimId: ct.claimId } });
    }
  }

  const questions = readJson<ResearchQuestionSet>(join(workspaceDir, "research/research-questions.json"), ResearchQuestionSetSchema);
  if (questions) {
    for (const q of questions.questions) {
      add({ kind: "question", id: q.questionId, text: q.questionText, refs: { questionId: q.questionId, category: q.category } });
    }
  }

  const script = readJson<ScriptResult>(join(workspaceDir, "script/script.json"), ScriptResultSchema);
  if (script) {
    for (const scene of script.scenes) {
      add({ kind: "scene", id: scene.id, text: `${scene.narration} ${scene.purpose}`, refs: { sceneId: scene.id, chapter: scene.chapter ?? "" } });
    }
    for (const ch of script.chapters ?? []) {
      add({ kind: "chapter", id: ch.id, text: `${ch.title} ${ch.narrativePurpose}`, refs: { chapterId: ch.id, sceneIds: (ch.sceneIds ?? []).join(",") } });
    }

    // --- Provenance backfill (spec §30): a claim/evidence record used by a scene's
    // scriptClaims gets that scene's id, so a search hit can resolve to a timestamp. ---
    for (const scene of script.scenes) {
      for (const sc of scene.scriptClaims ?? []) {
        for (const evId of sc.evidenceIds) {
          const claimRecord = byId.get(`claim:${evId}`);
          if (claimRecord && !claimRecord.refs.sceneId) claimRecord.refs.sceneId = scene.id;
          const evidenceRecord = byId.get(`evidence:${evId}`);
          if (evidenceRecord && !evidenceRecord.refs.sceneId) evidenceRecord.refs.sceneId = scene.id;
        }
      }
    }
  }

  const plan = readJson<VisualPlan>(join(workspaceDir, "storyboard/visual-plan.json"), VisualPlanSchema);
  if (plan) {
    for (const scene of plan.scenes) {
      for (const dp of scene.dataPoints ?? []) {
        if (dp.claimId) {
          const claimRecord = byId.get(`claim:${dp.claimId}`);
          if (claimRecord && !claimRecord.refs.sceneId) claimRecord.refs.sceneId = scene.sceneId;
        }
        if (dp.sourceId) {
          const dataRecord = [...byId.values()].find((r) => r.kind === "datapoint" && r.refs.sourceId === dp.sourceId);
          if (dataRecord && !dataRecord.refs.sceneId) dataRecord.refs.sceneId = scene.sceneId;
        }
      }
    }
  }

  return records;
}

export interface SearchOptions {
  /** Match the whole query as a bounded phrase rather than any substring. */
  exact?: boolean;
  kind?: SearchRecordKind;
  limit?: number;
}

const NUMERIC_QUERY = /^[-+]?\$?\d[\d,.]*\s?%?$/;

function normalizeNumericQuery(s: string): string {
  return s.toLowerCase().replace(/[\s,]/g, "").replace(/[$]/g, "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Exact-phrase / substring / numeric-aware search over a record set (spec §29). */
export function search(records: SearchRecord[], query: string, opts: SearchOptions = {}): SearchRecord[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const pool = opts.kind ? records.filter((r) => r.kind === opts.kind) : records;

  let matches: SearchRecord[];
  if (NUMERIC_QUERY.test(trimmed)) {
    const nq = normalizeNumericQuery(trimmed);
    matches = pool.filter((r) => normalizeNumericQuery(r.text).includes(nq));
  } else if (opts.exact) {
    const re = new RegExp(`\\b${escapeRegExp(trimmed.toLowerCase())}\\b`);
    matches = pool.filter((r) => re.test(r.text.toLowerCase()));
  } else {
    const q = trimmed.toLowerCase();
    matches = pool.filter((r) => r.text.toLowerCase().includes(q));
  }

  return opts.limit ? matches.slice(0, opts.limit) : matches;
}

export interface TimestampResolution {
  sceneId: string;
  start: number;
  duration: number;
  narration: string;
}

/** Resolves a search result to a real documentary timestamp, when the audio has been synthesised. */
export function resolveToTimestamp(record: SearchRecord, workspaceDir: string): TimestampResolution | null {
  const sceneId = record.kind === "scene" ? record.id : record.refs.sceneId;
  if (!sceneId) return null;
  const audio = readJson<AudioTimestamps>(join(workspaceDir, "audio/timestamps.json"), AudioTimestampsSchema);
  if (!audio) return null;
  const sentence = audio.sentences.find((s) => s.sceneId === sceneId);
  if (!sentence) return null;
  return { sceneId, start: sentence.start, duration: sentence.duration, narration: sentence.text };
}
