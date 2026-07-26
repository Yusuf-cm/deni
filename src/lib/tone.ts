import type { Tone } from './types'

/**
 * Tone is a function of the customer's behaviour, not a mood setting: it rises
 * with age of the debt and with promises they've broken.
 */
export function suggestedTone(overdueDays: number, brokenPromises: number): Tone {
  if (overdueDays > 45 || brokenPromises >= 2) return 'final'
  if (overdueDays > 14 || brokenPromises >= 1) return 'firm'
  if (overdueDays > 0) return 'professional'
  return 'friendly'
}

export function toneReason(overdueDays: number, brokenPromises: number): string {
  const bits: string[] = []
  if (overdueDays > 0) bits.push(`${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue`)
  else bits.push('not yet due')
  if (brokenPromises === 1) bits.push('1 broken promise')
  if (brokenPromises > 1) bits.push(`${brokenPromises} broken promises`)
  return bits.join(', ')
}

export const TONES: { value: Tone; label: string }[] = [
  { value: 'friendly', label: 'Friendly' },
  { value: 'professional', label: 'Professional' },
  { value: 'firm', label: 'Firm' },
  { value: 'final', label: 'Final notice' },
]

export const LANGUAGES: { value: 'english' | 'swahili' | 'sheng'; label: string }[] = [
  { value: 'english', label: 'English' },
  { value: 'swahili', label: 'Kiswahili' },
  { value: 'sheng', label: 'Sheng' },
]
