export type Tone = 'friendly' | 'professional' | 'firm' | 'final'
export type Language = 'english' | 'swahili' | 'sheng'
export type DebtStatus = 'open' | 'partial' | 'paid'
export type Reliability = 'good' | 'watch' | 'risky'
export type Tier = 'high' | 'medium' | 'low'

export interface Customer {
  id: string
  name: string
  phone: string // normalized 2547XXXXXXXX
}

export interface Payment {
  id: string
  amount: number
  date: string // ISO yyyy-mm-dd
  source: 'manual' | 'mpesa'
  mpesaRef?: string
  note?: string
}

export interface PromiseToPay {
  id: string
  promisedDate: string
  madeAt: string
  status: 'pending' | 'kept' | 'broken'
}

export interface Reminder {
  id: string
  tone: Tone
  language: Language
  text: string
  sentAt: string
}

export interface Debt {
  id: string
  customerId: string
  principal: number
  balance: number
  description: string
  createdAt: string
  dueDate: string
  dueDateAssumed: boolean
  status: DebtStatus
  payments: Payment[]
  promises: PromiseToPay[]
  reminders: Reminder[]
}

export interface CustomerStats {
  totalOwed: number
  openDebts: number
  paidDebts: number
  avgDaysLate: number | null
  brokenPromises: number
  reliability: Reliability
}

export interface ScoredDebt {
  debt: Debt
  customer: Customer
  score: number
  tier: Tier
  daysOverdue: number
  stats: CustomerStats
}
