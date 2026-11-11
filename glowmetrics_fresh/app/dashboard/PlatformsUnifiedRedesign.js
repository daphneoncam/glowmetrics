"use client"
import React, { useMemo, useState } from 'react'
import {
  buildBusinessSnapshot, buildPlatformComparison, buildEfficiencyComparison,
  buildTimeIntelligence, buildFanRevenue, buildCamCashNoticed, buildDataCoverage, formatHour,
} from '../../lib/platformIntelligenceAnalytics'
import { computeDataVaultStats } from './DashboardPreview'

// Platforms presentation only. All primary metrics come from the shared analytics engine.
const money = n => n == null || !Number.isFinite(Number(n)) ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const number = n => Number(n || 0).toLocaleString('en-US')
const ACCENT = { chaturbate:'#31c4ee', bongacams:'#ed56b9', myfreecams:'#ae83f9' }
const colorFor = p => ACCENT[String(p || '').toLowerCase()] || '#9ab5dc'

function Heading({children, note, action}) {
  return <div className="pir-head"><div><strong>{children}</strong>{note && <span>{note}</span>}</div>{action}</div>
}
function Card({children, className='', style={}, ...props}) {
  return <div className={'pir-card '+className} style={style} {...props}>{children}</div>
}
function Stat({label, value, sub, accent}) {
  return <div className="pir-stat"><span className="pir-label">{label}</span><b style={{color:accent || '#eaf1ff'}}>{value}</b>{sub && <small>{sub}</small>}</div>
}
function Empty({children}) { return <div className="pir-empty">{children}</div> }
function Trend({trend}) {
  if (!trend || !Number.isFinite(trend.pct)) return <span className="pir-faint">No comparison yet</span>
  return <span className={trend.pct > 0 ? 'pir-positive' : trend.pct < 0 ? 'pir-negative' : 'pir-faint'}>{trend.pct > 0 ? '↑ +' : trend.pct < 0 ? '↓ ' : ''}{Math.round(trend.pct)}% vs prior 30d</span>
}
function PlatformCards({comparison, onSelect}) {
  if (!comparison.length) return <Empty>Import platform history to see your cross-platform comparison.</Empty>
  const max = Math.max(...comparison.map(p => p.earnings), 1)
  return <div className="pir-platforms">{comparison.map((p,i) => {
    const c = colorFor(p.platform)
    return <button type="button" className="pir-platform" key={p.platform} style={{'--pir-accent':c}} onClick={() => onSelect(p.platform)}>
      <div className="pir-platform-top"><span className="pir-platform-symbol">{p.platform.slice(0,1)}</span><strong>{p.platform}</strong>{i===0 && <span className="pir-crown">Top revenue</span>}</div>
      <div className="pir-platform-value">{money(p.earnings)}</div>
      <div className="pir-platform-meta"><span>{p.earningsPercent}% of displayed earnings</span><Trend trend={p.trend}/></div>
      <div className="pir-track"><div style={{width:(p.earnings/max*100)+'%',background:c}}/></div>
      <div className="pir-platform-foot"><span><b>{p.rateHours > 0 && p.usdPerHour > 0 ? money(p.usdPerHour) : '—'}</b> /hr estimated</span><span>{p.rateHours > 0 ? p.rateHours.toFixed(1)+' rated h' : 'Time unavailable'}</span></div>
    </button>
  })}</div>
}
function Discovery({insights}) {
  return <Card className="pir-discover">
    <Heading note="Evidence-backed discoveries from your available history"><span className="pir-spark">✦</span> CamCash Noticed</Heading>
    {insights.length ? <div className="pir-discovery-list">{insights.map((ins,i) => <div className="pir-discovery" key={i}><span className="pir-discovery-dot">✦</span><span>{ins.text}</span></div>)}</div> :
      <Empty>CamCash is watching for meaningful cross-platform differences. More comparable history will unlock discoveries.</Empty>}
    <div className="pir-footnote">Insights describe observed history, not guaranteed future earnings.</div>
  </Card>
}
function Historical({comparison}) {
  const [metric,setMetric] = useState('earnings')
  const available = comparison.filter(p => p.trend && p.trend.pct !== null &&
    Number.isFinite(p.trend.last30USD) && Number.isFinite(p.trend.prior30USD))
  const highest = Math.max(1,...available.flatMap(p => [p.trend.last30USD,p.trend.prior30USD]))
  return <Card className="pir-history">
    <Heading note="Compare historical performance, not individual sessions">Historical Intelligence</Heading>
    <div className="pir-switches">
      <button className={metric==='earnings'?'active':''} onClick={()=>setMetric('earnings')}>Earnings trend</button>
      <button className={metric==='efficiency'?'active':''} onClick={()=>setMetric('efficiency')}>Hourly efficiency</button>
    </div>
    {metric==='earnings' ? (available.length ? <div className="pir-trend-grid">
      {available.map(p => <div className="pir-trend-row" key={p.platform}>
        <div className="pir-trend-name"><span style={{background:colorFor(p.platform)}}/>{p.platform}<Trend trend={p.trend}/></div>
        <div className="pir-paired">
          <div><small>Previous 30d</small><div className="pir-track"><div style={{width:100*p.trend.prior30USD/highest+'%',background:colorFor(p.platform),opacity:.4}}/></div><b>{money(p.trend.prior30USD)}</b></div>
          <div><small>Last 30d</small><div className="pir-track"><div style={{width:100*p.trend.last30USD/highest+'%',background:colorFor(p.platform)}}/></div><b>{money(p.trend.last30USD)}</b></div>
        </div>
      </div>)}
      <div className="pir-footnote">Two real 30-day periods supplied by the analytics engine. A continuous historical chart will require a canonical dated series.</div>
    </div> : <Empty>No valid prior-period comparison is available yet. No trend is inferred from a single period.</Empty>) :
      <div className="pir-efficiency">{comparison.map(p=><div key={p.platform} className="pir-eff-row"><span style={{color:colorFor(p.platform)}}>{p.platform}</span><b>{p.rateHours>0&&p.usdPerHour>0?money(p.usdPerHour)+'/hr':'Not enough timed data'}</b><small>{p.rateHours>0?p.rateHours.toFixed(1)+' rated hours':'Rate unavailable'}</small></div>)}<div className="pir-footnote">Only the engine's duration-qualified earnings and hours are used.</div></div>}
  </Card>
}
function Audience({fans, comparison}) {
  return <Card className="pir-audience">
    <Heading note="Changes in your supporter base">Audience Intelligence</Heading>
    <div className="pir-audience-stats">
      <Stat label="Tracked supporters" value={number(fans.uniqueTippers)}/>
      <Stat label="Returning" value={fans.returningTippers == null ? '—':number(fans.returningTippers)}/>
      <Stat label="New" value={fans.newTippers == null ? '—':number(fans.newTippers)}/>
    </div>
    <div className="pir-footnote">Supporters from the engine's tracked fan set; returning/new metrics may use a different eligible population. Cross-platform usernames are not merged.</div>
    {fans.topThreeContribution != null && <div className="pir-fan-risk">Top 3 supporters account for <b>{fans.topThreeContribution}%</b> of all tracked earnings.</div>}
  </Card>
}
function Timing({timeIntel, comparison, isPro}) {
  const hasPattern = timeIntel?.hasPattern
  return <Card className="pir-timing">
    <Heading note="Historical time patterns across platforms">Timing Opportunities</Heading>
    {hasPattern ? <div className="pir-time-list">
      {timeIntel.bestHour && <div className="pir-time-row"><span>✦ Strongest observed hour</span><b>{timeIntel.bestHour.label}</b><small>{number(timeIntel.bestHour.count)} observed days</small></div>}
      {timeIntel.bestDay && <div className="pir-time-row"><span>Best observed day</span><b>{timeIntel.bestDay.day}</b><small>{number(timeIntel.bestDay.count)} observed days</small></div>}
      <div className="pir-footnote">{timeIntel.confidence?.label || 'Observed pattern'} · Derived in the creator's selected timezone. This does not predict tonight's earnings.</div>
      {isPro && comparison.map(p => {
        const t = timeIntel.platformBestTimes?.[p.platform]
        const hour = t?.hour?.hour
        return hour != null ? <div className="pir-time-row" key={p.platform}><span>{p.platform}</span><b>{formatHour(hour)}</b><small>Platform best hour</small></div> : null
      })}
    </div> : <Empty>CamCash needs a repeatable pattern across at least three distinct local dates before naming a reliable window.</Empty>}
    {!isPro && <div className="pir-locked">✧ Pro unlocks the full per-platform timing comparison.</div>}
  </Card>
}
function Milestones({coverage, comparison}) {
  const finished = (coverage?.milestones || []).filter(m => m.done)
  return <Card className="pir-milestones">
    <Heading note="Verified tracking milestones and platform progress">Records & Milestones</Heading>
    <div className="pir-milestone-list">
      {finished.slice(-3).reverse().map(m=><div className="pir-milestone" key={m.days}><span>✦</span><div><b>{m.label}</b><small>{m.days} days of history on file</small></div></div>)}
      {comparison.length > 0 && <div className="pir-milestone"><span>◈</span><div><b>{comparison.length} tracked platform{comparison.length===1?'':'s'}</b><small>Based on platform rows in the analytics engine</small></div></div>}
    </div>
    <div className="pir-footnote">Personal earnings records and streaks will appear once verified historical record data is available. No record claims are simulated.</div>
  </Card>
}
export default function PlatformsUnifiedRedesign({analytics, tips=[], isPro=false, onSelectPlatform}) {
  const snapshot = useMemo(()=>buildBusinessSnapshot(analytics),[analytics])
  const comparison = useMemo(()=>buildPlatformComparison(analytics),[analytics])
  const timeIntel = useMemo(()=>buildTimeIntelligence(analytics),[analytics])
  const fans = useMemo(()=>buildFanRevenue(analytics,isPro),[analytics,isPro])
  const insights = useMemo(()=>buildCamCashNoticed(analytics),[analytics])
  const coverage = useMemo(()=>buildDataCoverage(computeDataVaultStats(tips)),[tips])
  const efficiency = useMemo(()=>buildEfficiencyComparison(analytics),[analytics])
  if (!snapshot || comparison.length===0) return <Empty>No platform history is ready to compare. Import earnings to get started.</Empty>
  const leader = comparison[0]
  return <div className="pir-root">
    <style>{`
      .pir-root{--pir-border:rgba(160,133,212,.22);color:#eaf1ff;min-width:0}
      .pir-root *{box-sizing:border-box}
      .pir-root .pir-card{min-width:0;border:1px solid var(--pir-border);border-radius:17px;padding:16px;background:linear-gradient(137deg,rgba(21,26,52,.88),rgba(35,16,43,.77));box-shadow:inset 0 1px 0 rgba(255,255,255,.035)}
      .pir-root .pir-head{display:flex;align-items:center;justify-content:space-between;gap:9px;margin-bottom:14px}
      .pir-root .pir-head>div{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
      .pir-root .pir-head strong{font-size:16px;font-weight:800;color:#f4f5ff}
      .pir-root .pir-head span:not(.pir-spark){font-size:11px;color:#8291af}
      .pir-root .pir-spark{color:#ee73cd;font-size:20px}
      .pir-root .pir-label{color:#91a2c0;font-size:10px;text-transform:uppercase;letter-spacing:.085em}
      .pir-root .pir-overview{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));margin-bottom:14px;padding:11px 6px;border-radius:16px;border:1px solid rgba(205,85,214,.35);background:linear-gradient(115deg,rgba(17,24,48,.88),rgba(45,18,49,.75))}
      .pir-root .pir-stat{padding:4px 14px;min-width:0;display:flex;flex-direction:column;gap:4px;border-right:1px solid rgba(169,181,213,.12)}
      .pir-root .pir-stat:last-child{border:0}
      .pir-root .pir-stat b{font-size:21px;letter-spacing:-.035em;line-height:1.2;overflow-wrap:anywhere}
      .pir-root .pir-stat small{font-size:10px;color:#8291af}
      .pir-root .pir-top-grid{display:grid;grid-template-columns:minmax(260px,.9fr) minmax(0,1.4fr);gap:12px;margin-bottom:12px}
      .pir-root .pir-platforms{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
      .pir-root .pir-platform{cursor:pointer;text-align:left;min-width:0;border:1px solid color-mix(in srgb,var(--pir-accent) 38%,transparent);border-radius:13px;padding:13px;background:linear-gradient(155deg,rgba(31,34,63,.92),rgba(12,19,37,.92));color:#eaf1ff;transition:transform .15s,border-color .15s,box-shadow .15s}
      .pir-root .pir-platform:hover,.pir-root .pir-platform:focus-visible{transform:translateY(-2px);border-color:var(--pir-accent);box-shadow:0 6px 23px color-mix(in srgb,var(--pir-accent) 14%,transparent)}
      .pir-root .pir-platform-top{display:flex;align-items:center;gap:7px;font-size:12px;min-width:0}
      .pir-root .pir-platform-top strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .pir-root .pir-platform-symbol{display:grid;place-items:center;border-radius:50%;border:1px solid var(--pir-accent);color:var(--pir-accent);font-weight:800;width:27px;height:27px;flex-shrink:0}
      .pir-root .pir-crown{margin-left:auto;font-size:9px;color:#f4ca72}
      .pir-root .pir-platform-value{font-weight:800;font-size:23px;margin-top:15px;letter-spacing:-.03em}
      .pir-root .pir-platform-meta{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px;margin:5px 0 12px;color:#a5b3cd;font-size:10px}
      .pir-root .pir-positive{color:#28d89e!important}.pir-root .pir-negative{color:#ff738a!important}.pir-root .pir-faint{color:#8190a9!important}
      .pir-root .pir-track{height:7px;border-radius:10px;overflow:hidden;background:#24334c;min-width:0}
      .pir-root .pir-track>div{height:100%;border-radius:10px}
      .pir-root .pir-platform-foot{display:flex;justify-content:space-between;gap:5px;flex-wrap:wrap;margin-top:13px;font-size:10px;color:#9babc7}
      .pir-root .pir-platform-foot b{color:#eff3ff;font-size:12px}
      .pir-root .pir-discover{border-color:rgba(238,84,200,.45);box-shadow:0 0 18px rgba(216,72,180,.085)}
      .pir-root .pir-discovery-list{display:grid;gap:8px}
      .pir-root .pir-discovery{padding:11px 10px;display:flex;align-items:flex-start;gap:9px;border-radius:10px;border:1px solid rgba(169,181,213,.13);background:rgba(14,19,38,.55);font-size:12px;line-height:1.5}
      .pir-root .pir-discovery-dot{color:#ec75cd;flex-shrink:0}
      .pir-root .pir-footnote{font-size:10px;line-height:1.5;color:#8292ad;margin-top:12px}
      .pir-root .pir-content-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(280px,.85fr);gap:12px;margin-bottom:12px}
      .pir-root .pir-side{display:grid;gap:12px}
      .pir-root .pir-switches{display:flex;gap:6px;margin-bottom:15px}
      .pir-root .pir-switches button{border:1px solid #34435f;border-radius:8px;padding:7px 11px;background:rgba(15,24,42,.65);color:#9facbf;cursor:pointer;font-size:11px}
      .pir-root .pir-switches button.active{border-color:#28d8f1;color:#30d9ef;background:rgba(30,151,194,.12)}
      .pir-root .pir-trend-grid{display:grid;gap:13px}.pir-root .pir-trend-name{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:650}
      .pir-root .pir-trend-name>span:first-child{display:block;width:8px;height:8px;border-radius:50%}.pir-root .pir-trend-name>span:last-child{margin-left:auto;font-size:10px}
      .pir-root .pir-paired{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:7px}
      .pir-root .pir-paired>div{display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center}
      .pir-root .pir-paired small{grid-column:1/-1;color:#8191ae;font-size:10px}
      .pir-root .pir-paired b{font-size:10px;font-weight:600}
      .pir-root .pir-audience-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}
      .pir-root .pir-audience-stats .pir-stat{padding:0 8px}.pir-root .pir-audience-stats .pir-stat b{font-size:20px}
      .pir-root .pir-fan-risk,.pir-root .pir-locked{font-size:11px;color:#e7c4de;background:rgba(228,98,182,.08);border-radius:8px;padding:8px;margin-top:10px}
      .pir-root .pir-time-list{display:grid;gap:8px}.pir-root .pir-time-row{display:grid;grid-template-columns:1fr auto;gap:2px 8px;border:1px solid rgba(173,147,219,.2);padding:9px;border-radius:9px;font-size:11px}
      .pir-root .pir-time-row b{color:#ecbdf0}.pir-root .pir-time-row small{color:#8798b7;grid-column:1/-1}
      .pir-root .pir-milestone-list{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
      .pir-root .pir-milestone{display:flex;gap:9px;border:1px solid rgba(171,150,207,.19);border-radius:12px;background:rgba(20,22,44,.62);padding:12px}
      .pir-root .pir-milestone>span{color:#f5a8e2}.pir-root .pir-milestone b{display:block;font-size:12px}.pir-root .pir-milestone small{display:block;color:#8595b3;font-size:10px;margin-top:5px}
      .pir-root .pir-efficiency{display:grid;gap:8px}.pir-root .pir-eff-row{display:grid;grid-template-columns:1fr auto;gap:3px;font-size:12px;padding:9px;border:1px solid rgba(170,185,217,.12);border-radius:8px}.pir-root .pir-eff-row small{grid-column:1/-1;color:#8292ae}
      .pir-root .pir-empty{border:1px dashed rgba(155,171,207,.25);padding:16px;border-radius:12px;color:#a1b2ce;font-size:12px;line-height:1.5}
      @media(max-width:1120px){.pir-root .pir-top-grid,.pir-root .pir-content-grid{grid-template-columns:1fr}.pir-root .pir-overview{grid-template-columns:repeat(3,minmax(0,1fr))}.pir-root .pir-platforms{grid-template-columns:repeat(3,minmax(0,1fr))}}
      @media(max-width:670px){.pir-root .pir-overview{grid-template-columns:repeat(2,minmax(0,1fr))}.pir-root .pir-platforms,.pir-root .pir-milestone-list{grid-template-columns:1fr}.pir-root .pir-audience-stats .pir-stat b{font-size:16px}}
    `}</style>
    <div className="pir-overview">
      <Stat label="Platform earnings" value={money(snapshot.totalEarnings)} sub="Meaningful sessions"/>
      <Stat label="Estimated $/hour" value={snapshot.usdPerHour==null?'—':money(snapshot.usdPerHour)} sub="Qualified duration only" accent="#2ed6e8"/>
      <Stat label="Observed hours" value={snapshot.totalHours>0?snapshot.totalHours.toFixed(1)+'h':'—'} sub="Imported spans are estimates"/>
      <Stat label="Revenue leader" value={leader.platform} sub={leader.earningsPercent+'% of displayed earnings'} accent={colorFor(leader.platform)}/>
      <Stat label="Platforms" value={number(snapshot.platformCount)} sub="With eligible history"/>
    </div>
    <div className="pir-top-grid">
      <Discovery insights={insights}/>
      <Card><Heading note="Select a platform to view its deeper history">Platform Performance</Heading><PlatformCards comparison={comparison} onSelect={onSelectPlatform}/></Card>
    </div>
    <div className="pir-content-grid">
      <Historical comparison={comparison}/>
      <div className="pir-side"><Audience fans={fans} comparison={comparison}/><Timing timeIntel={timeIntel} comparison={comparison} isPro={isPro}/></div>
    </div>
    <Milestones coverage={coverage} comparison={comparison}/>
  </div>
}
