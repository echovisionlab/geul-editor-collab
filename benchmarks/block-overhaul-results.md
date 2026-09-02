# Typed Block persistence: final benchmark

Measured 2026-08-18 against the current dirty typed Block contract, codec, and
`contentblock.Store`. This report supersedes the earlier raw-SQL approximation.

## Environment and method

- Host: Apple M2 Pro, 32 GiB, macOS arm64; Node.js 24.19.0, pnpm 11.9.0, Go 1.26.6.
- PostgreSQL: 18.6 (containerized Debian image, `linux/amd64` under Docker),
  `fsync=on`, `synchronous_commit=on`.
- Repository bases: editor-collab `80c7377d128b0dc13310faafba66a26acb33b1c8`, API
  `5717cad9d387863e17d524786706c4248f8afeec`, schema
  `1ad600a5972357d264524a9b0190402fc7ba6b75`; all measurements include the current
  uncommitted typed Block worktrees on top of those bases.
- Workload: one locale, flat root paragraph Blocks with an 82-character body, at
  1, 10, 100, and 1,000 Blocks. A single edit replaces one localized body; full
  reorder reverses every Block.
- Old-state fixtures are real, fresh, compact Yjs snapshots with a deterministic
  representative uint32 client ID. They exclude update history, so this is the
  most favorable old-state size, not a production-history estimate.
- JavaScript numbers are medians of three complete runs. Go CPU/allocation numbers
  are medians of five benchmark runs (`benchtime=500ms`). Each PostgreSQL before
  and after set is the median of three isolated complete runs, with five warmups
  and 30 measured transactions against a freshly migrated v1 through v19 database.
- PostgreSQL typed numbers call the generated contract and the actual
  `contentblock.Store` through GORM. Authorization, owning-domain fence query,
  SpiceDB, provider calls, and network traversal are intentionally excluded. The
  supplied domain fence is a no-op because this benchmark owns no domain rows.
- Current row counts come from the before/after delta of
  `pg_stat_xact_user_tables` in one instrumented warmup transaction per operation:
  `seq_tup_read + idx_tup_fetch` for reads and
  `n_tup_ins + n_tup_upd + n_tup_del` for writes. Snapshot-clear/stat probes are
  excluded from the GORM body statement count and every timed sample. These are
  actual PostgreSQL transaction tuple counters, not SQL result-row estimates or
  hardcoded formulas.

## Wire bytes

The browser/collab RPC boundary uses generated Protobuf JSON. Binary Protobuf is
included as a contract-size reference, not as the deployed transport claim.

### One localized Block edit

| Blocks | Old compact Yjs JSON | Typed generated JSON | JSON change | Typed binary |
| -----: | -------------------: | -------------------: | ----------: | -----------: |
|      1 |                459 B |                501 B |       +9.2% |        272 B |
|     10 |              3,975 B |                501 B |      -87.4% |        272 B |
|    100 |             39,375 B |                501 B |      -98.7% |        272 B |
|  1,000 |            403,363 B |                501 B |     -99.88% |        272 B |

### Full reverse reorder

| Blocks | Old compact Yjs JSON | Typed generated JSON |    JSON change | Typed binary |
| -----: | -------------------: | -------------------: | -------------: | -----------: |
|      1 |                451 B |                  0 B | semantic no-op |          0 B |
|     10 |              3,967 B |              1,072 B |         -73.0% |        574 B |
|    100 |             39,367 B |              8,722 B |         -77.8% |      4,714 B |
|  1,000 |            403,367 B |             86,122 B |         -78.6% |     46,986 B |

The 1-Block reverse produces no move and therefore no typed request. The old-size
cell shows the whole fresh Yjs state that the old persistence shape would replace
if a caller wrote it.

## Client CPU

These are wall-clock microseconds per operation. The typed column includes current
aggregate validation/diff plus generated Protobuf JSON encoding. It is a wire-size
improvement, not a client-CPU improvement.

| Blocks | Old Yjs snapshot encode, edit |  Typed edit | Old Yjs snapshot encode, reorder | Typed reorder |
| -----: | ----------------------------: | ----------: | -------------------------------: | ------------: |
|      1 |                       4.31 us |    16.79 us |                          3.33 us |      12.24 us |
|     10 |                      17.67 us |    91.10 us |                         17.69 us |      90.08 us |
|    100 |                     156.99 us |   839.57 us |                        160.71 us |     895.39 us |
|  1,000 |                   1,584.37 us | 8,477.26 us |                      1,559.90 us |   9,166.58 us |

