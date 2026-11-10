// Weekly subscriber tips (used by app/api/cron/send-subscription-tips).
// Every tip describes a feature that exists on the Pro plan as listed on
// /pricing; no steps, menus or numbers are invented.
import { SITE_URL, SUPPORT_EMAIL } from './sendEmail'

export const TIP_INTERVAL_DAYS = 7

const SIGNOFF = `Questions? Email us at ${SUPPORT_EMAIL}

The CamCash Team`

export const TIPS = [
  {
    subject: 'CamCash tip: let Live Mode coach you while you stream',
    text: `Hi there,

Live Mode works alongside your show and tracks tips as they happen, with real-time coaching based on your pace, your room and your tippers.

Turn it on before your next show:
${SITE_URL}/live

${SIGNOFF}`,
  },
  {
    subject: 'CamCash tip: plan your week with Stream Planner',
    text: `Hi there,

Stream Planner uses your own tip history to show when your shows tend to earn the most, so you can plan your schedule around your strongest times.

Open it from the Stream Planner tab in your dashboard:
${SITE_URL}/dashboard

${SIGNOFF}`,
  },
  {
    subject: 'CamCash tip: see where your money comes from with Money Map',
    text: `Hi there,

Money Map shows when and where you earn: a day-by-hour map of your earnings, earnings by platform, monthly totals and your $/hr trend week to week.

Find it in your dashboard:
${SITE_URL}/dashboard

${SIGNOFF}`,
  },
  {
    subject: 'CamCash tip: win back fans who have gone quiet',
    text: `Hi there,

Your fan insights flag regular tippers who haven't been back in a while. Each one has a 💌 Message button that writes a friendly check-in for you to copy and send them yourself on the platform where they tip you. CamCash never messages fans for you.

See who to reach out to:
${SITE_URL}/dashboard

${SIGNOFF}`,
  },
  {
    subject: 'CamCash tip: compare all your platforms in one place',
    text: `Hi there,

With Pro you can track every platform you work and compare your earnings across them side by side, with your full history on each one.

Add another platform by uploading its CSV or tracking it with Live Mode:
${SITE_URL}/dashboard

${SIGNOFF}`,
  },
]

