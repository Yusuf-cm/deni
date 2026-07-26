import { customerStats, daysOverdue, resolvePromises } from './derive'
import { today } from './format'
import type { Customer, Debt, ScoredDebt, Tier } from './types'

/**
 * Share of face value still realistically collectable. Collection probability
 * falls off a cliff with age, which is exactly why old debt must be chased first.
 */
export function recoveryFactor(days: number): number {
  if (days <= 30) return 1
  if (days <= 60) return 0.7
  if (days <= 90) return 0.5
  return 0.3
}

/** Money at risk right now: what's still owed, discounted by how collectable it is. */
export function valueAtRisk(debt: Debt, from = today()): number {
  return debt.balance * (1 - recoveryFactor(daysOverdue(debt, from)))
}

export function debtScore(debt: Debt, brokenPromises: number, from = today()): number {
  const overdue = daysOverdue(debt, from)
  return (
    debt.balance *
    (1 + overdue / 30) *
    (2 - recoveryFactor(overdue)) *
    (1 + 0.5 * brokenPromises)
  )
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

/** Open debts, highest priority first, each with the numbers behind its rank. */
export function rankDebts(
  debts: Debt[],
  customers: Customer[],
  from = today()
): ScoredDebt[] {
  const open = debts.filter((d) => d.status !== 'paid')
  const scored = open.map((d) => {
    const stats = customerStats(d.customerId, debts, from)
    const customer = customers.find((c) => c.id === d.customerId)
    return {
      debt: resolvePromises(d, from),
      customer: customer ?? { id: d.customerId, name: 'Unknown', phone: '' },
      score: debtScore(d, stats.brokenPromises, from),
      tier: 'low' as Tier,
      daysOverdue: daysOverdue(d, from),
      stats,
    }
  })

  const sortedScores = scored.map((s) => s.score).sort((a, b) => a - b)
  const p75 = percentile(sortedScores, 75)
  const p40 = percentile(sortedScores, 40)

  for (const s of scored) {
    s.tier = s.score >= p75 ? 'high' : s.score >= p40 ? 'medium' : 'low'
  }

  return scored.sort((a, b) => b.score - a.score)
}
