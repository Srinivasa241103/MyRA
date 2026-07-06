# RAG Hybrid Retrieval Plan

## Goal

Improve retrieval quality and efficiency in the current backend by combining:

1. lexical retrieval for exact keywords, names, subjects, dates, and entities
2. dense retrieval for semantic recall
3. follow-up query rewriting for conversational continuity
4. reranking and deduplication for final precision

This plan is intentionally implementation-focused, but it does **not** change code. It tells you exactly what to build, where to build it, and in what order.

---

## Current Backend Retrieval Path

### Files currently involved

- `backend/src/api/controllers/chatController.js`
- `backend/src/RAG/ragService.js`
- `backend/src/RAG/query/queryPipeline.js`
- `backend/src/RAG/retrieval/retriever.js`
- `backend/src/database/chunkRepository.js`
- `backend/src/RAG/ingestion/chunker.js`
- `backend/src/RAG/ingestion/embeddingPipeline.js`
- `backend/src/RAG/ingestion/embeddingsProvider.js`
- `backend/src/service/normalizers/GmailNormalizer.js`
- `backend/src/service/normalizers/GoogleCalendarNormalizer.js`
- `backend/src/RAG/query/memoryService.js`
- `backend/src/RAG/query/prompts.js`

### What the current flow does

1. user message reaches `chatController.js`
2. RAG requests go into `ragService.js`
3. `queryPipeline.js` calls `retriever.retrieve(query, userId, options)`
4. `retriever.js` creates a dense embedding for the raw query
5. `chunkRepository.js` runs vector similarity on `document_chunks`
6. returned chunks are filtered by a fixed distance threshold
7. `contextBuilder.js` concatenates them
8. the LLM answers using that context

### Main limitations

- no BM25 or lexical retrieval path
- no hybrid fusion
- no reranker
- no follow-up question rewrite before retrieval
- Gmail metadata is not indexed strongly enough for exact search
- chunking is generic rather than source-aware
- fixed similarity threshold is likely dropping relevant results
- no diversity control, so one document can dominate the context

---

## Target Retrieval Architecture

Build this retrieval pipeline:

1. load conversation history
2. decide whether the user query is standalone or a follow-up
3. rewrite follow-up questions into a standalone search query
4. extract retrieval filters where possible
5. run lexical retrieval
6. run dense retrieval
7. fuse both candidate lists with Reciprocal Rank Fusion
8. rerank the fused candidates
9. deduplicate and diversify results
10. build final context for the LLM

This is the most practical industry-standard direction for your current stack.

---

## Phase 1: Follow-Up Query Handling

### What to build

Add a query transformation step before retrieval.

### Where to do it

- create logic in `backend/src/RAG/retrieval/queryTransformer.js`
- call it from `backend/src/RAG/query/queryPipeline.js` before `retriever.retrieve(...)`
- reuse conversation history from `backend/src/RAG/query/memoryService.js`
- add or refine prompts in `backend/src/RAG/query/prompts.js`

### What it should do

For each incoming query:

- detect whether it depends on earlier turns
- rewrite it into a standalone retrieval query
- preserve key entities, dates, people, thread references, and source hints

### Example

Input:

- previous turn: "Show me emails from Rahul about the invoice"
- current turn: "What about the one from last week?"

Rewritten retrieval query:

- "Show me emails from Rahul about the invoice from last week"

### Additional output to extract

Have the transformer also try to infer structured filters:

- source type: `gmail`, `calendar`
- date range
- sender / organizer / attendee
- subject keywords
- document type

These filters should be passed into retrieval options.

### Important constraint

Do not use the raw follow-up question for search if a rewrite is available. Use the rewritten query for retrieval and keep the original user message for the response generation stage.

---

## Phase 2: Add Lexical Retrieval

### What to build

Implement a lexical retrieval path in addition to vector search.

### Where to do it

- implement `searchByText(...)` in `backend/src/database/chunkRepository.js`
- update `backend/src/RAG/retrieval/retriever.js` to call both text and vector retrieval

### Recommended database approach

Use PostgreSQL full-text search first.

That means:

- `to_tsvector(...)`
- `websearch_to_tsquery(...)`
- `ts_rank_cd(...)`
- `GIN` index for production efficiency

### What text should be indexed

For each chunk, lexical search should include:

- chunk content
- document title
- author
- Gmail subject
- Gmail from / to / snippet / labels
- Calendar summary
- Calendar organizer / attendees / location / description

### Important design point

Do **not** rely only on the chunk body for keyword search.

For email retrieval, lexical quality depends heavily on fields like:

- sender name
- sender email
- subject line
- recipient list
- labels

### Best practice

Build a normalized `search_text` or equivalent combined searchable string per chunk.

Even if you do not persist a dedicated column immediately, design retrieval as if this logical field exists.

