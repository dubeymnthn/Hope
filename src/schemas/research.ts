import { z } from "zod";

export const FactCategoryEnum = z.enum([
  "FACT",
  "OPINION",
  "ESTIMATE",
  "SPECULATION",
  "UNVERIFIED"
]);
export type FactCategory = z.infer<typeof FactCategoryEnum>;

export const SourceCitationSchema = z.object({
  title: z.string().describe("Title of the cited source or publication"),
  url: z.string().describe("URL or origin of the source"),
  retrievedAt: z.string().optional().describe("ISO timestamp when retrieved")
});
export type SourceCitation = z.infer<typeof SourceCitationSchema>;

export const ResearchFactSchema = z.object({
  statement: z.string().describe("The statement or claim"),
  category: FactCategoryEnum.describe("Reliability category"),
  confidence: z.number().min(0).max(1).describe("Confidence score between 0 and 1"),
  source: SourceCitationSchema.describe("Citation for this statement")
});
export type ResearchFact = z.infer<typeof ResearchFactSchema>;

export const StatisticItemSchema = z.object({
  metric: z.string().describe("What is being measured (e.g., 'HBM3e spot price')"),
  value: z.string().describe("The value or change (e.g., '+280%')"),
  context: z.string().describe("Context or timeframe (e.g., 'Q1 2024 to Q3 2026')"),
  source: SourceCitationSchema.optional()
});
export type StatisticItem = z.infer<typeof StatisticItemSchema>;

export const TimelineEventSchema = z.object({
  date: z.string().describe("Date or period (e.g. 'Late 2023', '2024 Q2')"),
  event: z.string().describe("Key development or milestone"),
  significance: z.string().describe("Why this event matters to the topic")
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

export const ResearchResultSchema = z.object({
  topic: z.string().describe("Primary topic of research"),
  angle: z.string().describe("Unique editorial angle or thesis"),
  summary: z.string().describe("Executive summary of findings"),
  facts: z.array(ResearchFactSchema).describe("Verified facts and categorized claims"),
  statistics: z.array(StatisticItemSchema).describe("Key numbers, price points, and metrics"),
  people: z.array(z.string()).describe("Key individuals involved"),
  companies: z.array(z.string()).describe("Key organizations, manufacturers, or players"),
  timeline: z.array(TimelineEventSchema).describe("Chronological progression of events"),
  claims_to_verify: z.array(z.string()).describe("Unconfirmed claims that script must treat carefully"),
  sources: z.array(SourceCitationSchema).describe("All referenced sources")
});
export type ResearchResult = z.infer<typeof ResearchResultSchema>;
