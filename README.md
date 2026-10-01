# ClaimCheck

**Live:** https://claimcheck.app.space · **Built on** [DeepSpace](https://deep.space)

ClaimCheck checks what's said about a developer tool against that tool's own docs. Paste a launch post, landing-page copy, or an answer an AI assistant gave about the product. ClaimCheck splits it into claims and gives each one a verdict:

| Verdict | Meaning |
|---|---|
| ✓ Supported | The docs say it. |
| ✗ Contradicted | The docs say otherwise. |
| ? Not in docs | A checkable fact the docs don't settle. |
| ~ Unverifiable | Opinion or marketing language. |

A teammate then reviews the verdicts before anything ships. Every week, ClaimCheck re-reads the cited pages and flags verdicts whose evidence has disappeared.

The rule the whole app is built around: **a verdict stands only if its quote appears word for word in the docs.** The model proposes verdicts and quotes. Code checks every quote against the passage it cites, and drops any it can't find. A "supported" or "contradicted" verdict with no surviving quote is downgraded to "not in docs".

## How a check works

```
paste text ─▶ startCheck (server action: limits, auth)
            ─▶ check-claims job (JobRoom, one checkpointed tick per claim)
                 1. Claude Haiku 4.5 splits the text into claims
                 2. managed knowledge search (hybrid) finds doc passages
                 3. Claude Sonnet 5 proposes a verdict + exact quotes
                 4. code verifies every quote word for word (grounding.ts)
            ─▶ verdicts stream into the page live (RecordRoom)
            ─▶ a teammate agrees or disputes, per claim
weekly cron ─▶ re-scrape cited pages ─▶ quote still there? else flag "stale"
```

## What it uses from DeepSpace, and why

| DeepSpace feature | Used for | Why this instead of hand-rolling |
|---|---|---|
| **Firecrawl** integration (`crawl`, `get-crawl`, `scrape`) | Crawl a docs site (69 pages for docs.deep.space); weekly single-page re-reads | Async crawl with cost reporting, called through the integration proxy, so no API keys |
| **Managed knowledge** (`[[ai_search]]`, `knowledge(env)`) | Search the crawled docs for each claim | The platform's own retrieval index; I didn't build embeddings or a vector store |
| **AI proxy** (`createDeepSpaceAI`) with Claude Haiku 4.5 + Sonnet 5 | Claim splitting (cheap model) and verdicts (stronger model) | Billed to the app owner through the platform; structured output via the AI SDK |
| **JobRoom** (`useJobs`, `enqueueJob`, `ctx.continue`) | Crawls and checks as durable background jobs with live progress | Checkpointing means a retry resumes the same crawl or claim instead of paying twice |
| **CronRoom** (`useCronMonitor`) | Weekly citation re-check, with "Run now" and run history | Built-in schedule, manual trigger and execution log |
| **RecordRoom + RBAC** | Sources, pages, checks, claims, reviews, re-check log | Per-collection permissions, `uniqueOn` + `userBound` for one review per person per claim |
| **Server actions** | `startCheck` (input and daily spend limits), `reviewClaim` (no self-review), `openDiscussion`, admin `inspectSearch` | Rules that compare two records, which schema permissions can't express |
| **PresenceRoom** (`usePresenceRoom`) | Who else is viewing a check, and which claim they're looking at | Ephemeral, verified identities, nothing stored |
| **Bundled messaging** (`useMessages`) | A discussion thread per check | Platform schemas instead of a custom comments model |
| **Auth** | Google/GitHub sign-in; roles gate spend | |

**Spend controls** (the owner pays for everything):
- Only admins can start crawls or trigger the cron task. Both the JobRoom and the cron socket refuse writes from members.
- Members start checks only through `startCheck`, which caps them at 3 per person and 8 per app per day.
- Crawls are capped at 75 pages.
- Every check records its estimated cost.

### What I left out, and why

