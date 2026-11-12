// Shared presentation for long-form blog articles
export const s = {
  h1: { fontSize: 32, fontWeight: 800, color: '#f1f5f9', lineHeight: 1.2, marginBottom: 24 },
  intro: { fontSize: 18, lineHeight: 1.75, color: '#cbd5e1', marginBottom: 32, paddingLeft: 16, borderLeft: '4px solid #0ea5e9' },
  h2: { fontSize: 24, fontWeight: 700, color: '#e2e8f0', marginBottom: 16, marginTop: 40 },
  h3: { fontSize: 18, fontWeight: 700, color: '#e2e8f0', marginBottom: 12, marginTop: 28 },
  p: { fontSize: 16, lineHeight: 1.75, color: '#94a3b8', marginBottom: 16 },
  ul: { paddingLeft: 24, marginBottom: 16 },
  ol: { paddingLeft: 24, marginBottom: 16 },
  li: { fontSize: 16, lineHeight: 1.75, color: '#94a3b8', marginBottom: 10 },
  meta: { fontSize: 13, color: '#64748b', marginBottom: 32, display: 'flex', gap: 20, flexWrap: 'wrap' },
  link: { color: '#0ea5e9', textDecoration: 'none', fontWeight: 500 },
  strong: { color: '#f1f5f9', fontWeight: 700 },
  answer: { padding: '20px', borderRadius: 12, background: 'rgba(14,165,233,.08)', border: '1px solid rgba(14,165,233,.3)', marginBottom: 28, fontSize: 16, lineHeight: 1.75, color: '#e2e8f0' },
  note: { padding: '16px', borderRadius: 10, background: 'rgba(251,191,36,.06)', border: '1px solid rgba(251,191,36,.25)', marginBottom: 20, fontSize: 15, lineHeight: 1.75, color: '#cbd5e1' },
  step: { padding: '18px 20px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.1)', marginBottom: 14 },
  stepNum: { display: 'inline-block', fontSize: 12, fontWeight: 800, letterSpacing: '.08em', color: '#0ea5e9', marginBottom: 8 },
  code: { fontSize: 14, fontFamily: "'Fira Code', monospace", color: '#f0f4f8', background: 'rgba(15,23,42,.6)', padding: '2px 6px', borderRadius: 4 },
  codeBlock: { background: 'rgba(15,23,42,.8)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, padding: '16px', overflow: 'auto', marginBottom: 20, fontSize: 13, lineHeight: 1.6, color: '#cbd5e1' },
  promo: { background: 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(239,68,68,0.08))', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 12, padding: '32px 24px', margin: '38px 0' },
  promoTitle: { fontSize: 18, fontWeight: 800, color: '#f1f5f9', marginBottom: 12 },
  promoButtons: { display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 },
  promoBtn: { display: 'inline-block', padding: '12px 24px', borderRadius: 8, color: '#fff', fontWeight: 700, fontSize: 14, textDecoration: 'none', textAlign: 'center', cursor: 'pointer', border: 'none' },
  promoBtnModel: { background: 'linear-gradient(135deg, #f59e0b, #d97706)', transition: 'all 0.3s ease' },
  promoBtnCam: { background: 'linear-gradient(135deg, #ef4444, #dc2626)', transition: 'all 0.3s ease' },
}

export const articleSchema = ({ title, description, slug, faqs } = {}) => ({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: title,
  description: description,
  url: slug ? `https://www.camcashgrl.com/blog/${slug}` : undefined,
  ...(faqs && faqs.length > 0 && {
    mainEntity: {
      '@type': 'FAQPage',
      mainEntity: faqs.map(faq => ({
        '@type': 'Question',
        name: faq.q,
        acceptedAnswer: {
          '@type': 'Answer',
          text: faq.a,
        },
      })),
    },
  }),
})

export const articleMeta = ({ title, description, slug } = {}) => ({
  title: title,
  description: description,
  alternates: {
    canonical: slug ? `https://www.camcashgrl.com/blog/${slug}` : undefined,
  },
  openGraph: {
    type: 'article',
    title: title,
    description: description,
    url: slug ? `https://www.camcashgrl.com/blog/${slug}` : undefined,
    siteName: 'CamCashGrl',
  },
})
