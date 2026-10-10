/** Accept numeric KES input without converting a negative value into a payment. */
export function parsePositiveAmount(input: string): number {
  const value = Number(input.replace(/[,\s]/g, ''))
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function isDuplicatePayment(recordedRefs: string[], reference?: string | null): boolean {
  const ref = reference?.trim().toUpperCase()
  return Boolean(ref && recordedRefs.some((value) => value.trim().toUpperCase() === ref))
}
