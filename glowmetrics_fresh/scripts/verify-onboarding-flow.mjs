// The onboarding journey: import -> Live Mode opportunity -> success + Creator
// Pro CTA -> dashboard.
//
// What it was: the loading card counted up Earnings / Fans / Tips / Best Hour,
// the Live Mode card then stole the completion sparkle (fired at import
// success, so it burned its four seconds behind a card the creator was still
// reading), and the final card rendered the SAME four figures again — after
// which onboarding ended on "Go to Dashboard" with no route into Creator Pro
// at all. Two totals displays either side of the Live Mode card, a
// celebration on the wrong card, and no offer at the one moment the creator
// has just seen what CamCash found about their own earnings.
//
// These checks pin the corrected sequence. They deliberately assert POSITION
// and OWNERSHIP, not just presence: "a totals grid exists" would stay true
// with the duplicate back.

import { readFileSync } from 'fs'

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`) }
}
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const raw = read('../app/onboarding/page.js')
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const planSrc = read('../lib/plan.js')

// Step block boundaries, so "which card owns this" is answerable.
const iLoading = src.indexOf("{step==='loading'&&(")
const iLive = src.indexOf("{step==='live'&&(")
const iStep4 = src.indexOf("{step==='step4'&&(")
const iReport = src.indexOf("{step==='report'&&importResult&&(")
const iTrial = src.indexOf("{step==='trial'&&(")
const iDone = src.indexOf("{step==='done'&&(")
const loadingBlock = src.slice(iLoading, iLive)
const liveBlock = src.slice(iLive, iStep4)
const reportBlock = src.slice(iReport, iTrial > iReport ? iTrial : undefined)
const trialBlock = src.slice(iTrial, iDone > iTrial ? iDone : undefined)
const doneBlock = src.slice(iDone, iTrial > iDone ? iTrial : undefined)

// ══════════════════════════════════════════════════════════════════════
// 1-2. ONE TOTALS DISPLAY, ON THE FINAL CARD ONLY.
// ══════════════════════════════════════════════════════════════════════
check('every step block of the new flow exists',
  [iLoading, iLive, iStep4, iReport, iTrial, iDone].every(i => i > -1),
  `loading=${iLoading} live=${iLive} step4=${iStep4} report=${iReport} trial=${iTrial} done=${iDone}`)
// import -> report -> trial -> live -> done
check('import lands on the report, not on Live Mode',
  (src.match(/setIsFirstImport\(false\);setStep\('report'\)/g) || []).length === 2)
check('the report continues to the trial for a non-Pro creator',
  /setStep\(userPlan==='pro'\?'live':'trial'\)/.test(reportBlock))
check('the trial card offers Free as a peer, not a confirmation step',
  /Continue with Free/.test(trialBlock) &&
  /setTrialSkipped\(true\);setStep\('live'\)/.test(trialBlock) &&
  !/are you sure/i.test(trialBlock) && !/confirm\(/.test(trialBlock))
// "Do not visually punish the Free option": it is a full-width peer button of
// the same height as the primary, not hidden, faded, or shrunk to a text link.
check('the Free option is not visually punished',
  /<OBSecBtn onClick=\{\(\)=>\{track\('trial_skipped'[\s\S]{0,220}?width:'100%',height:44/.test(trialBlock) &&
  !/display:'none'/.test(trialBlock) && !/opacity:0\./.test(trialBlock))
check('the trial states every commercial term before the CTA',
  /A credit card is required to start the trial/.test(trialBlock) &&
  /Billing begins after \$\{TRIAL_DAYS\} days at \$\{PRO_PRICE_MONTHLY_LABEL\}/.test(trialBlock) &&
  /Cancel any time before then and you pay nothing/.test(trialBlock) &&
  trialBlock.indexOf('Cancel any time') < trialBlock.indexOf('Start my {TRIAL_DAYS}-day free trial'))
check('the price comes from the canonical constant, never retyped',
  /PRO_PRICE_MONTHLY_LABEL \} from '\.\.\/\.\.\/lib\/constants'/.test(src) &&
  !/\$19\.99/.test(trialBlock))
check('the CTA names the action — no vague Get Started / Unlock / Try Pro',
  /Start my \{TRIAL_DAYS\}-day free trial/.test(trialBlock) &&
  !/Get Started|Unlock Pro|Try Pro<|Continue →/.test(trialBlock))
check('a closed checkout returns to the decision with both options',
  /q\.get\('trial'\)==='cancelled'/.test(src) && /setStep\('trial'\)/.test(src) &&
  /trialAbandoned&&\(/.test(trialBlock))
check('the final card owns the completion state',
  /You&apos;re done/.test(doneBlock) && /Go to my dashboard →/.test(doneBlock))
check('the extension is optional on the final card, and Pro-only',
  /userPlan==='pro'&&\(/.test(doneBlock) &&
  /Live Mode works without it/.test(doneBlock) &&
  !/must install/i.test(doneBlock))
check('the loading card no longer renders a totals grid before Live Mode',
  !/estimatedEarnings/.test(loadingBlock) && !/fansDetected/.test(loadingBlock) &&
  !/tipsDetected/.test(loadingBlock) && !/bestHour/.test(loadingBlock),
  loadingBlock.slice(0, 200))
check('the loading card keeps its progress checklist — only the totals went',
  /LOADING_MESSAGES\.map/.test(loadingBlock))
check('the totals render exactly once, on the report card',
  /estimatedEarnings/.test(reportBlock) &&
  (src.match(/preview\?\.estimatedEarnings/g) || []).length === 1)
// The figures must come from state the import already produced. A second
// engine, or a re-parse at the end, is the thing to prevent.
check('the report reads already-computed state, not a fresh calculation',
  !/buildPreview\(/.test(reportBlock) && !/diagnosePasteFailure/.test(reportBlock) &&
  /preview\?\./.test(reportBlock))
check('buildPreview is still called once, at parse time only',
  // Count INVOCATIONS, not the function declaration — a bare /buildPreview\(/
  // also matches `function buildPreview(` and would pass with a second call
  // added.
  (src.match(/=buildPreview\(/g) || []).length === 1 &&
  /function buildPreview\(/.test(src))

// ══════════════════════════════════════════════════════════════════════
// 3-4. THE SPARKLE BELONGS TO COMPLETION, NOT TO THE LIVE TRACKER CARD.
// ══════════════════════════════════════════════════════════════════════
check('the sparkle no longer fires at import success',
  !/setShowSparkle\(true\);setStep\('live'\)/.test(src) &&
  !/setIsFirstImport\(false\);setShowSparkle\(true\)/.test(src))
check('it fires on the way into the final card',
  /onContinue=\{\(\)=>\{celebrate\(\);setStep\('done'\)\}\}/.test(src))
check('celebrate() is the single owner of the sparkle',
  (src.match(/setShowSparkle\(true\)/g) || []).length === 1 &&
  /function celebrate\(\)\{/.test(src))
check('the Live Mode card does not raise it',
  !/celebrate\(\)/.test(liveBlock.replace(/onContinue=\{[^}]*\}\}/g, '')))

// ══════════════════════════════════════════════════════════════════════
// 5-7. THE CREATOR PRO CTA — PRESENT FOR FREE, ABSENT FOR PRO.
// ══════════════════════════════════════════════════════════════════════
check('the trial card offers the trial to a non-Pro creator',
  /Start my \{TRIAL_DAYS\}-day free trial/.test(trialBlock))
check('it routes through the canonical trial entry, not a bespoke checkout',
  /router\.push\('\/start-trial'\)/.test(trialBlock) &&
  !/api\/stripe\/checkout/.test(trialBlock))
check('the trial length comes from the canonical constant, never retyped',
  /import \{ isProPlan, TRIAL_DAYS \} from '\.\.\/\.\.\/lib\/plan'/.test(src) &&
  /export const TRIAL_DAYS = 7/.test(planSrc) &&
  !/7-day free trial/.test(trialBlock))
check('an already-Pro creator never reaches the trial card',
  /setStep\(userPlan==='pro'\?'live':'trial'\)/.test(reportBlock))
check('the Pro branch skips straight to Live Mode',
  /userPlan==='pro'\?'live'/.test(reportBlock))
check('userPlan is derived from the canonical predicate',
  /setUserPlan\(isProPlan\(profile\)\?'pro':'free'\)/.test(src))
check('the trial CTA is tracked as its own funnel step',
  /track\('trial_cta_clicked',\{source:'onboarding_trial'\}\)/.test(trialBlock))

// ══════════════════════════════════════════════════════════════════════
// 8. THE EXTENSION NEVER BLOCKS COMPLETION.
// ══════════════════════════════════════════════════════════════════════
check('no extension install step or CTA remains in onboarding',
  !/Install Live Tracker/.test(src) && !/camcashgrl\.com\/extension/.test(src) &&
  !/camcash-extension\.zip/.test(src) && !/onInstall/.test(src))
check('the Live Mode card advances on its own, with no install gate',
  /<LiveModeDemo onContinue=/.test(src) && /function LiveModeDemo\(\{onContinue,isPro=false\}\)/.test(src))
check('the Live Mode preview knows the plan, so Free is not shown it as owned',
  /<LiveModeDemo onContinue=\{[^}]*\}\} isPro=\{userPlan==='pro'\}/.test(src))

// ══════════════════════════════════════════════════════════════════════
// 9-10. LAYOUT: WIDER, SHORTER, STILL TAPPABLE.
// ══════════════════════════════════════════════════════════════════════
check('the card shell is wider than the old 430',
  /maxWidth:520\}\}>/.test(src) && !/maxWidth:430\}/.test(src))
check('the upsell modal matches the same width, so cards do not disagree',
  (src.match(/maxWidth:520/g) || []).length === 2)
check('the shell sheds vertical padding while keeping horizontal room',
  /padding:'20px 30px 18px'/.test(src) && !/padding:'26px 28px 24px'/.test(src))
check('the tall 22px header gaps are gone',
  !/textAlign:'center',marginBottom:22\}/.test(src))
check('the hero medallions were reduced, not removed',
  !/width:64,height:64,borderRadius:22/.test(src) && !/width:56,height:56,borderRadius:20/.test(src) &&
  /width:52,height:52,borderRadius:18/.test(src) && /width:46,height:46,borderRadius:16/.test(src))
check('copy is allowed to use the extra width instead of wrapping',
  /maxWidth:430,margin:'0 auto'/.test(src) && !/maxWidth:360,margin:'0 auto'/.test(src))
// Touch targets survive the tightening — this is the thing a "make it shorter"
// pass is most likely to break.
check('the primary CTA stays at least 44px',
  /width:'100%',height:48,borderRadius:14/.test(src))
check('the secondary CTAs stay at least 44px',
  /function OBSecBtn[\s\S]{0,200}?height:44/.test(src) &&
  !/<OBSecBtn key=\{b\.label\} onClick=\{b\.onClick\} style=\{\{width:'100%',height:40/.test(src))

// ══════════════════════════════════════════════════════════════════════
// 11-14. NOTHING ELSE MOVED.
// ══════════════════════════════════════════════════════════════════════
check('the dashboard redirect still works',
  /router\.push\('\/dashboard'\)/.test(src))
check('completion tracking is intact',
  /track\('onboarding_completed',\{platform:platformId\}\)/.test(src) &&
  /track\('onboarding_completed',\{platform:platformId,source:'csv'\}\)/.test(src))
check('the first-insight funnel event is intact',
  /track\('first_insight_viewed'/.test(src))
check('CSV and paste import paths both survive',
  /handleCsvUpload/.test(src) && /handlePreview/.test(src))
check('no free-beta or "Pro is free" claim is introduced',
  !/free during beta/i.test(src) && !/100% free/i.test(src) &&
  !/Creator Pro is free/i.test(src))
check('the card-backed nature of the trial is stated at the CTA',
  /A credit card is required to start the trial/.test(trialBlock) &&
  /Cancel any time before then/.test(trialBlock))
check('exactly one trial CTA exists in onboarding',
  (src.match(/start-trial'\)/g) || []).length === 1)
check('exactly one sparkle renderer exists',
  (src.match(/\{showSparkle&&<Sparkle\/>\}/g) || []).length === 1)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
