# Scope: publishing the package intelligence tools as an Apify Actor

**Date:** 2026-08-09
**Status:** scoped, not started

## Why

The service has been live for two days on npm, the MCP Registry, Glama and two
awesome-lists, and has served zero external calls and zero payments. The paid
tier is correctly implemented and unfindable: the CDP Bazaar indexes on first
settlement, so it cannot list a service that has never been paid, and a buyer
needs a funded Base wallet before they can pay at all.

Apify inverts both problems. Its buyers already hold credits and already spend
them, and it distributes into Make, n8n and Zapier — the workflow tools where
people actually assemble automations. It pays out $500k+/month to developers;
the entire x402 ecosystem moves roughly $1.11M/month in total volume across
every seller. That is the argument for spending the next unit of effort here.

## Terms, confirmed

Checked against Apify's Store Publishing Terms, not inferred:

- **80% revenue share.** `profit = 0.8 × revenue − platform usage costs`, with
  the option to pass platform costs to users instead of absorbing them.
- **No exclusivity.** Nothing prevents publishing the same tool elsewhere, so
  the existing x402 surface can keep running unchanged.
- **No formal review**, but Actors must pass automated functionality testing,
  carry honest names and documentation, and be kept working.
- **Minimum payout USD 20** (PayPal; USD 100 otherwise). Below that it rolls
  over monthly — and is **forfeited after 12 consecutive months** under the
  threshold.
- **Circumventing Apify's payment system is prohibited.** The Actor must bill
  through Apify. Running x402 separately is fine; pointing Actor users at the
  x402 endpoint to dodge the commission is not.

## What already exists and moves unchanged

The data layer has no crypto, no payment code and no Node-specific APIs. It
already runs outside a normal Node server — the free tier serves from Cloudflare
Workers today, which is the same portability constraint.

```
src/sources/npmRegistry.ts   src/sources/osv.ts
src/sources/pypi.ts          src/sources/depsdev.ts
src/sources/cratesIo.ts      src/sources/registry.ts
src/domain/health.ts         src/cache.ts
```

## What changes

**The Actor calls upstreams directly.** No HTTP hop to our own API, so the
Actor needs no backend at all — no Fly, no Worker, no tunnel. This channel is
independent of the Fly trial expiring on 2026-08-16.

**Billing replaces x402 entirely in this channel.** `Actor.charge('event', n)`
at the point of use, rather than a 402 challenge and a signed payment.

**The paid tools become reachable.** Their zero conversions are a wallet
problem, not a pricing problem; on Apify the buyer already has credits.

## What we lose here

The npm build's pitch is that it runs locally and nothing about your
dependencies leaves your machine. An Apify Actor is remote — they see every
query. That is a real difference, not a presentational one, and the two channels
should be described honestly rather than with one blurb:

| Channel | Pitch |
|---|---|
| npm / stdio | Local, private, free, keyless |
| Apify | Hosted, credits, zero-friction, inside Make / n8n / Zapier |

## Design decisions to make before building

**One health algorithm, shared.** `src/domain/health.ts` must not be copied.
Two drifting copies means the same package scores differently depending on which
channel you bought through — hard to notice, embarrassing when a user does.

**What counts as a billable event.** The obvious mapping is one charge per paid
tool call, matching the existing $0.01 / $0.02 split. Worth considering whether
a batch call charges once or per package scored; charging per package is more
honest about cost and more painful to explain.

**Whether to pass platform costs to users.** Absorbing them is simpler and
keeps the price legible; passing them through protects margin on a tool whose
upstreams are free but whose compute is not.

**Whether the free tools are free here too.** Giving them away drove the npm
adoption strategy, but on Apify the platform charges for compute regardless, so
"free" costs real money per call. Likely answer: charge a small amount for
everything, since the keyless-free-tier argument does not apply to a channel
where the user already has an account and a balance.

## Sequence

1. Pull Apify's TypeScript MCP Actor template; confirm it accepts the existing
   tool definitions with minimal reshaping.
2. Port the source modules; keep them importable from both surfaces.
3. Wire `Actor.charge` to the paid tools; decide the free-tool question above.
4. Deploy in Standby mode for a persistent endpoint.
5. Verify against the same probes used for the npm build: every tool, all three
   ecosystems, real data, and a charge that actually registers.
6. Publish, then measure. `/stats` cannot see Apify traffic, so its analytics
   are the only signal for this channel.

## Honest risks

**The $20 payout threshold is the real bar.** At $0.01–$0.02 per call that is
1,000–2,000 paid calls before a single payout, and earnings under the threshold
for twelve months are forfeited. This channel is worth doing for distribution;
it is not worth doing for the money unless it finds actual volume.

**Three surfaces, one maintainer, zero users.** The npm build, the HTTP API and
an Actor is a lot of surface to keep working for an audience that does not exist
yet. If effort is scarce, the correct move is to let the x402 side idle — it
costs nothing now that the free tier is at the edge — rather than to keep all
three actively maintained.

**Competitors already exist here too.** The MCP Registry already lists two
servers covering the same three ecosystems, both free and both remote-hosted.
Check Apify Store for the same before building, not after. That check was
skipped at the start of this project and the "unserved niche" premise turned out
to be two days out of date.
