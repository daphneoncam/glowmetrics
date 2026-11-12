'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
// Token rates — single source of truth, never hardcode below this line
import { PLATFORM_TOKEN_RATES, tokenRate, PRO_PRICE_MONTHLY_LABEL } from '../../lib/constants'
import { track } from '../../lib/track'
import { isProPlan, TRIAL_DAYS } from '../../lib/plan'
import { FREE_MAX_PLATFORMS } from '../../lib/planLimits'
import OnboardingExitSurvey from '@/components/OnboardingExitSurvey'


const PLATFORMS = {
  chaturbate:{
    label:'Chaturbate',short:'CB',
    iconStyle:{background:'#F05A2A',color:'#fff'},
    instructions:'Go to your profile → Token Stats tab. Select All Time. Highlight the table, copy, and paste below.',
    earningsUrl:(u)=>u?`https://chaturbate.com/p/${u}/?tab=tokens`:'https://chaturbate.com/accounts/settings/',
    placeholder:'Paste your Chaturbate tip history here...\n\nExample:\nJun 18, 2026, 8:27 PM\nTip From: username123\n500  12345\n\nJun 18, 2026, 9:14 PM\nTip From: whaleking99\n1000  12346',
  },
  bongacams:{
    label:'BongaCams',short:'BC',
    iconStyle:{background:'#311222',color:'#FF3B6E',border:'1px solid rgba(255,59,110,0.25)'},
    instructions:'Go to Reports → General. Select your date range. Highlight all rows, copy, and paste below. You can also paste your Paid Chat section separately.',
    earningsUrl:()=>'https://bongamodels.com/reports/general',
    placeholder:'Paste your BongaCams tip history here...\n\nExample:\n18.06.2026 14:32\tusername123\t500\t25.00\n18.06.2026 15:14\twhaleking99\t1000\t50.00\n18.06.2026 15:45\tregularfan\t25\t1.25',
  },
  myfreecams:{
    label:'MyFreeCams',short:'MFC',
    iconStyle:{background:'#2D2226',color:'#FF8B2C',border:'1px solid rgba(255,139,44,0.25)'},
    instructions:'Go to Token Sessions. Set your date range, highlight all rows, copy and paste below.',
    earningsUrl:()=>'https://profiles.myfreecams.com/_/ext/token_sessions',
    placeholder:'Paste your MyFreeCams tip history here...\n\nExample:\n1746555770\tJun 18th, 2026 10:40 PM\t500\tusername123\tTip\n1746555771\tJun 18th, 2026 11:02 PM\t1000\twhaleking99\tTip',
  },
}

// Token rates come from lib/constants.js — do not define here
const TOKEN_RATES = {
  chaturbate: PLATFORM_TOKEN_RATES.Chaturbate,
  bongacams:  PLATFORM_TOKEN_RATES.BongaCams,
  myfreecams: PLATFORM_TOKEN_RATES.MyFreeCams,
}
const LOADING_MESSAGES=['Cleaning your tip history…','Finding your top fans…','Calculating your average earnings per hour…','Detecting your best stream windows…','Building your dashboard…']
const EXTRA_MSGS=['Importing additional tip history…','Merging with your dashboard…','Updating your insights…']

// BongaCams paid chat session types
const BC_PAID_TYPES=['Private Chat','Full-Private Chat','Group Chat','Spy Mode']

// ── Parsers ────────────────────────────────────────────────────
function tryParseDate(str){
  if(!str)return null;const s=str.trim()
  const cbMatch=s.match(/^([A-Za-z]{3})\s+(\d{1,2})(?:st|nd|rd|th)?,\s+(\d{4}),\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i)
  if(cbMatch){const[,mon,day,year,hr,min,ampm]=cbMatch;const months={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};let h=parseInt(hr,10);if(ampm.toUpperCase()==='PM'&&h!==12)h+=12;if(ampm.toUpperCase()==='AM'&&h===12)h=0;const d=new Date(parseInt(year),months[mon.toLowerCase()],parseInt(day),h,parseInt(min));if(!isNaN(d.getTime()))return d}
  const bcMatch=s.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/)
  if(bcMatch){const[,day,mon,year,hr,min]=bcMatch;const d=new Date(parseInt(year),parseInt(mon)-1,parseInt(day),parseInt(hr),parseInt(min));if(!isNaN(d.getTime()))return d}
  // Ordinal suffix optional, matching the Chaturbate branch above — MFC
  // renders both "Aug 1, 2026" and "Aug 1st, 2026" depending on the view,
  // and the required-suffix version silently fell through to `new Date(s)`.
  const mfcMatch=s.match(/^([A-Za-z]{3})\s+(\d{1,2})(?:st|nd|rd|th)?,\s+(\d{4})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i)
  if(mfcMatch){const[,mon,day,year,hr,min,ampm]=mfcMatch;const months={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};let h=parseInt(hr,10);if(ampm.toUpperCase()==='PM'&&h!==12)h+=12;if(ampm.toUpperCase()==='AM'&&h===12)h=0;const d=new Date(parseInt(year),months[mon.toLowerCase()],parseInt(day),h,parseInt(min));if(!isNaN(d.getTime()))return d}
  const d=new Date(s);if(!isNaN(d.getTime()))return d;return null
}

// A column is only safe to treat as a token/usd number if it is numeric in
// its ENTIRETY (after stripping $, commas, whitespace) — parseFloat() alone
// parses a leading numeric prefix and ignores the rest (parseFloat('21yeacock')
// === 21, parseFloat('93marian') === 93), which silently misclassifies a
// numeric-leading username as a token/usd value instead of the username. That
// shifts every later column in the row (the real username is lost, the
// transaction-type column — e.g. "Tips" — gets used as the username instead,
// and tokens/usd end up swapped), collapsing every affected fan into one fake
// bucket and inflating totals. Confirmed against a real 1912-row BongaCams
// export: 4 numeric-leading usernames ("21yeacock", "93marian", "85hn5n",
// "141414av2") all collapsed into a single fake "Tips" fan, undercounting
// unique fans (315 vs the real 318) and overstating total revenue by ~$78
// (their real token counts were misassigned into the usd field).
function isFullyNumeric(str){
  return /^-?\d+(\.\d+)?$/.test((str||'').replace(/[$,\s]/g,'').trim())
}

// Detects if a BongaCams tab-separated row is a paid chat session
// Returns session_type string or null
function detectBCPaidRow(cols){
  if(!cols||cols.length<4)return null
  for(const t of BC_PAID_TYPES){
    if(cols.some(c=>c.trim()===t))return t
  }
  return null
}

// Parse BongaCams paid chat rows into paid_session objects
function parseBCPaidSessions(rawText){
  const lines=rawText.split('\n').map(l=>l.trim()).filter(Boolean)
  const sessions=[];let skipped=0
  const headerKw=['date','time','member','chat','type','tokens','payout','earned']
  for(const line of lines){
    const cols=line.split(/\t/).map(c=>c.trim().replace(/^"|"$/g,''))
    if(cols.length<4){skipped++;continue}
    const lower=cols.map(c=>c.toLowerCase())
    if(lower.filter(c=>headerKw.some(k=>c.includes(k))).length>=2)continue
    const sessionType=detectBCPaidRow(cols)
    if(!sessionType){skipped++;continue}
    let ts=null,username=null,tokens=0,usd=0
    for(const col of cols){
      const d=tryParseDate(col)
      if(d&&!ts){ts=d;continue}
      if(col===sessionType)continue
      // Strip $, comma, AND whitespace (incl. NBSP/narrow-NBSP thousands
      // separators like BongaCams' "1 507") before parsing — parseFloat
      // otherwise stops at the first non-numeric character and silently
      // truncates e.g. "1 507" tokens down to 1.
      const n=isFullyNumeric(col)?parseFloat(col.replace(/[$,\s]/g,'')):NaN
      if(!isNaN(n)&&n>0){
        if(Number.isInteger(n)&&n<100000&&tokens===0)tokens=Math.round(n)
        else if(n<50000&&usd===0)usd=n
      } else if(col.length>1&&col.length<=50&&!isFullyNumeric(col)&&!username){
        username=col
      }
    }
    if(!ts||!username||tokens<1){skipped++;continue}
    sessions.push({ts,username,sessionType,tokens,usd:usd>0?usd:+(tokens*tokenRate('BongaCams')).toFixed(4)})
  }
  return{sessions,skipped}
}

function parseRows(rawText,platformId){
  const rate=TOKEN_RATES[platformId]||0.05
  const lines=rawText.split('\n').map(l=>l.trim()).filter(Boolean)
  const rows=[];let skipped=0
  const dateLineRe=/^([A-Za-z]{3}\s+\d{1,2}(?:st|nd|rd|th)?,\s+\d{4},\s+\d{1,2}:\d{2}\s+[AP]M)/i
  const tipFromRe=/^Tip From:\s*(.+)/i
  // Two numbers ("tokens  running_balance"), each allowing a thousands-comma
  // (e.g. "500  12,345") — same bug class already fixed for BongaCams
  // (scripts/verify-bongacams-tokens-thousands-separator.mjs). Kept in
  // lockstep with lib/analytics.js's CB_TOKENS_LINE_RE/CB_TOKENS_SINGLE_RE
  // (the server-side parser /api/upload actually uses) so this preview
  // never shows a row count the real import can't reproduce.
  const tokensLineRe=/^([\d,]+)\s+([\d,]+)$/
  const tokensSingleRe=/^([\d,]+)$/
  const isMultiLine=lines.some(l=>tipFromRe.test(l))
  if(isMultiLine){
    let i=0
    while(i<lines.length){
      const dateMatch=lines[i].match(dateLineRe)
      if(dateMatch){
        const ts=tryParseDate(dateMatch[1]);const actionLine=lines[i+1]||'';const tipMatch=actionLine.match(tipFromRe)
        if(ts&&tipMatch){
          const username=tipMatch[1].trim();let tokensLine=lines[i+2]||'';let note=''
          let tMatch=tokensLine.match(tokensLineRe)
          let singleMatch=!tMatch?tokensLine.match(tokensSingleRe):null
          if(!tMatch&&!singleMatch&&lines[i+3]){
            note=tokensLine;tokensLine=lines[i+3]||''
            tMatch=tokensLine.match(tokensLineRe)
            singleMatch=!tMatch?tokensLine.match(tokensSingleRe):null
          }
          const tokensRaw=tMatch?tMatch[1]:(singleMatch?singleMatch[1]:null)
          if(tokensRaw){const tokens=parseInt(tokensRaw.replace(/,/g,''),10);if(tokens>=1){const usd=+(tokens*rate).toFixed(2);rows.push({ts,username,tokens,usd,note})}else skipped++}else skipped++
        }
        i++
      }else i++
    }
    return{rows,skipped}
  }
  const headerKw=['date','time','user','token','usd','tip','amount','note','message','from','type','stamp','earning','reference','private','voyeur','group','xfer','returned','fines','total','mfc','away','club','display','sort','period','payment','month','search']
  for(const line of lines){
    const cols=line.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c=>c.trim().replace(/^"|"$/g,''))
    // Skip reference IDs (MFC format — long numeric first column)
    if(cols[0]&&/^\d{8,}$/.test(cols[0].trim()))cols.shift()
    if(cols.length<2){skipped++;continue}
    const lower=cols.map(c=>c.toLowerCase())
    if(lower.filter(c=>headerKw.some(k=>c.includes(k))).length>=2)continue
    // Skip BongaCams paid chat rows from the free tips parser
    if(detectBCPaidRow(cols)){skipped++;continue}
    let ts=null,tsIdx=-1
    for(let i=0;i<cols.length;i++){const d=tryParseDate(cols[i]);if(d){ts=d;tsIdx=i;break}}
    if(!ts){skipped++;continue}
    const rest=cols.filter((_,i)=>i!==tsIdx)
    let tokens=null,usd=null,username=null,note=''
    for(const col of rest){
      const n=isFullyNumeric(col)?parseFloat(col.replace(/[$,]/g,'')):NaN
      if(!isNaN(n)&&n>0){
        if(Number.isInteger(n)&&n>=1&&n<100000&&tokens===null)tokens=n
        else if(!Number.isInteger(n)&&n<5000&&usd===null)usd=n
        else if(Number.isInteger(n)&&n>=1&&n<100000&&tokens===null)tokens=n
        // A whole-dollar payout (e.g. "9.00") parses to an integer and
        // matched neither branch above once tokens was already found —
        // silently dropping a real trusted payout in favor of a token-rate
        // estimate. Once tokens is known and usd isn't, treat the next
        // positive number as the real payout regardless of its integer-ness.
        else if(tokens!==null&&usd===null)usd=n
      }else if(col.length>0&&!isFullyNumeric(col)){
        if(username===null&&col.length<=50&&col.length>1)username=col
        else if(note===''&&col.length>0)note=col
      }
    }
    if(!tokens||tokens<1){skipped++;continue}
    if(!usd)usd=+(tokens*rate).toFixed(2)
    rows.push({ts,username:username||'anonymous',tokens,usd,note})
  }
  return{rows,skipped}
}

