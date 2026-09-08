# Graph Report - homepage  (2026-09-08)

## Corpus Check
- 40 files · ~31,883 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 219 nodes · 303 edges · 19 communities (13 shown, 6 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `bb832f1c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 16 edges
2. `fetchCitiesForState()` - 9 edges
3. `stateFullName()` - 8 edges
4. `stateSlug()` - 8 edges
5. `citySlug()` - 8 edges
6. `getPageSeo()` - 7 edges
7. `siteUrl()` - 7 edges
8. `stateFromSlug()` - 7 edges
9. `scripts` - 5 edges
10. `CityHubPage()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `generateMetadata()` --calls--> `getPageSeo()`  [EXTRACTED]
  src/app/layout.tsx → src/lib/page-seo.ts
- `generateMetadata()` --calls--> `stateFromSlug()`  [EXTRACTED]
  src/app/venues/[state]/page.tsx → src/lib/us-states.ts
- `generateMetadata()` --calls--> `buildMetadata()`  [EXTRACTED]
  src/app/privacy/page.tsx → src/lib/page-seo.ts
- `generateMetadata()` --calls--> `getPageSeo()`  [EXTRACTED]
  src/app/privacy/page.tsx → src/lib/page-seo.ts
- `sitemap()` --calls--> `citySlug()`  [EXTRACTED]
  src/app/sitemap.ts → src/lib/us-states.ts

## Import Cycles
- None detected.

## Communities (19 total, 6 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.11
Nodes (16): ListingTracker(), Props, APP, SaveToWishlistButton(), VenueFaqItem, VenueFaqSection(), VenueMapEmbed(), VenueSocial (+8 more)

### Community 1 - "Community 1"
Cohesion: 0.16
Nodes (23): SeoIndexVenue, SITE_URL, sitemap(), CityHubPage(), generateMetadata(), resolveCityName(), SITE_URL, VenueSeoFooter() (+15 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (24): dependencies, lucide-react, next, react, react-dom, @supabase/supabase-js, @tailwindcss/typography, devDependencies (+16 more)

### Community 3 - "Community 3"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 4 - "Community 4"
Cohesion: 0.10
Nodes (14): Ga4Scripts(), LEAD_LINK_EVENTS, LeadLinkTracker(), ListingLeadModal(), Props, Status, TOURING_OPTIONS, API_BASE (+6 more)

### Community 5 - "Community 5"
Cohesion: 0.21
Nodes (9): APP_URL, generateMetadata(), APP_URL, buildMetadata(), getPageSeo(), PageSeoRow, siteUrl(), generateMetadata() (+1 more)

### Community 6 - "Community 6"
Cohesion: 0.16
Nodes (11): DirectoryListingBadges(), DirectoryVenueCard(), LocationAutocomplete(), LocationSuggestion, Props, AMENITIES, BUDGET_LABELS, BudgetTier (+3 more)

### Community 7 - "Community 7"
Cohesion: 0.19
Nodes (11): AVATAR_BG, avatarColor(), GoogleReviewRow, GoogleReviewsBundle, ReviewCardGoogle(), ReviewCardStory(), SortKey, StoryReviewRow (+3 more)

### Community 8 - "Community 8"
Cohesion: 0.22
Nodes (5): AVATARS, FAQS, LandingPage(), LAUNCH_DATE, useCountdown()

### Community 9 - "Community 9"
Cohesion: 0.32
Nodes (3): supabaseAdmin, POST(), sendEmail()

### Community 10 - "Community 10"
Cohesion: 0.47
Nodes (4): MetaPixelScript(), fetchVenueBasics(), metadata, ThankyouPage()

### Community 11 - "Community 11"
Cohesion: 0.33
Nodes (5): Deploy on Railway, Environment variables, Local development, Relationship to the main StoryPay app, StoryPay Homepage (storypay.io)

## Knowledge Gaps
- **91 isolated node(s):** `eslintConfig`, `nextConfig`, `name`, `version`, `private` (+86 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `siteUrl()` connect `Community 5` to `Community 0`, `Community 1`, `Community 4`?**
  _High betweenness centrality (0.088) - this node is a cross-community bridge._
- **Why does `DirectoryListingBadges()` connect `Community 6` to `Community 0`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Why does `VenueSeoFooter()` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **What connects `eslintConfig`, `nextConfig`, `name` to the rest of the system?**
  _91 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.10666666666666667 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._