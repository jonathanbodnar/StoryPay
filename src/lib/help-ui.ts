/**
 * Framework-free helpers shared by every Help Center (venue owners and couples).
 *
 * Kept out of the components so the same ranking, snippet, and grouping rules
 * drive both audiences. Nothing here is audience-specific or touches the
 * network, so it is safe to unit test directly.
 */

export interface HelpArticleShape {
  id: string;
  title: string;
  body: string;
  tags: string[];
}

export interface HelpCategoryShape {
  id: string;
  label: string;
  color: string;
  iconName: string;
  articles: HelpArticleShape[];
}

/** An article flattened with its parent category's display metadata. */
export interface EnrichedArticle extends HelpArticleShape {
  catId: string;
  catLabel: string;
  catColor: string;
}

export function enrichArticles(categories: HelpCategoryShape[]): EnrichedArticle[] {
  return categories.flatMap((c) =>
    c.articles.map((a) => ({ ...a, catId: c.id, catLabel: c.label, catColor: c.color })),
  );
}

/** Pin one category first (the "Getting Started" equivalent), rest A–Z by label. */
export function sortHelpCategoriesForDisplay<T extends { id: string; label: string }>(
  categories: T[],
  firstCategoryId: string,
): T[] {
  const first = categories.find((c) => c.id === firstCategoryId);
  const rest = categories
    .filter((c) => c.id !== firstCategoryId)
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  return first ? [first, ...rest] : rest;
}

/**
 * Keyword match, mirroring the venue Help Center: one case-insensitive
 * `includes` over title, body, and tags. Requires 2+ characters so a single
 * letter does not match everything.
 */
export function matchesSubstring(article: HelpArticleShape, normalisedQuery: string): boolean {
  if (!normalisedQuery || normalisedQuery.length < 2) return false;
  const q = normalisedQuery.toLowerCase();
  return (
    article.title.toLowerCase().includes(q) ||
    article.body.toLowerCase().includes(q) ||
    article.tags.some((t) => t.toLowerCase().includes(q))
  );
}

/**
 * Related articles: score by tag overlap, with a bonus for the same category,
 * then take the best few. Articles with no shared tag and a different category
 * are excluded rather than padding the list.
 */
export function getRelatedArticles(
  all: EnrichedArticle[],
  sourceId: string,
  limit = 3,
): EnrichedArticle[] {
  const source = all.find((a) => a.id === sourceId);
  if (!source) return [];
  const sourceTags = new Set(source.tags.map((t) => t.toLowerCase()));
  return all
    .filter((a) => a.id !== sourceId)
    .map((a) => {
      const tagOverlap = a.tags.filter((t) => sourceTags.has(t.toLowerCase())).length;
      const sameCategory = a.catId === source.catId ? 1 : 0;
      return { article: a, score: tagOverlap + sameCategory };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ article }) => article);
}

/**
 * The best excerpt to show under a search result: a ~140 character window
 * around the match, falling back to the first non-empty line.
 */
export function getBestSnippet(body: string, term: string): string {
  const firstLine = body.split('\n').find((l) => l.trim()) || '';
  if (!term || term.length < 2) return firstLine;
  const idx = body.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return firstLine;
  const start = Math.max(0, idx - 60);
  const end = Math.min(body.length, idx + term.length + 80);
  let snippet = body.slice(start, end).replace(/\n/g, ' ').trim();
  if (start > 0) snippet = `\u2026${snippet}`;
  if (end < body.length) snippet = `${snippet}\u2026`;
  return snippet;
}

/** Escape a user string for safe use inside a RegExp. */
export function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
