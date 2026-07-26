const kesFormatter = new Intl.NumberFormat('en-KE', {
  style: 'currency',
  currency: 'KES',
  maximumFractionDigits: 0,
})

export function kes(amount: number): string {
  return kesFormatter.format(Math.round(amount || 0))
}

/** Local (not UTC) ISO date — Kenya is UTC+3, so toISOString() would roll the date back. */
export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function today(): string {
  return toISODate(new Date())
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function addDays(iso: string, days: number): string {
  const d = parseISO(iso)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const ms = parseISO(to).getTime() - parseISO(from).getTime()
  return Math.round(ms / 86_400_000)
}

export function formatDate(iso: string): string {
  if (!iso) return '—'
  return parseISO(iso).toLocaleDateString('en-KE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function relativeDue(dueDate: string, from = today()): string {
  const diff = daysBetween(from, dueDate)
  if (diff === 0) return 'Due today'
  if (diff > 0) return `Due in ${diff} day${diff === 1 ? '' : 's'}`
  const late = Math.abs(diff)
  return `${late} day${late === 1 ? '' : 's'} overdue`
}

export function endOfCurrentMonth(from = today()): string {
  const d = parseISO(from)
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}
