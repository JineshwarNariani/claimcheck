ClaimCheck

What I built:
ClaimCheck checks what's said about a developer tool against that tool's own docs. Paste a launch post, landing-page copy, or an answer ChatGPT gave about the product. It splits the text into claims and gives each a verdict (supported, contradicted, not in docs, unverifiable), with the doc passages that back it. A teammate signs off or disputes each verdict. A weekly job re-reads the cited pages and flags verdicts whose evidence has disappeared. The demo checks claims about DeepSpace against docs.deep.space.

The core rule: a verdict only stands if its quote appears word for word in the docs. Claude proposes; code verifies every quote and drops any it can't find.

DeepSpace integrations and primitives used:
- Firecrawl (crawl a 69-page docs site; weekly single-page re-reads)
- Managed knowledge (AI Search) for retrieval
- AI proxy (createDeepSpaceAI) with Claude Haiku 4.5 for splitting claims and Sonnet 5 for verdicts
- JobRoom background jobs with checkpoints
- CronRoom for the weekly re-check, with "Run now" and history
RecordRoom with RBAC, uniqueOn and userBound (one review per person per claim)
- Server actions for spend limits and no-self-review
- PresenceRoom for who's viewing which claim
- Bundled messaging for per-check discussion
- Auth

what i left out on purpose:

- Web search as evidence, because it would dilute "the docs say so".
- Yjs editing of the checked text, because editing would silently invalidate verdicts.
- email and media, because they add spend without improving a verdict. Email is the first thing I'd add.

The main tradeoff: 
Trust over coverage. ClaimCheck would rather say "not in docs" than confirm something it can't quote. On a 15-claim known-answer test it scored 9/15, then 11/15 after fixes, then 11/15 again after re-indexing docs by section (which fixed the retrieval miss it targeted but exposed a claim-splitting regression). Across all 45 judged claims: zero false "supported" verdicts. What's left is mostly the model over-reaching on "contradicted"; teammate review exists for that and then a narrow second check is the next fix.

The cost side was measured and  not guessed. DeepSpace bills Sonnet 5 at about 4× list, so a 12-claim check is about $0.40. I tested turning off thinking to cut that: accuracy was the same and so was the cost, so I left it on.

What the agent did
Claude Code wrote most all of the code and ran some of the live checks. Specifically it:

- built the pipeline, jobs, cron task, review features and design;
- wrote 29 unit tests and 15 browser tests, including a two-user collaboration test;
- deployed after each step and diagnosed failures from platform logs.
- everything is logged step by step, with what the agent did separated from what was verified, in AGENT_LOG.md.

What I directed, decided and verified:
- came up with the idea after an explicit uniqueness and risk review. decided ClaimCheck over a more novel "audit what AI assistants say about you" idea, because that one needed ~80 paid calls per run which i learnt from an analysis i did with claude.

- set the budget rules: crawl once and reuse it, cap pages, a cheap model for splitting, daily limits.

- chose Sonnet 5 for verdicts from measured cost per check.

- asked for the thinking-off experiment, which disproved the agent's cost hypothesis and found the real cause (4× billing).

- created a 15-claim known-answer test, with each expected answer checked against the docs before running. Then asked for a re-measurement after fixes, rather than accepting the first number.

- reviewed the incidents the agent reported and found the platform limits behind them:

a) a re-crawl hit the JobRoom's 15-minute alarm limit and briefly left 3 of 69 pages indexed;
b) managed-knowledge folders over 63 characters accept uploads but can't be listed or searched;
c) a deploy reset the job room mid-rebuild.
fixed with checkpointed batches, short index-build folders, and a "never deploy during a long job" rule. these are listed for the DeepSpace team in the README's "Platform findings".

- created the two test accounts and confirmed the two-user review test passes: presence, no self-review in both UI and API, live sign-off and comments.

-checked the live app myself: I ran a 3-claim check and confirmed its quotes against the docs pages, reviewed the review desk and the run-3 accuracy checks, and checked the Sources page and weekly re-check panel.

-found a bug while doing that: New check offered no docs source. An interrupted cleanup job had marked a working source "failed". The agent confirmed the index was intact, fixed the error handling so cleanup failures can't take a source offline, and added a verified Restore action.

Unfinished, and what I'd do next:
-retrieval still decides coverage, and the model can over-reach on "contradicted". Next: an explicit "rules out" second check on contradicted verdicts and an eval that re-runs automatically after prompt or index changes.
-email reviewers when a check needs them plus a weekly stale-claim digest.
