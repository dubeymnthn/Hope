import { resolve } from "node:path";
import { buildSearchIndex, search, resolveToTimestamp, SearchRecordKind } from "./index.js";

/**
 * Thin CLI over the search index (V2.3 spec §29): `npm run search -- "<query>" -d <workspace>`.
 * TypeScript infra only — no reasoning, just reads already-authored artifacts.
 */
function usage(): void {
  console.log(`
Documentary research search (V2.3)

Usage:
  npm run search -- "<query>" -d <workspace-dir> [options]

Options:
  -d, --dir <dir>      Topic workspace directory (e.g. topics/why-modern-batteries-are-still-expensive)
  -k, --kind <kind>     Restrict to one record kind (claim, evidence, source, entity, datapoint, event, question, contradiction, scene, chapter)
  -e, --exact           Exact-phrase match instead of substring
  -l, --limit <n>       Max results (default 20)

Examples:
  npm run search -- "TSMC" -d topics/how-a-semiconductor-fab-actually-works
  npm run search -- "\\$7,000" -d topics/how-a-semiconductor-fab-actually-works -k datapoint
`);
}

function parseArgs(args: string[]): { query: string; dir?: string; kind?: SearchRecordKind; exact: boolean; limit: number } {
  let query = "";
  let dir: string | undefined;
  let kind: SearchRecordKind | undefined;
  let exact = false;
  let limit = 20;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-d" || arg === "--dir") dir = args[++i];
    else if (arg === "-k" || arg === "--kind") kind = args[++i] as SearchRecordKind;
    else if (arg === "-e" || arg === "--exact") exact = true;
    else if (arg === "-l" || arg === "--limit") limit = parseInt(args[++i] || "20", 10);
    else if (!arg.startsWith("-") && !query) query = arg;
  }

  return { query, dir, kind, exact, limit };
}

function main(): void {
  const { query, dir, kind, exact, limit } = parseArgs(process.argv.slice(2));
  if (!query || !dir) {
    usage();
    process.exit(query && dir ? 0 : 1);
  }

  const workspaceDir = resolve(dir!);
  const records = buildSearchIndex(workspaceDir);
  const results = search(records, query, { kind, exact, limit });

  console.log(`\n[SEARCH] "${query}" in ${workspaceDir} — ${results.length}/${records.length} record(s) matched\n`);
  for (const r of results) {
    const ts = resolveToTimestamp(r, workspaceDir);
    const location = ts ? ` @ ${ts.sceneId} (${ts.start.toFixed(1)}s-${(ts.start + ts.duration).toFixed(1)}s)` : "";
    console.log(`[${r.kind}] ${r.id}${location}`);
    console.log(`  ${r.text.slice(0, 160)}${r.text.length > 160 ? "..." : ""}`);
  }
}

main();
