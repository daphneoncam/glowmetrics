'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import SiteFooter from '../components/SiteFooter'
import Button from '../../components/ui/Button'
import { supabase } from '../../lib/supabase'
import { track } from '../../lib/track'

// Pricing-page analytics. Every event goes through lib/track.js (GTM dataLayer
// + /api/track -> analytics_events); the server attaches user_id itself, so
// no personal data (email, name) is ever put in event properties.
const PLAN_PRICE = { standard_monthly: 9.99, standard_annual: 99 }

/*
 * IMPORTANT:
 * This client does not directly read Stripe environment variables.
 *
 * It sends:
 *   standard_monthly
 *   standard_annual
 *
 * The server route at app/api/stripe/checkout/route.js maps those to:
 *   STRIPE_MONTHLY_PRICE_ID
 *   NEXT_PUBLIC_STRIPE_PRICE_ANNUAL
 */
async function startCheckout(planType, setLoading, trial = true) {
  setLoading(planType)
  track('pricing_plan_selected', { plan_type: planType, plan_price: PLAN_PRICE[planType], trial })
  let failureTracked = false
  const fail = (reason, extra = {}) => {
    failureTracked = true
    track('pricing_checkout_failed', { plan_type: planType, reason, ...extra })
  }

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.access_token) {
      fail('no_session')
      alert(
        'Your login session could not be found. Please sign in again, then return to pricing.'
      )
      return
    }

    const response = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      credentials: 'include',
      body: JSON.stringify({
        plan_type: planType,
        trial,
      }),
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      fail('api_error', { status_code: response.status })
      throw new Error(
        data.error || 'Unable to start Stripe Checkout.'
      )
    }

    if (!data.url) {
      fail('no_checkout_url')
      throw new Error(
        'Stripe Checkout did not return a payment URL.'
      )
    }

    track('pricing_checkout_redirected', { plan_type: planType, plan_price: PLAN_PRICE[planType] })
    window.location.assign(data.url)
  } catch (error) {
    if (!failureTracked) fail('network_error')
    alert(
      error?.message ||
        'Something went wrong while opening Stripe Checkout. Please try again.'
    )
  } finally {
    setLoading(null)
  }
}

const C = {
  bg: '#050713',
  card: 'rgba(10, 14, 32, 0.82)',
  card2: 'rgba(16, 20, 42, 0.72)',
  border: 'rgba(124,92,255,0.15)',
  purple: '#7C5CFF',
  pink: '#FF2BAE',
  cyan: '#16F4FF',
  cyanSoft: '#48E9FF',
  green: '#10B981',
  white: '#FFFFFF',
  text: '#8D93AA',
  muted: '#5E647C',
  gradientPrimary:
    'linear-gradient(90deg, #16F4FF 0%, #55B8FF 28%, #7C5CFF 52%, #FF2BAE 100%)',
}

function CheckLine({ children, color = C.cyan }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        marginBottom: 11,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          color,
          fontWeight: 800,
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        ✓
      </span>

      <span
        style={{
          color: C.text,
          fontSize: 14,
          lineHeight: 1.55,
        }}
      >
        {children}
      </span>
    </div>
  )
}

function TopBar({ user }) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        background: 'rgba(5,7,19,0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom:
          '1px solid rgba(124,92,255,0.2)',
      }}
    >
      <a
        href="/"
        onClick={() => track('pricing_cta_clicked', { cta: 'logo', logged_in: !!user })}
        style={{
          textDecoration: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 9,
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 9,
            background: C.gradientPrimary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: 900,
            color: '#06101A',
            boxShadow:
              '0 0 14px rgba(22,244,255,0.3)',
          }}
        >
          $
        </span>

        <span
          style={{
            fontSize: 17,
            fontWeight: 800,
            color: C.white,
            letterSpacing: '-0.4px',
          }}
        >
          Cam
          <span
            style={{
              background: C.gradientPrimary,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Cash
          </span>
          ™
        </span>
      </a>

      <Button
        as="a"
        href={user ? '/dashboard' : '/landing'}
        onClick={() => track('pricing_cta_clicked', { cta: user ? 'topbar_dashboard' : 'topbar_create_account', logged_in: !!user })}
        style={{
          padding: '8px 18px',
          fontSize: 13,
        }}
      >
        {user
          ? 'Back to Dashboard →'
          : 'Create Your Account →'}
      </Button>
    </div>
  )
}

