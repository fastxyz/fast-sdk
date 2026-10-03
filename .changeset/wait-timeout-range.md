---
"@fastxyz/cli": patch
---

`fast wait-for-payment --timeout` (and `fast request --wait --timeout`) now accepts at most 2147483 seconds (about 24 days) and rejects longer values with `INVALID_USAGE`. Past that, the delay exceeds what the runtime's timers support, so the timeout never fired and the command waited forever.
