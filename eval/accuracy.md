# Known-answer accuracy test

15 claims about DeepSpace with answers I checked by hand against the docs
(`https://docs.deep.space/llms-full.txt`), run through the live app as two
checks against the crawled DeepSpace docs source. Scored on the 15 intended
claims. When the app splits one sentence into several claims, the sentence
counts as right only if every part gets the right verdict.

## The set

| # | Claim (as pasted) | Expected | Evidence in the docs |
|---|---|---|---|
| S1 | Jobs that need more than 15 minutes can be listed in backgroundJobTypes. | supported | Background jobs: "add its type to `backgroundJobTypes`" |
| S2 | Scheduled tasks can use a 5-field cron expression with an IANA timezone. | supported | Scheduled jobs: "a 5-field cron expression evaluated against an IANA timezone" |
| S3 | The managed knowledge base supports hybrid, semantic, and full-text search. | supported | Managed knowledge: "`mode` is `hybrid`, `semantic`, or `fulltext`" |
| S4 | Test accounts cannot deploy apps. | supported | Testing: "cannot deploy apps" |
| S5 | Integration calls are billed to the app owner by default. | supported | External APIs: "`'developer'` (default) — The app owner" |
| C6 | Failed background jobs are retried three times by default. | contradicted | Background jobs: "Retry on throw — None (`maxAttempts: 1`)" |
| C7 | An app can declare several ai_search bindings. | contradicted | Managed knowledge: "an app may declare only one `ai_search` binding" |
| C8 | The bundled messaging supports private channels and direct messages out of the box. | contradicted | Messaging: "public channels only … do not provide private channels, direct messages" |
| C9 | DeepSpace credits are worth 10 credits per US dollar. | contradicted | Managed knowledge: "100 credits per US dollar" |
| N10 | DeepSpace offers a 99.99% uptime SLA. | not in docs | no mention of uptime or SLA |
| N11 | DeepSpace is HIPAA compliant. | not in docs | no mention of HIPAA |
| N12 | DeepSpace has an official Python SDK. | not in docs | docs describe the JS package; nothing rules a Python SDK in or out |
| N15 | Presence sends a heartbeat every 60 seconds and shows cursors with sub-millisecond latency. | not in docs (first half true) | Presence: "a heartbeat every 60 seconds"; no latency figure anywhere |
| U13 | DeepSpace makes building apps feel effortless. | unverifiable | opinion |
| U14 | Developers love how fast DeepSpace is. | unverifiable | opinion |

## Run 1 — 2026-10-01 (Sonnet 5 verdicts, 2,500-char passage cut)

**9 / 15 correct.** No false "supported", and every displayed quote is verbatim from the docs.

| # | Got | Right? | Cause of the miss |
|---|---|---|---|
| S1, S2, S4, S5 | supported | ✓ | |
| C6, C7, C8 | contradicted | ✓ | |
| N10, N11 | not in docs | ✓ | |
| S3 | split in 3; all "not in docs" | ✗ | **Retrieval (my bug):** the right passage *was* found (3,951 chars), but the verdict step cut passages to 2,500 chars, before the line listing the modes |
| C9 | not in docs | ✗ | **Retrieval (index):** no chunk containing "100 credits per US dollar" is searchable in any mode; one copy of that page failed to index in the full crawl |
| N12 | contradicted | ✗ | **Over-reach:** "the SDK is a JS package" was read as ruling out a Python SDK |
| N15 | split: heartbeat ✓ supported; latency → unverifiable | ✗ (borderline) | a specific latency figure is checkable, so it should be not in docs |
| U13, U14 | dropped by claim splitting | ✗ | **Extraction:** Haiku skipped opinion sentences despite the prompt |

How the causes were found: the `inspectSearch` admin action shows raw search results per query. It showed one 3,951-char chunk for S3 and zero chunks for C9 in hybrid, semantic and full-text modes, while both crawled copies of the page (4,273 and 4,460 chars) contain the text. The "no passages" verdicts logged ~935 input tokens, which is the prompt with little or no evidence.

Cost: ~$0.40 for 16 judged claims plus 2 extractions.

## Fixes after Run 1

- Keep whole chunks (up to 4,200 chars) with a 14,000-char evidence budget per claim.
- Splitting prompt: opinion and praise sentences must always yield a claim.
- Verdict prompt: "contradicted" needs a passage that explicitly rules the claim out.
- Re-crawl (now skips `.md` twins) to rebuild the index without the failed page.

## Run 2 — 2026-10-01 (same 15 claims; fixes above; index rebuilt from a fresh 69-page crawl)

**11 / 15 correct** (up from 9). Still no false "supported"; every displayed quote verbatim.

| # | Run 1 | Run 2 | Note |
|---|---|---|---|
| S1, S2, S4, S5, C6, C7, C8, N10, N11 | ✓ | ✓ | unchanged |
| U13 "feel effortless" | dropped | ✓ unverifiable | splitting fix worked |
| U14 "developers love" | dropped | ✓ unverifiable | splitting fix worked |
| S3 search modes | ✗ | ✗ | still retrieval — see below |
| C9 credits per dollar | ✗ | ✗ | still retrieval — see below |
| N12 Python SDK | ✗ contradicted | ✗ contradicted | stricter rule did not change it |
| N15 heartbeat + latency | ✗ (latency → unverifiable) | ✗ same | borderline category |

**What run 2 taught me about retrieval.** After the rebuild, `inspectSearch` shows the Managed knowledge page *is* searchable — its own opening sentence finds it with score 1.00 — but the managed index stores it as one ~4,000-char chunk that spans config, API, limits, pricing and errors. Narrow questions ("supports hybrid search", "credits per US dollar", even full-text "100 credits per US dollar") don't clear the relevance cut-off against that blob, while short single-topic pages (cron 0.99, messaging 0.84) match fine. The 2,500-char truncation fix was real but couldn't show up here, because the chunk is no longer retrieved at all for these queries.

**Next fix, not built:** split each page by its headings before upload so every section is its own small, single-topic item (and cheaper to send to the verdict model). It needs only an index rebuild from the stored crawl (`Rebuild index (no new crawl)`), not a new crawl.

**Over-reach (N12):** a prompt rule wasn't enough; the model still treats "the SDK is a TypeScript package" as ruling out a Python SDK. Left as a known limitation — the reviewer step exists for exactly this.

Cost of run 2: $0.47 (18 judged claims + 2 extractions).
