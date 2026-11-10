# AI plans and cost per request

Owner decision recorded on 2026-11-10. This replaces the earlier paid limit of 20 per day. StylAI has two AI plans. Both use the same request pipeline and estimated unit cost.

| Plan | Daily allowance per signed-in user | Estimated cost at full daily use | Estimated cost over 30 days at full use |
| --- | ---: | ---: | ---: |
| Free | 3 requests | 0.09 | 2.70 |
| Paid AI membership | 12 requests total | 0.36 | 10.80 |

Amounts are expressed in the as-yet unspecified currency of the owner's calculation. The paid quota replaces the free quota for the day. The subscription price and any monthly allowance are open decisions.

## What one request includes

1. **AI catalog search and embedding verification**, estimated at **0.01**. Search the approved catalog in the requested clothing category, retrieve relevant candidates and check their embeddings against the search intent. Keep category, availability, rights and variant constraints authoritative. Store search provenance so the chosen image can be traced to an actual product variant.
2. **Generate one preview image**, estimated at **0.02**, using one verified garment variant and the user's eligible photo. Preserve an explicitly selected variant. When search finds no eligible candidate, return that outcome before calling the image provider.

The estimated combined cost is **0.03 per request** in either plan. One combined request uses one unit of daily allowance. Keep provider spend for search and image generation separately reconcilable, including failure, no-match, retry and unknown-outcome cases. An idempotent replay must reuse the same job. Search and image calls need separate accounting and attempt tracking so a generation retry does not silently rerun a completed search or reserve the user allowance again.

The estimates came from the owner's calculation. Confirm their currency and compare actual search, embedding and generation charges before setting price or spend caps. The earlier GPU-second example remains a separate benchmark scenario. [Budget and hosting](../operations/budget-and-hosting.md).
