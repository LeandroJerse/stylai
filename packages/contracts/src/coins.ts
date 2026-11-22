/**
 * Moedas (the user-facing unit). Owner decision (2026-11-21 complement): free plan 30 moedas,
 * paid plan 120 moedas. Documented rules reused, not invented:
 *  - docs/decisions/2026-11-10-ai-plans-and-request-cost.md: daily allowance per signed-in user,
 *    free = 3 requests, paid AI membership = 12 requests; one combined request (search + 1 image)
 *    uses one unit; failures, no-match and cancellations do not use it; paid replaces free for the day.
 *  - 30/3 = 120/12 = 10 moedas per generation (same ratio as the earlier demo: generation = 10).
 * The database keeps counting requests (private.ai_daily_usage); moedas = requests x 10, so the
 * backend stays the single source of truth and nothing is reset on page load or login.
 * OPEN (not decided, do not invent): edit cost, monthly limits, price of the paid plan, and
 * confirmation of the UTC daily reset (engineering proposal in the decision doc).
 */
export const COINS_PER_REQUEST = 10
export const PLAN_COINS = { free: 30, paid: 120 } as const
export const COIN_UNIT = { singular: "moeda", plural: "moedas" } as const
export type PlanId = keyof typeof PLAN_COINS
export const PLAN_LABEL: Record<PlanId, string> = { free: "Gratuito", paid: "Pago" }

export const coinsFromRequests = (requests: number): number => Math.max(0, Math.trunc(requests)) * COINS_PER_REQUEST
