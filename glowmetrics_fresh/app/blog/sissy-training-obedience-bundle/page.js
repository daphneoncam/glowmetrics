import ArticleLayout from '../../components/ArticleLayout'
import ProductCarousel from '../../components/ProductCarousel'
import { PRODUCTS } from '@/app/lib/productsData'

export const metadata = {
  title: 'Sissy Training & Obedience Bundle for Adult Creators — Organized Workbook',
  description:
    'A creator-focused workbook with training agreements, boundaries worksheets, planning, prompts, progress tracking, and session organization. Consent-centered and customizable.',
  alternates: {
    canonical: 'https://www.camcashgrl.com/blog/sissy-training-obedience-bundle',
  },
  openGraph: {
    title: 'Sissy Training & Obedience Bundle for Adult Creators',
    description:
      'Creator-side organization tools for structured roleplay: agreements, boundaries, assignments, progress tracking, and session planning.',
    url: 'https://www.camcashgrl.com/blog/sissy-training-obedience-bundle',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sissy Training & Obedience Bundle',
    description: 'Organized planning, agreements, and tracking for structured roleplay sessions.',
  },
}

const schema = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Sissy Training & Obedience Bundle for Adult Creators: Organized Workbook System',
  description:
    'A creator-focused workbook bringing together organization tools, agreements, boundaries, assignments, progress tracking, and session planning for structured adult roleplay.',
  url: 'https://www.camcashgrl.com/blog/sissy-training-obedience-bundle',
  datePublished: '2026-09-12',
  dateModified: '2026-09-12',
  author: { '@type': 'Person', name: 'Daphne Dawson', jobTitle: 'Cam Model' },
  publisher: { '@type': 'Organization', name: 'CamCashGrl', url: 'https://www.camcashgrl.com' },
  mainEntityOfPage: {
    '@type': 'WebPage',
    '@id': 'https://www.camcashgrl.com/blog/sissy-training-obedience-bundle',
  },
}

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What is included in the Sissy Training & Obedience Bundle?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'The bundle includes a training contract, rules agreement, consent/limits/privacy worksheet, 30-day planner, weekly reviews, rewards and consequences menu, assignment cards, session and payment tracker, completion certificate, 40 prompts, guided script, and personal-use license.',
      },
    },
    {
      '@type': 'Question',
      name: 'Why start with consent and boundaries?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'A structured workbook makes it easier to document what is and is not part of the experience from the start. This protects both the creator and the client by making expectations clear and explicit.',
      },
    },
    {
      '@type': 'Question',
      name: 'How should I use the 30-day planner?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Organize assignments, progress, reviews, session notes, payments, rewards, and milestones in the planner. Use weekly reviews to track progress and adjust the plan based on what is working.',
      },
    },
    {
      '@type': 'Question',
      name: 'Is this workbook a rigid framework?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'No. The framework is meant to be customized rather than followed as a rigid script. Adapt it to your specific role, your client\'s needs, your boundaries, and your business practices.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can I use this workbook for different client types?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes, with customization. Create separate workbooks for different clients or client types, and adapt the structure to match their specific needs and your boundaries with each.',
      },
    },
  ],
}

const s = {
  h1: {
    fontSize: '29px',
    fontWeight: 800,
    color: '#f1f5f9',
    lineHeight: 1.2,
    marginBottom: '14px',
    letterSpacing: '-0.02em',
  },
  intro: {
    fontSize: '16px',
    lineHeight: 1.75,
    color: '#cbd5e1',
    marginBottom: '32px',
    paddingLeft: '14px',
    borderLeft: '3px solid #6366f1',
  },
  h2: {
    fontSize: '21px',
    fontWeight: 700,
    color: '#e2e8f0',
    marginBottom: '10px',
    marginTop: '40px',
    letterSpacing: '-0.01em',
  },
  h3: { fontSize: '16px', fontWeight: 600, color: '#a5b4fc', marginBottom: '8px', marginTop: '22px' },
  p: { fontSize: '15px', lineHeight: 1.75, color: '#94a3b8', marginBottom: '14px' },
  ul: { paddingLeft: '20px', marginBottom: '16px' },
  li: { fontSize: '15px', lineHeight: 1.7, color: '#94a3b8', marginBottom: '6px' },
  meta: {
    fontSize: '12px',
    color: '#475569',
    marginBottom: '28px',
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
  },
  cta: {
    background: 'rgba(99,102,241,0.07)',
    border: '1px solid rgba(99,102,241,0.18)',
    borderRadius: '10px',
    padding: '22px 24px',
    margin: '36px 0',
    textAlign: 'center',
  },
  ctaT: { fontSize: '17px', fontWeight: 700, color: '#f1f5f9', marginBottom: '6px' },
  ctaS: { fontSize: '13px', color: '#64748b', marginBottom: '16px' },
  ctaBtn: {
    display: 'inline-block',
    padding: '9px 22px',
    borderRadius: '7px',
    background: '#6366f1',
    color: 'white',
    fontWeight: 600,
    fontSize: '14px',
    textDecoration: 'none',
  },
  related: { marginTop: '36px', paddingTop: '24px', borderTop: '1px solid rgba(255,255,255,0.06)' },
  relT: {
    fontSize: '11px',
    color: '#475569',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: '10px',
  },
  relLinks: { display: 'flex', flexDirection: 'column', gap: '6px' },
  relLink: { fontSize: '14px', color: '#6366f1', textDecoration: 'none' },
  iLink: { color: '#a5b4fc', textDecoration: 'none' },
}

