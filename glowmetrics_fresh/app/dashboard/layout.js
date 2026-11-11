import PromoRedeemer from './PromoRedeemer'

// Wraps every /dashboard page. PromoRedeemer lives here (not inside the page)
// so it stays mounted through the page's loading screen and can catch a
// ?promo= link before any redirect.
export default function DashboardLayout({ children }) {
  return (
    <>
      {children}
      <PromoRedeemer />
    </>
  )
}
