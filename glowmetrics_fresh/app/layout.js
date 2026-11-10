
import './globals.css'
import { Analytics } from '@vercel/analytics/react'
import Script from 'next/script'
import { interClassName } from './fonts/inter'
import FeedbackWidgetGate from './components/FeedbackWidgetGate'
import AnalyticsInit from './components/AnalyticsInit'

// Inter is self-hosted in ./fonts/inter.js: the same files, weights (400–900),
// unicode ranges, display: swap and Latin preload that next/font/google produced.

const SITE_URL = 'https://www.camcashgrl.com'
const TITLE = 'CamCash — Cam Model Analytics That Makes You More Money'
const DESC =
  'Free analytics for cam models on Chaturbate, BongaCams & more. See your top tippers, best stream times, peak earning hours, and exactly what to do to increase tips. Upload your CSV — instant insights.'

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: '%s | CamCash',
  },
  description: DESC,
  keywords: [
    'cam model analytics',
    'chaturbate earnings tracker',
    'cam model tip tracker',
    'bongacams analytics',
    'cam model income tracker',
    'how to increase cam tips',
    'chaturbate token tracker',
    'cam model dashboard',
    'top tipper analytics',
    'cam model revenue',
    'myfreecams analytics',
    'best time to stream chaturbate',
    'cam model statistics',
    'stream earnings tracker',
  ],
  authors: [{ name: 'CamCash', url: SITE_URL }],
  creator: 'CamCash',
  publisher: 'CamCash',
  alternates: {
    canonical: SITE_URL,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: 'CamCash',
    title: TITLE,
    description: DESC,
    images: [
      {
        url: `${SITE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: 'CamCash — Cam Model Analytics Dashboard',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESC,
    images: [`${SITE_URL}/og-image.png`],
  },
  icons: { icon: '/favicon.ico', apple: '/apple-touch-icon.png' },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={interClassName}>
      <head>
        <meta name="copyright" content="© 2026 CamCash™ / CamCashGrl. All rights reserved." />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'SoftwareApplication',
              name: 'CamCash',
              applicationCategory: 'BusinessApplication',
              operatingSystem: 'Web',
              url: SITE_URL,
              description: DESC,
              offers: {
                '@type': 'Offer',
                price: '0',
                priceCurrency: 'USD',
                description: 'Free during beta',
              },
              featureList: [
                'Chaturbate earnings tracker',
                'BongaCams analytics',
                'Top tipper identification',
                'Peak earning hour detection',
                'Platform comparison',
                'Session breakdown with timeline',
                'Revenue predictions',
                'Fan re-engagement messages',
              ],
            }),
          }}
        />
        <Script id="gtm-head" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
  new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
  j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
  'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
  })(window,document,'script','dataLayer','GTM-P4L7DNX6');`}
        </Script>
        {/* Recovers automatically from a stale deployment: a visitor's browser
            fetches an HTML shell referencing a JS chunk hash from a build
            that's since been replaced, the chunk 404s (ChunkLoadError), and
            without this the visitor is stuck on a blank "Application error"
            page. This catches the failure at the window level — including
            rejected dynamic-import promises that never reach the React error
            boundary in app/global-error.js — and reloads once to fetch the
            current deployment's assets. */}
        <Script id="chunk-error-recovery" strategy="beforeInteractive">
          {`(function(){
  function isChunkError(msg){ return /ChunkLoadError|Loading chunk [\\w-]+ failed|Loading CSS chunk/i.test(msg||''); }
  function recover(msg){
    if (!isChunkError(msg)) return;
    var key = 'camcash_chunk_reload_at';
    var last = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - last > 10000) {
      sessionStorage.setItem(key, String(Date.now()));
      window.location.reload();
    }
  }
  window.addEventListener('error', function(e){ recover(e && e.message); });
  window.addEventListener('unhandledrejection', function(e){ recover(e && e.reason && e.reason.message); });
})();`}
        </Script>
      </head>
      <body>
        <noscript>
          <iframe
            src="https://www.googletagmanager.com/ns.html?id=GTM-P4L7DNX6"
            height="0"
            width="0"
            style={{display:'none',visibility:'hidden'}}
          />
        </noscript>
        {children}
        <FeedbackWidgetGate />
        <Analytics />
        <AnalyticsInit />

        {/* X (Twitter) Conversion Tracking Pixel */}
        <Script
          id="twitter-pixel"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              !function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);
              },s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',
              a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');
              twq('config','rc0w2');
            `,
          }}
        />
      </body>
    </html>
  )
}