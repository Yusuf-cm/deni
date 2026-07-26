import { addDays, today } from './format'
import type { Customer, Debt } from './types'

/**
 * Demo data covering every state the dashboard can show: a risky customer with
 * a broken promise and a partial payment, a healthy one not yet due, and a
 * cleared debt feeding "collected this month".
 */
export function buildSeed(): { customers: Customer[]; debts: Debt[] } {
  const now = today()
  const d = (offset: number) => addDays(now, offset)

  const njeri: Customer = { id: 'seed-cust-njeri', name: 'Mama Njeri', phone: '254722114477' }
  const kamau: Customer = { id: 'seed-cust-kamau', name: 'John Kamau', phone: '254712345678' }
  const wanjiku: Customer = { id: 'seed-cust-wanjiku', name: 'Wanjiku Stores', phone: '254733909090' }

  const debts: Debt[] = [
    {
      id: 'seed-debt-njeri',
      customerId: njeri.id,
      principal: 18000,
      balance: 15000,
      description: '40 bags of cement',
      createdAt: d(-60),
      dueDate: d(-45),
      dueDateAssumed: false,
      status: 'partial',
      payments: [
        { id: 'seed-pay-1', amount: 3000, date: d(-30), source: 'mpesa', mpesaRef: 'RKJ4T8P2XA', note: 'Part payment' },
      ],
      promises: [
        { id: 'seed-prom-1', promisedDate: d(-15), madeAt: d(-22), status: 'pending' },
      ],
      reminders: [
        {
          id: 'seed-rem-1',
          tone: 'professional',
          language: 'swahili',
          text: 'Habari Mama Njeri. Salio lako la KES 15,000 la cement lilipaswa kulipwa. Tafadhali nijulishe utakapoweza kutuma. Asante.',
          sentAt: d(-22),
        },
      ],
    },
    {
      id: 'seed-debt-kamau',
      customerId: kamau.id,
      principal: 8000,
      balance: 8000,
      description: '15 pieces of mabati',
      createdAt: d(-28),
      dueDate: d(2),
      dueDateAssumed: false,
      status: 'open',
      payments: [],
      promises: [],
      reminders: [],
    },
    {
      id: 'seed-debt-wanjiku',
      customerId: wanjiku.id,
      principal: 5000,
      balance: 0,
      description: 'Paint and brushes',
      createdAt: d(-35),
      dueDate: d(-10),
      dueDateAssumed: false,
      status: 'paid',
      payments: [
        { id: 'seed-pay-2', amount: 5000, date: d(-4), source: 'mpesa', mpesaRef: 'SGH7Y1QW3M' },
      ],
      promises: [],
      reminders: [],
    },
  ]

  return { customers: [njeri, kamau, wanjiku], debts }
}

/** Paste-ready samples for the demo. */
export const DEMO_TEXTS = {
  whatsapp: `[09:14] Mama Njeri: Boss niaje, uko na cement ya Bamburi?
[09:15] Me: Niko nayo. Unahitaji ngapi?
[09:16] Mama Njeri: Nipe bags 20. Nitalipa mwisho wa mwezi nikipata pesa ya harambee.
[09:17] Me: Sawa. Bags 20 ni Ksh 16,000.
[09:18] Mama Njeri: Poa boss, nitatuma. Number yangu ni 0722114477.
[09:19] Me: Sawa nimekuandika. Asante.`,

  reply: `Boss nisamehe sana, hii wiki imekuwa ngumu. Nitatuma pesa Friday bila fail.`,

  mpesaSms: `SFJ3K2LM9Q Confirmed. Ksh2,000.00 received from JOHN KAMAU 254712345678 on 26/7/26 at 2:14 PM. New M-PESA balance is Ksh12,430.00.`,
}
