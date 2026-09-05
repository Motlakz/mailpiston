# Forward Email inbound fixtures

These JSON files are the normalizer's test suite for the life of the project
(roadmap Phase 0 deliverable, Phase 2 acceptance).

## Status: synthetic, pending spike 0.2

⚠️ **None of these were captured from a live Forward Email delivery.** They are
built from the payload shape documented in roadmap §1.4 and exist so the
normalizer has a contract to be tested against before a domain is pointed at
anything.

Spike 0.2 replaces them with five payloads captured from a real throwaway
domain:

| File | Case | Captured |
| --- | --- | --- |
| `plain-text.json` | plain text, single recipient | ❌ synthetic |
| `html.json` | HTML plus text alternative | ❌ synthetic |
| `with-attachment.json` | one base64 attachment | ❌ synthetic |
| `reply.json` | carries `In-Reply-To` and `References` | ❌ synthetic |
| `bcc-only.json` | envelope recipient absent from the `To:` header | ❌ synthetic |

When a real capture lands, replace the file, keep the filename, and flip the row
to ✅. If a real payload disagrees with a synthetic one, the real payload wins
and the normalizer changes — that is the entire point of the exercise.

Scrub before committing: real captures contain real addresses and real message
bodies.

## The case that matters most

`bcc-only.json` is the load-bearing fixture. A message BCC'd to a managed
address has no `To:` header naming it, so a normalizer that keys off headers
instead of the SMTP envelope loses the delivery entirely.
