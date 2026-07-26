import { today } from '../format'
import type { AiTask } from './schemas'

export interface AiResult<T> {
  data: T
  source: 'claude' | 'heuristic'
  warning?: string
}

export async function callAI<T>(task: AiTask, payload: Record<string, unknown>): Promise<AiResult<T>> {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, payload: { today: today(), ...payload } }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`AI request failed (${res.status}) ${detail}`)
  }
  return res.json()
}

export interface ExtractResult {
  customerName: string | null
  phone: string | null
  amount: number | null
  dueDate: string | null
  description: string
  confidence: number
  assumptions: string[]
}

export interface ReplyResult {
  intent: 'promise' | 'paid_claim' | 'dispute' | 'other'
  promisedDate: string | null
  summary: string
}

export interface MatchResult {
  debtId: string | null
  amount: number | null
  mpesaRef: string | null
  payerName: string | null
  confidence: number
  reasoning: string
}

export interface ExplainResult {
  explanations: { debtId: string; reasoning: string }[]
}

/** Below this, the extraction form opens for review instead of saving straight through. */
export const CONFIDENCE_THRESHOLD = 0.7