The aggregate typed validation/diff shown above is the preserved cold/full boundary.
Resident autosave no longer runs that O(N) pass for a known transaction; the
affected-node measurement below is the current hot path. The old CPU column encodes
an already-resident Yjs document; it does not include decoding or schema validation
and is therefore deliberately favorable.

### Resident autosave affected-node hot path

Median of three complete runs on the same 1/10/100/1,000 Block fixtures. Each
operation alternates one localized paragraph edit and advances the authoritative
minimal ACK revision. `Before` scans the full canonical document; `after` validates
and diffs only the codec-reported affected node. Times are wall-clock microseconds.

| Blocks | Nodes decoded before -> after | Full diff before | Affected diff after | CPU reduction |
| -----: | ----------------------------: | ---------------: | ------------------: | ------------: |
|      1 |                        1 -> 1 |         4.962 us |            1.692 us |         65.9% |
|     10 |                       10 -> 1 |        33.146 us |            1.859 us |         94.4% |
|    100 |                      100 -> 1 |       316.111 us |            1.567 us |        99.50% |
|  1,000 |                    1,000 -> 1 |     3,251.978 us |            1.671 us |        99.95% |

Known base/locale/order and metadata/layout transactions therefore avoid full-room
decode. Unknown or root-wide changes still fail into the strict full decode; cold
Load/bootstrap/checkpoint/reload boundaries retain full validation.

## Generated Go contract CPU and allocation

The following isolates the current generated canonicalizer/validator and the
contract workloads used by edit/reorder. Time is microseconds per operation.

| Blocks |                            Canonical hash |                                     Validate |                         Single edit workload |                        Full reorder workload |
| -----: | ----------------------------------------: | -------------------------------------------: | -------------------------------------------: | -------------------------------------------: |
|      1 |             6.610 us / 6,404 B / 86 alloc |             19.627 us / 14,813 B / 249 alloc |             19.246 us / 14,700 B / 249 alloc |             19.810 us / 14,815 B / 249 alloc |
|     10 |          70.435 us / 68,103 B / 836 alloc |         196.936 us / 146,817 B / 2,470 alloc |         197.585 us / 146,689 B / 2,470 alloc |         196.644 us / 146,813 B / 2,470 alloc |
|    100 |      678.182 us / 719,858 B / 8,958 alloc |    1,947.890 us / 1,461,292 B / 24,469 alloc |    1,957.857 us / 1,461,277 B / 24,470 alloc |    1,967.643 us / 1,461,336 B / 24,469 alloc |
|  1,000 | 6,921.386 us / 8,387,169 B / 96,731 alloc | 18,444.496 us / 14,772,887 B / 244,956 alloc | 18,007.569 us / 14,778,367 B / 244,987 alloc | 18,419.489 us / 14,776,759 B / 244,978 alloc |

The allocation curve remains material: at 1,000 Blocks, a single contract workload
is about 14.8 MB and 245k allocations before database persistence is considered.
The standalone contract results remain within run-to-run variation of the baseline;
the Store improvement below comes from eliminating redundant aggregate work around
the contract and narrowing persisted verification, not from this isolated primitive.

## PostgreSQL exact Store hot paths

Each latency cell is p50 / p95 milliseconds and includes `BEGIN`, the exact
production Store body, and `COMMIT`. The current generated adapters route locale
upsert, shared presentation upsert, shared File replacement, and reorder through
their final single-statement PostgreSQL hot paths. The 1-Block reverse remains a
semantic no-op, so full reorder starts at 10 Blocks. Nested move uses three Blocks:
two root paragraphs and one child moved between them.

### Current latency, statements, and transaction tuple work

All three isolated reruns produced body statement set `[1]` and identical tuple
counters for every typed scenario.

| Operation                         | Blocks | Transaction p50 / p95 | Body statements | Tuple reads / writes |
| --------------------------------- | -----: | --------------------: | --------------: | -------------------: |
| Locale one-Block edit             |      1 |         1.324 / 1.953 |               1 |                5 / 2 |
|                                   |     10 |         1.340 / 2.010 |               1 |               23 / 2 |
|                                   |    100 |         1.091 / 1.476 |               1 |              203 / 2 |
|                                   |  1,000 |         1.552 / 1.796 |               1 |            2,003 / 2 |
| Shared one-Block edit, no File    |      1 |         1.663 / 2.503 |               1 |                5 / 2 |
|                                   |     10 |         1.568 / 2.050 |               1 |               23 / 2 |
|                                   |    100 |         1.356 / 1.612 |               1 |              203 / 2 |
|                                   |  1,000 |         1.874 / 2.604 |               1 |            2,003 / 2 |
| Shared one-Block File replacement |      1 |         1.648 / 2.263 |               1 |               13 / 3 |
|                                   |     10 |         1.676 / 2.562 |               1 |               49 / 3 |
|                                   |    100 |         1.464 / 1.820 |               1 |              409 / 3 |
|                                   |  1,000 |         2.035 / 2.718 |               1 |            4,009 / 3 |
| Full reverse reorder              |     10 |         2.291 / 3.088 |               1 |              53 / 11 |
|                                   |    100 |         8.478 / 9.109 |               1 |            503 / 101 |
|                                   |  1,000 |       74.647 / 79.600 |               1 |        5,003 / 1,001 |
| Nested single child move          |      3 |         2.220 / 3.182 |               1 |               26 / 2 |

