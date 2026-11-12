import { redirect } from 'next/navigation'

export const metadata = {
  title: 'CamCash Demo — Interactive Dashboard',
  description:
    'Try CamCash free — no signup needed. Full interactive dashboard with fan intelligence, earnings analytics, session breakdown, platform comparison, and AI coaching.',
  openGraph: {
    title: 'CamCash Demo — Interactive Dashboard',
    description: 'Full interactive demo with fan CRM, earnings analytics, and AI coaching. No signup required.',
    url: 'https://www.camcashgrl.com/demo',
  },
  alternates: { canonical: 'https://www.camcashgrl.com/landing/demo' },
}

export default function DemoPage({ searchParams }) {
  const tab = searchParams?.tab
  redirect(tab ? `/landing/demo?tab=${encodeURIComponent(tab)}` : '/landing/demo')
}
