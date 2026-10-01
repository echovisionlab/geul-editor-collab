# Inbound mutation ownership

An editable SyncStep2 or Update frame enters one actor lane for its resident
document. That lane waits for a different previous actor's durable save, checks
the current room admission and locale ownership, applies the update, and records
its authenticated contributor before releasing the lane. A failed save or
validation prevents the new update from entering the document. A later frame can
retry; rejection does not poison the lane.

The lane is keyed by the resident document instance. A canonical reload starts
a separate lane and cannot inherit an older instance's queued work. Existing
per-frame session and permission authorization remains ahead of this boundary.
Read-only, pre-admission and SyncStep1 frames retain their existing protocol
behavior and never acquire mutation attribution.

Hocuspocus 4.6.0 awaits `beforeSync` and subsequently applies the received Yjs
update. Its `onChange` hook runs asynchronously and cannot own synchronous actor
attribution. `applyInboundMutation` therefore applies inside `beforeSync` while
the actor lane is held. It preserves the connection transaction origin for
broadcasts and ordinary debounced stores, with a private marker indicating that
the lane owns attribution. The normal MessageReceiver replay of the identical
Yjs update is idempotent and causes no second document update. The asynchronous
`onChange` hook skips only these marked updates.

`inbound-mutation.test.ts` exercises two real Hocuspocus connections and its
MessageReceiver, simultaneous frames, delayed and failed durable writes,
retries, validation rejection and duplicate replay. Upgrading Hocuspocus requires
these boundary tests to continue passing. This test is a local protocol and
persistence boundary test; it does not use production sockets or a database.

The Post boundary also exercises an insert followed by a peer deletion through
the resident runtime and the actual store hook. Different actors persist the
insert before applying the deletion; the same actor can return to the original
canonical body without a database mutation. Both paths broadcast a persisted
ACK covering the inserted clocks and deleted ranges. This test calls the store
hook directly and does not exercise the debounce scheduler.

Awareness is connection-owned presence, separate from document mutations.
Providers can send a null state for a peer whose heartbeat expired locally.
That frame must not disconnect the sender or remove the peer's server presence.
Only an owning connection's null state removes presence; a foreign non-null
update remains rejected. Hocuspocus 4.6 scratch decoding discards null entries,
so authorized removals are applied before that decoding boundary.

On 2026-10-02, production Post QA exposed repeated connection closures with
`Awareness client ID belongs to another connection`. The real Awareness timer
and MessageReceiver regression reproduced the foreign-null rejection before
the fix and preserved the server-owned peer state afterward. All 1,136 local
tests and the four exact coverage metrics passed at 100% after the change.