The locale and shared no-File hot paths keep one-row mutation cost constant even
though PostgreSQL inspects the aggregate. File replacement adds attachment/File
checks but still writes three tuples. Full reorder remains O(N) in both tuple reads
and writes; at 1,000 Blocks it is the only current hot path above 3 ms p95.

### Previous Foundation Store to final hot path

These before numbers are the independently rerun exact Foundation Store results
from the immediately preceding implementation, under the same PostgreSQL image,
settings, warmups, repetitions, and fixture shape. A one-Block reorder is omitted
because the final benchmark correctly treats it as no work.

| Blocks |      Locale edit before -> final | Reduction p50 / p95 |              Reorder before -> final | Reduction p50 / p95 |
| -----: | -------------------------------: | ------------------: | -----------------------------------: | ------------------: |
|      1 |   2.536 / 4.096 -> 1.324 / 1.953 |       47.8% / 52.3% |                       semantic no-op |                   - |
|     10 |   3.074 / 3.755 -> 1.340 / 2.010 |       56.4% / 46.5% |       3.895 / 4.710 -> 2.291 / 3.088 |       41.2% / 34.4% |
|    100 |   8.071 / 8.804 -> 1.091 / 1.476 |       86.5% / 83.2% |     14.967 / 16.900 -> 8.478 / 9.109 |       43.4% / 46.1% |
|  1,000 | 55.718 / 59.012 -> 1.552 / 1.796 |       97.2% / 97.0% | 110.777 / 125.347 -> 74.647 / 79.600 |       32.6% / 36.5% |

The comparable body statement count is `8 -> 1` for locale edit and full reorder.
The earlier report's row counts came from GORM-returned/affected rows; the final
report uses PostgreSQL transaction tuple counters. Because the definitions differ,
old-to-new row reductions are intentionally not claimed. Shared no-File, shared
File, and nested move are new exact scenarios and have no saved equivalent before
baseline.

### Final Store stage breakdown

Component cells are p50 / p95 milliseconds. Quantiles are calculated independently,
so components need not sum exactly to the transaction quantile.

| Operation      | Blocks |       BEGIN |      SQL body | Non-SQL Store body |      COMMIT |
| -------------- | -----: | ----------: | ------------: | -----------------: | ----------: |
| Locale edit    |      1 | 0.271/0.367 |   0.572/1.082 |        0.102/0.181 | 0.413/0.709 |
|                |     10 | 0.273/0.446 |   0.553/0.859 |        0.051/0.148 | 0.423/0.525 |
|                |    100 | 0.217/0.308 |   0.493/0.650 |        0.039/0.063 | 0.338/0.522 |
|                |  1,000 | 0.259/0.329 |   0.769/0.919 |        0.061/0.125 | 0.367/0.473 |
| Shared no File |      1 | 0.246/0.348 |   0.682/1.284 |        0.141/0.270 | 0.387/0.590 |
|                |     10 | 0.262/0.347 |   0.686/0.912 |        0.146/0.354 | 0.412/0.552 |
|                |    100 | 0.212/0.325 |   0.634/0.749 |        0.115/0.201 | 0.353/0.458 |
|                |  1,000 | 0.243/0.347 |   0.852/1.053 |        0.339/0.538 | 0.387/0.568 |
| Shared File    |      1 | 0.231/0.305 |   0.748/1.046 |        0.291/0.396 | 0.374/0.491 |
|                |     10 | 0.249/0.328 |   0.801/1.301 |        0.149/0.500 | 0.406/0.602 |
|                |    100 | 0.221/0.288 |   0.708/0.853 |        0.132/0.392 | 0.338/0.415 |
|                |  1,000 | 0.257/0.371 |   1.169/1.524 |        0.136/0.292 | 0.454/0.670 |
| Full reorder   |     10 | 0.222/0.347 |   1.160/1.947 |        0.354/0.859 | 0.445/0.599 |
|                |    100 | 0.232/0.387 |   4.416/4.890 |        2.962/3.296 | 0.752/0.949 |
|                |  1,000 | 0.390/0.542 | 40.745/43.450 |      28.662/31.087 | 4.330/5.049 |
| Nested move    |      3 | 0.244/0.317 |   1.424/1.738 |        0.093/0.208 | 0.463/0.722 |

