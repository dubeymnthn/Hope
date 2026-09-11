import { z } from "zod";

/**
 * V2.6 (spec §10/§31): what downstream content is affected when research changes after
 * argument/script/visuals were already generated from it. Deterministic output, not
 * agent-authored — same role as `research-gaps.json` (gap-detection.ts).
 */
export const StalenessReportSchema = z.object({
  generatedAt: z.string(),
  staleReasons: z.array(z.string()),
  affectedClaims: z.array(z.string()),
  affectedArgumentSections: z.array(z.string()),
  affectedScriptScenes: z.array(z.string()),
  affectedVisualOpportunities: z.array(z.string()),
  summary: z.string()
});
export type StalenessReport = z.infer<typeof StalenessReportSchema>;
