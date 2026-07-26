import { daysBetween, today } from './format'
import type { Customer, CustomerStats, Debt, Reliability } from './types'

export function daysOverdue(debt: Debt, from = today()): number {
  return Math.max(0, -daysBetween(from, debt.dueDate))
}

export function totalPaid(debt: Debt): number {
  return debt.payments.reduce((sum, p) => sum + p.amount, 0)
}

/**
 * Promises are stored as `pending` and resolved lazily: a promise is kept if a
 * payment landed on or before the promised date, broken once that date passes
 * with nothing to show for it.
 */
export function resolvePromises(debt: Debt, from = today()): Debt {
  const promises = debt.promises.map((p) => {
    if (p.status !== 'pending') return p
    const covered = debt.payments.some(
      (pay) => daysBetween(pay.date, p.promisedDate) >= 0 && daysBetween(p.madeAt, pay.date) >= 0
    )
    if (covered) return { ...p, status: 'kept' as const }
    if (daysBetween(from, p.promisedDate) < 0) return { ...p, status: 'broken' as const }
    return p
  })
  return { ...debt, promises }
}

export function customerStats(
  customerId: string,
  debts: Debt[],
  from = today()
): CustomerStats {
  const mine = debts.filter((d) => d.customerId === customerId)
  const open = mine.filter((d) => d.status !== 'paid')
  const paid = mine.filter((d) => d.status === 'paid')

  const lateness = paid
    .map((d) => {
      const last = d.payments.map((p) => p.date).sort().at(-1)
      return last ? daysBetween(d.dueDate, last) : null
    })
    .filter((n): n is number => n !== null)

  const avgDaysLate = lateness.length
    ? Math.round(lateness.reduce((a, b) => a + b, 0) / lateness.length)
    : null

  const brokenPromises = mine
    .flatMap((d) => resolvePromises(d, from).promises)
    .filter((p) => p.status === 'broken').length

  const worstOverdue = open.reduce((max, d) => Math.max(max, daysOverdue(d, from)), 0)

  let reliability: Reliability = 'good'
  if (brokenPromises >= 2 || (avgDaysLate !== null && avgDaysLate > 30) || worstOverdue > 60) {
    reliability = 'risky'
  } else if (brokenPromises === 1 || (avgDaysLate !== null && avgDaysLate > 7) || worstOverdue > 14) {
    reliability = 'watch'
  }

  return {
    totalOwed: open.reduce((sum, d) => sum + d.balance, 0),
    openDebts: open.length,
    paidDebts: paid.length,
    avgDaysLate,
    brokenPromises,
    reliability,
  }
}

export function findCustomerByIdentity(
  customers: Customer[],
  name: string,
  phone: string | null
): Customer | undefined {
  if (phone) {
    const byPhone = customers.find((c) => c.phone === phone)
    if (byPhone) return byPhone
  }
  const key = name.trim().toLowerCase()
  if (!key) return undefined
  return customers.find((c) => c.name.trim().toLowerCase() === key)
}