function pasteToCSVBlob(rawText,platformId){
  const{rows,skipped}=parseRows(rawText,platformId)
  const csvRows=['date_time,username,tokens,usd,note']
  for(const r of rows){const isoTs=r.ts.toISOString().replace('T',' ').slice(0,19);csvRows.push(`${isoTs},${r.username.replace(/,/g,'')},${r.tokens},${r.usd},${r.note.replace(/,/g,'')}`)}
  return{blob:new Blob([csvRows.join('\n')],{type:'text/csv'}),rowCount:rows.length,skipped}
}

// Convert paid sessions to CSV blob for upload via /api/upload-paid-sessions
function paidSessionsToCSVBlob(sessions){
  const csvRows=['date_time,username,session_type,tokens,usd']
  for(const s of sessions){
    const isoTs=s.ts.toISOString().replace('T',' ').slice(0,19)
    csvRows.push(`${isoTs},${s.username.replace(/,/g,'')},${s.sessionType.replace(/,/g,'')},${s.tokens},${s.usd}`)
  }
  return new Blob([csvRows.join('\n')],{type:'text/csv'})
}

function buildPreview(rawText,platformId,platformLabel){
  const{rows,skipped}=parseRows(rawText,platformId)

  // Also detect paid sessions for BongaCams so we can show them in preview
  let paidSessions=[]
  if(platformId==='bongacams'){
    const res=parseBCPaidSessions(rawText)
    paidSessions=res.sessions
  }

  if(!rows.length&&!paidSessions.length)return null
  const totalUsd=rows.reduce((s,r)=>s+r.usd,0)
  const paidUsd=paidSessions.reduce((s,r)=>s+r.usd,0)
  const allRows=[...rows,...paidSessions.map(s=>({...s,ts:s.ts,username:s.username,tokens:s.tokens,usd:s.usd}))]
  const fans=new Set([...rows,...paidSessions].map(r=>(r.username||'').toLowerCase().trim()).filter(Boolean)).size
  const dates=allRows.map(r=>r.ts).sort((a,b)=>a-b)
  const topSpender=Object.entries(allRows.reduce((acc,r)=>{acc[r.username]=(acc[r.username]||0)+r.tokens;return acc},{})).sort((a,b)=>b[1]-a[1])[0]
  const hourCounts=allRows.reduce((acc,r)=>{const h=r.ts.getHours();acc[h]=(acc[h]||0)+r.tokens;return acc},{})
  const bestHour=Object.entries(hourCounts).sort((a,b)=>b[1]-a[1])[0]
  const fmtHour=h=>{const n=parseInt(h);return n===0?'12am':n<12?`${n}am`:n===12?'12pm':`${n-12}pm`}
  return{
    tipsDetected:rows.length,
    paidSessionsDetected:paidSessions.length,
    paidSessions,
    estimatedEarnings:+(totalUsd+paidUsd).toFixed(2),
    paidEarnings:+paidUsd.toFixed(2),
    fansDetected:fans,
    dateRange:dates.length?`${dates[0].toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${dates[dates.length-1].toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`:'—',
    topSpender:topSpender?{name:topSpender[0],tokens:topSpender[1]}:null,
    bestHour:bestHour?fmtHour(bestHour[0]):null,
    sampleRows:rows.slice(0,5).map(r=>({date:r.ts.toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}),fan:r.username,tokens:r.tokens,amount:r.usd,platform:platformLabel})),
  }
}

// Zero-rows diagnostic — replaces the old one-size-fits-all "we couldn't
// find any tip rows" message with a specific reason, based on exactly how
// far the parse got. Chaturbate's multi-line format was 49 of 56
// onboarding_paste_parse_failed events (by far the dominant one), so it
// gets the most granular checks; the columnar platforms get a simpler
// but still specific check.
// Structural fingerprint of a failed paste — the missing half of the failure
// telemetry. onboarding_paste_parse_failed has fired for 8 separate users and
// every event recorded only WHICH platform failed, never WHAT shape the text
// was, so each failure had to be guessed at instead of fixed. (The Chaturbate
// fix in #411 only happened because a real sample turned up separately.)
//
// Deliberately privacy-preserving: every digit becomes 9 and every letter
// becomes a, so "Aug 11, 2026, 07:04 AM" -> "aaa 99, 9999, 99:99 aa" and
// "Tip From: sexyguy99" -> "aaa aaaa: aaaaaaa99". Usernames, token amounts,
// dollar figures and notes cannot be reconstructed from this — only the
// layout, which is the only part we need to write a parser against.
function fingerprintPaste(rawText){
  const lines=rawText.split('\n').map(l=>l.trim()).filter(Boolean)
  const shape=l=>l.replace(/[0-9]/g,'9').replace(/[A-Za-z]/g,'a').slice(0,60)
  const counts=new Map()
  for(const l of lines.slice(0,80)){
    const sh=shape(l)
    counts.set(sh,(counts.get(sh)||0)+1)
  }
  const top=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10)
  return {
    line_count:lines.length,
    distinct_shapes:counts.size,
    has_tabs:rawText.includes('\t'),
    has_commas:rawText.includes(','),
    top_shapes:top.map(([sh,n])=>`${n}x ${sh}`),
  }
}

function diagnosePasteFailure(rawText,platformId){
  const lines=rawText.split('\n').map(l=>l.trim()).filter(Boolean)
  if(!lines.length)return 'Paste your tip history above first.'
  if(platformId==='chaturbate'){
    const dateLineRe=/^([A-Za-z]{3}\s+\d{1,2}(?:st|nd|rd|th)?,\s+\d{4},\s+\d{1,2}:\d{2}\s+[AP]M)/i
    const tipFromRe=/^Tip From:\s*(.+)/i
    const hasDateLines=lines.some(l=>dateLineRe.test(l))
    const hasTipFromLines=lines.some(l=>tipFromRe.test(l))
    if(!hasDateLines&&!hasTipFromLines)return "We couldn't recognize this as Chaturbate's Token Stats format. Go to your profile → Token Stats tab, select All Time, then copy the whole table (dates, \"Tip From:\" lines, and token amounts together)."
    if(hasDateLines&&!hasTipFromLines)return 'We found dates but no "Tip From:" lines. Make sure you copied the full table, not just the date column.'
    if(!hasDateLines&&hasTipFromLines)return "We found tip lines but couldn't read the dates next to them. Make sure each tip's date/time line is included above its \"Tip From:\" line."
    return "We found tips and dates but couldn't read the token amounts. Make sure the token number (and running balance, if shown) directly follows each \"Tip From:\" line, unedited."
  }
  // Columnar platforms (BongaCams, MyFreeCams, generic CSV) — at least one
  // recognizable date/timestamp is the minimum bar; below that, nothing
  // else in the row can be trusted either.
  const hasAnyDateLike=lines.some(l=>tryParseDate(l.split(/\t|,/)[0]||l))
  if(!hasAnyDateLike)return "We couldn't find any recognizable dates in what you pasted. Make sure each row includes its date/time, and that rows are separated by line breaks the way they appear on the page."
  return "We found rows but couldn't read the token/dollar amounts. Make sure you copied the full table, including the amount columns, without extra edits."
}

// ── Ambient particle canvas ────────────────────────────────────
function AmbientParticles(){
  const ref=useRef()
  useEffect(()=>{
    const c=ref.current;if(!c)return
    const ctx=c.getContext('2d')
    const resize=()=>{c.width=window.innerWidth;c.height=window.innerHeight}
    resize();window.addEventListener('resize',resize)
    const COLS=['rgba(33,230,243,','rgba(255,47,174,','rgba(139,92,246,','rgba(255,255,255,']
    const pts=Array.from({length:55},()=>({
      x:Math.random()*c.width,y:Math.random()*c.height,
      r:Math.random()*1.5+0.3,
      col:COLS[Math.floor(Math.random()*COLS.length)],
      alpha:Math.random()*0.5+0.1,
      aDir:Math.random()>0.5?1:-1,
      aSpd:Math.random()*0.008+0.003,
      vx:(Math.random()-0.5)*0.18,
      vy:(Math.random()-0.5)*0.18,
    }))
    let raf
    const draw=()=>{
      ctx.clearRect(0,0,c.width,c.height)
      pts.forEach(p=>{
        p.x+=p.vx;p.y+=p.vy
        p.alpha+=p.aDir*p.aSpd
        if(p.alpha>=0.65){p.alpha=0.65;p.aDir=-1}
        if(p.alpha<=0.05){p.alpha=0.05;p.aDir=1}
        if(p.x<-4)p.x=c.width+4;if(p.x>c.width+4)p.x=-4
        if(p.y<-4)p.y=c.height+4;if(p.y>c.height+4)p.y=-4
        ctx.beginPath()
        ctx.arc(p.x,p.y,p.r,0,Math.PI*2)
        ctx.fillStyle=`${p.col}${p.alpha.toFixed(2)})`
        ctx.fill()
        if(p.alpha>0.4&&p.r>1){
          ctx.strokeStyle=`${p.col}${(p.alpha*0.4).toFixed(2)})`
          ctx.lineWidth=0.5
          ctx.beginPath();ctx.moveTo(p.x-p.r*2.5,p.y);ctx.lineTo(p.x+p.r*2.5,p.y);ctx.stroke()
          ctx.beginPath();ctx.moveTo(p.x,p.y-p.r*2.5);ctx.lineTo(p.x,p.y+p.r*2.5);ctx.stroke()
        }
      })
      raf=requestAnimationFrame(draw)
    }
    raf=requestAnimationFrame(draw)
    return()=>{cancelAnimationFrame(raf);window.removeEventListener('resize',resize)}
  },[])
  return<canvas ref={ref} style={{position:'fixed',top:0,left:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:1}}/>
}

// ── Sparkle burst (completion) ─────────────────────────────────
function Sparkle(){
  const ref=useRef()
  useEffect(()=>{
    const c=ref.current;if(!c)return
    const ctx=c.getContext('2d');c.width=window.innerWidth;c.height=window.innerHeight
    const COLS=['#21E6F3','#ffffff','#FF2FAE','#a78bfa','#6C5CFF']
    const dots=Array.from({length:38},()=>({x:Math.random()*c.width,y:Math.random()*c.height,r:Math.random()*2.2+0.4,color:COLS[Math.floor(Math.random()*COLS.length)],alpha:Math.random()*0.9+0.1,aDir:Math.random()>0.5?1:-1,aSpd:Math.random()*0.025+0.008,vx:(Math.random()-0.5)*0.3,vy:(Math.random()-0.5)*0.3}))
    let frame=0,raf
    const draw=()=>{
      ctx.clearRect(0,0,c.width,c.height)
      dots.forEach(d=>{
        d.x+=d.vx;d.y+=d.vy;d.alpha+=d.aDir*d.aSpd
        if(d.alpha>=1){d.alpha=1;d.aDir=-1}if(d.alpha<=0){d.alpha=0;d.aDir=1}
        if(d.x<-4)d.x=c.width+4;if(d.x>c.width+4)d.x=-4;if(d.y<-4)d.y=c.height+4;if(d.y>c.height+4)d.y=-4
        ctx.save();ctx.globalAlpha=d.alpha;ctx.translate(d.x,d.y);ctx.fillStyle=d.color
        const s=d.r;ctx.beginPath();ctx.moveTo(0,-s*2.5);ctx.lineTo(s*0.5,-s*0.5);ctx.lineTo(s*2.5,0);ctx.lineTo(s*0.5,s*0.5);ctx.lineTo(0,s*2.5);ctx.lineTo(-s*0.5,s*0.5);ctx.lineTo(-s*2.5,0);ctx.lineTo(-s*0.5,-s*0.5);ctx.closePath();ctx.fill();ctx.restore()
      })
      frame++;if(frame<200)raf=requestAnimationFrame(draw);else{let op=1;const fade=()=>{op-=0.05;ctx.globalAlpha=op;if(op>0)requestAnimationFrame(fade);else ctx.clearRect(0,0,c.width,c.height)};fade()}
    }
    raf=requestAnimationFrame(draw);return()=>cancelAnimationFrame(raf)
  },[])
  return<canvas ref={ref} style={{position:'fixed',top:0,left:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:9999}}/>
}