function PricingSection({
  checkoutLoading,
  setCheckoutLoading,
  user,
}) {
  const freeFeatures = [
    'Track up to 3 platforms (1 Primary + 2 Secondary)',
    'Full history on your Primary platform',
    'Upload tip history by CSV',
    'Basic earnings dashboard',
    'Basic session analytics',
    'Live tip detection',
    'Real-time alerts',
    'Basic Live Mode coaching',
    'Top 3 fans',
    'Last 31 days on your Secondary platforms',
    'Basic fan insights',
  ]

  const standardFeatures = [
    'Unlimited platform tracking',
    'Full permanent history on every platform',
    'Advanced churn and re-engagement insights',
    'Full fan profiles and CRM tools',
    'Cross-platform earnings comparisons',
    'Advanced Live Mode coaching',
    'Private-session analytics',
    'Deeper fan risk signals',
    'Complete historical trend analysis',
    'Stream Planner (advanced)',
    'Money Map (advanced)',
    'Comparative performance reports',
  ]

  return (
    <section
      style={{
        padding: '88px 20px 56px',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'flex-start',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 1000,
          margin: '0 auto',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(290px, 1fr))',
            gap: 24,
            alignItems: 'stretch',
          }}
        >
          {/* STANDARD PLAN */}
          <article
            style={{
              position: 'relative',
              background: C.card2,
              border: `2px solid ${C.pink}`,
              borderRadius: 20,
              padding: 28,
              display: 'flex',
              flexDirection: 'column',
              boxShadow:
                '0 0 36px rgba(255,43,174,0.16)',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: -13,
                right: 22,
                background: C.gradientPrimary,
                color: '#06101A',
                padding: '6px 12px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 900,
                textTransform: 'uppercase',
                letterSpacing: '0.6px',
              }}
            >
              Most Popular
            </div>

            <p
              style={{
                color: C.pink,
                fontSize: 12,
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '1.5px',
                margin: '0 0 12px',
              }}
            >
              Pro
            </p>

            <div style={{ marginBottom: 6 }}>
              <span
                style={{
                  color: C.white,
                  fontSize: 42,
                  fontWeight: 900,
                  letterSpacing: '-1px',
                }}
              >
                $9.99
              </span>

              <span
                style={{
                  color: C.text,
                  fontSize: 15,
                  marginLeft: 4,
                }}
              >
                /month
              </span>
            </div>

            <p
              style={{
                color: C.cyan,
                fontWeight: 800,
                fontSize: 14,
                margin: '0 0 22px',
              }}
            >
              Or $99 per year
            </p>

            <div
              style={{
                flexGrow: 1,
                marginBottom: 26,
              }}
            >
              {standardFeatures.map((feature) => (
                <CheckLine
                  key={feature}
                  color={C.pink}
                >
                  {feature}
                </CheckLine>
              ))}
            </div>

            <div
              style={{
                display: 'grid',
                gap: 12,
              }}
            >
              <Button
                type="button"
                onClick={() =>
                  startCheckout(
                    'standard_monthly',
                    setCheckoutLoading,
                    true
                  )
                }
                disabled={checkoutLoading !== null}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '13px 0',
                  fontSize: 14,
                }}
              >
                {checkoutLoading ===
                'standard_monthly'
                  ? 'Redirecting…'
                  : 'Start 7-day free trial'}
              </Button>

              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  startCheckout(
                    'standard_monthly',
                    setCheckoutLoading,
                    false
                  )
                }
                disabled={checkoutLoading !== null}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '13px 0',
                  fontSize: 14,
                }}
              >
                Subscribe now — $9.99/month
              </Button>

              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  startCheckout(
                    'standard_annual',
                    setCheckoutLoading,
                    false
                  )
                }
                disabled={checkoutLoading !== null}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '13px 0',
                  fontSize: 14,
                }}
              >
                {checkoutLoading ===
                'standard_annual'
                  ? 'Redirecting…'
                  : 'Choose Annual — $99'}
              </Button>
            </div>
          </article>
        </div>
      </div>
    </section>
  )
}

