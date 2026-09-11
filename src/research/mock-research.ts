import { WebResearchProvider, SearchResult, PageContent } from "./provider.js";

export class MockWebResearchProvider implements WebResearchProvider {
  async search(query: string): Promise<SearchResult[]> {
    return [
      {
        title: "Mock AI Memory Shortage Report",
        url: "https://mock.example.com/memory-prices",
        snippet: "Mock findings: Memory prices increased by 250% due to HBM3e AI demands."
      }
    ];
  }

  async fetch(url: string): Promise<PageContent> {
    return {
      url,
      title: "Mock AI Memory Page",
      markdown: "HBM3e production is sold out through 2026. Spot prices are surging."
    };
  }
}
