'use client'
export const dynamic = 'force-dynamic'
import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { safeRedirectPath } from '@/lib/safe-redirect'

// Only works in Vercel preview environments.
// Add up to 5 accounts in Vercel → Settings → Environment Variables → Preview only:
//   NEXT_PUBLIC_PREVIEW_LABEL_1 = "My Main Account"
//   NEXT_PUBLIC_PREVIEW_EMAIL_1 = "me@example.com"
//   NEXT_PUBLIC_PREVIEW_PASSWORD_1 = "mypassword"
//   NEXT_PUBLIC_PREVIEW_LABEL_2 = "Test Account"
//   NEXT_PUBLIC_PREVIEW_EMAIL_2 = "test@example.com"
//   NEXT_PUBLIC_PREVIEW_PASSWORD_2 = "testpassword"
//   ...up to _5

// Next.js only inlines NEXT_PUBLIC_* vars when referenced as a static,
// literal `process.env.NEXT_PUBLIC_X` expression -- a dynamic/templated
// key (e.g. process.env[`...${n}`]) can never be replaced at build time,
// so each slot must be spelled out individually here.
const ACCOUNTS = [
  { label: process.env.NEXT_PUBLIC_PREVIEW_LABEL_1 || null, email: process.env.NEXT_PUBLIC_PREVIEW_EMAIL_1 || null, password: process.env.NEXT_PUBLIC_PREVIEW_PASSWORD_1 || null },
  { label: process.env.NEXT_PUBLIC_PREVIEW_LABEL_2 || null, email: process.env.NEXT_PUBLIC_PREVIEW_EMAIL_2 || null, password: process.env.NEXT_PUBLIC_PREVIEW_PASSWORD_2 || null },
  { label: process.env.NEXT_PUBLIC_PREVIEW_LABEL_3 || null, email: process.env.NEXT_PUBLIC_PREVIEW_EMAIL_3 || null, password: process.env.NEXT_PUBLIC_PREVIEW_PASSWORD_3 || null },
  { label: process.env.NEXT_PUBLIC_PREVIEW_LABEL_4 || null, email: process.env.NEXT_PUBLIC_PREVIEW_EMAIL_4 || null, password: process.env.NEXT_PUBLIC_PREVIEW_PASSWORD_4 || null },
  { label: process.env.NEXT_PUBLIC_PREVIEW_LABEL_5 || null, email: process.env.NEXT_PUBLIC_PREVIEW_EMAIL_5 || null, password: process.env.NEXT_PUBLIC_PREVIEW_PASSWORD_5 || null },
].filter(a => a.email && a.password)

const outer = {
  minHeight: '100vh', display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  background: '#0F1117', fontFamily: 'system-ui, sans-serif',
  padding: 24,
}

function PreviewLoginInner() {
  const params     = useSearchParams()
  const redirectTo = safeRedirectPath(params.get('to'))
  const [loading, setLoading] = useState(null)
  const [error,   setError]   = useState(null)

  const isProduction = process.env.NEXT_PUBLIC_VERCEL_ENV === 'production'

  const signIn = async (account, i) => {
    setLoading(i)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({
      email: account.email,
      password: account.password,
    })
    if (error) {
      setError(error.message)
      setLoading(null)
    } else {
      window.location.href = redirectTo
    }
  }

  if (isProduction) {
    return (
      <div style={outer}>
        <div style={{ color: '#8B92A0', fontSize: 13 }}>Not available in production.</div>
      </div>
    )
  }

  if (ACCOUNTS.length === 0) {
    return (
      <div style={outer}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>🔐</div>
        <div style={{ color: '#C1C7D4', fontSize: 14, fontWeight: 700, marginBottom: 8 }}>No accounts configured</div>
        <div style={{ color: '#8B92A0', fontSize: 12, lineHeight: 1.7, maxWidth: 340, textAlign: 'center' }}>
          Add preview accounts in Vercel → Settings → Environment Variables (Preview only):<br />
          <code style={{ color: '#6366F1' }}>NEXT_PUBLIC_PREVIEW_EMAIL_1</code><br />
          <code style={{ color: '#6366F1' }}>NEXT_PUBLIC_PREVIEW_PASSWORD_1</code><br />
          <code style={{ color: '#6366F1' }}>NEXT_PUBLIC_PREVIEW_LABEL_1</code> (optional display name)
        </div>
      </div>
    )
  }

  return (
    <div style={outer}>
      <div style={{ fontSize: 28, marginBottom: 10 }}>🔐</div>
      <div style={{ color: '#F0F2F6', fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Preview Login</div>
      <div style={{ color: '#8B92A0', fontSize: 12, marginBottom: 24 }}>
        Sign in as → <span style={{ color: '#6366F1' }}>{redirectTo}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 300 }}>
        {ACCOUNTS.map((account, i) => (
          <button
            key={i}
            onClick={() => signIn(account, i)}
            disabled={loading !== null}
            style={{
              padding: '12px 20px', borderRadius: 10, border: '1px solid rgba(99,102,241,0.3)',
              background: loading === i ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.08)',
              color: '#F0F2F6', fontSize: 13, fontWeight: 700, cursor: loading !== null ? 'default' : 'pointer',
              transition: 'all 0.15s', opacity: loading !== null && loading !== i ? 0.5 : 1,
            }}
          >
            {loading === i ? '⏳ Signing in…' : `${account.label || account.email}`}
            <div style={{ fontSize: 10, color: '#8B92A0', fontWeight: 400, marginTop: 2 }}>
              {account.label ? account.email : ''}
            </div>
          </button>
        ))}
      </div>

      {error && (
        <div style={{ marginTop: 16, color: '#ef4444', fontSize: 12 }}>⚠️ {error}</div>
      )}
    </div>
  )
}

export default function PreviewLogin() {
  return (
    <Suspense fallback={<div style={outer}><div style={{ color: '#8B92A0', fontSize: 13 }}>Loading…</div></div>}>
      <PreviewLoginInner />
    </Suspense>
  )
}