export default function SissyTrainingObedienceBundle() {
  return (
    <ArticleLayout
      schema={[schema, faqSchema]}
      breadcrumb={[{ label: 'Blog', href: '/blog' }, { label: 'Sissy Training & Obedience Bundle' }]}
    >
      <div style={s.meta}>
        <span>Daphne Dawson</span>
        <span>September 2026</span>
        <span>5 min read</span>
      </div>

      <h1 style={s.h1}>Sissy Training and Obedience Bundle for Adult Creators</h1>

      <p style={s.intro}>
        Structured adult roleplay can be difficult to organize when agreements, boundaries,
        assignments, progress notes, and session planning live in different places. A creator
        workbook bundle brings organization tools together in one integrated system so you can
        manage sessions, track progress, and maintain clear boundaries.
      </p>

      <h2 id="whats-included" style={s.h2}>
        What Is Included
      </h2>

      <p style={s.p}>The Sissy Training & Obedience Bundle includes:</p>

      <ul style={s.ul}>
        <li style={s.li}>Training contract template</li>
        <li style={s.li}>Rules agreement worksheet</li>
        <li style={s.li}>Consent/limits/privacy worksheet</li>
        <li style={s.li}>30-day planner</li>
        <li style={s.li}>Weekly review pages</li>
        <li style={s.li}>Rewards and consequences menu</li>
        <li style={s.li}>Assignment cards</li>
        <li style={s.li}>Session and payment tracker</li>
        <li style={s.li}>Completion certificate</li>
        <li style={s.li}>40 prompts</li>
        <li style={s.li}>Guided script</li>
        <li style={s.li}>Personal-use license</li>
      </ul>

      <h2 id="start-with-consent" style={s.h2}>
        Start With Consent and Boundaries
      </h2>

      <p style={s.p}>
        Use the agreement and boundaries sections before building the training plan. A structured
        workbook makes it easier to document what is and is not part of the experience from the
        start.
      </p>

      <p style={s.p}>
        Consent and clear boundaries protect both you and your client by making expectations
        explicit. This is not paperwork bureaucracy—it is essential protection and clarity.
      </p>

      <h2 id="build-workflow" style={s.h2}>
        Build a Repeatable Workflow
      </h2>

      <p style={s.p}>
        Organize assignments, progress, reviews, session notes, payments, rewards, and milestones.
        The framework is meant to be customized rather than followed as a rigid script.
      </p>

      <p style={s.p}>
        Use weekly reviews to track progress and decide whether to adjust the pace or structure.
        This creates a feedback loop where you are continuously refining the experience based on
        what is actually working.
      </p>

      <h2 id="customization" style={s.h2}>
        Customize for Your Practice
      </h2>

      <p style={s.p}>
        The bundle provides a structure, but every element can be adapted. Adjust language, change
        timelines, reorder assignments, create new rewards, or skip sections entirely. Your
        boundaries and business practices are non-negotiable—the workbook adapts to you, not the
        other way around.
      </p>

      <div style={s.cta}>
        <div style={s.ctaT}>View the Sissy Training & Obedience Bundle</div>
        <div style={s.ctaS}>
          Complete workbook with agreements, planning, tracking, and session organization
        </div>
        <a
          href="https://www.etsy.com/listing/4537118216/sissy-punishment-guide-53pg-training?utm_source=camcashgrl&utm_medium=blog&utm_campaign=sissy-training-obedience-bundle"
          target="_blank"
          rel="noopener noreferrer"
          style={s.ctaBtn}
        >
          View on Etsy →
        </a>
      </div>

      <ProductCarousel products={PRODUCTS} currentProductId="sissy-training" />

      <h2 id="additional-tools" style={s.h2}>
        Related Creator Tools
      </h2>

      <p style={s.p}>
        Browse additional creator-focused resources designed to help you organize sessions, track
        progress, and maintain professional boundaries in your practice.
      </p>

      <div style={s.related}>
        <div style={s.relT}>Related Articles</div>
        <div style={s.relLinks}>
          <a href="/blog/daddys-girl-roleplay-script-pack" style={s.relLink}>
            → Daddy's Girl Roleplay Script Pack
          </a>
          <a href="/blog/sph-script-pack" style={s.relLink}>
            → SPH Script Pack
          </a>
          <a href="/blog/cam-session-scripts-for-models" style={s.relLink}>
            → Cam Session Scripts for Models
          </a>
          <a href="/shop" style={s.relLink}>
            → Explore All Creator Tools
          </a>
        </div>
      </div>
    </ArticleLayout>
  )
}
