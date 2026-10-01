# ClaimCheck: submission note

**Live URL:** https://claimcheck.app.space
**Repository:** https://github.com/JineshwarNariani/claimcheck

## What I built

ClaimCheck checks what's said about a developer tool against that tool's own docs. Paste a launch post, landing-page copy, or an answer ChatGPT gave about the product. It splits the text into claims and gives each a verdict (supported, contradicted, not in docs, unverifiable), with the doc passages that back it. A teammate signs off or disputes each verdict. A weekly job re-reads the cited pages and flags verdicts whose evidence has disappeared. The demo checks claims about DeepSpace against docs.deep.space.

The core rule: **a verdict only stands if its quote appears word for word in the docs.** Claude proposes; code verifies every quote and drops any it can't find.

## DeepSpace integrations and primitives used

- **Firecrawl** (crawl a 69-page docs site; weekly single-page re-reads)
- **Managed knowledge** (AI Search) for retrieval
- **AI proxy** (`createDeepSpaceAI`) with Claude Haiku 4.5 for splitting claims and Sonnet 5 for verdicts
- **JobRoom** background jobs with checkpoints
- **CronRoom** for the weekly re-check, with "Run now" and history
- **RecordRoom with RBAC**, `uniqueOn` and `userBound` (one review per person per claim)
- **Server actions** for spend limits and no-self-review
- **PresenceRoom** for who's viewing which claim
- **Bundled messaging** for per-check discussion
- **Auth**

**Left out on purpose:**
- Web search as evidence, because it would dilute "the docs say so".
- Yjs editing of the checked text, because editing would silently invalidate verdicts.
- Email and media, because they add spend without improving a verdict. Email is the first thing I'd add.

## The main tradeoff

**Trust over coverage.** ClaimCheck would rather say "not in docs" than confirm something it can't quote. On a 15-claim known-answer test it went from **9/15 to 11/15** after fixes, with **zero false "supported" verdicts** in either run. The misses are mostly retrieval: the right passage wasn't found, so the claim fell back to "not in docs". A third run targets that by indexing docs as heading-level sections.

The cost side was measured, not guessed. DeepSpace bills Sonnet 5 at about 4× list, so a 12-claim check is about $0.40. I tested turning off thinking to cut that: accuracy was the same and so was the cost, so I left it on.

## What the agent did

Claude Code wrote nearly all of the code and ran the live checks. Specifically, it:
- researched the DeepSpace docs, SDK types and integration catalog before building;
- built the pipeline, jobs, cron task, review features and design;
- wrote 29 unit tests and 15 browser tests, including a two-user collaboration test;
- deployed after each step and diagnosed failures from platform logs.

Everything is logged step by step, with what the agent did separated from what was verified, in `AGENT_LOG.md`.

## What I directed, decided and verified

- **Picked the idea after an explicit uniqueness and risk review.** ClaimCheck over a more novel "audit what AI assistants say about you" idea, because that one needed ~80 paid calls per run.
- **Set the budget rules:** crawl once and reuse it, cap pages, a cheap model for splitting, daily limits.
- **Chose Sonnet 5 for verdicts** from measured cost per check.
- **Asked for the thinking-off experiment,** which disproved the agent's cost hypothesis and found the real cause (4× billing).
- **Required a 15-claim known-answer test,** with each expected answer checked against the docs before running. Then asked for a re-measurement after fixes, rather than accepting the first number.
- **Reviewed the incidents the agent reported:**
  - a re-crawl hit the JobRoom's 15-minute alarm limit and briefly left 3 of 69 pages indexed;
  - a rebuild bug uploaded nothing.
  
  Both were fixed with checkpointed batches and per-crawl index folders, so the live index keeps serving during a rebuild.
- **Created the two test accounts** and confirmed the two-user review test passes: presence, no self-review in both UI and API, live sign-off and comments.
- **Checked the live app myself:** <!-- EDIT: list what you personally clicked through, e.g. ran a check, opened the review desk, read eval/accuracy.md -->

## Unfinished, and what I'd do next

- Retrieval still decides coverage, and the model can over-reach on "contradicted". Next: an explicit "rules out" second check on contradicted verdicts, and an eval that re-runs automatically after prompt or index changes.
- Email reviewers when a check needs them, plus a weekly stale-claim digest.