---

## Phase 3: Hybrid Retrieval

### What to build

Combine lexical and dense results into one ranked candidate set.

### Where to do it

- main orchestration in `backend/src/RAG/retrieval/retriever.js`
- DB query methods in `backend/src/database/chunkRepository.js`

### Recommended method

Use Reciprocal Rank Fusion (RRF).

### Why RRF

RRF is simple, strong, and robust. It works well when combining:

- lexical search for exact matches
- semantic search for paraphrases and vague queries

### Retrieval flow

For each query:

1. run lexical retrieval for top 30 to 50 chunks
2. run dense retrieval for top 30 to 50 chunks
3. merge results by `chunk_id`
4. compute RRF score
5. sort descending by fused score

### Ranking inputs to keep

For each candidate preserve:

- vector distance
- lexical rank
- lexical score
- source type
- document id
- occurred_at / timestamp

These signals are useful for reranking and debugging.

---

## Phase 4: Reranking

### What to build

Add a reranking stage after hybrid fusion.

### Where to do it

- implement `backend/src/RAG/retrieval/reranker.js`
- call it from `backend/src/RAG/retrieval/retriever.js` after fusion

### What it should do

Take the top fused candidates and rescore them against the final rewritten query.

### Options

#### Option A: heuristic reranker

Use a lightweight initial reranker based on:

- exact subject match boost
- exact sender match boost
- date proximity boost
- source-type boost if the query implies source
- phrase overlap boost

This is fast and easy.

#### Option B: model-based reranker

Later, replace or augment heuristics with a cross-encoder or LLM reranker.

Use model reranking only on a small candidate set such as top 10 to 20.

### Recommendation

Start with a heuristic reranker first. It gives good gains without adding model latency and cost.

---

## Phase 5: Deduplication and Diversity

### What to build

Prevent retrieval from returning five chunks from the same email or event.

### Where to do it

- final stage inside `backend/src/RAG/retrieval/retriever.js`
- optionally support helper functions in a retrieval utility module if you later create one

### Rules to apply

- cap chunks per document, for example 1 or 2
- prefer the best-ranked chunk from each document
- optionally group Gmail results by thread id for some query types
- mix results across documents when scores are close

### Why this matters

This increases final answer coverage and reduces wasted context window usage.

---

## Phase 6: Improve Chunking

### What to change

Replace generic chunking with source-aware chunking.

### Where to do it

- `backend/src/RAG/ingestion/chunker.js`
- optionally pass richer structured inputs from:
  - `backend/src/service/normalizers/GmailNormalizer.js`
  - `backend/src/service/normalizers/GoogleCalendarNormalizer.js`

### Gmail chunking guidance

- smaller chunks than current settings
- include a synthetic header section in the searchable text:
  - subject
  - from
  - to
  - date
  - labels
- keep reply chains and quoted text under control
- strip noisy footer and signature content more aggressively

### Calendar chunking guidance

- one event should often be one chunk
- keep fields together:
  - title
  - time
  - location
  - attendees
  - organizer
  - description

### Recommended chunk sizes

Use much smaller chunks than the current 2700 characters for emails.

Practical starting point:

- email body chunks around 600 to 1200 characters
- overlap around 80 to 150 characters
- calendar events often unchunked or minimally chunked

---

## Phase 7: Improve the Normalized Searchable Content

### Where to do it

- `backend/src/service/normalizers/GmailNormalizer.js`
- `backend/src/service/normalizers/GoogleCalendarNormalizer.js`

### Gmail changes needed

Augment the stored content or derived search text with:

- `Subject: ...`
- `From: ...`
- `To: ...`
- `Date: ...`
- `Labels: ...`
- `Snippet: ...`
- cleaned body

### Calendar changes needed

You already include useful fields in content. Improve consistency by ensuring:

- ISO-style date/time string is present
- attendee emails are searchable
- organizer email is searchable
- location and summary stay near the top

### Why this matters

BM25 and lexical search depend directly on token quality. Better content shaping produces better retrieval without changing the retriever at all.

---

## Phase 8: Retrieval Filters

### What to build

Support structured filtering in hybrid retrieval.

### Where to do it

- parsing in `backend/src/RAG/retrieval/queryTransformer.js`
- enforcement in `backend/src/database/chunkRepository.js`

### Filters to support

- `sourceType`
- `occurredAfter`
- `occurredBefore`
- sender / organizer / attendee exact or fuzzy match
- thread id when already known

### Important note

If the database currently depends on `c.occurred_at`, verify that field is actually populated for `document_chunks`. If it is not, use the parent `documents.timestamp` instead or add explicit chunk timestamp population during insertion.

---

## Phase 9: Database Efficiency Work

### Immediate DB tasks

Add indexes for both lexical and vector paths.

