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
