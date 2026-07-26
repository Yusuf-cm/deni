import type { Metadata, Viewport } from 'next'
import { DeniProvider } from '@/lib/store'
import './globals.css'

export const metadata: Metadata = {
  title: 'Deni — collections assistant',
  description: 'Know who owes you, who to follow up today, and exactly what to say.',
}

export const viewport: Viewport = {
  themeColor: '#047857',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <DeniProvider>
          <div className="mx-auto w-full max-w-[480px] flex-1 px-4 pb-28 pt-5">{children}</div>
        </DeniProvider>
      </body>
    </html>
  )
}