At 1,000 Blocks, reorder is dominated by the 1,001-row rewrite and aggregate
processing. The one-Block locale/shared paths no longer pay O(N) non-SQL work;
their full 1,000-Block aggregate tuple scan remains visible in the row counters,
but not as a material latency slope on this isolated local PostgreSQL instance.

### Current compact Yjs comparison

The old path locks one authority row and replaces one fresh compact Yjs `bytea`.
Its guarantee is not equivalent to typed persistence, but it was rerun under the
same settings. At 1,000 Blocks, old whole-Yjs edit is 4.304 / 5.590 ms versus typed
locale edit 1.552 / 1.796 ms; old whole-Yjs reorder is 4.797 / 6.555 ms versus typed
reorder 74.647 / 79.600 ms. Locale editing is now faster than rewriting the compact
blob, while full typed reorder remains 15.56x / 12.14x slower because it must rewrite
and validate every ordered Block.

## Why the previous 5.4 ms result cannot be reused

The original handwritten raw-SQL harness reported a 1,000-Block typed edit at
5.411 / 10.414 ms but omitted generated adapters, aggregate work, Store/GORM
mapping, hashes, and persisted verification. It was invalid for the then-current
Store. The final exact Store now measures 1.552 / 1.796 ms because a distinct,
verified single-statement locale hot path landed; that improvement does not
retroactively make the old incomplete harness a valid Store measurement.

## Unmeasured UI/runtime boundaries

ProseMirror edit/diff/awareness burst CPU and React rerender counts were not
reported. A benchmark-only Vitest mount loaded duplicate ProseMirror keyed-plugin
modules and failed before producing a valid sample. Fixing that requires changing
the production test/bundler boundary, which is outside this benchmark-only scope.
Existing controller tests prove behavior but contain no production timing or
rerender instrumentation, so substituting synthetic numbers would be misleading.
The existing JavaScript wire/validation harness was rerun against the latest tree:
all four 1/10/100/1,000 scenarios completed and retained the documented payload
shape and CPU scale. It is not a production ProseMirror/Page render harness and is
therefore used only as a consistency check.

Yjs remains transient collaboration state. These results do not recommend Yjs V2
durable snapshots, squash persistence, database merge queues, or other persistence
layers; none is needed to interpret or address the measured typed Store cost.

## Reproduction and closure

```sh
cd /path/to/geul-editor-collab
BENCHMARK_YJS_FIXTURE_DIR=/tmp/contentblock-yjs \
  pnpm exec tsx benchmarks/block-overhaul-benchmark.ts

cd /path/to/geul-api
go test ./internal/contentblock -run '^$' \
  -bench '^BenchmarkGeneratedContentBlockFoundation$' \
  -benchmem -benchtime=500ms -count=5

# Against a fresh isolated PostgreSQL 18.6 database migrated v1 through v19:
BENCHMARK_DATABASE_DSN='<isolated-dsn>' \
BENCHMARK_YJS_FIXTURE_DIR=/tmp/contentblock-yjs \
BENCHMARK_WARMUPS=5 BENCHMARK_REPETITIONS=30 \
  go run ./benchmarks/contentblock
```

- Wire, client CPU, generated Go contract CPU/allocation, actual Store latency,
  statement count, and row-volume evidence are present for 1/10/100/1,000 Blocks.
- The final Store's locale hot path is faster than rewriting the compact Yjs blob
  in this isolated benchmark, but full reorder is not. Wire reduction and fixed
  one-statement typed hot paths are verified; O(N) tuple inspection, standalone
  validation/hash allocation, and reorder write volume remain measurable.
- Any future optimization should be measured by this same actual-Store harness and
  may remove redundant aggregate passes only if all current invariants and persisted
  verification remain equivalent. No new durable state or queue is implied.
- Benchmark-scope `go test`, `go vet`, ESLint, and the shared-tree
  `typecheck:local-dependencies` passed. The default installed-package
  `pnpm typecheck` remains red on the concurrent dirty tree because its pinned
  `@echovisionlab/geul-*` packages predate the local Block contracts and its rootDir excludes the
  directly linked generated Protobuf source; it is not used as a benchmark verdict.
- Every benchmark PostgreSQL container, isolated network, generated fixture, and
  task image was removed; no task-prefixed container, network, volume, or image
  remained at final inspection.
