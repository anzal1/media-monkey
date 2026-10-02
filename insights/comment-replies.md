# Replies to unanswered comments (drafts, 2026-10-02)

Each one is checked against what its reel actually said. Not posted yet.

**"Your write IOPS randomly quadruple every five minutes."**
> Is there a name for this phenomenon??

Yep, it's the full-page-write spike. After every checkpoint, the first change to each 8 KB page writes the whole page to the WAL, so write volume jumps right after a checkpoint and tapers off until the next one. Five minutes is the default checkpoint_timeout, which is why it's so regular. A bigger max_wal_size means fewer checkpoints and fewer spikes.

**"Two identical requests land 3ms apart."**
> If the payment processor does this, this is not your responsibility to prevent...

Fair point, and true if you send an idempotency key: Stripe will dedupe a retried charge with the same key. The case in the reel is two separate requests that each build their own call, so they carry different keys or none at all, and the processor sees two legit charges. Derive the key from the order ID and the charge side is fixed, but you still want the atomic claim so your own order rows and emails don't run twice.

**"Your hot key expires at 02:00:00.000."**
> Does it refresh according to which cache is frequently used? You shouldn't refresh data that's not even used.

Exactly, and that's the nice part of XFetch: the early refresh only ever happens on a read, and only when the key is close to expiring. A key nobody reads never triggers a recompute, it just expires normally.

**"The row was deleted."**
> On a usual day, RRs are pretty and nearly instantaneous. The possibility of this happening is non zero tho.

Agreed, lag is usually a few milliseconds, which is exactly why it bites. Nobody designs for the one read in ten thousand that lands during a long transaction on the primary. Sending a user's reads to the primary for a few seconds after they write is the cheap fix.

**"Your handlers are filled with defensive if-checks."**
> Wow, this is really good architecture. Never thought of it this way. Thanks

Glad it clicked. Parse once at the edge and everything downstream gets to trust its inputs. It makes a whole codebase calmer.

**Follow-up for the voice comment, once the new voice is live:**

Changed the voice because of this, thanks for flagging it. Let me know if the new one is easier to follow.
