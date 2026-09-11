export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface PageContent {
  url: string;
  title: string;
  markdown: string;
}

export interface WebResearchProvider {
  search(query: string, limit?: number): Promise<SearchResult[]>;
  fetch(url: string): Promise<PageContent>;
}