### Where this belongs

Create a DB migration or SQL script outside the runtime code path.

Recommended location if you add it to this repo later:

- `backend/sql/rag_retrieval_indexes.sql`

### SQL work to include

- GIN index for full-text search over the searchable text expression or column
- vector index on chunk embeddings if not already present
- indexes on:
  - `documents.user_id`
  - `documents.timestamp`
  - `document_chunks.document_id`
  - `document_chunks.source_type`
  - any timestamp field used during chunk filtering

### Optional but useful

- `pg_trgm` for fuzzy sender / subject / attendee matching

This helps with typos like:

- "rahul" vs "rauhl"
- partial company names
- incomplete subject phrases

---

## Phase 10: Prompt and Context Changes

### Where to update

- `backend/src/RAG/query/prompts.js`
- `backend/src/RAG/retrieval/contextBuilder.js`

### What to change

- make the final answer prompt aware that sources come from hybrid retrieval
- preserve source metadata cleanly in context blocks
- keep the context builder from stuffing too many chunks from one document

### Better context design

Each source block should expose:

- source type
- date
- sender or organizer
- title or subject
- compact body excerpt

This improves grounded answers and citations.

---

## Phase 11: Evaluation

### What to build

Create a retrieval evaluation set before tuning aggressively.

### Suggested file location

- `backend/test/retrieval-evals.md`
- `backend/test/test-retriever.js`
- later a structured JSON dataset if you want repeatable scoring

### Query categories to test

- exact sender queries
- exact subject queries
- semantic email queries
- calendar scheduling queries
- time-bounded queries
- follow-up conversational queries
- typo and fuzzy-entity queries

### Metrics to track

- Recall@5
- Recall@10
- MRR
- nDCG
- percentage of answers grounded in the correct source

### Practical rule

Do not tune lexical weights, fusion constants, or rerank rules blindly. Tune them against judged queries.

---

## Recommended Build Order

Implement in this order:

1. query rewrite for follow-up handling
2. lexical retrieval path in `chunkRepository.js`
3. hybrid retrieval orchestration in `retriever.js`
4. deduplication and diversity logic
5. heuristic reranker
6. source-aware chunking
7. Gmail searchable content improvements
8. DB indexes
9. evaluation and tuning

This order gives useful gains early while keeping risk controlled.

---

## Concrete File-by-File Change Map

### `backend/src/RAG/query/queryPipeline.js`

- insert query rewrite before retrieval
- pass conversation history into the transformer
- use rewritten query for retrieval
- keep original user message for final answering

### `backend/src/RAG/retrieval/queryTransformer.js`

- implement follow-up rewriting
- extract structured retrieval filters
- output:
  - `retrievalQuery`
  - `filters`
  - `sourceHints`

### `backend/src/RAG/retrieval/retriever.js`

- orchestrate:
  - lexical search
  - dense search
  - rank fusion
  - reranking
  - deduplication
- remove dependence on fixed dense-only thresholding

### `backend/src/database/chunkRepository.js`

- implement `searchByText(...)`
- keep `searchByEmbedding(...)`
- optionally add `searchHybrid(...)` helper if you want repository-level composition
- enforce user and date filters consistently

### `backend/src/RAG/retrieval/reranker.js`

- implement heuristic reranker first
- accept query + candidates
- return rescored and sorted candidates

### `backend/src/RAG/ingestion/chunker.js`

- replace one-size-fits-all chunking
- add source-specific chunk strategies

### `backend/src/service/normalizers/GmailNormalizer.js`

- enrich searchable content
- reduce retrieval noise
- preserve subject and sender strongly in searchable text

### `backend/src/service/normalizers/GoogleCalendarNormalizer.js`

- keep event metadata highly searchable
- ensure time and participant strings are normalized consistently

### `backend/src/RAG/retrieval/contextBuilder.js`

- limit duplicate chunks from the same document
- improve source formatting

### `backend/src/RAG/query/prompts.js`

- refine standalone-question rewrite prompt
- refine final grounded-answer instructions

---

## What “best retrieval accuracy” means in practice

For your assistant, strong retrieval means:

- exact email/person/subject queries are caught by lexical search
- vague or paraphrased queries are caught by dense search
- follow-up questions do not lose context
- the final top results are not redundant
- the LLM receives fewer but better chunks

That is the right standard to aim for. Not dense-only retrieval, and not BM25-only retrieval.

---

## Final Recommendation

Use a hybrid retrieval stack on top of the current Postgres + pgvector setup:

- follow-up query rewrite
- PostgreSQL lexical retrieval
- pgvector semantic retrieval
- Reciprocal Rank Fusion
- heuristic reranking
- source-aware chunking
- evaluation-driven tuning

That is the most practical path to materially better retrieval quality without replacing the whole backend architecture.