function PromiseSection() {
  const promises = [
    'Start with a 7-day free trial (card required)',
    'Or subscribe now and get immediate access',
    'Pro unlocks full history on every platform and deeper insights',
    'No surprise feature locks after launch',
    '30 days notice before material pricing or plan changes',
    'Built by cam models, for cam models',
  ]

  return (
    <section style={{ padding: '72px 20px' }}>
      <div
        style={{
          maxWidth: 760,
          margin: '0 auto',
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 20,
          padding: '48px 40px',
        }}
      >
        <h2
          style={{
            color: C.white,
            fontSize: 'clamp(22px, 3.5vw, 32px)',
            fontWeight: 800,
            margin: '0 0 32px',
            letterSpacing: '-0.4px',
          }}
        >
          Our Promise to You
        </h2>

        <div>
          {promises.map((promise) => (
            <div
              key={promise}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                marginBottom: 14,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  fontSize: 18,
                  flexShrink: 0,
                }}
              >
                ✅
              </span>

              <span
                style={{
                  color: C.text,
                  fontSize: 15,
                  lineHeight: 1.55,
                }}
              >
                {promise}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const FAQ_ITEMS = [
  {
    q: 'Is there a free trial?',
    a: 'Yes. Choose the 7-day free trial. A card is required to start, and it is not charged until the trial ends. You can also subscribe now to pay immediately.',
  },
  {
    q: 'What do I need to open the dashboard?',
    a: 'An active subscription or a running free trial. Accounts created before 11 November 2026 keep their existing dashboard access and data.',
  },
  {
    q: 'What does CamCash Pro include?',
    a: 'Pro includes all supported platforms, full permanent tip history, expanded fan profiles, CRM tools, cross-platform earnings comparisons, advanced Live Mode coaching, private-session analytics, churn and re-engagement insights, full best-time analysis, Stream Planner, Money Map, and advanced reports.',
  },
  {
    q: 'How much is Pro?',
    a: 'CamCash Pro is $9.99 per month or $99 per year. Both billing options unlock the same Pro features.',
  },
  {
    q: 'Can I switch between monthly and annual billing?',
    a: 'Yes. You can change your billing cycle through your subscription-management options.',
  },
  {
    q: 'What platforms does CamCash support?',
    a: 'CamCash currently supports Chaturbate, BongaCams, and MyFreeCams. Additional platforms may be added based on creator demand.',
  },
  {
    q: 'Is my data private?',
    a: 'Yes. Your analytics data is private to your account. CamCash does not sell your personal analytics data.',
  },
]

function FAQSection() {
  const [open, setOpen] = useState(null)

  return (
    <section style={{ padding: '0 20px 72px' }}>
      <div
        style={{
          maxWidth: 760,
          margin: '0 auto',
        }}
      >
        <h2
          style={{
            color: C.white,
            fontSize: 'clamp(22px, 3.5vw, 32px)',
            fontWeight: 800,
            margin: '0 0 32px',
            textAlign: 'center',
            letterSpacing: '-0.4px',
          }}
        >
          Questions
        </h2>

        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          {FAQ_ITEMS.map((item, index) => {
            const isOpen = open === index

            return (
              <div
                key={item.q}
                style={{
                  borderBottom:
                    index < FAQ_ITEMS.length - 1
                      ? '1px solid rgba(255,255,255,0.06)'
                      : 'none',
                }}
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => {
                    track('pricing_faq_toggled', { question: item.q, action: isOpen ? 'close' : 'open' })
                    setOpen(isOpen ? null : index)
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    padding: '20px 24px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      color: C.white,
                      fontWeight: 600,
                      fontSize: 15,
                      lineHeight: 1.4,
                    }}
                  >
                    {item.q}
                  </span>

                  <span
                    aria-hidden="true"
                    style={{
                      color: C.purple,
                      fontSize: 18,
                      flexShrink: 0,
                      transform: isOpen
                        ? 'rotate(180deg)'
                        : 'rotate(0deg)',
                      transition: 'transform 0.2s',
                      lineHeight: 1,
                    }}
                  >
                    ›
                  </span>
                </button>

                {isOpen && (
                  <div
                    style={{
                      padding: '0 24px 20px',
                    }}
                  >
                    <p
                      style={{
                        color: C.text,
                        fontSize: 14,
                        lineHeight: 1.7,
                        margin: 0,
                      }}
                    >
                      {item.a}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function FinalCTA({ user }) {
  return (
    <section
      style={{
        background:
          'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(124,92,255,0.2) 0%, rgba(5,7,19,0) 70%), #050713',
        padding: '80px 20px',
        textAlign: 'center',
      }}
    >
      <h2
        style={{
          color: C.white,
          fontSize: 'clamp(26px, 5vw, 46px)',
          fontWeight: 800,
          margin: '0 0 16px',
          letterSpacing: '-1px',
        }}
      >
        Start your trial. Grow with CamCash.
      </h2>

      <p
        style={{
          color: C.text,
          fontSize: 16,
          margin: '0 auto 36px',
          maxWidth: 480,
          lineHeight: 1.6,
        }}
      >
        Create an account, then choose the 7-day free
        trial (card required) or subscribe now.
      </p>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 14,
          justifyContent: 'center',
          marginBottom: 20,
        }}
      >
        <Button
          as="a"
          href={user ? '/dashboard' : '/landing'}
          onClick={() => track('pricing_cta_clicked', { cta: user ? 'final_dashboard' : 'final_create_account', logged_in: !!user })}
          style={{
            padding: '14px 28px',
          }}
        >
          {user
            ? 'Go to Dashboard →'
            : 'Create Your Account →'}
        </Button>

        <Button
          as="a"
          href="/extension"
          onClick={() => track('pricing_cta_clicked', { cta: 'final_view_extension', logged_in: !!user })}
          variant="secondary"
          style={{
            padding: '14px 28px',
            fontSize: 15,
          }}
        >
          View Extension →
        </Button>
      </div>

      <p
        style={{
          color: C.muted,
          fontSize: 13,
          margin: 0,
        }}
      >
        Card required for the free trial · Trial is
        charged only after 7 days
      </p>
    </section>
  )
}

function AmbientBackground() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.3), transparent), radial-gradient(1px 1px at 60% 10%, rgba(255,255,255,0.22), transparent), radial-gradient(1px 1px at 80% 60%, rgba(255,255,255,0.26), transparent), radial-gradient(1px 1px at 35% 80%, rgba(255,255,255,0.18), transparent), radial-gradient(1px 1px at 90% 85%, rgba(255,255,255,0.22), transparent)',
        }}
      />

      <div
        style={{
          position: 'absolute',
          width: 700,
          height: 700,
          top: '-15%',
          right: '-5%',
          background:
            'radial-gradient(circle, rgba(22,244,255,0.08), transparent 65%)',
          filter: 'blur(60px)',
        }}
      />

      <div
        style={{
          position: 'absolute',
          width: 600,
          height: 600,
          bottom: '10%',
          left: '-10%',
          background:
            'radial-gradient(circle, rgba(255,43,174,0.08), transparent 65%)',
          filter: 'blur(60px)',
        }}
      />

      <div
        style={{
          position: 'absolute',
          width: 600,
          height: 600,
          top: '40%',
          left: '40%',
          background:
            'radial-gradient(circle, rgba(124,92,255,0.06), transparent 65%)',
          filter: 'blur(60px)',
        }}
      />
    </div>
  )
}

function trafficSource() {
  try {
    const p = new URLSearchParams(window.location.search)
    if (p.get('utm_source')) return p.get('utm_source')
    if (!document.referrer) return 'direct'
    return new URL(document.referrer).hostname
  } catch {
    return 'unknown'
  }
}

export default function PricingClient() {
  const [checkoutLoading, setCheckoutLoading] =
    useState(null)

  const [user, setUser] = useState(null)

  useEffect(() => {
    let mounted = true

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (mounted) {
          setUser(session?.user || null)
        }
        track('pricing_page_viewed', { logged_in: !!session?.user, traffic_source: trafficSource() })
      })
      .catch(() => {
        track('pricing_page_viewed', { logged_in: false, traffic_source: trafficSource() })
      })

    // Scroll depth: each threshold fires at most once per page view.
    const firedDepths = new Set()
    const onScroll = () => {
      const doc = document.documentElement
      const scrollable = doc.scrollHeight - window.innerHeight
      const pct = scrollable <= 0 ? 100 : ((window.scrollY + 1) / scrollable) * 100
      for (const t of [25, 50, 75, 100]) {
        if (pct >= t && !firedDepths.has(t)) {
          firedDepths.add(t)
          track('pricing_scroll_depth', { percent: t })
        }
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (mounted) {
          setUser(session?.user || null)
        }
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  return (
    <div
      style={{
        minHeight: '100vh',
        background: C.bg,
        color: C.white,
        fontFamily:
          "'DM Sans', system-ui, -apple-system, sans-serif",
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <AmbientBackground />

      <TopBar user={user} />

      <main
        style={{
          position: 'relative',
          zIndex: 1,
        }}
      >
        <PricingSection
          checkoutLoading={checkoutLoading}
          setCheckoutLoading={setCheckoutLoading}
          user={user}
        />

        <PromiseSection />

        <FAQSection />

        <FinalCTA user={user} />
      </main>

      <div
        style={{
          position: 'relative',
          zIndex: 1,
        }}
      >
        <SiteFooter />
      </div>
    </div>
  )
}