// ── CountUp ────────────────────────────────────────────────────
function CountUp({to,prefix='',suffix='',duration=1000,decimals=0}){
  const[val,setVal]=useState(0)
  useEffect(()=>{
    const start=Date.now()
    const tick=()=>{const p=Math.min((Date.now()-start)/duration,1);const e=1-Math.pow(1-p,3);const v=e*to;setVal(decimals?+v.toFixed(decimals):Math.round(v));if(p<1)requestAnimationFrame(tick)}
    requestAnimationFrame(tick)
  },[to,duration,decimals])
  return<>{prefix}{decimals?val.toFixed(decimals):val.toLocaleString()}{suffix}</>
}

// ── Pro Upsell Modal ───────────────────────────────────────────
function ProUpsellModal({platform,onSkip}){
  const router=useRouter()
  return(
    <div style={{position:'fixed',inset:0,zIndex:9998,background:'rgba(3,5,15,0.92)',backdropFilter:'blur(12px)',display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{width:'100%',maxWidth:520,background:'linear-gradient(180deg,rgba(12,15,35,0.98),rgba(6,8,20,0.99))',borderRadius:24,boxShadow:'0 0 60px rgba(33,230,243,0.15),0 0 120px rgba(255,47,174,0.1)',border:'1px solid rgba(255,255,255,0.08)',padding:28}}>
        <div style={{textAlign:'center',marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:900,letterSpacing:'0.1em',textTransform:'uppercase',color:'#a78bfa',marginBottom:8}}>Unlock All Platforms</div>
          <h2 style={{fontSize:20,fontWeight:900,color:'#fff',marginBottom:6}}>You're adding {platform.label}</h2>
          <p style={{fontSize:13,color:'rgba(148,163,184,0.8)',lineHeight:1.6}}>Free tracks up to {FREE_MAX_PLATFORMS} platforms. Upgrade to sync more and see your full earnings picture.</p>
        </div>
        <div style={{marginBottom:12}}>
          <div style={{background:'rgba(167,139,250,0.08)',border:'1.5px solid rgba(167,139,250,0.4)',borderRadius:14,padding:16,position:'relative'}}>
            <div style={{fontSize:11,color:'#a78bfa',fontWeight:700,marginBottom:6,textTransform:'uppercase'}}>Creator Pro</div>
            <div style={{fontSize:24,fontWeight:900,color:'#fff'}}>$19.99</div>
            <div style={{fontSize:11,color:'rgba(148,163,184,0.7)',marginBottom:12}}>/month · or $99/year</div>
            {['All platforms','Full history analysed','AI pattern learning','Fan behavior analysis'].map(f=>(<div key={f} style={{display:'flex',gap:6,alignItems:'center',fontSize:12,color:'rgba(203,213,225,0.9)',marginBottom:4}}><span style={{color:'#a78bfa'}}>✓</span>{f}</div>))}
            <button onClick={()=>router.push('/pricing')} style={{width:'100%',marginTop:12,padding:'10px',borderRadius:10,border:'none',cursor:'pointer',background:'linear-gradient(135deg,#a78bfa,#7c3aed)',color:'#fff',fontSize:13,fontWeight:700}}>Upgrade to Pro →</button>
          </div>
        </div>
        <div style={{background:'rgba(33,230,243,0.06)',border:'1px solid rgba(33,230,243,0.15)',borderRadius:10,padding:'10px 14px',marginBottom:14,fontSize:12,color:'rgba(148,163,184,0.8)',textAlign:'center'}}>
          ✅ <span style={{color:'#fff'}}>Nothing is locked during your trial</span> — every platform and every insight is included for 7 days.
        </div>
        <div style={{textAlign:'center'}}><button onClick={onSkip} style={{background:'none',border:'none',fontSize:12,color:'rgba(100,116,139,0.7)',cursor:'pointer',textDecoration:'underline'}}>Skip for now — continue with one platform</button></div>
      </div>
    </div>
  )
}

// ── Live Mode Demo ─────────────────────────────────────────────
function LiveModeDemo({onContinue,isPro=false}){
  const PROMPTS=[{icon:'🐋',title:'Greet Returning Fan',body:'whaleking99 just entered. He tipped $180 last stream. Say hi by name.',impact:'+$40 avg when acknowledged'},{icon:'💡',title:'Mention Your Tip Menu',body:'22 active viewers, no tip in 7 min. Mention your toy or wheel menu.',impact:'+34% tip rate after prompt'},{icon:'🎯',title:'Refresh the Room Goal',body:'Tips slowed down. Try a smaller, faster goal to restart momentum.',impact:'Recovers dead zones in ~4 min'}]
  const[idx,setIdx]=useState(0)
  useEffect(()=>{const t=setInterval(()=>setIdx(i=>(i+1)%PROMPTS.length),3500);return()=>clearInterval(t)},[])
  const cur=PROMPTS[idx]
  return(
    <div style={{animation:'fadeUp 0.3s ease both'}}>
      <div style={{textAlign:'center',marginBottom:14}}>
        <div style={EYE}>Live Mode Preview</div>
        <h1 style={{fontSize:20,fontWeight:900,color:'#fff',letterSpacing:'-0.02em',marginBottom:6}}>CamCash during your stream</h1>
        <p style={{fontSize:13,color:'rgba(166,168,189,0.85)',lineHeight:1.6}}>While you stream, CamCash watches your room and tells you exactly what to do to earn more.</p>
      </div>
      <div style={{background:'rgba(4,6,18,0.9)',border:'1px solid rgba(33,230,243,0.2)',borderRadius:16,padding:16,marginBottom:12,position:'relative',overflow:'hidden'}}>
        <div style={{position:'absolute',top:0,left:0,right:0,height:2,background:'linear-gradient(90deg,transparent,#21E6F3,#6C5CFF,#FF2FAE,transparent)',animation:'shimmer 2.5s linear infinite'}}/>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:12}}>
          {[{label:'Live Score',value:'82/100',color:'#21E6F3'},{label:'Earnings/hr',value:'$124/hr',color:'#4ade80'},{label:'Prompts',value:'5/7',color:'#a78bfa'}].map(s=>(<div key={s.label} style={{background:'rgba(255,255,255,0.04)',borderRadius:10,padding:'8px 10px'}}><div style={{fontSize:9,color:'rgba(148,163,184,0.5)',marginBottom:3,textTransform:'uppercase',letterSpacing:'0.06em'}}>{s.label}</div><div style={{fontSize:14,fontWeight:800,color:s.color}}>{s.value}</div></div>))}
        </div>
        <div style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(33,230,243,0.25)',borderRadius:12,padding:14}}>
          <div style={{display:'flex',gap:10,marginBottom:8}}><div style={{width:36,height:36,borderRadius:10,background:'rgba(33,230,243,0.1)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0}}>{cur.icon}</div><div><div style={{fontSize:9,fontWeight:700,color:'#21E6F3',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:2}}>Coach Prompt</div><div style={{fontSize:12,fontWeight:700,color:'#fff',marginBottom:2}}>{cur.title}</div><div style={{fontSize:11,color:'rgba(148,163,184,0.8)',lineHeight:1.5}}>{cur.body}</div></div></div>
          <div style={{fontSize:10,color:'rgba(74,222,128,0.8)',marginBottom:8}}>📈 {cur.impact}</div>
          <div style={{display:'flex',gap:6}}>{['✓ Done','⏸ Snooze','✕ Ignore'].map((l,i)=>(<button key={l} style={{flex:i===0?2:1,padding:'6px',borderRadius:7,border:'none',cursor:'pointer',fontSize:11,fontWeight:700,background:i===0?'linear-gradient(90deg,#21E6F3,#6C5CFF)':'rgba(255,255,255,0.06)',color:i===0?'#04101b':'rgba(148,163,184,0.7)'}}>{l}</button>))}</div>
        </div>
        <div style={{display:'flex',justifyContent:'center',gap:5,marginTop:10}}>{PROMPTS.map((_,i)=>(<div key={i} onClick={()=>setIdx(i)} style={{width:i===idx?16:5,height:5,borderRadius:3,background:i===idx?'#21E6F3':'rgba(255,255,255,0.15)',transition:'all 0.3s',cursor:'pointer'}}/>))}</div>
      </div>
      {/* Was "Install Live Tracker — it's free →", which sent every creator,
          Free included, to install an extension that only does anything through
          Live Mode — a Pro feature the database refuses to start for them. The
          preview above still sells Live Mode; the extension itself is now
          offered in the Creator Pro flow, once the creator actually has it. */}
      <OBBtn onClick={onContinue} style={{marginBottom:10}}>Continue to my dashboard →</OBBtn>
    </div>
  )
}

// ── Feedback bubble ────────────────────────────────────────────
function FeedbackBubble(){
  const[open,setOpen]=useState(false)
  if(!open)return(<button onClick={()=>setOpen(true)} style={{position:'fixed',bottom:20,right:20,zIndex:200,display:'flex',alignItems:'center',gap:7,padding:'8px 16px',borderRadius:100,background:'rgba(6,8,20,0.92)',border:'1px solid rgba(255,255,255,0.1)',color:'rgba(148,163,184,0.9)',fontSize:12,fontWeight:700,cursor:'pointer',backdropFilter:'blur(20px)'}}>💬 Feedback</button>)
  return(<div style={{position:'fixed',bottom:20,right:20,zIndex:200,maxWidth:280,borderRadius:18,border:'1px solid rgba(200,43,255,0.25)',background:'rgba(6,8,20,0.96)',padding:14,backdropFilter:'blur(20px)'}}><button onClick={()=>setOpen(false)} style={{position:'absolute',top:8,right:8,background:'none',border:'none',color:'rgba(100,116,139,0.7)',cursor:'pointer',fontSize:14}}>✕</button><p style={{fontSize:13,fontWeight:700,color:'#C9B8FF',paddingRight:16,marginBottom:10,lineHeight:1.6}}>Having trouble with this step? We'd love your feedback.</p><button style={{display:'flex',alignItems:'center',gap:5,padding:'5px 12px',borderRadius:100,border:'1px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.035)',color:'rgba(148,163,184,0.9)',fontSize:11,fontWeight:700,cursor:'pointer'}}>💬 Feedback</button></div>)
}

// ── Design tokens ──────────────────────────────────────────────
const CYAN='#21E6F3'
const PINK='#FF2FAE'
const GRAD='linear-gradient(90deg,#21E6F3,#6C5CFF,#FF2FAE)'
const EYE={fontSize:10,fontWeight:900,letterSpacing:'0.22em',textTransform:'uppercase',color:CYAN,marginBottom:10,textAlign:'center'}

const CSS=`
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',system-ui,sans-serif}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  @keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}
  @keyframes cardShimmer{0%,92%{opacity:0}94%{opacity:1}100%{opacity:0}}
  @keyframes glowPulse{0%,100%{box-shadow:0 0 28px rgba(33,230,243,0.18),0 0 60px rgba(255,47,174,0.12),0 0 120px rgba(33,230,243,0.06)}50%{box-shadow:0 0 45px rgba(33,230,243,0.30),0 0 90px rgba(255,47,174,0.20),0 0 160px rgba(33,230,243,0.10)}}
  @keyframes checkIn{from{transform:scale(0) rotate(-20deg);opacity:0}to{transform:scale(1) rotate(0);opacity:1}}
  @keyframes flashPulse{0%{opacity:0}20%{opacity:1}100%{opacity:0}}
  @keyframes statCardIn{from{opacity:0;transform:translateY(8px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}
  @keyframes progressSweep{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}
  textarea::placeholder{color:rgba(100,116,139,0.4);font-family:monospace;font-size:11px;line-height:1.6}
  input::placeholder{color:rgba(100,116,139,0.4)}
  input:focus,textarea:focus{outline:none}
  button{font-family:inherit;cursor:pointer}
  ::-webkit-scrollbar{width:4px}
  ::-webkit-scrollbar-thumb{background:rgba(33,230,243,0.25);border-radius:2px}
  .stat-card{
    background:linear-gradient(160deg,rgba(255,255,255,0.055),rgba(255,255,255,0.022));
    border:1px solid rgba(255,255,255,0.10);
    box-shadow:inset 0 1px 0 rgba(255,255,255,0.07),0 0 22px rgba(0,217,255,0.05);
    border-radius:14px;
    position:relative;
    overflow:hidden;
    transition:box-shadow 0.2s,border-color 0.2s;
  }
  .stat-card::before{
    content:'';position:absolute;top:0;left:0;right:0;height:1px;
    background:linear-gradient(90deg,transparent,rgba(255,255,255,0.18),transparent);
  }
  .stat-card:hover{border-color:rgba(255,255,255,0.16);box-shadow:inset 0 1px 0 rgba(255,255,255,0.09),0 0 32px rgba(0,217,255,0.09)}
  .ob-btn-primary{
    position:relative;overflow:hidden;
    background:linear-gradient(90deg,#20E3F3,#7C5CFF,#FF2FAE);
    box-shadow:0 0 14px rgba(32,227,243,0.16),0 0 28px rgba(255,47,174,0.10),inset 0 1px 0 rgba(255,255,255,0.35);
  }
  .ob-btn-primary::after{
    content:'';position:absolute;top:0;left:-100%;width:60%;height:100%;
    background:linear-gradient(90deg,transparent,rgba(255,255,255,0.18),transparent);
    animation:shimmer 3s ease-in-out infinite 1.5s;
  }
  .ob-card-inner::before{
    content:'';position:absolute;top:0;left:-100%;right:0;height:1px;
    background:linear-gradient(90deg,transparent,rgba(255,255,255,0.35),transparent);
    animation:cardShimmer 7s ease-in-out infinite;
    pointer-events:none;z-index:1;
  }
  @media(max-width:600px){
    main{padding:18px 12px 28px!important;align-items:flex-start!important}
    .ob-card{padding:22px 16px!important;border-radius:24px!important}
    .ob-plat-row{flex-direction:column!important}
  }
`

// ── UI components ──────────────────────────────────────────────
function OBLogo({showSub=false}){
  return(
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',marginBottom:12}}>
      <div style={{display:'flex',alignItems:'center',gap:9,marginBottom:showSub?4:0}}>
        <div style={{width:32,height:32,borderRadius:12,background:GRAD,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,fontWeight:900,color:'#fff',boxShadow:`0 0 14px rgba(33,230,243,0.25),0 0 28px rgba(255,47,174,0.12)`}}>$</div>
        <div style={{fontSize:20,fontWeight:900,letterSpacing:'-0.035em'}}>
          <span style={{color:'#fff'}}>Cam</span>
          <span style={{background:GRAD,WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>Cash</span>
        </div>
      </div>
      {showSub&&<div style={{fontSize:10,color:'rgba(148,163,184,0.5)',letterSpacing:'0.06em',fontWeight:500}}>Creator intelligence for your cam income</div>}
    </div>
  )
}

function OBProgress({current}){
  const steps=[{n:1,label:'Stats'},{n:2,label:'Tips'},{n:3,label:'Done'}]
  return(
    <div className="ob-stepper" style={{marginBottom:22}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',maxWidth:250,margin:'0 auto 8px'}}>
        {steps.map((s,i)=>(
          <div key={s.n} style={{display:'flex',alignItems:'center',flex:i<2?1:'none'}}>
            <div className="ob-stepper-circle" style={{
              width:30,height:30,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:11,fontWeight:800,flexShrink:0,transition:'all 0.35s',
              background:s.n<current?CYAN:s.n===current?GRAD:'rgba(255,255,255,0.05)',
              border:s.n>current?'1px solid rgba(255,255,255,0.12)':'none',
              color:s.n<=current?'#04101b':'rgba(255,255,255,0.25)',
              boxShadow:s.n===current?`0 0 22px rgba(33,230,243,0.65),0 0 45px rgba(33,230,243,0.25)`:s.n<current?`0 0 14px rgba(33,230,243,0.4)`:'none',
            }}>
              {s.n<current?'✓':s.n}
            </div>
            {i<2&&<div className="ob-stepper-line" style={{height:2,flex:1,background:current>s.n?GRAD:'rgba(255,255,255,0.1)',transition:'all 0.35s',margin:'0 3px',boxShadow:current>s.n?'0 0 6px rgba(33,230,243,0.3)':'none'}}/>}
          </div>
        ))}
      </div>
      <div className="ob-stepper-labels" style={{display:'flex',justifyContent:'space-between',maxWidth:250,margin:'0 auto'}}>
        {steps.map(s=>(<div key={s.n} style={{width:28,textAlign:'center',fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.1em',color:s.n<=current?`rgba(33,230,243,0.9)`:'rgba(255,255,255,0.2)',transition:'all 0.35s'}}>{s.label}</div>))}
      </div>
    </div>
  )
}

function OBBtn({onClick,children,disabled=false,style={}}){
  return(
    <button onClick={onClick} disabled={disabled} className={disabled?'':'ob-btn-primary'} style={{
      width:'100%',height:48,borderRadius:14,border:'none',
      background:disabled?'rgba(255,255,255,0.07)':GRAD,
      color:disabled?'rgba(255,255,255,0.25)':'#fff',
      fontSize:14,fontWeight:900,cursor:disabled?'not-allowed':'pointer',
      boxShadow:disabled?'none':'0 0 14px rgba(33,230,243,0.16),0 0 28px rgba(255,47,174,0.10)',
      transition:'all 0.18s',display:'flex',alignItems:'center',justifyContent:'center',gap:7,
      letterSpacing:'-0.01em',
      ...style
    }}
    onMouseEnter={e=>{if(!disabled){e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 0 22px rgba(33,230,243,0.28),0 0 44px rgba(255,47,174,0.18),inset 0 1px 0 rgba(255,255,255,0.3)'}}}
    onMouseLeave={e=>{e.currentTarget.style.transform='';e.currentTarget.style.boxShadow=disabled?'none':'0 0 14px rgba(33,230,243,0.16),0 0 28px rgba(255,47,174,0.10)'}}
    onMouseDown={e=>{if(!disabled)e.currentTarget.style.transform='translateY(0)'}}
    >{children}</button>
  )
}

function OBSecBtn({onClick,children,style={}}){
  return(
    <button onClick={onClick} style={{height:44,padding:'0 16px',borderRadius:12,border:'1px solid rgba(255,255,255,0.12)',background:'rgba(255,255,255,0.04)',color:'rgba(203,213,225,0.85)',fontSize:13,fontWeight:700,transition:'all 0.18s',...style}}
    onMouseEnter={e=>{e.currentTarget.style.borderColor='rgba(33,230,243,0.45)';e.currentTarget.style.color='#fff';e.currentTarget.style.background='rgba(33,230,243,0.07)'}}
    onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(255,255,255,0.12)';e.currentTarget.style.color='rgba(203,213,225,0.85)';e.currentTarget.style.background='rgba(255,255,255,0.04)'}}
    >{children}</button>
  )
}

function OBLinks({links}){
  return(
    <div style={{display:'flex',justifyContent:'center',gap:18,marginTop:12,flexWrap:'wrap'}}>
      {links.map((l,i)=>(<button key={i} onClick={l.onClick} style={{background:'none',border:'none',fontSize:11,color:'rgba(100,116,139,0.7)',cursor:'pointer',transition:'color 0.2s'}} onMouseEnter={e=>e.currentTarget.style.color=CYAN} onMouseLeave={e=>e.currentTarget.style.color='rgba(100,116,139,0.7)'}>{l.label}</button>))}
    </div>
  )
}

function OBTrust(){
  return(<div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:5,marginTop:14,fontSize:10,color:'rgba(100,116,139,0.55)'}}><span>🔒</span><span>Your data is stored securely and never shared.</span></div>)
}

// ── Main component ─────────────────────────────────────────────
export default function OnboardingPage(){
  const router=useRouter()
  const[user,setUser]=useState(null)
  const[booting,setBooting]=useState(true)
  const[userPlan,setUserPlan]=useState('free')

  const[step,setStep]=useState('platform')
  const[platformId,setPlatformId]=useState('chaturbate')
  const[cbUsername,setCbUsername]=useState('')
  const[cbUsernameError,setCbUsernameError]=useState('')
  const[pasteText,setPasteText]=useState('')
  const[preview,setPreview]=useState(null)
  const[parseError,setParseError]=useState('')
  const[importResult,setImportResult]=useState(null)
  const[importError,setImportError]=useState('')
  const[upgradeBlocked,setUpgradeBlocked]=useState(null)
  const[isFirstImport,setIsFirstImport]=useState(true)
  const[showSparkle,setShowSparkle]=useState(false)
  // The trial is optional and a skip is final for this run: once taken, the
  // offer is not shown again. trialAbandoned is set when the creator returns
  // from a checkout they closed, so the decision card can say so instead of
  // silently looking identical.
  const[trialSkipped,setTrialSkipped]=useState(false)
  const[trialAbandoned,setTrialAbandoned]=useState(false)
  const[importedPlatforms,setImportedPlatforms]=useState([])
  const[showUpsell,setShowUpsell]=useState(false)
  const[pendingPlatform,setPendingPlatform]=useState(null)
  const[csvUploading,setCsvUploading]=useState(false)
  const[csvError,setCsvError]=useState('')
  const[loadingMsgIdx,setLoadingMsgIdx]=useState(0)
  const[loadingProgress,setLoadingProgress]=useState(0)
  const csvRef=useRef()

  const platform=PLATFORMS[platformId]
  const stepNum={platform:1,username:1,paste:2,csv:2,loading:3,live:3,step4:3,done:3}[step]||1
  const showProgress=!['loading','live'].includes(step)

  useEffect(()=>{
    ;(async()=>{
      const{data:{user}}=await supabase.auth.getUser()
      if(!user){router.replace('/login');return}
      const{data}=await supabase.from('beta_users').select('onboarding_complete').eq('user_id',user.id).single()
      if(data?.onboarding_complete){router.replace('/dashboard');return}
      const{data:profile}=await supabase.from('profiles').select('plan, plan_expires_at').eq('id',user.id).single()
      setUserPlan(isProPlan(profile)?'pro':'free')
      // Onboarding always hands off to the dashboard. The trial is an OFFER
      // presented once the creator has seen real value, never a gate standing
      // between them and their own data — see /start-trial, which is reachable
      // but never forced.
      setUser(user);setBooting(false)
    })()
  },[router])

  // Fires on every step transition so we can see exactly where a user
  // last was before abandoning onboarding (drop-off = last step_viewed row).
  useEffect(()=>{
    if(!user)return
    track('onboarding_step_viewed',{step,platform:platformId})
    // Named distinctly from the generic step_viewed event so the funnel's
    // "first useful insight" step is directly queryable, per the funnel
    // instrumentation checklist, without filtering step_viewed by 'done'.
    if(step==='report')track('first_insight_viewed',{platform:platformId,tipsImported:importResult?.inserted??0})
  },[step,user])

  async function markDone(){
    if(!user)return
    await supabase.from('beta_users').upsert({user_id:user.id,email:user.email,onboarding_complete:true,signed_up_at:user.created_at},{onConflict:'user_id'})
  }

  function selectPlatform(id){
    if(userPlan!=='pro'&&importedPlatforms.length>0&&!importedPlatforms.includes(id)){setPendingPlatform(id);setShowUpsell(true);return}
    setPlatformId(id)
    if(id==='chaturbate')setStep('username');else setStep('paste')
  }

  async function handleUsernameSubmit(){
    setCbUsernameError('')
    const cleaned=cbUsername.trim().toLowerCase().replace(/[^a-z0-9_-]/g,'')
    if(!cleaned){setCbUsernameError('Enter your Chaturbate username to continue.');return}
    setCbUsername(cleaned)
    if(user)await supabase.from('profiles').upsert({id:user.id,chaturbate_username:cleaned},{onConflict:'id'})
    setStep('paste')
  }

  // The sparkle marks COMPLETION, so it fires when the final card mounts —
  // not at import success, where it used to burn its four seconds behind the
  // Live Mode card the creator was still reading.
  // /start-trial sends the creator back here with ?trial=cancelled when they
  // close Stripe. Resume at the decision card with BOTH options rather than
  // dropping them at the start of onboarding.
  useEffect(()=>{
    if(typeof window==='undefined')return
    const q=new URLSearchParams(window.location.search)
    if(q.get('trial')==='cancelled'){
      setTrialAbandoned(true)
      setStep('trial')
      window.history.replaceState({},'',window.location.pathname)
    }
  },[])

  function celebrate(){
    setShowSparkle(true)
    setTimeout(()=>setShowSparkle(false),4000)
  }

  function handleUpsellSkip(){
    // "Skip" means stay on the already-imported platform — do NOT advance into pendingPlatform's flow
    setShowUpsell(false);setPendingPlatform(null)
    if(importedPlatforms.length)setPlatformId(importedPlatforms[0])
  }

  function handleCloseClick(){
    // window.__onboardingExitCheck returns false and shows the exit survey
    // when eligible; onResolved (passed to OnboardingExitSurvey) completes
    // this navigation once the user dismisses/submits it.
    // Goes to '/' rather than '/dashboard': a user with onboarding_complete
    // false and zero tips gets bounced right back to /onboarding by the
    // dashboard's abandoned-onboarding redirect, trapping them in a loop.
    const canExitNow=window.__onboardingExitCheck?window.__onboardingExitCheck():true
    if(canExitNow)router.push('/')
  }

  function handlePreview(){
    setParseError('')
    if(!pasteText.trim()){setParseError('Paste your tip history above first.');return}
    const p=buildPreview(pasteText,platformId,platform.label)
    if(!p||( p.tipsDetected===0&&p.paidSessionsDetected===0)){
      const reason=diagnosePasteFailure(pasteText,platformId)
      setParseError(reason)
      track('onboarding_paste_parse_failed',{platform:platformId,reason,...fingerprintPaste(pasteText)})
      return
    }
    setPreview(p)
    handleImport(p)
  }

  async function handleImport(previewArg){
    const p=previewArg||preview
    if(!user)return
    track('import_started',{platform:platformId,source:'paste',rows:p?.tipsDetected??0})
    setImportError('');setUpgradeBlocked(null);setStep('loading');setLoadingMsgIdx(0);setLoadingProgress(0)
    try{
      const{data:{session}}=await supabase.auth.getSession()
      if(!session)throw new Error('Not logged in')
      // Send the already-parsed rows as a clean CSV instead of the raw paste —
      // the server has its own independent parser, and re-parsing the raw text
      // there can disagree with what this page's parseRows() already validated.
      const{blob:csvBlob}=pasteToCSVBlob(pasteText,platformId)
      const file=new File([csvBlob],'pasted_import.csv',{type:'text/csv'})
      const minWait=isFirstImport?5500:1800
      const msgs=isFirstImport?LOADING_MESSAGES:EXTRA_MSGS
      const start=Date.now()
      const pi=setInterval(()=>{const pr=Math.min((Date.now()-start)/minWait,0.95);setLoadingProgress(Math.round(pr*100))},60)
      const mi=setInterval(()=>setLoadingMsgIdx(i=>(i+1)%msgs.length),900)

      // Upload free tips
      const tipUploadPromise=fetch('/api/upload',{
        method:'POST',
        headers:{Authorization:`Bearer ${session.access_token}`},
        body:(()=>{const f=new FormData();f.append('file',file);f.append('platform',platform.label);return f})()
      })

      // Upload BongaCams paid sessions if any detected
      let paidUploadPromise=Promise.resolve(null)
      if(platformId==='bongacams'&&p?.paidSessionsDetected>0){
        const paidBlob=paidSessionsToCSVBlob(p.paidSessions)
        const paidFile=new File([paidBlob],'paid_sessions_import.csv',{type:'text/csv'})
        const paidForm=new FormData()
        paidForm.append('file',paidFile)
        paidForm.append('platform','BongaCams')
        paidUploadPromise=fetch('/api/upload-paid-sessions',{
          method:'POST',
          headers:{Authorization:`Bearer ${session.access_token}`},
          body:paidForm
        })
      }

      const[res,,]=await Promise.all([
        tipUploadPromise,
        paidUploadPromise,
        new Promise(r=>setTimeout(r,minWait)),
      ])
      clearInterval(pi);clearInterval(mi);setLoadingProgress(100)
      const json=await res.json()
      if(!res.ok||json.error){
        const err=new Error(json.error||'Import failed')
        err.code=json.code;err.upgradeUrl=json.upgradeUrl
        throw err
      }
      await markDone()
      const inserted=json.inserted??p?.tipsDetected??0
      setImportResult({inserted,skipped:json.skipped??0,paidInserted:p?.paidSessionsDetected??0})
      setImportedPlatforms(prev=>prev.includes(platformId)?prev:[...prev,platformId])
      track('onboarding_import_completed',{platform:platformId,inserted,skipped:json.skipped??0})
      if(isFirstImport){track('onboarding_completed',{platform:platformId});setIsFirstImport(false);setStep('report')}
      else setStep('step4')
    }catch(e){
      if(e.code==='platform_limit_reached')setUpgradeBlocked({message:e.message,upgradeUrl:e.upgradeUrl||'/pricing'})
      else setImportError(e.message||'Import failed')
      track('onboarding_import_failed',{platform:platformId,code:e.code||null,message:e.message||null})
      setStep('paste')
    }
  }

  async function handleCsvUpload(file){
    if(!file||!user)return
    track('import_started',{platform:platformId,source:'csv'})
    setCsvUploading(true);setCsvError('');setStep('loading');setLoadingProgress(0)
    try{
      const{data:{session}}=await supabase.auth.getSession()
      if(!session)throw new Error('Not logged in')
      const form=new FormData();form.append('file',file);form.append('platform',platform.label)
      const minWait=isFirstImport?5500:1800
      const start=Date.now()
      const pi=setInterval(()=>{const p=Math.min((Date.now()-start)/minWait,0.95);setLoadingProgress(Math.round(p*100))},60)
      const[res]=await Promise.all([fetch('/api/upload',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`},body:form}),new Promise(r=>setTimeout(r,minWait))])
      clearInterval(pi);setLoadingProgress(100)
      const json=await res.json()
      if(!res.ok||json.error)throw new Error(json.error||'Upload failed')
      await markDone()
      const inserted=json.inserted??preview?.tipsDetected??0
      setImportResult({inserted,skipped:json.skipped??0})
      setImportedPlatforms(prev=>prev.includes(platformId)?prev:[...prev,platformId])
      track('onboarding_import_completed',{platform:platformId,inserted,skipped:json.skipped??0,source:'csv'})
      if(isFirstImport){track('onboarding_completed',{platform:platformId,source:'csv'});setIsFirstImport(false);setStep('report')}
      else setStep('step4')
    }catch(e){
      setCsvError(e.message||'Upload failed')
      track('onboarding_import_failed',{platform:platformId,message:e.message||null,source:'csv'})
      setStep('csv')
    }
    finally{setCsvUploading(false)}
  }

  if(booting)return(
    <div style={{minHeight:'100vh',background:'#050812',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{width:30,height:30,borderRadius:'50%',border:'2px solid rgba(255,255,255,0.08)',borderTopColor:CYAN,animation:'spin 0.8s linear infinite'}}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  const msgs=isFirstImport?LOADING_MESSAGES:EXTRA_MSGS
  const tipsDisplayed=importResult?.inserted>0?importResult.inserted:(preview?.tipsDetected||0)

  return(
    <main style={{position:'relative',minHeight:'100vh',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'28px 16px 34px',background:'#070b18',fontFamily:"'Inter',system-ui,sans-serif",color:'#fff',overflow:'hidden'}}>
      <style>{CSS}</style>

      {/* ── BACKGROUND ── */}
      <div style={{position:'fixed',inset:0,pointerEvents:'none',zIndex:0}}>
        <div style={{position:'absolute',inset:0,background:'linear-gradient(90deg,rgba(7,178,207,0.22) 0%,rgba(8,14,31,0.92) 48%,rgba(29,12,45,0.88) 72%,rgba(255,47,174,0.16) 100%),radial-gradient(ellipse at 14% 46%,rgba(33,230,243,0.24) 0%,transparent 54%),radial-gradient(ellipse at 86% 50%,rgba(255,47,174,0.22) 0%,transparent 58%),radial-gradient(ellipse at 50% 100%,rgba(139,92,246,0.12) 0%,transparent 50%)'}}/>
        <div style={{position:'absolute',left:'-12%',top:'8%',width:620,height:620,borderRadius:'50%',background:'rgba(33,230,243,0.22)',filter:'blur(100px)'}}/>
        <div style={{position:'absolute',right:'-14%',bottom:'2%',width:640,height:640,borderRadius:'50%',background:'rgba(255,47,174,0.20)',filter:'blur(110px)'}}/>
        <div style={{position:'absolute',left:'35%',top:'30%',width:420,height:420,borderRadius:'50%',background:'rgba(139,92,246,0.12)',filter:'blur(90px)'}}/>
        <div style={{position:'absolute',left:'50%',top:'-5%',transform:'translateX(-50%)',width:400,height:300,borderRadius:'50%',background:'rgba(33,230,243,0.10)',filter:'blur(80px)'}}/>
        <div style={{position:'absolute',inset:0,opacity:0.13,backgroundImage:'radial-gradient(rgba(255,255,255,0.58) 1px,transparent 1px)',backgroundSize:'28px 28px'}}/>
      </div>

      <AmbientParticles/>
      <OnboardingExitSurvey currentStep={stepNum} currentStepName={step} minStepToTrigger={1} onResolved={()=>router.push('/')}/>
      {showSparkle&&<Sparkle/>}
      {showUpsell&&pendingPlatform&&<ProUpsellModal platform={PLATFORMS[pendingPlatform]} onSkip={handleUpsellSkip}/>}
      <FeedbackBubble/>

      {/* ── CARD ── */}
      <div style={{position:'relative',zIndex:10,width:'100%',maxWidth:520}}>
        <div style={{position:'absolute',inset:-2,borderRadius:30,background:'linear-gradient(135deg,rgba(33,230,243,0.9) 0%,rgba(124,92,255,0.45) 45%,rgba(255,47,174,0.9) 100%)',zIndex:-1,filter:'blur(1.5px)',animation:'glowPulse 3.5s ease-in-out infinite'}}/>
        <div style={{position:'absolute',inset:-60,borderRadius:'50%',background:'radial-gradient(circle,rgba(124,92,255,0.10) 0%,transparent 70%)',zIndex:-2,pointerEvents:'none'}}/>
        <div className="ob-card ob-card-inner" style={{position:'relative',borderRadius:28,border:'1px solid rgba(255,255,255,0.12)',background:'linear-gradient(180deg,rgba(10,15,35,0.94),rgba(6,9,24,0.96))',backdropFilter:'blur(34px)',WebkitBackdropFilter:'blur(34px)',padding:'20px 30px 18px',overflow:'hidden',boxShadow:'0 0 46px rgba(33,230,243,0.25),0 0 70px rgba(255,47,174,0.15),0 26px 96px rgba(0,0,0,0.58),inset 0 1px 0 rgba(255,255,255,0.10)'}}>
          <div style={{position:'absolute',top:0,left:'8%',right:'8%',height:'1px',background:'linear-gradient(90deg,transparent,rgba(255,255,255,0.22),transparent)',pointerEvents:'none'}}/>
          <div style={{position:'absolute',top:-50,left:-50,width:220,height:220,borderRadius:'50%',background:'rgba(33,230,243,0.055)',filter:'blur(40px)',pointerEvents:'none'}}/>
          <div style={{position:'absolute',bottom:-50,right:-50,width:220,height:220,borderRadius:'50%',background:'rgba(255,47,174,0.045)',filter:'blur(40px)',pointerEvents:'none'}}/>

          {!['loading','done'].includes(step)&&(
            <button
              onClick={handleCloseClick}
              aria-label="Close onboarding"
              style={{position:'absolute',top:16,right:16,width:28,height:28,borderRadius:'50%',border:'1px solid rgba(255,255,255,0.12)',background:'rgba(255,255,255,0.04)',color:'rgba(148,163,184,0.7)',fontSize:13,lineHeight:1,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',zIndex:5,transition:'all 0.18s'}}
              onMouseEnter={e=>{e.currentTarget.style.color='#fff';e.currentTarget.style.borderColor='rgba(255,255,255,0.25)'}}
              onMouseLeave={e=>{e.currentTarget.style.color='rgba(148,163,184,0.7)';e.currentTarget.style.borderColor='rgba(255,255,255,0.12)'}}
            >✕</button>
          )}

          {!['loading'].includes(step)&&(
            <header>
              <OBLogo showSub={step==='platform'}/>
              {showProgress&&<OBProgress current={stepNum}/>}
            </header>
          )}

          {/* ══ PLATFORM ══ */}
          {step==='platform'&&(
            <div style={{animation:'fadeUp 0.3s ease both'}}>
              <div style={EYE}>Step 1 of 3</div>
              <div style={{textAlign:'center',marginBottom:12}}>
                <h1 style={{fontSize:23,fontWeight:900,color:'#F8FAFC',letterSpacing:'-0.025em',lineHeight:1.15,marginBottom:7}}>Start tracking your streams</h1>
                <p style={{fontSize:13,color:'rgba(166,168,189,0.88)',lineHeight:1.6,maxWidth:430,margin:'0 auto'}}>Choose your platform so CamCash can import your tip history and build your first insights.</p>
              </div>
              <div style={{marginBottom:22}}>
                <div style={{fontSize:10,fontWeight:700,color:'rgba(166,168,189,0.6)',marginBottom:9,letterSpacing:'0.08em',textTransform:'uppercase'}}>Your platform</div>
                <div className="ob-plat-row" style={{display:'flex',gap:9}}>
                  {Object.entries(PLATFORMS).map(([key,p])=>{
                    const sel=platformId===key
                    return(
                      <button key={key} onClick={()=>setPlatformId(key)} style={{
                        flex:1,padding:'12px 8px',borderRadius:14,textAlign:'center',
                        background:sel?'rgba(33,230,243,0.09)':'rgba(255,255,255,0.03)',
                        border:sel?`1.5px solid rgba(33,230,243,0.85)`:'1px solid rgba(255,255,255,0.09)',
                        boxShadow:sel?'0 0 22px rgba(33,230,243,0.22),inset 0 1px 0 rgba(255,255,255,0.08)':'none',
                        cursor:'pointer',transition:'all 0.22s',position:'relative',
                      }}
                      onMouseEnter={e=>{if(!sel){e.currentTarget.style.borderColor='rgba(33,230,243,0.45)';e.currentTarget.style.background='rgba(33,230,243,0.05)'}}}
                      onMouseLeave={e=>{if(!sel){e.currentTarget.style.borderColor='rgba(255,255,255,0.09)';e.currentTarget.style.background='rgba(255,255,255,0.03)'}}}
                      >
                        {sel&&<div style={{position:'absolute',top:9,right:9,width:18,height:18,borderRadius:'50%',background:CYAN,display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:900,color:'#04101b',boxShadow:'0 0 14px rgba(33,230,243,0.6)'}}>✓</div>}
                        <div style={{width:44,height:44,borderRadius:14,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:900,margin:'0 auto 10px',...p.iconStyle}}>{p.short}</div>
                        <div style={{fontSize:12,fontWeight:700,color:sel?'#fff':'rgba(255,255,255,0.5)'}}>{p.label}</div>
                      </button>
                    )
                  })}
                </div>
              </div>
              <OBBtn onClick={()=>selectPlatform(platformId)} style={{marginBottom:10}}>Continue with {platform.label} →</OBBtn>
            </div>
          )}

          {/* ══ USERNAME ══ */}
          {step==='username'&&(
            <div style={{animation:'fadeUp 0.3s ease both'}}>
              <div style={EYE}>Step 1 of 3 — Chaturbate</div>
              <div style={{textAlign:'center',marginBottom:14}}>
                <h1 style={{fontSize:23,fontWeight:900,color:'#F8FAFC',letterSpacing:'-0.025em',lineHeight:1.15,marginBottom:7}}>Start tracking your streams</h1>
                <p style={{fontSize:13,color:'rgba(166,168,189,0.88)',lineHeight:1.6,maxWidth:430,margin:'0 auto'}}>Enter your username so we can link you directly to your token stats page.</p>
              </div>
              <div style={{marginBottom:22}}>
                <div style={{fontSize:10,fontWeight:700,color:'rgba(166,168,189,0.6)',marginBottom:7,letterSpacing:'0.08em',textTransform:'uppercase'}}>Chaturbate username</div>
                <div style={{position:'relative'}}>
                  <input value={cbUsername} onChange={e=>{setCbUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g,''));setCbUsernameError('')}} onKeyDown={e=>e.key==='Enter'&&handleUsernameSubmit()} placeholder="your_username" autoFocus
                    style={{width:'100%',padding:'12px 14px',background:'rgba(4,6,18,0.92)',border:`1px solid ${cbUsernameError?'rgba(248,113,113,0.5)':'rgba(255,255,255,0.1)'}`,borderRadius:13,color:'#f8fafc',fontSize:13,fontFamily:'monospace',transition:'all 0.2s'}}
                    onFocus={e=>{e.target.style.borderColor='rgba(33,230,243,0.65)';e.target.style.boxShadow='0 0 0 3px rgba(33,230,243,0.09)'}}
                    onBlur={e=>{e.target.style.borderColor=cbUsernameError?'rgba(248,113,113,0.5)':'rgba(255,255,255,0.1)';e.target.style.boxShadow='none'}}
                  />
                </div>
                {cbUsernameError&&<div style={{marginTop:6,fontSize:12,color:'#f87171'}}>⚠️ {cbUsernameError}</div>}
                {cbUsername&&<div style={{marginTop:6,fontSize:11,color:'rgba(100,116,139,0.7)'}}>Your stats page: <span style={{color:CYAN}}>chaturbate.com/p/{cbUsername}/?tab=tokens</span></div>}
                <div style={{marginTop:5,fontSize:10,color:'rgba(100,116,139,0.45)'}}>Exact username you use to broadcast (not display name)</div>
              </div>
              <OBBtn onClick={handleUsernameSubmit} style={{marginBottom:10}}>Continue to Tip Import →</OBBtn>
              <OBLinks links={[{label:'← Back',onClick:()=>setStep('platform')},{label:"Skip — I'll navigate there myself",onClick:()=>{setCbUsername('');setStep('paste')}}]}/>
              <OBTrust/>
            </div>
          )}

          {/* ══ PASTE ══ */}
          {step==='paste'&&(
            <div style={{animation:'fadeUp 0.3s ease both'}}>
              <div style={EYE}>Step 2 of 3 — {platform.label}</div>
              <div style={{textAlign:'center',marginBottom:12}}>
                <h1 style={{fontSize:23,fontWeight:900,color:'#F8FAFC',letterSpacing:'-0.025em',lineHeight:1.15,marginBottom:7}}>Paste your tip history</h1>
                <p style={{fontSize:13,color:'rgba(166,168,189,0.88)',lineHeight:1.6,maxWidth:430,margin:'0 auto'}}>Copy your earning rows from {platform.label} and paste them below. CamCash will clean and organize everything automatically.</p>
              </div>

              {/* BongaCams paid chat notice */}
              {platformId==='bongacams'&&(
                <div style={{borderRadius:12,border:'1px solid rgba(255,47,174,0.22)',background:'rgba(255,47,174,0.055)',padding:'10px 13px',marginBottom:12,fontSize:11,color:'rgba(203,213,225,0.8)',lineHeight:1.55}}>
                  <span style={{color:PINK,fontWeight:700}}>💳 Tip:</span> You can paste your <strong style={{color:'#fff'}}>Free Chat</strong> and <strong style={{color:'#fff'}}>Paid Chat</strong> sections together — CamCash automatically separates tips from private sessions.
                </div>
              )}

              <div className="ob-howto-card" style={{borderRadius:13,border:'1px solid rgba(33,230,243,0.22)',background:'rgba(33,230,243,0.055)',padding:'14px 16px',marginBottom:12}}>
                <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12,marginBottom:10}}>
                  <div style={{fontSize:10,fontWeight:900,letterSpacing:'0.18em',textTransform:'uppercase',color:'rgba(33,230,243,0.85)'}}>How to copy from {platform.label}</div>
                  <a href={platform.earningsUrl(cbUsername)} target="_blank" rel="noreferrer" style={{flexShrink:0,padding:'5px 11px',borderRadius:9,border:'1px solid rgba(255,47,174,0.35)',background:'rgba(255,255,255,0.03)',color:'rgba(203,213,225,0.85)',fontSize:10,fontWeight:700,textDecoration:'none',whiteSpace:'nowrap',transition:'all 0.2s'}} onMouseEnter={e=>{e.currentTarget.style.borderColor='rgba(33,230,243,0.55)';e.currentTarget.style.color='#fff'}} onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(255,47,174,0.35)';e.currentTarget.style.color='rgba(203,213,225,0.85)'}}>Open earnings page ↗</a>
                </div>
                <p style={{fontSize:12,color:'rgba(148,163,184,0.8)',lineHeight:1.6,marginBottom:10}}>{platform.instructions}</p>
                <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8}}>
                  {['No password required','You control what gets imported','Takes about 60 seconds'].map(t=>(<div key={t} style={{display:'flex',alignItems:'center',gap:5,fontSize:10,color:'rgba(148,163,184,0.75)'}}><span style={{color:CYAN,fontSize:11}}>✓</span>{t}</div>))}
                </div>
              </div>

              <textarea value={pasteText} onChange={e=>setPasteText(e.target.value)} placeholder={platform.placeholder}
                style={{width:'100%',height:156,resize:'none',borderRadius:13,border:'1px solid rgba(33,230,243,0.18)',borderTop:'1.5px solid rgba(33,230,243,0.48)',background:'rgba(1,3,12,0.98)',padding:'12px 14px',fontFamily:'monospace',fontSize:11,lineHeight:1.65,color:'#a5f3fc',outline:'none',transition:'border-color 0.2s,box-shadow 0.2s',marginBottom:parseError?9:12,boxShadow:'inset 0 2px 12px rgba(0,0,0,0.4),inset 0 1px 0 rgba(33,230,243,0.08)'}}
                onFocus={e=>{e.target.style.borderColor='rgba(33,230,243,0.6)';e.target.style.boxShadow='0 0 0 3px rgba(33,230,243,0.08)'}}
                onBlur={e=>{e.target.style.borderColor='rgba(255,255,255,0.1)';e.target.style.boxShadow='none'}}
              />

              {parseError&&<div style={{marginBottom:10,padding:'9px 12px',borderRadius:11,background:'rgba(248,113,113,0.07)',border:'1px solid rgba(248,113,113,0.22)',fontSize:12,color:'#f87171'}}>⚠️ {parseError}</div>}

              {upgradeBlocked&&(
                <div style={{marginBottom:10,padding:'12px 14px',borderRadius:12,background:'rgba(167,139,250,0.08)',border:'1px solid rgba(167,139,250,0.35)'}}>
                  <div style={{fontSize:12,fontWeight:800,color:'#a78bfa',marginBottom:4}}>🔒 Upgrade to add {platform.label}</div>
                  <div style={{fontSize:12,color:'rgba(203,213,225,0.85)',lineHeight:1.5,marginBottom:9}}>{upgradeBlocked.message}</div>
                  <button onClick={()=>router.push('/pricing')} style={{padding:'8px 16px',borderRadius:9,border:'none',cursor:'pointer',background:'linear-gradient(135deg,#a78bfa,#7c3aed)',color:'#fff',fontSize:12,fontWeight:700}}>See upgrade options →</button>
                </div>
              )}
              {importError&&<div style={{marginBottom:10,padding:'9px 12px',borderRadius:11,background:'rgba(248,113,113,0.07)',border:'1px solid rgba(248,113,113,0.22)',fontSize:12,color:'#f87171'}}>⚠️ {importError}</div>}

              <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:9,marginBottom:16}}>
                {['Open your earnings page','Highlight the rows you want','Copy and paste them here'].map((t,i)=>(<div key={i} style={{display:'flex',alignItems:'center',gap:7,fontSize:10,color:'rgba(148,163,184,0.8)'}}><div style={{width:19,height:19,borderRadius:'50%',border:'1px solid rgba(33,230,243,0.35)',background:'rgba(33,230,243,0.08)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:900,color:CYAN,flexShrink:0}}>{i+1}</div><span>{t}</span></div>))}
              </div>

              <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:10,marginBottom:6}}>
                <OBSecBtn onClick={()=>setStep('platform')} style={{height:46}}>← Back</OBSecBtn>
                <OBBtn onClick={handlePreview} disabled={!pasteText.trim()} style={{height:46,fontSize:13}}>Import & build dashboard →</OBBtn>
              </div>
              <OBLinks links={[{label:'Upload CSV instead',onClick:()=>setStep('csv')}]}/>
              <OBTrust/>
            </div>
          )}

          {/* ══ CSV ══ */}
          {step==='csv'&&(
            <div style={{animation:'fadeUp 0.3s ease both'}}>
              <div style={EYE}>Step 2 of 3 — {platform.label}</div>
              <div style={{textAlign:'center',marginBottom:12}}>
                <h1 style={{fontSize:23,fontWeight:900,color:'#F8FAFC',letterSpacing:'-0.025em',marginBottom:7}}>Upload your CSV</h1>
                <p style={{fontSize:13,color:'rgba(166,168,189,0.85)',lineHeight:1.65}}>Export your earnings as a CSV file and drop it below.</p>
              </div>
              <div onClick={()=>!csvUploading&&csvRef.current?.click()} style={{border:'2px dashed rgba(255,255,255,0.1)',borderRadius:16,padding:'40px 20px',textAlign:'center',cursor:csvUploading?'not-allowed':'pointer',background:'rgba(255,255,255,0.02)',marginBottom:12,transition:'all 0.2s'}} onMouseEnter={e=>{if(!csvUploading){e.currentTarget.style.borderColor='rgba(33,230,243,0.4)';e.currentTarget.style.background='rgba(33,230,243,0.03)'}}} onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(255,255,255,0.1)';e.currentTarget.style.background='rgba(255,255,255,0.02)'}}>
                <input ref={csvRef} type="file" accept=".csv,.txt" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(f)handleCsvUpload(f)}}/>
                {csvUploading?(<><div style={{width:24,height:24,borderRadius:'50%',border:'2px solid rgba(255,255,255,0.1)',borderTopColor:CYAN,animation:'spin 0.8s linear infinite',margin:'0 auto 10px'}}/><div style={{fontSize:13,color:CYAN,fontWeight:500}}>Uploading…</div></>):(<><div style={{fontSize:28,marginBottom:8}}>📁</div><div style={{fontSize:13,fontWeight:700,color:'#f8fafc',marginBottom:3}}>Drop your CSV here or click to browse</div><div style={{fontSize:11,color:'rgba(148,163,184,0.55)'}}>Supports {platform.label} export format</div></>)}
              </div>
              {csvError&&<div style={{marginBottom:12,padding:'9px 12px',borderRadius:11,background:'rgba(248,113,113,0.07)',border:'1px solid rgba(248,113,113,0.22)',fontSize:12,color:'#f87171'}}>⚠️ {csvError}</div>}
              <div style={{display:'flex',gap:9}}><OBSecBtn onClick={()=>setStep('paste')} style={{flex:1}}>← Use paste instead</OBSecBtn><OBSecBtn onClick={()=>setStep('platform')} style={{flex:1}}>← Back</OBSecBtn></div>
              <OBTrust/>
            </div>
          )}

          {/* ══ LOADING ══ */}
          {step==='loading'&&(
            <div style={{animation:'fadeUp 0.3s ease both'}}>
              <OBLogo/>
              <div style={{marginBottom:12}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'center',maxWidth:250,margin:'0 auto 8px'}}>
                  {[{n:1},{n:2},{n:3}].map((s,i)=>(<div key={s.n} style={{display:'flex',alignItems:'center',flex:i<2?1:'none'}}>
                    <div style={{width:30,height:30,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:800,flexShrink:0,background:s.n<3?CYAN:GRAD,color:'#04101b',boxShadow:s.n===3?`0 0 20px rgba(33,230,243,0.6)`:`0 0 14px rgba(33,230,243,0.4)`}}>{s.n<3?'✓':s.n}</div>
                    {i<2&&<div style={{height:2,flex:1,background:GRAD,margin:'0 3px',boxShadow:'0 0 6px rgba(33,230,243,0.3)'}}/>}
                  </div>))}
                </div>
                <div style={{display:'flex',justifyContent:'space-between',maxWidth:250,margin:'0 auto'}}>
                  {['Stats','Tips','Done'].map((l,i)=>(<div key={l} style={{width:28,textAlign:'center',fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.1em',color:i<2?`rgba(33,230,243,0.55)`:`rgba(33,230,243,0.9)`}}>{l}</div>))}
                </div>
              </div>
              <div style={{textAlign:'center',marginBottom:12}}>
                <h1 style={{fontSize:23,fontWeight:900,color:'#F8FAFC',letterSpacing:'-0.025em',marginBottom:7}}>Building your CamCash dashboard</h1>
                <p style={{fontSize:13,color:'rgba(148,163,184,0.75)',minHeight:18}}>{msgs[loadingMsgIdx]}</p>
              </div>
              <div style={{marginBottom:22}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                  <span style={{fontSize:10,color:'rgba(148,163,184,0.55)'}}>Progress</span>
                  <span style={{fontSize:10,color:CYAN,fontWeight:700}}>{loadingProgress}%</span>
                </div>
                <div style={{height:8,borderRadius:100,background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.07)',overflow:'hidden'}}>
                  <div style={{height:'100%',width:`${loadingProgress}%`,background:GRAD,borderRadius:100,boxShadow:'0 0 18px rgba(33,230,243,0.4)',transition:'width 0.1s linear'}}/>
                </div>
                <div style={{fontSize:10,color:'rgba(100,116,139,0.5)',textAlign:'center',marginTop:4}}>{loadingProgress}% complete</div>
              </div>
              <div style={{marginBottom:12}}>
                {LOADING_MESSAGES.map((m,i)=>{
                  const done=loadingProgress>=((i+1)/LOADING_MESSAGES.length)*95
                  const active=!done&&loadingProgress>=(i/LOADING_MESSAGES.length)*95
                  return(<div key={m} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'5px 0',borderBottom:i<LOADING_MESSAGES.length-1?'1px solid rgba(255,255,255,0.04)':'none',opacity:done||active?1:0.3,transition:'opacity 0.4s'}}>
                    <div style={{display:'flex',alignItems:'center',gap:9}}>
                      <div style={{width:20,height:20,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,background:done?CYAN:active?'rgba(33,230,243,0.15)':'rgba(255,255,255,0.05)',border:done?'none':active?`1px solid rgba(33,230,243,0.45)`:'1px solid rgba(255,255,255,0.1)',transition:'all 0.3s',boxShadow:done?'0 0 10px rgba(33,230,243,0.5)':active?'0 0 6px rgba(33,230,243,0.2)':'none'}}>
                        {done?<span style={{fontSize:10,fontWeight:900,color:'#04101b'}}>✓</span>:active?<div style={{width:6,height:6,borderRadius:'50%',border:'1.5px solid rgba(255,255,255,0.2)',borderTopColor:CYAN,animation:'spin 0.8s linear infinite'}}/>:null}
                      </div>
                      <span style={{fontSize:12,color:done?'#fff':active?CYAN:'rgba(148,163,184,0.5)',fontWeight:done?600:active?700:400}}>{m}</span>
                    </div>
                    <span style={{fontSize:9,fontWeight:700,color:done?CYAN:active?'rgba(33,230,243,0.6)':'rgba(100,116,139,0.35)'}}>{done?'Complete':active?'In progress':'Queued'}</span>
                  </div>)
                })}
              </div>
              {/* The animated Earnings / Fans / Tips / Best Hour grid used to
                  sit here, counting up with loadingProgress — and then the
                  'done' card rendered the same four figures again a step
                  later. Two totals displays either side of the Live Mode card
                  made onboarding feel longer than it is and buried the ending.
                  The numbers now appear ONCE, on the final card, from the same
                  already-computed preview/importResult state. No second
                  calculation exists; this was always a render of numbers the
                  import had already produced. */}
              <div style={{textAlign:'center',marginTop:10,fontSize:10,color:'rgba(100,116,139,0.45)'}}>⚡ Almost there! Crunching the good stuff…</div>
            </div>
          )}

          {/* ══ LIVE MODE ══ */}
          {step==='live'&&(
            <LiveModeDemo onContinue={()=>{celebrate();setStep('done')}} isPro={userPlan==='pro'} />
          )}

          {/* ══ STEP4 ══ */}
          {step==='step4'&&(
            <div style={{animation:'fadeUp 0.35s ease both'}}>
              <div style={{textAlign:'center',marginBottom:12}}>
                <div style={{width:46,height:46,borderRadius:16,background:GRAD,display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,color:'#fff',margin:'0 auto 10px',boxShadow:'0 0 40px rgba(33,230,243,0.35),0 0 70px rgba(255,47,174,0.2)'}}>✓</div>
                <h1 style={{fontSize:20,fontWeight:900,color:'#fff',marginBottom:7}}>Make your dashboard smarter</h1>
                <p style={{fontSize:13,color:'rgba(148,163,184,0.8)',lineHeight:1.6}}>Add more history or turn on live tracking so CamCash can find stronger patterns.</p>
              </div>
              {[{icon:'📥',title:'Add more history',sub:'Improve accuracy with more tip data',onClick:()=>{setPasteText('');setStep('paste')}},{icon:'📊',title:'Go to dashboard',sub:'See what CamCash found so far',onClick:()=>router.push('/dashboard')}].map(a=>(<button key={a.title} onClick={a.onClick} style={{display:'flex',alignItems:'center',gap:13,padding:'14px 15px',width:'100%',background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:15,cursor:'pointer',transition:'all 0.2s',textAlign:'left',marginBottom:9}} onMouseEnter={e=>{e.currentTarget.style.borderColor='rgba(33,230,243,0.3)';e.currentTarget.style.background='rgba(33,230,243,0.04)';e.currentTarget.style.transform='translateY(-1px)'}} onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(255,255,255,0.08)';e.currentTarget.style.background='rgba(255,255,255,0.03)';e.currentTarget.style.transform=''}}><div style={{width:40,height:40,borderRadius:13,background:'rgba(33,230,243,0.08)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:19,flexShrink:0}}>{a.icon}</div><div><div style={{fontSize:13,fontWeight:700,color:'#fff',marginBottom:1}}>{a.title}</div><div style={{fontSize:11,color:'rgba(100,116,139,0.8)'}}>{a.sub}</div></div><div style={{marginLeft:'auto',color:'rgba(100,116,139,0.5)',fontSize:14}}>→</div></button>))}
            </div>
          )}

          {/* ══ DONE ══ */}
          {step==='report'&&importResult&&(
            <div style={{animation:'fadeUp 0.4s ease both',textAlign:'center',position:'relative',overflow:'hidden'}}>
              <div style={{position:'absolute',inset:0,animation:'flashPulse 1s ease-out 1',background:'rgba(33,230,243,0)',pointerEvents:'none'}}/>
              <div style={{width:52,height:52,borderRadius:18,background:GRAD,display:'flex',alignItems:'center',justifyContent:'center',fontSize:26,fontWeight:900,color:'#fff',margin:'0 auto 11px',boxShadow:'0 0 55px rgba(255,47,174,0.45),0 0 100px rgba(33,230,243,0.3)',animation:'glowPulse 2.5s ease-in-out infinite'}}>✓</div>
              <div style={EYE}>First Insights</div>
              <h1 style={{fontSize:23,fontWeight:900,color:'#F8FAFC',letterSpacing:'-0.025em',marginBottom:7}}>Your first insights are ready</h1>
              <p style={{fontSize:13,color:'rgba(166,168,189,0.85)',lineHeight:1.65,marginBottom:14}}>Here's a beautiful preview of what we found.</p>
              <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8,marginBottom:10}}>
                {[
                  {label:'Tips Imported',value:tipsDisplayed,color:CYAN,prefix:'',suffix:' tips',delay:'0s'},
                  {label:'Unique Fans',value:preview?.fansDetected||0,color:'#f59e0b',prefix:'',suffix:' fans',delay:'0.1s'},
                  {label:'Est. Earnings',value:parseFloat(preview?.estimatedEarnings||0),color:'#4ade80',prefix:'$',suffix:'',delay:'0.2s',decimals:2},
                  {label:'Top Spender',value:preview?.topSpender?.name||'—',color:PINK,isText:true,delay:'0.3s'},
                ].map(s=>(<div key={s.label} className="stat-card" style={{padding:'13px 13px',animation:`statCardIn 0.4s ease ${s.delay} both`}}>
                  <div style={{position:'absolute',top:0,left:0,right:0,height:'2px',borderRadius:'14px 14px 0 0',background:`linear-gradient(90deg,${s.color}00,${s.color}88,${s.color}00)`}}/>
                  <div style={{fontSize:9,color:'rgba(148,163,184,0.6)',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.14em',fontWeight:700}}>{s.label}</div>
                  <div style={{fontSize:s.isText?14:20,fontWeight:900,color:s.color,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {s.isText?s.value:<CountUp to={typeof s.value==='number'?s.value:0} prefix={s.prefix||''} suffix={s.suffix||''} duration={900} decimals={s.decimals||0}/>}
                  </div>
                </div>))}
              </div>

              {/* Paid sessions callout on done screen */}
              {importResult.paidInserted>0&&(
                <div style={{borderRadius:12,border:'1px solid rgba(255,47,174,0.2)',background:'rgba(255,47,174,0.04)',padding:'10px 13px',marginBottom:12,textAlign:'left',display:'flex',gap:9,alignItems:'flex-start'}}>
                  <span style={{fontSize:14,flexShrink:0}}>💳</span>
                  <div style={{fontSize:11,color:'rgba(203,213,225,0.8)',lineHeight:1.55}}>
                    <strong style={{color:PINK}}>{importResult.paidInserted} paid chat sessions</strong> were also imported and are tracked separately in your dashboard under Private Sessions.
                  </div>
                </div>
              )}

              <div style={{borderRadius:14,border:`1px solid ${PINK}33`,background:`rgba(255,47,174,0.05)`,padding:'13px 15px',marginBottom:14,textAlign:'left',display:'flex',gap:10}}>
                <span style={{fontSize:18,flexShrink:0}}>⚡</span>
                <div>
                  <div style={{fontSize:10,fontWeight:800,color:PINK,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>Best first insight</div>
                  {preview?.bestHour?(
                    // preview.bestHour is the single hour with the highest total
                    // token sum across the just-parsed rows (buildPreview() above)
                    // — no minimum-sample or confidence-tier requirement, unlike
                    // the dashboard's canonical bestWindow (session-based, median,
                    // requires 4+ sessions before it's shown as "your best time" at
                    // all). This preview can legitimately be one or two rows'
                    // worth of signal. "Your sweet spot" overstated that as a
                    // settled fact; framing it as an early read from this import
                    // — confirmed or revised once the dashboard has full session
                    // data — matches what this number actually is.
                    <p style={{fontSize:13,color:'rgba(248,250,252,0.9)',lineHeight:1.6}}>This import shows an early signal around <strong style={{color:PINK}}>{preview.bestHour}</strong> — your dashboard will confirm this once it has more sessions to work with.</p>
                  ):(
                    <p style={{fontSize:12,color:'rgba(148,163,184,0.7)',lineHeight:1.6}}>Import more history to unlock your peak streaming windows.</p>
                  )}
                </div>
              </div>

              <div style={{borderRadius:14,border:'1px solid rgba(255,255,255,0.07)',background:'rgba(255,255,255,0.03)',padding:'10px 13px',marginBottom:16,textAlign:'left',display:'flex',alignItems:'flex-start',gap:10}}>
                <div style={{fontSize:18,flexShrink:0}}>📧</div>
                <div><div style={{fontSize:12,fontWeight:800,color:'#fff',marginBottom:2}}>Check your email</div><div style={{fontSize:11,color:'rgba(148,163,184,0.7)',lineHeight:1.55}}>We sent you a walkthrough on importing more data. Use the <span style={{color:CYAN,fontWeight:600}}>CSV Importer</span> in your sidebar anytime.</div></div>
              </div>

              <div style={{borderRadius:12,border:'1px solid rgba(124,92,255,0.2)',background:'rgba(124,92,255,0.06)',padding:'10px 13px',marginBottom:12,textAlign:'left',display:'flex',gap:9,alignItems:'flex-start'}}>
                <span style={{fontSize:14,flexShrink:0}}>💡</span>
                <div style={{fontSize:11,color:'rgba(148,163,184,0.75)',lineHeight:1.55}}>
                  <strong style={{color:'rgba(203,213,225,0.9)'}}>To get the full potential of CamCash,</strong> import as much tip history as possible. Until you have a substantial number of sessions, your insights won't be as deep or accurate — but you can always add more later using the CSV Importer in your dashboard.
                </div>
              </div>

              {/* The report ends on a neutral Continue. The trial is its own
                  card (step 'trial') so the commercial terms — price, when
                  billing starts, how to cancel — get stated in full rather
                  than crammed under an insights grid. */}
              <OBBtn onClick={()=>setStep(userPlan==='pro'?'live':'trial')} style={{marginBottom:10}}>Continue →</OBBtn>
              <div style={{display:'grid',gridTemplateColumns:'1fr',gap:9}}>
                <OBSecBtn onClick={()=>{setPasteText('');setStep('paste')}} style={{width:'100%',height:44,fontSize:12}}>Add more history</OBSecBtn>
              </div>
            </div>
          )}

          {/* ══ OPTIONAL CREATOR PRO TRIAL ══
              Placed AFTER the report, so the offer arrives once the creator
              has seen what CamCash found in their own data — never before.
              It is genuinely optional: "Continue with Free" is a peer button,
              not a muted afterthought, and taking it is a single click with no
              confirmation step. Skipping is remembered (trialSkipped) so the
              card does not reappear later in the same run. */}
          {/* ══ FINAL — COMPLETION ══
              The sparkle belongs here: celebrate() fires on the way in from
              the Live Mode card, so the celebration marks the END of
              onboarding rather than burning behind a card still being read.
              The extension is referenced as an optional next step for anyone
              who has Pro; it never gates completion. */}
          {step==='done'&&(
            <div style={{animation:'fadeUp 0.4s ease both',textAlign:'center'}}>
              <div style={{width:52,height:52,borderRadius:18,background:GRAD,display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,color:'#fff',margin:'0 auto 11px',boxShadow:'0 0 44px rgba(33,230,243,0.32)'}}>✓</div>
              <div style={EYE}>All set</div>
              <h1 style={{fontSize:21,fontWeight:900,color:'#F8FAFC',letterSpacing:'-0.02em',marginBottom:7}}>You&apos;re done — your dashboard is ready</h1>
              <p style={{fontSize:13,color:'rgba(166,168,189,0.85)',lineHeight:1.6,maxWidth:430,margin:'0 auto 14px'}}>
                {userPlan==='pro'
                  ? "Your Creator Pro trial is active. Everything is unlocked on the data you just imported."
                  : "Your import is saved and your dashboard is built. You can start a Creator Pro trial any time from your dashboard."}
              </p>
              {userPlan==='pro'&&(
                <div style={{borderRadius:12,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(255,255,255,0.03)',padding:'10px 13px',marginBottom:12,fontSize:12,color:'rgba(148,163,184,0.85)',lineHeight:1.55,textAlign:'left'}}>
                  Optional: add the CamCash extension to capture tips automatically while you stream. Live Mode works without it.
                </div>
              )}
              <OBBtn onClick={()=>router.push('/dashboard')}>Go to my dashboard →</OBBtn>
            </div>
          )}

          {step==='trial'&&(
            <div style={{animation:'fadeUp 0.35s ease both'}}>
              <div style={{textAlign:'center',marginBottom:12}}>
                <div style={EYE}>Optional</div>
                <h1 style={{fontSize:20,fontWeight:900,color:'#fff',marginBottom:6}}>Try Creator Pro free for {TRIAL_DAYS} days</h1>
                <p style={{fontSize:13,color:'rgba(166,168,189,0.85)',lineHeight:1.6,maxWidth:430,margin:'0 auto'}}>
                  Pro reads your full history, ranks your supporters, and coaches you live while you stream.
                </p>
              </div>

              {trialAbandoned&&(
                <div style={{borderRadius:12,border:'1px solid rgba(245,158,11,0.3)',background:'rgba(245,158,11,0.08)',padding:'10px 13px',marginBottom:12,fontSize:12,color:'rgba(248,250,252,0.9)',lineHeight:1.55}}>
                  Checkout closed before it finished, so your trial hasn&apos;t started. You can try again or carry on with Free — your import is safe either way.
                </div>
              )}

              {/* The commercial terms, stated before the CTA rather than after
                  it. TRIAL_DAYS and PRO_PRICE_MONTHLY_LABEL are the canonical
                  constants; no price is retyped here. */}
              <div style={{borderRadius:14,border:'1px solid rgba(33,230,243,0.22)',background:'rgba(33,230,243,0.05)',padding:'13px 15px',marginBottom:14}}>
                {[
                  `Free for ${TRIAL_DAYS} days — every Pro feature, on your own data`,
                  'A credit card is required to start the trial',
                  `Billing begins after ${TRIAL_DAYS} days at ${PRO_PRICE_MONTHLY_LABEL}`,
                  'Cancel any time before then and you pay nothing',
                ].map(t=>(
                  <div key={t} style={{display:'flex',gap:8,alignItems:'flex-start',fontSize:12,color:'rgba(203,213,225,0.92)',lineHeight:1.55,marginBottom:6}}>
                    <span style={{color:CYAN,fontWeight:900,flexShrink:0}} aria-hidden="true">•</span>
                    <span>{t}</span>
                  </div>
                ))}
              </div>

              <OBBtn onClick={()=>{track('trial_cta_clicked',{source:'onboarding_trial'});setTrialAbandoned(false);router.push('/start-trial')}} style={{marginBottom:9}}>Start my {TRIAL_DAYS}-day free trial</OBBtn>
              <OBSecBtn onClick={()=>{track('trial_skipped',{source:'onboarding_trial'});setTrialSkipped(true);setStep('live')}} style={{width:'100%',height:44,fontSize:13}}>Continue with Free</OBSecBtn>
              <p style={{textAlign:'center',fontSize:11,color:'rgba(148,163,184,0.65)',lineHeight:1.5,marginTop:9}}>
                Free needs no card and keeps everything you just imported.
              </p>
            </div>
          )}

        </div>
      </div>
    </main>
  )
}