- **Exa / web search as evidence.** The point is to check claims against the product's own docs. Mixing in web results would make "supported" mean "someone online said so".
- **Collaborative editing of the checked text (Yjs).** A check is a snapshot: editing the text after verdicts exist would silently invalidate them. Reviews and discussion are the collaborative layer instead.
- **Email notifications (Resend).** Useful for a real team (for example, "3 claims need your review"), but they add spend and setup without making a verdict more accurate. That's the first thing I'd add next.
- **Image generation / voice.** Nothing about checking a claim gets better with them.
- **Live calls to ChatGPT/Claude/Gemini to collect their answers about a product.** I considered auditing "what assistants say about you" as the main idea. I rejected it because it needs about 80 paid calls per run and depends on a third-party API's latency, which a $5 free allowance can't absorb. Instead, ClaimCheck accepts any pasted text, including an assistant's answer copied by hand.

## The main tradeoff: trust over coverage

ClaimCheck would rather say "not in docs" than confirm something it can't quote. That costs coverage: retrieval misses show up as "not in docs" instead of the right verdict. But across two 15-claim test runs it produced **zero false "supported" verdicts**, and every quote shown on screen appears verbatim in the docs. The same deterministic quote check powers the weekly re-check, so verifying freshness needs no model calls (about $0.03 a run).

Model choice was a cost/quality decision made with real numbers. DeepSpace bills `claude-sonnet-5` at a measured **4.0× Anthropic list price** (Haiku at 1.3×), so a 12-claim check costs about $0.40. I tested whether turning off thinking would cut that: accuracy was 6/6 both ways and the cost was the same ($0.2048 vs $0.2044), so thinking stayed on. See [AGENT_LOG.md](AGENT_LOG.md).

## Measured accuracy

15 known-answer claims about DeepSpace. I checked each expected answer by hand against the docs before running. Full table, evidence and per-miss diagnosis: [eval/accuracy.md](eval/accuracy.md).

| Run | Change | Score | False "supported" |
|---|---|---|---|
| 1 | baseline | 9 / 15 | 0 |
| 2 | keep whole passages; splitting keeps opinion claims; stricter "contradicted" | 11 / 15 | 0 |
| 3 | heading-level sections in the index | *pending* | |

Run 2's remaining misses: two retrieval misses (the docs index stored a whole multi-topic page as one ~4,000-char chunk, so narrow questions never matched; run 3 targets this), one over-reach (the model read "the SDK is a TypeScript package" as ruling out a Python SDK), and one borderline category.

## Running it

```bash
npm install
npx deepspace auth login
npx deepspace dev start          # local dev (vite + miniflare)
npx deepspace test run all       # Playwright: smoke, API, two-user collaboration
npx vitest run                   # unit tests: grounding, staleness, crawl parsing, sections
npx deepspace deploy
```

The two-user test needs two DeepSpace test accounts (`npx deepspace test accounts create …`). It uses a dev-only `seedDemoCheck` action, so it makes no model calls.

## Code map

| Path | What it does |
|---|---|
| `src/check/` | The check pipeline: prompts, the job, deterministic grounding (`grounding.ts`) |
| `src/crawl/` | Crawl and index job (checkpointed phases, per-crawl index folders), page parsing and sectioning |
| `src/recheck/` | Weekly stale-claim detection (pure rules + cron task) |
| `src/actions/index.ts` | Server actions: `startCheck`, `reviewClaim`, `openDiscussion`, `inspectSearch`, dev-only `seedDemoCheck` |
| `src/schemas/` | Collections and their RBAC |
| `src/pages/` | Landing (`index.tsx`, static and prerendered), review desk, check, check detail, sources |
| `eval/accuracy.md` | The accuracy test set and results |
| `AGENT_LOG.md` | What the coding agent did and what was verified or decided, step by step |

## Known limitations

- **Retrieval decides coverage.** If search doesn't return the passage, the verdict falls back to "not in docs".
- **The model can still over-reach** on "contradicted". That's what teammate review is for.
- **The weekly re-check catches evidence that disappeared**, not docs that *newly* support a claim marked "not in docs". Catching that needs a model call.
- **One docs source per check;** no multi-product comparisons.

## What I'd do next

1. Email a reviewer when a check is waiting for them, and a weekly digest of stale claims.
2. A second "explicitly rules out" check on every "contradicted" verdict, to target the over-reach.
3. A larger eval set, run automatically after prompt or index changes.
