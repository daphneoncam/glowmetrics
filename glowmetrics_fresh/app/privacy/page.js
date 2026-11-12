export default function PrivacyPolicy() {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#05070f",
      fontFamily: "'Inter', Arial, sans-serif",
      color: "#94A3B8",
      padding: "60px 20px"
    }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>

        <div style={{ marginBottom: 48 }}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: "#22D3EE",
            textTransform: "uppercase", letterSpacing: 2, marginBottom: 16
          }}>
            Legal
          </div>
          <h1 style={{ fontSize: 40, fontWeight: 900, color: "#F1F5F9", marginBottom: 12 }}>
            Privacy Policy
          </h1>
          <p style={{ fontSize: 15, color: "#475569" }}>
            Last updated: August 5, 2026
          </p>
        </div>

        {[
          {
            title: "1. Who We Are",
            content: `CamCash ("we", "us", "our") is a software-as-a-service platform operated at camcashgrl.com. We provide analytics tools and a Chrome extension for cam models to track their earnings and stream performance.`
          },
          {
            title: "2. What Data We Collect",
            content: `We collect the following data when you use CamCash:

• Account information: Your email address when you sign up.
• Earnings data: Tip amounts, token counts, usernames of tippers, platform names, and timestamps — either uploaded by you via CSV or captured automatically via the Chrome extension.
• Session data: Authentication tokens stored locally in your browser to keep you logged in.
• Usage data: Basic analytics about how you use the dashboard (pages visited, features used).

We do not collect passwords in plaintext, payment card information, or any personally identifiable information about the viewers/fans who tip you beyond their platform usernames.`
          },
          {
            title: "3. How We Use Your Data",
            content: `We use your data to provide and improve the CamCash service:

• To display your earnings analytics, fan insights, and stream recommendations in your dashboard.
• To power AI-generated coaching and insights based on your historical tip data.
• To send you transactional emails such as welcome messages and product updates.
• To analyze anonymized, aggregated data across all users (for example, earnings trends or platform benchmarks) to publish general insights, such as blog content or product marketing. Aggregate data is never shown in a way that could identify an individual user, and any published breakdown requires a minimum number of contributing users.

We do not sell your data. We do not share your data with third parties except as required to operate the service (see Section 5).`
          },
          {
            title: "4. Chrome Extension Data Collection",
            content: `The CamCash Chrome extension collects the following data while active on supported cam platforms (Chaturbate, BongaCams, MyFreeCams):

• Tip events: Username, token amount, and timestamp of each tip received during your stream.
• Authentication session: Your CamCash login token, stored locally in Chrome's storage.

The extension only activates on the supported cam platform pages. It does not track your browsing on any other websites. Tip data is transmitted securely to your CamCash account and is never shared with third parties.`
          },
          {
            title: "5. Third-Party Services",
            content: `We use the following third-party services to operate CamCash:

• Supabase — database and authentication (supabase.com)
• Vercel — website hosting (vercel.com)
• Resend — transactional email delivery (resend.com)
• Stripe — payment processing for paid plans (stripe.com)

Each of these services has its own privacy policy. We only share the minimum data necessary for each service to function.`
          },
          {
            title: "6. Data Storage and Security",
            content: `Your data is stored on Supabase's servers in the United States. We use industry-standard encryption in transit (HTTPS/TLS) and at rest. Access to your data is restricted to your account only — other users cannot see your earnings or fan data.`
          },
          {
            title: "7. Data Retention",
            content: `We retain your data for as long as your account is active. If you delete your account, your data will be permanently deleted within 30 days. You can request deletion at any time by contacting us at support@camcashgrl.com.`
          },
          {
            title: "8. Your Rights",
            content: `You have the right to:

• Access the data we hold about you
• Correct inaccurate data
• Request deletion of your data
• Export your data in a portable format
• Opt out of marketing emails at any time

To exercise any of these rights, contact us at support@camcashgrl.com.`
          },
          {
            title: "9. Children's Privacy",
            content: `CamCash is intended for adult users only (18+). We do not knowingly collect data from anyone under the age of 18. If you believe a minor has created an account, please contact us immediately.`
          },
          {
            title: "10. Changes to This Policy",
            content: `We may update this privacy policy from time to time. We will notify you of significant changes by email or by posting a notice on the dashboard. Your continued use of CamCash after changes are posted constitutes acceptance of the updated policy.`
          },
          {
            title: "11. Contact Us",
            content: `If you have questions about this privacy policy or how we handle your data, contact us at:

Email: support@camcashgrl.com
Website: camcashgrl.com`
          }
        ].map((section, i) => (
          <div key={i} style={{
            marginBottom: 40,
            paddingBottom: 40,
            borderBottom: "1px solid rgba(255,255,255,0.06)"
          }}>
            <h2 style={{
              fontSize: 20, fontWeight: 800, color: "#F1F5F9",
              marginBottom: 16
            }}>
              {section.title}
            </h2>
            <div style={{
              fontSize: 15, lineHeight: 1.8, color: "#94A3B8",
              whiteSpace: "pre-line"
            }}>
              {section.content}
            </div>
          </div>
        ))}

        <div style={{
          marginTop: 40, padding: "20px 24px",
          background: "rgba(34,211,238,0.05)",
          border: "1px solid rgba(34,211,238,0.15)",
          borderRadius: 12, fontSize: 14, color: "#475569"
        }}>
          For questions about this policy, email{" "}
          <a href="mailto:support@camcashgrl.com" style={{ color: "#22D3EE" }}>
            support@camcashgrl.com
          </a>
        </div>

      </div>
    </div>
  )
}
