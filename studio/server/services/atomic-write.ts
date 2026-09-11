import { writeFileSync, renameSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Atomic write: write to a temp file, then rename over the target (spec V2.4 §33
 * "prefer temporary file, validate, atomic replace"). Same pattern already used by
 * `agent-task.ts`'s brief writer and `pipeline-state.ts`'s `saveState()` — reused here,
 * not reinvented, so a crash mid-write never leaves a partially-written canonical
 * artifact on disk.
 */
export function atomicWriteJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, path);
}

export function readJsonOrThrow<T = any>(path: string): T {
  if (!existsSync(path)) throw new Error(`Missing artifact: ${path}`);
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}
