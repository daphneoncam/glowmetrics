// app/page.js
// SERVER COMPONENT — replaces the old spinner/redirect
// Google now sees full content on the homepage
// LandingClient handles auth redirect + all interactivity

import LandingClient from './landing/LandingClient'

export const metadata = {
  title: 'CamCash — Cam Model Analytics That Makes You More Money',
  description: 'Free analytics for cam models on Chaturbate, BongaCams & more. See your top tippers, best stream times, peak earning hours, and exactly what to do to increase tips. Upload your CSV — instant insights.',
  alternates: { canonical: 'https://www.camcashgrl.com' },
  openGraph: {
    title: 'CamCash — Cam Model Analytics That Makes You More Money',
    description: 'Know exactly when to go live, who your most valuable fans are, and how much more you could be earning. Free for cam models.',
    url: 'https://www.camcashgrl.com',
    siteName: 'CamCash',
    type: 'website',
    images: [{ url: 'https://www.camcashgrl.com/og-image.png', width: 1200, height: 630, alt: 'CamCash — Cam Model Analytics Dashboard' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CamCash — Cam Model Analytics That Makes You More Money',
    description: 'Free analytics for cam models. Upload your CSV and instantly see your top tippers, best stream times, and how to earn more.',
    images: ['https://www.camcashgrl.com/og-image.png'],
  },
}

export default function HomePage() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'CamCash',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: 'https://www.camcashgrl.com',
    description: 'Free analytics for cam models on Chaturbate, BongaCams & more. See your top tippers, best stream times, peak earning hours, and exactly what to do to increase tips.',
    offers: { '@type': 'Offer', price: '9.99', priceCurrency: 'USD' },
    featureList: [
      'Chaturbate earnings tracker',
      'BongaCams analytics',
      'Top tipper identification and churn risk alerts',
      'Peak earning hour detection',
      'Platform comparison',
      'Session breakdown with revenue timeline',
      'Fan re-engagement messages',
      'Revenue predictions',
      'Room title generator',
      'Live mode coaching',
    ],
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />

      {/* Crawlable content — Google reads this, users see LandingClient UI */}
      <div style={{
        position: 'absolute', width: 1, height: 1,
        overflow: 'hidden', clip: 'rect(0,0,0,0)',
        whiteSpace: 'nowrap', pointerEvents: 'none',
      }}>
        <h1>CamCash — Free Cam Model Analytics Dashboard</h1>
        <p>CamCash is a free analytics tool for cam models on Chaturbate, BongaCams, and MyFreeCams. Upload your CSV to instantly see your top tippers, peak earning hours, best streaming days, platform comparison, and personalized recommendations to increase your income.</p>
        <h2>Top Tipper Tracking</h2>
        <p>See every fan ranked by lifetime spend. Know who your whales are, when they last tipped, and whether they're at risk of going cold. Get personalized re-engagement messages for fans who've gone quiet.</p>
        <h2>Peak Earning Hours</h2>
        <p>CamCash analyzes your tip history to find the 2-3 hour windows where you earn 40-80% more than your average. Stream at the right time for your specific audience.</p>
        <h2>Platform Comparison</h2>
        <p>See your actual $/hour on Chaturbate vs BongaCams vs MyFreeCams so you can put more time where it pays off most.</p>
        <h2>Session Breakdown</h2>
        <p>Every session gets a full timeline — when tips came in, who drove the revenue, and what to do differently next time.</p>
        <h2>Room Title Generator</h2>
        <p>Generate high-converting room titles based on your toy type, token goal, and vibe. Free to use without an account.</p>
        <h2>How It Works</h2>
        <p>1. Export your earnings CSV from Chaturbate, BongaCams, or MyFreeCams. 2. Upload it to CamCash — takes under 2 minutes. 3. Your full analytics dashboard is ready instantly.</p>
        <p>No credit card required.</p>
        <nav>
          <a href="/blog/cam-model-earnings">Cam Model Earnings Guide</a>
          <a href="/blog/how-to-make-more-money-on-chaturbate">How to Make More Money on Chaturbate</a>
          <a href="/blog/how-much-do-chaturbate-models-make">How Much Do Chaturbate Models Make</a>
          <a href="/blog/how-to-build-loyal-fans">How to Build a Loyal Fanbase</a>
          <a href="/blog/how-to-re-engage-whales-and-high-tipping-fans">How to Re-Engage Whales and Top Tippers</a>
          <a href="/blog/why-cam-income-is-inconsistent">Why Cam Income Is Inconsistent</a>
          <a href="/blog/best-cam-model-tools">Best Cam Model Tools</a>
          <a href="/guides/chaturbate-earnings-tracker">Chaturbate Earnings Tracker</a>
          <a href="/guides/cam-model-analytics">Cam Model Analytics Guide</a>
          <a href="/guides/chaturbate-hours">Best Time to Stream on Chaturbate</a>
        </nav>
      </div>

      {/* Interactive landing page — handles auth redirect + all UI */}
      <LandingClient />
    </>
  )
}
