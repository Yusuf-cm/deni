'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { isDuplicatePayment } from './amount'
import { today } from './format'
import type { Customer, Debt, Language, Payment, Tone } from './types'

const CUSTOMERS_KEY = 'deni:customers'
const DEBTS_KEY = 'deni:debts'

function uid(): string {
  return crypto.randomUUID()
}

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T[]) : []
  } catch {
    return []
  }
}

export interface NewDebtInput {
  customerName: string
  phone: string
  principal: number
  description: string
  dueDate: string
  dueDateAssumed: boolean
  createdAt?: string
}

interface DeniContext {
  ready: boolean
  customers: Customer[]
  debts: Debt[]
  addDebt: (input: NewDebtInput) => Debt
  addPayment: (debtId: string, payment: Omit<Payment, 'id'>) => void
  addPromise: (debtId: string, promisedDate: string) => void
  addReminder: (debtId: string, r: { tone: Tone; language: Language; text: string }) => void
  replaceAll: (data: { customers: Customer[]; debts: Debt[] }) => void
  clearAll: () => void
}

const Ctx = createContext<DeniContext | null>(null)

export function DeniProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [debts, setDebts] = useState<Debt[]>([])

  useEffect(() => {
    // localStorage only exists client-side, so the initial load has to happen
    // in an effect rather than a lazy initializer (which would run during SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCustomers(read<Customer>(CUSTOMERS_KEY))
    setDebts(read<Debt>(DEBTS_KEY))
    setReady(true)
  }, [])

  useEffect(() => {
    if (ready) localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(customers))
  }, [customers, ready])

  useEffect(() => {
    if (ready) localStorage.setItem(DEBTS_KEY, JSON.stringify(debts))
  }, [debts, ready])

  const addDebt = useCallback(
    (input: NewDebtInput): Debt => {
    const existing = customers.find(
      (c) =>
        (input.phone && c.phone === input.phone) ||
        c.name.trim().toLowerCase() === input.customerName.trim().toLowerCase()
    )
    const customerId = existing?.id ?? uid()

    if (!existing) {
      setCustomers((prev) => [
        ...prev,
        { id: customerId, name: input.customerName.trim(), phone: input.phone },
      ])
    } else if (!existing.phone && input.phone) {
      // Backfill a phone number we didn't have before.
      setCustomers((prev) =>
        prev.map((c) => (c.id === existing.id ? { ...c, phone: input.phone } : c))
      )
    }

    const debt: Debt = {
      id: uid(),
      customerId,
      principal: input.principal,
      balance: input.principal,
      description: input.description,
      createdAt: input.createdAt ?? today(),
      dueDate: input.dueDate,
      dueDateAssumed: input.dueDateAssumed,
      status: 'open',
      payments: [],
      promises: [],
      reminders: [],
    }
      setDebts((prev) => [...prev, debt])
      return debt
    },
    [customers]
  )

  const addPayment = useCallback((debtId: string, payment: Omit<Payment, 'id'>) => {
    setDebts((prev) => {
      const refs = prev.flatMap(d => d.payments.flatMap(p => p.mpesaRef ? [p.mpesaRef] : []))
      if (!Number.isFinite(payment.amount) || payment.amount <= 0 || isDuplicatePayment(refs, payment.mpesaRef)) return prev
      return prev.map((d) => {
        if (d.id !== debtId || d.balance <= 0) return d
        const capped = Math.min(payment.amount, d.balance)
        const payments = [...d.payments, { ...payment, amount: capped, id: uid() }]
        const balance = Math.max(0, d.balance - capped)
        return {
          ...d,
          payments,
          balance,
          status: balance === 0 ? 'paid' : 'partial',
        }
      })
    })
  }, [])

  const addPromise = useCallback((debtId: string, promisedDate: string) => {
    setDebts((prev) =>
      prev.map((d) =>
        d.id === debtId
          ? {
              ...d,
              promises: [
                ...d.promises,
                { id: uid(), promisedDate, madeAt: today(), status: 'pending' as const },
              ],
            }
          : d
      )
    )
  }, [])

  const addReminder = useCallback(
    (debtId: string, r: { tone: Tone; language: Language; text: string }) => {
      setDebts((prev) =>
        prev.map((d) =>
          d.id === debtId
            ? { ...d, reminders: [...d.reminders, { ...r, id: uid(), sentAt: today() }] }
            : d
        )
      )
    },
    []
  )

  const replaceAll = useCallback((data: { customers: Customer[]; debts: Debt[] }) => {
    setCustomers(data.customers)
    setDebts(data.debts)
  }, [])

  const clearAll = useCallback(() => {
    setCustomers([])
    setDebts([])
  }, [])

  const value = useMemo(
    () => ({ ready, customers, debts, addDebt, addPayment, addPromise, addReminder, replaceAll, clearAll }),
    [ready, customers, debts, addDebt, addPayment, addPromise, addReminder, replaceAll, clearAll]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDeni(): DeniContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDeni must be used inside DeniProvider')
  return ctx
}

