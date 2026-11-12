"use client"
import React, { useState, useEffect, useRef } from "react"

// ─── DEMO DATA ────────────────────────────────────────────────────────────────
// Multi-platform streamer: Chaturbate, BongaCams, MyFreeCams
// Top-earning creator. Last imported ~1 week ago. High-earner numbers.

const DEMO_USER = { email: "demo@camcash.app" }

const C = {
  bg: "#05070f", card: "#121826", card2: "#161e2e", border: "#1e2d45", border2: "#2a3f5f",
  indigo: "#7C5CFF", cyan: "#22D3EE", pink: "#EC4899", gold: "#F59E0B", blue: "#60A5FA",
  green: "#10B981", red: "#F87171", orange: "#FB923C", white: "#F1F5F9", text: "#94A3B8", muted: "#475569"
}

const glassCard = {
  background: "rgba(15,20,32,0.75)",
  border: "1px solid rgba(255,255,255,0.08)",
  backdropFilter: "blur(20px)",
  boxShadow: "0 0 40px rgba(59,130,246,0.15), 0 0 80px rgba(236,72,153,0.08)",
}

const now = Date.now()
const daysAgo = (d) => new Date(now - d * 86400000).toISOString()
const hoursAgo = (h) => new Date(now - h * 3600000).toISOString()

// ─── TIPS ────────────────────────────────────────────────────────────────────
const DEMO_TIPS = [
  // Chaturbate — primary platform, highest earner
  { id:1,  username:"diamondkingx",   platform:"Chaturbate", tokens:20000, usd:1000, date_time: daysAgo(2),  tip_type:"tip",          tip_note:"you're unreal" },
  { id:2,  username:"vaultmaster99",  platform:"Chaturbate", tokens:10000, usd:500,  date_time: daysAgo(2),  tip_type:"tip",          tip_note:"my absolute favorite" },
  { id:3,  username:"cbwhale_elite",  platform:"Chaturbate", tokens:5000,  usd:250,  date_time: daysAgo(2),  tip_type:"tip",          tip_note:"" },
  { id:4,  username:"nightrider_cb",  platform:"Chaturbate", tokens:3000,  usd:150,  date_time: daysAgo(2),  tip_type:"tip",          tip_note:"" },
  { id:5,  username:"toptipper_x",    platform:"Chaturbate", tokens:2000,  usd:100,  date_time: daysAgo(2),  tip_type:"tip",          tip_note:"" },
  { id:6,  username:"diamondkingx",   platform:"Chaturbate", tokens:30000, usd:1500, date_time: daysAgo(4),  tip_type:"tip",          tip_note:"best show this month" },
  { id:7,  username:"vaultmaster99",  platform:"Chaturbate", tokens:15000, usd:750,  date_time: daysAgo(4),  tip_type:"tip",          tip_note:"" },
  { id:8,  username:"highroller88",   platform:"Chaturbate", tokens:8000,  usd:400,  date_time: daysAgo(4),  tip_type:"tip",          tip_note:"worth every token" },
  { id:9,  username:"cbwhale_elite",  platform:"Chaturbate", tokens:6000,  usd:300,  date_time: daysAgo(4),  tip_type:"tip",          tip_note:"" },
  { id:10, username:"nightrider_cb",  platform:"Chaturbate", tokens:4000,  usd:200,  date_time: daysAgo(4),  tip_type:"tip",          tip_note:"" },
  { id:11, username:"diamondkingx",   platform:"Chaturbate", tokens:40000, usd:2000, date_time: daysAgo(7),  tip_type:"tip",          tip_note:"my queen always" },
  { id:12, username:"vaultmaster99",  platform:"Chaturbate", tokens:20000, usd:1000, date_time: daysAgo(7),  tip_type:"tip",          tip_note:"" },
  { id:13, username:"highroller88",   platform:"Chaturbate", tokens:10000, usd:500,  date_time: daysAgo(7),  tip_type:"tip",          tip_note:"" },
  { id:14, username:"cbfan_ultra",    platform:"Chaturbate", tokens:5000,  usd:250,  date_time: daysAgo(7),  tip_type:"tip",          tip_note:"" },
  { id:15, username:"private_king",   platform:"Chaturbate", tokens:30000, usd:1500, date_time: daysAgo(7),  tip_type:"private show", tip_note:"" },
  { id:16, username:"daddy_premium",  platform:"Chaturbate", tokens:3000,  usd:150,  date_time: daysAgo(7),  tip_type:"tip",          tip_note:"" },
  { id:17, username:"diamondkingx",   platform:"Chaturbate", tokens:50000, usd:2500, date_time: daysAgo(14), tip_type:"tip",          tip_note:"legend" },
  { id:18, username:"vaultmaster99",  platform:"Chaturbate", tokens:25000, usd:1250, date_time: daysAgo(14), tip_type:"tip",          tip_note:"" },
  { id:19, username:"highroller88",   platform:"Chaturbate", tokens:12000, usd:600,  date_time: daysAgo(14), tip_type:"tip",          tip_note:"" },
  { id:20, username:"cbwhale_elite",  platform:"Chaturbate", tokens:8000,  usd:400,  date_time: daysAgo(21), tip_type:"tip",          tip_note:"" },
  { id:21, username:"diamondkingx",   platform:"Chaturbate", tokens:35000, usd:1750, date_time: daysAgo(21), tip_type:"tip",          tip_note:"you're the best" },
  { id:22, username:"vaultmaster99",  platform:"Chaturbate", tokens:18000, usd:900,  date_time: daysAgo(28), tip_type:"tip",          tip_note:"" },
  { id:23, username:"private_king",   platform:"Chaturbate", tokens:40000, usd:2000, date_time: daysAgo(28), tip_type:"private show", tip_note:"" },
  { id:24, username:"highroller88",   platform:"Chaturbate", tokens:15000, usd:750,  date_time: daysAgo(35), tip_type:"tip",          tip_note:"" },
  { id:25, username:"ghost_whale",    platform:"Chaturbate", tokens:20000, usd:1000, date_time: daysAgo(60), tip_type:"tip",          tip_note:"" },

  // BongaCams — second platform
  { id:26, username:"euro_titan",     platform:"BongaCams",  tokens:8000,  usd:400,  date_time: daysAgo(3),  tip_type:"tip",          tip_note:"" },
  { id:27, username:"bonga_whale_1",  platform:"BongaCams",  tokens:6000,  usd:300,  date_time: daysAgo(3),  tip_type:"tip",          tip_note:"incredible show" },
  { id:28, username:"bonga_premium",  platform:"BongaCams",  tokens:4000,  usd:200,  date_time: daysAgo(3),  tip_type:"tip",          tip_note:"" },
  { id:29, username:"euro_titan",     platform:"BongaCams",  tokens:10000, usd:500,  date_time: daysAgo(6),  tip_type:"tip",          tip_note:"" },
  { id:30, username:"bonga_whale_1",  platform:"BongaCams",  tokens:8000,  usd:400,  date_time: daysAgo(6),  tip_type:"tip",          tip_note:"" },
  { id:31, username:"nightfall_eu",   platform:"BongaCams",  tokens:5000,  usd:250,  date_time: daysAgo(10), tip_type:"tip",          tip_note:"" },
  { id:32, username:"euro_titan",     platform:"BongaCams",  tokens:12000, usd:600,  date_time: daysAgo(17), tip_type:"tip",          tip_note:"" },
  { id:33, username:"bonga_premium",  platform:"BongaCams",  tokens:6000,  usd:300,  date_time: daysAgo(17), tip_type:"tip",          tip_note:"" },
  { id:34, username:"bonga_whale_1",  platform:"BongaCams",  tokens:10000, usd:500,  date_time: daysAgo(24), tip_type:"tip",          tip_note:"" },
  { id:35, username:"euro_titan",     platform:"BongaCams",  tokens:15000, usd:750,  date_time: daysAgo(30), tip_type:"tip",          tip_note:"" },
  { id:36, username:"bonga_premium",  platform:"BongaCams",  tokens:4000,  usd:200,  date_time: daysAgo(45), tip_type:"tip",          tip_note:"" },

  // MyFreeCams — third platform
  { id:37, username:"mfc_godfather",  platform:"MyFreeCams", tokens:10000, usd:500,  date_time: daysAgo(2),  tip_type:"tip",          tip_note:"always worth it" },
  { id:38, username:"mfc_vip_99",     platform:"MyFreeCams", tokens:6000,  usd:300,  date_time: daysAgo(5),  tip_type:"tip",          tip_note:"" },
  { id:39, username:"mfc_godfather",  platform:"MyFreeCams", tokens:12000, usd:600,  date_time: daysAgo(9),  tip_type:"tip",          tip_note:"" },
  { id:40, username:"mfc_whale_x",    platform:"MyFreeCams", tokens:20000, usd:1000, date_time: daysAgo(12), tip_type:"tip",          tip_note:"stunning performance" },
  { id:41, username:"mfc_vip_99",     platform:"MyFreeCams", tokens:4000,  usd:200,  date_time: daysAgo(16), tip_type:"tip",          tip_note:"" },
  { id:42, username:"mfc_godfather",  platform:"MyFreeCams", tokens:8000,  usd:400,  date_time: daysAgo(20), tip_type:"tip",          tip_note:"" },
  { id:43, username:"mfc_whale_x",    platform:"MyFreeCams", tokens:15000, usd:750,  date_time: daysAgo(25), tip_type:"tip",          tip_note:"" },
  { id:44, username:"mfc_premium",    platform:"MyFreeCams", tokens:10000, usd:500,  date_time: daysAgo(32), tip_type:"tip",          tip_note:"" },
]
// Assign UTC hours to tips to create realistic peak patterns (CB peaks at 1 AM UTC, Bonga at 9 PM)
const HOUR_MAP = {
  "Chaturbate": [1, 1, 2, 1, 1, 2, 1, 2, 1, 1, 2, 1, 1, 0, 1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1],
  "BongaCams":  [21,21,22,21,21,22,21,22,21,21,21],
  "MyFreeCams": [23,23,0,23,23,0,23,0],
}
DEMO_TIPS.forEach((t, i) => {
  const hours = HOUR_MAP[t.platform] || [1]
  const h = hours[i % hours.length]
  const d = new Date(t.date_time)
  d.setUTCHours(h, Math.floor(Math.random()*60), 0, 0)
  t.date_time = d.toISOString()
  t.dateRaw = t.date_time
})

// ─── SESSIONS ────────────────────────────────────────────────────────────────
const DEMO_SESSIONS = [
  { id:"s1",  platform:"Chaturbate", startTime: new Date(daysAgo(2)).setUTCHours(1,0,0,0),  endTime: new Date(daysAgo(2)).setUTCHours(4,0,0,0),   totalUSD:2215, tipCount:5, uniqueFans:5, durationMinutes:180, durationHours:3,    usdPerHour:738,   usdPerMinute:12.3, avgTipSize:443,  velocityTrend:"growing",  topContributor:"diamondkingx",  topContributorPct:45, firstHalfUPM:9.2,  secondHalfUPM:15.4 },
  { id:"s2",  platform:"Chaturbate", startTime: new Date(daysAgo(4)).setUTCHours(1,0,0,0),  endTime: new Date(daysAgo(4)).setUTCHours(3,30,0,0),  totalUSD:3350, tipCount:5, uniqueFans:5, durationMinutes:150, durationHours:2.5,  usdPerHour:1340,  usdPerMinute:22.3, avgTipSize:670,  velocityTrend:"above",    topContributor:"diamondkingx",  topContributorPct:44, firstHalfUPM:18.5, secondHalfUPM:26.1 },
  { id:"s3",  platform:"BongaCams",  startTime: new Date(daysAgo(3)).setUTCHours(21,0,0,0), endTime: new Date(daysAgo(3)).setUTCHours(23,0,0,0),  totalUSD:900,  tipCount:3, uniqueFans:3, durationMinutes:120, durationHours:2,    usdPerHour:450,   usdPerMinute:7.5,  avgTipSize:300,  velocityTrend:"steady",   topContributor:"euro_titan",    topContributorPct:44, firstHalfUPM:6.2,  secondHalfUPM:8.8 },
  { id:"s4",  platform:"Chaturbate", startTime: new Date(daysAgo(7)).setUTCHours(1,0,0,0),  endTime: new Date(daysAgo(7)).setUTCHours(4,30,0,0),  totalUSD:5900, tipCount:6, uniqueFans:5, durationMinutes:210, durationHours:3.5,  usdPerHour:1686,  usdPerMinute:28.1, avgTipSize:983,  velocityTrend:"growing",  topContributor:"diamondkingx",  topContributorPct:42, firstHalfUPM:22.0, secondHalfUPM:34.2 },
  { id:"s5",  platform:"MyFreeCams", startTime: new Date(daysAgo(2)).setUTCHours(23,0,0,0), endTime: new Date(daysAgo(2)).setUTCHours(1,0,0,0),   totalUSD:1300, tipCount:3, uniqueFans:3, durationMinutes:120, durationHours:2,    usdPerHour:650,   usdPerMinute:10.8, avgTipSize:433,  velocityTrend:"above",    topContributor:"mfc_whale_x",   topContributorPct:77, firstHalfUPM:7.2,  secondHalfUPM:14.4 },
  { id:"s6",  platform:"BongaCams",  startTime: new Date(daysAgo(6)).setUTCHours(21,0,0,0), endTime: new Date(daysAgo(6)).setUTCHours(23,30,0,0), totalUSD:1250, tipCount:3, uniqueFans:3, durationMinutes:150, durationHours:2.5,  usdPerHour:500,   usdPerMinute:8.3,  avgTipSize:417,  velocityTrend:"above",    topContributor:"euro_titan",    topContributorPct:60, firstHalfUPM:6.0,  secondHalfUPM:10.7 },
  { id:"s7",  platform:"MyFreeCams", startTime: new Date(daysAgo(5)).setUTCHours(23,0,0,0), endTime: new Date(daysAgo(5)).setUTCHours(1,30,0,0),  totalUSD:1800, tipCount:3, uniqueFans:2, durationMinutes:150, durationHours:2.5,  usdPerHour:720,   usdPerMinute:12.0, avgTipSize:600,  velocityTrend:"growing",  topContributor:"mfc_godfather", topContributorPct:56, firstHalfUPM:9.5,  secondHalfUPM:14.5 },
  { id:"s8",  platform:"Chaturbate", startTime: new Date(daysAgo(14)).setUTCHours(1,0,0,0), endTime: new Date(daysAgo(14)).setUTCHours(4,0,0,0),  totalUSD:4500, tipCount:5, uniqueFans:4, durationMinutes:180, durationHours:3,    usdPerHour:1500,  usdPerMinute:25.0, avgTipSize:900,  velocityTrend:"steady",   topContributor:"diamondkingx",  topContributorPct:55, firstHalfUPM:19.5, secondHalfUPM:30.5 },
  { id:"s9",  platform:"MyFreeCams", startTime: new Date(daysAgo(9)).setUTCHours(23,0,0,0), endTime: new Date(daysAgo(9)).setUTCHours(2,0,0,0),   totalUSD:1750, tipCount:3, uniqueFans:3, durationMinutes:180, durationHours:3,    usdPerHour:583,   usdPerMinute:9.7,  avgTipSize:583,  velocityTrend:"growing",  topContributor:"mfc_whale_x",   topContributorPct:57, firstHalfUPM:7.0,  secondHalfUPM:12.4 },
  { id:"s10", platform:"Chaturbate", startTime: new Date(daysAgo(21)).setUTCHours(1,0,0,0), endTime: new Date(daysAgo(21)).setUTCHours(5,0,0,0),  totalUSD:7250, tipCount:5, uniqueFans:3, durationMinutes:240, durationHours:4,    usdPerHour:1813,  usdPerMinute:30.2, avgTipSize:1450, velocityTrend:"above",    topContributor:"diamondkingx",  topContributorPct:69, firstHalfUPM:24.0, secondHalfUPM:36.4 },
]
DEMO_SESSIONS.forEach(s => {
  s.startTime = new Date(s.startTime).toISOString()
  s.endTime   = new Date(s.endTime).toISOString()
  s.tips      = DEMO_TIPS.filter(t => t.platform === s.platform && Math.abs(new Date(t.date_time) - new Date(s.startTime)) < 4*3600000)
  s.durationUnknown = false
})

// ─── WHALES ──────────────────────────────────────────────────────────────────
const DEMO_WHALES = [
  { username:"diamondkingx",  platform:"Chaturbate", totalUSD:9750, tipCount:7,  avgTipSize:1392.9, tier:"Whale",   lastTipDate:daysAgo(2),  daysSinceLastTip:2,  avgDaysBetweenTips:7,  churnRisk:{level:"Low"},    tipProbability:{level:"High"},   spendPercentile:99, typicalOnlineHours:"1–2 AM UTC",  lifetimeValue:{monthly:2800}, hasPrivates:false, privateCount:0, tipNotes:["you're unreal","best show this month","my queen always","legend","you're the best"], tips:DEMO_TIPS.filter(t=>t.username==="diamondkingx") },
  { username:"vaultmaster99", platform:"Chaturbate", totalUSD:4400, tipCount:5,  avgTipSize:880,    tier:"Whale",   lastTipDate:daysAgo(2),  daysSinceLastTip:2,  avgDaysBetweenTips:10, churnRisk:{level:"Low"},    tipProbability:{level:"High"},   spendPercentile:98, typicalOnlineHours:"1–3 AM UTC",  lifetimeValue:{monthly:1200}, hasPrivates:false, privateCount:0, tipNotes:["my absolute favorite"],   tips:DEMO_TIPS.filter(t=>t.username==="vaultmaster99") },
  { username:"private_king",  platform:"Chaturbate", totalUSD:3500, tipCount:2,  avgTipSize:1750,   tier:"Whale",   lastTipDate:daysAgo(7),  daysSinceLastTip:7,  avgDaysBetweenTips:21, churnRisk:{level:"Low"},    tipProbability:{level:"Medium"}, spendPercentile:97, typicalOnlineHours:"1 AM UTC",    lifetimeValue:{monthly:700},  hasPrivates:true,  privateCount:2, tipNotes:[],                          tips:DEMO_TIPS.filter(t=>t.username==="private_king") },
  { username:"highroller88",  platform:"Chaturbate", totalUSD:1850, tipCount:4,  avgTipSize:462.5,  tier:"Whale",   lastTipDate:daysAgo(4),  daysSinceLastTip:4,  avgDaysBetweenTips:11, churnRisk:{level:"Low"},    tipProbability:{level:"High"},   spendPercentile:96, typicalOnlineHours:"1–2 AM UTC",  lifetimeValue:{monthly:500},  hasPrivates:false, privateCount:0, tipNotes:["worth every token"],      tips:DEMO_TIPS.filter(t=>t.username==="highroller88") },
  { username:"euro_titan",    platform:"BongaCams",  totalUSD:2250, tipCount:5,  avgTipSize:450,    tier:"Whale",   lastTipDate:daysAgo(3),  daysSinceLastTip:3,  avgDaysBetweenTips:9,  churnRisk:{level:"Low"},    tipProbability:{level:"High"},   spendPercentile:95, typicalOnlineHours:"9–10 PM UTC", lifetimeValue:{monthly:620},  hasPrivates:false, privateCount:0, tipNotes:[],                          tips:DEMO_TIPS.filter(t=>t.username==="euro_titan") },
  { username:"mfc_whale_x",   platform:"MyFreeCams", totalUSD:1750, tipCount:2,  avgTipSize:875,    tier:"Whale",   lastTipDate:daysAgo(12), daysSinceLastTip:12, avgDaysBetweenTips:13, churnRisk:{level:"Medium"}, tipProbability:{level:"Medium"}, spendPercentile:94, typicalOnlineHours:"11 PM UTC",   lifetimeValue:{monthly:420},  hasPrivates:false, privateCount:0, tipNotes:["stunning performance"],   tips:DEMO_TIPS.filter(t=>t.username==="mfc_whale_x") },
  { username:"bonga_whale_1", platform:"BongaCams",  totalUSD:1200, tipCount:3,  avgTipSize:400,    tier:"Shark",   lastTipDate:daysAgo(3),  daysSinceLastTip:3,  avgDaysBetweenTips:10, churnRisk:{level:"Low"},    tipProbability:{level:"High"},   spendPercentile:91, typicalOnlineHours:"9 PM UTC",    lifetimeValue:{monthly:360},  hasPrivates:false, privateCount:0, tipNotes:["incredible show"],         tips:DEMO_TIPS.filter(t=>t.username==="bonga_whale_1") },
  { username:"mfc_godfather", platform:"MyFreeCams", totalUSD:1500, tipCount:4,  avgTipSize:375,    tier:"Shark",   lastTipDate:daysAgo(2),  daysSinceLastTip:2,  avgDaysBetweenTips:9,  churnRisk:{level:"Low"},    tipProbability:{level:"High"},   spendPercentile:90, typicalOnlineHours:"11 PM UTC",   lifetimeValue:{monthly:420},  hasPrivates:false, privateCount:0, tipNotes:["always worth it"],         tips:DEMO_TIPS.filter(t=>t.username==="mfc_godfather") },
  { username:"cbwhale_elite", platform:"Chaturbate", totalUSD:950,  tipCount:3,  avgTipSize:316.7,  tier:"Shark",   lastTipDate:daysAgo(7),  daysSinceLastTip:7,  avgDaysBetweenTips:11, churnRisk:{level:"Low"},    tipProbability:{level:"Medium"}, spendPercentile:87, typicalOnlineHours:"1 AM UTC",    lifetimeValue:{monthly:280},  hasPrivates:false, privateCount:0, tipNotes:[],                          tips:DEMO_TIPS.filter(t=>t.username==="cbwhale_elite") },
  { username:"nightrider_cb", platform:"Chaturbate", totalUSD:350,  tipCount:2,  avgTipSize:175,    tier:"Regular", lastTipDate:daysAgo(2),  daysSinceLastTip:2,  avgDaysBetweenTips:14, churnRisk:{level:"Low"},    tipProbability:{level:"High"},   spendPercentile:78, typicalOnlineHours:"1 AM UTC",    lifetimeValue:{monthly:98},   hasPrivates:false, privateCount:0, tipNotes:[],                          tips:DEMO_TIPS.filter(t=>t.username==="nightrider_cb") },
  { username:"bonga_premium", platform:"BongaCams",  totalUSD:700,  tipCount:3,  avgTipSize:233.3,  tier:"Regular", lastTipDate:daysAgo(3),  daysSinceLastTip:3,  avgDaysBetweenTips:15, churnRisk:{level:"Low"},    tipProbability:{level:"High"},   spendPercentile:76, typicalOnlineHours:"9 PM UTC",    lifetimeValue:{monthly:185},  hasPrivates:false, privateCount:0, tipNotes:[],                          tips:DEMO_TIPS.filter(t=>t.username==="bonga_premium") },
  { username:"mfc_vip_99",    platform:"MyFreeCams", totalUSD:500,  tipCount:2,  avgTipSize:250,    tier:"Regular", lastTipDate:daysAgo(5),  daysSinceLastTip:5,  avgDaysBetweenTips:11, churnRisk:{level:"Low"},    tipProbability:{level:"Medium"}, spendPercentile:73, typicalOnlineHours:"11 PM UTC",   lifetimeValue:{monthly:145},  hasPrivates:false, privateCount:0, tipNotes:[],                          tips:DEMO_TIPS.filter(t=>t.username==="mfc_vip_99") },
  { username:"mfc_premium",   platform:"MyFreeCams", totalUSD:500,  tipCount:1,  avgTipSize:500,    tier:"Regular", lastTipDate:daysAgo(32), daysSinceLastTip:32, avgDaysBetweenTips:32, churnRisk:{level:"High"},   tipProbability:{level:"Low"},    spendPercentile:71, typicalOnlineHours:"Unknown",     lifetimeValue:{monthly:60},   hasPrivates:false, privateCount:0, tipNotes:[],                          tips:DEMO_TIPS.filter(t=>t.username==="mfc_premium") },
  { username:"nightfall_eu",  platform:"BongaCams",  totalUSD:250,  tipCount:1,  avgTipSize:250,    tier:"Regular", lastTipDate:daysAgo(10), daysSinceLastTip:10, avgDaysBetweenTips:30, churnRisk:{level:"Low"},    tipProbability:{level:"Low"},    spendPercentile:60, typicalOnlineHours:"Unknown",     lifetimeValue:{monthly:55},   hasPrivates:false, privateCount:0, tipNotes:[],                          tips:[] },
  { username:"ghost_whale",   platform:"Chaturbate", totalUSD:1000, tipCount:1,  avgTipSize:1000,   tier:"Dormant", lastTipDate:daysAgo(60), daysSinceLastTip:60, avgDaysBetweenTips:60, churnRisk:{level:"Critical"},tipProbability:{level:"Low"},    spendPercentile:88, typicalOnlineHours:"Unknown",     lifetimeValue:{monthly:50},   hasPrivates:false, privateCount:0, tipNotes:[],                          tips:[] },
]

// ─── ANALYTICS ───────────────────────────────────────────────────────────────
const DEMO_ANALYTICS = {
  totalUSD: DEMO_TIPS.reduce((s,t) => s+t.usd, 0),
  sessions: DEMO_SESSIONS,
  whales: DEMO_WHALES,
  platforms: [
    { platform:"Chaturbate", totalUSD:26650, sessions:6, hours:22,  usdPerHour:1211.4, avgTipSize:743.3, tipCount:21 },
    { platform:"BongaCams",  totalUSD:3500,  sessions:2, hours:4.5, usdPerHour:777.8,  avgTipSize:354.5, tipCount:11 },
    { platform:"MyFreeCams", totalUSD:3550,  sessions:3, hours:7.5, usdPerHour:473.3,  avgTipSize:443.8, tipCount:8  },
  ],
  bestHour: { hour: 1, avg: 1450 },
  bestDay:  { day: "Thursday", avg: 6200 },
  insights: [
    { icon:"💡", text:"You earn 2.6x more on Chaturbate than MyFreeCams per hour — prioritize CB for high-effort streams" },
    { icon:"📅", text:"Thursdays are your best day — you average $6,200 on Thursdays vs $1,800 on other days" },
    { icon:"🔁", text:"diamondkingx tips every 7 days on average — they're due again today" },
    { icon:"⏰", text:"1–2 AM UTC is your peak window — 89% of your top earnings happen in this 2-hour block" },
    { icon:"🐳", text:"Your top 3 fans = 72% of all-time revenue — strong loyalty, moderate concentration risk" },
    { icon:"💎", text:"private_king has booked 2 private shows — they're a strong candidate for a personal outreach" },
  ],
  platformVelocity:    { Chaturbate:1211.4, BongaCams:777.8, MyFreeCams:473.3 },
  platformBestTimes:   {
    Chaturbate: { hour:{ hour:1, avg:1450 }, bestDay:{ day:"Thursday", avg:6200 },
      bestHourByDay:{ Monday:{hour:1,avg:1100}, Tuesday:{hour:1,avg:1350}, Wednesday:{hour:1,avg:1200}, Thursday:{hour:1,avg:6200}, Friday:{hour:1,avg:2100}, Saturday:{hour:2,avg:1800}, Sunday:{hour:1,avg:1400} } },
    BongaCams:  { hour:{ hour:21, avg:620 },  bestDay:{ day:"Wednesday", avg:1250 },
      bestHourByDay:{ Monday:{hour:21,avg:580}, Tuesday:{hour:21,avg:550}, Wednesday:{hour:21,avg:1250}, Thursday:{hour:21,avg:700}, Friday:{hour:22,avg:900}, Saturday:{hour:21,avg:680}, Sunday:{hour:21,avg:520} } },
    MyFreeCams: { hour:{ hour:23, avg:580 },  bestDay:{ day:"Saturday", avg:1750 },
      bestHourByDay:{ Monday:{hour:23,avg:420}, Tuesday:{hour:23,avg:480}, Wednesday:{hour:0,avg:550}, Thursday:{hour:23,avg:620}, Friday:{hour:23,avg:680}, Saturday:{hour:23,avg:1750}, Sunday:{hour:0,avg:500} } },
  },
  earningsVelocity: 965.4,
  missedRevenueByPlatform: {
    BongaCams:  { missedRevenue:280, bestHourAvg:900,  overallAvg:620  },
    MyFreeCams: { missedRevenue:180, bestHourAvg:580,  overallAvg:400  },
  },
  returningVsNew:  { multiplier:5.8, returningPct:71 },
  topFanDependency:{ top1Pct:42, top3Pct:72 },
  monthlyData: [
    { month:"2025-11", usd:18400, tips:62,  fans:14, sessions:18, usdPerFan:1314.3 },
    { month:"2025-12", usd:24600, tips:78,  fans:16, sessions:22, usdPerFan:1537.5 },
    { month:"2026-01", usd:31200, tips:89,  fans:17, sessions:26, usdPerFan:1835.3 },
    { month:"2026-02", usd:28800, tips:84,  fans:15, sessions:24, usdPerFan:1920.0 },
    { month:"2026-03", usd:42500, tips:104, fans:18, sessions:31, usdPerFan:2361.1 },
    { month:"2026-04", usd:38900, tips:96,  fans:17, sessions:29, usdPerFan:2288.2 },
    { month:"2026-05", usd:19700, tips:44,  fans:12, sessions:14, usdPerFan:1641.7 },
  ],
  bestMonth: { month:"2026-03", usd:42500, fans:18, tips:104, usdPerFan:2361.1 },
  tipTypeBreakdown: [
    { type:"Tips",         usd:29700, count:42, fans:15, pct:88, avgUsd:707.1 },
    { type:"Private Show", usd:3500,  count:2,  fans:1,  pct:10, avgUsd:1750  },
    { type:"Spy Show",     usd:500,   count:2,  fans:2,  pct:2,  avgUsd:250   },
  ],
  privateShowFans: [{ username:"private_king", count:2, usd:3500 }],
  spyShowFans: ["nightrider_cb", "cbfan_ultra"],
  // preTipBehavior/trueHourlyAvg removed — the dashboard features they
  // previewed were deleted as dead UI (permanently-null analytics fields
  // whose cards could never render). A marketing demo must not advertise a
  // card the product doesn't ship. The Revenue Concentration card below
  // stays: analytics.dependencyRisk is now genuinely implemented, and this
  // demo's own top1=42%/top3=72% "Moderate concentration" wording is the
  // cross-check the real thresholds were validated against.
  dependencyRisk: null,
  whaleAlerts: [], lossAlerts: [], nextMoves: [],
  bestDay: { day:"Thursday", avg:6200 },
}

const DEMO_TOTAL_REVENUE = DEMO_ANALYTICS.totalUSD
const DEMO_AVG_PER_HOUR  = 965.4

// ─── DAILY BRIEF ─────────────────────────────────────────────────────────────
const buildDemoDailyBrief = () => {
  const now2 = new Date()
  const utcHour = now2.getUTCHours()
  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const todayName = DAYS[now2.getUTCDay()]
  const bh = 1
  const bhLabel = "1 AM"
  const hoursUntilPeak = (bh - utcHour + 24) % 24
  const atPeak = hoursUntilPeak <= 1
  return {
    todayName, bhLabel, bh, atPeak, hoursUntilPeak,
    displayPlat:"Chaturbate", displayAvg:1450,
    isBestDay: todayName === "Thursday",
    predictionLow:1100, predictionHigh:2200,
    reengageFans: DEMO_WHALES.filter(w=>w.daysSinceLastTip>14&&w.totalUSD>50).slice(0,3),
    likelyOnline: DEMO_WHALES.filter(w=>w.tipProbability?.level==="High").slice(0,2),
    platTodayStats: {
      Chaturbate: { todayBestHour:"1 AM", todayBestAvg:162 },
      BongaCams:  { todayBestHour:"9 PM", todayBestAvg:87  },
    }
  }
}

const TIER_COLORS = { "Whale":"#F59E0B", "Shark":"#60A5FA", "Regular":"#22D3EE", "Dormant":"#FB923C" }
const formatHour = h => h===0?"12 AM":h<12?`${h} AM`:h===12?"12 PM":`${h-12} PM`

// ─── SIDEBAR SECTIONS ────────────────────────────────────────────────────────
const SECTIONS = [
  { id:"main", label:null, items:[{ id:"overview", icon:"⚡", label:"Command Center" }] },
  { id:"fans", label:"FAN CRM", items:[{ id:"whales", icon:"👑", label:"Top Fans" }] },
  { id:"analytics", label:"ANALYTICS", items:[
    { id:"platforms", icon:"🎯", label:"Platforms" },
    { id:"sessions",  icon:"🎥", label:"Sessions"  },
    { id:"monthly",   icon:"📈", label:"Monthly"   },
    { id:"moneymap",  icon:"🗺️", label:"Money Map" },
    { id:"plan",      icon:"📅", label:"Streaming Plan" },
  ]},
  { id:"tools", label:"TOOLS", items:[
    { id:"live",   icon:"🔴", label:"Live Mode"   },
    { id:"titles", icon:"🎬", label:"Room Titles" },
    { id:"upload", icon:"📥", label:"Upload Data" },
  ]},
]
const BOTTOM_ITEMS = [{ id:"demo_cta", icon:"🚀", label:"Start Free" }]

// ─── DEMO SIDEBAR ────────────────────────────────────────────────────────────
function DemoSidebar({ activeTab, onTabChange }) {
  const [hoveredId, setHoveredId] = useState(null)
  const [mobileOpen, setMobileOpen] = useState(false)

  const renderItem = (id, icon, label) => {
    const isActive  = activeTab === id
    const isHovered = hoveredId === id
    return (
      <button key={id}
        onClick={() => { onTabChange(id); setMobileOpen(false) }}
        onMouseEnter={() => setHoveredId(id)}
        onMouseLeave={() => setHoveredId(null)}
        style={{
          width:"100%", display:"flex", alignItems:"center", gap:10,
          padding:"8px 12px", borderRadius:9,
          border: isActive?"1px solid rgba(59,130,246,0.3)":"1px solid transparent",
          cursor:"pointer", textAlign:"left",
          fontSize:13, fontWeight:isActive?600:400,
          color: isActive?"#F1F5F9":isHovered?"#94A3B8":"#4B5E78",
          background: isActive?"linear-gradient(135deg,rgba(59,130,246,0.18),rgba(236,72,153,0.13))":isHovered?"rgba(255,255,255,0.04)":"transparent",
          position:"relative", overflow:"hidden", transition:"all 0.15s ease",
        }}
      >
        {isActive && <div style={{ position:"absolute", left:0, top:"18%", bottom:"18%", width:2.5, borderRadius:2, background:"linear-gradient(180deg,#22D3EE,#EC4899)", boxShadow:"0 0 6px rgba(34,211,238,0.6)" }} />}
        <span style={{ fontSize:15, lineHeight:1, flexShrink:0, filter:isActive?"drop-shadow(0 0 4px rgba(34,211,238,0.45))":isHovered?"brightness(1.3)":"brightness(0.8)" }}>{icon}</span>
        <span style={{ lineHeight:1 }}>{label}</span>
        {id==="overview"&&isActive && <div style={{ marginLeft:"auto", width:6, height:6, borderRadius:"50%", background:"#10B981", boxShadow:"0 0 6px #10B981", animation:"pulse-demo 2s infinite" }} />}
      </button>
    )
  }

  const sidebarStyle = { width:220, display:"flex", flexDirection:"column", zIndex:50, background:"linear-gradient(180deg,#0a0d1a 0%,#070910 100%)", borderRight:"1px solid rgba(255,255,255,0.06)", boxShadow:"inset -1px 0 0 rgba(124,92,255,0.07), 2px 0 20px rgba(0,0,0,0.4)" }

  const content = (
    <>
      <style>{`
        .demo-sidebar-scroll::-webkit-scrollbar{width:2px}
        .demo-sidebar-scroll::-webkit-scrollbar-thumb{background:rgba(124,92,255,0.2);border-radius:2px}
        @keyframes pulse-demo{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.6;transform:scale(1.3)}}
      `}</style>
      {/* Header */}
      <div style={{ padding:"16px 16px 14px", borderBottom:"1px solid rgba(255,255,255,0.05)", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:8 }}>
          <div style={{ width:30, height:30, borderRadius:9, background:"linear-gradient(135deg,#22D3EE,#EC4899)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, fontWeight:800, color:"#fff", boxShadow:"0 0 12px rgba(34,211,238,0.3)", flexShrink:0 }}>$</div>
          <span style={{ fontSize:17, fontWeight:800, color:"#F1F5F9", letterSpacing:-0.3 }}>Cam<span style={{ background:"linear-gradient(90deg,#22D3EE,#EC4899)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Cash</span></span>
        </div>
        <div style={{ fontSize:10, color:"#2d3f55", marginBottom:10 }}>demo@camcash.app</div>
        <div style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 10px", borderRadius:7, background:"linear-gradient(135deg,rgba(124,92,255,0.13),rgba(34,211,238,0.07))", border:"1px solid rgba(124,92,255,0.25)" }}>
          <div style={{ width:6, height:6, borderRadius:"50%", background:"#7C5CFF", boxShadow:"0 0 5px #7C5CFF", flexShrink:0 }} />
          <div>
            <div style={{ fontSize:10, fontWeight:700, color:"#A78BFA", letterSpacing:0.5 }}>DEMO MODE</div>
            <div style={{ fontSize:9, color:"#7C5CFF" }}>Sample data — sign up to use yours</div>
          </div>
        </div>
      </div>
      {/* Nav */}
      <div className="demo-sidebar-scroll" style={{ flex:1, overflowY:"auto", overflowX:"hidden", padding:"10px 10px 6px", display:"flex", flexDirection:"column", gap:2, minHeight:0 }}>
        {SECTIONS.map((section, si) => (
          <div key={section.id} style={{ marginTop:si>0?14:0 }}>
            {section.label && <div style={{ fontSize:9, fontWeight:700, letterSpacing:1.5, color:"#1e3a52", textTransform:"uppercase", padding:"0 10px 5px" }}>{section.label}</div>}
            <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
              {section.items.map(item => renderItem(item.id, item.icon, item.label))}
            </div>
          </div>
        ))}
      </div>
      {/* Bottom CTA */}
      <div style={{ padding:"8px 10px 14px", borderTop:"1px solid rgba(255,255,255,0.04)", flexShrink:0 }}>
        <a href="/landing" style={{ display:"block", textDecoration:"none", padding:"10px 14px", borderRadius:10, background:"linear-gradient(135deg,#22D3EE,#EC4899)", textAlign:"center", fontSize:13, fontWeight:700, color:"white", boxShadow:"0 0 20px rgba(34,211,238,0.3)" }}>
          🚀 Start Free — Use My Data
        </a>
      </div>
    </>
  )

  return (
    <>
      <div style={{ position:"fixed", left:0, top:0, bottom:0, ...sidebarStyle }}>{content}</div>
      <button onClick={() => setMobileOpen(true)} className="demo-mobile-btn" style={{ display:"none", position:"fixed", top:16, left:16, zIndex:100, width:40, height:40, borderRadius:10, background:"rgba(10,13,26,0.95)", border:"1px solid rgba(255,255,255,0.1)", color:"#F1F5F9", fontSize:18, alignItems:"center", justifyContent:"center", cursor:"pointer" }}>☰</button>
      {mobileOpen && <div onClick={() => setMobileOpen(false)} style={{ position:"fixed", inset:0, zIndex:98, background:"rgba(0,0,0,0.6)", backdropFilter:"blur(4px)" }} />}
      <div style={{ display:mobileOpen?"flex":"none", flexDirection:"column", position:"fixed", left:0, top:0, bottom:0, zIndex:99, ...sidebarStyle }}>{content}</div>
      <style>{`@media(max-width:768px){.demo-mobile-btn{display:flex!important}}`}</style>
    </>
  )
}


// ─── WALKTHROUGH OVERLAY ─────────────────────────────────────────────────────
const WALKTHROUGH_STEPS = [
  {
    id: "revenue",
    icon: "💰",
    title: "Revenue Overview",
    body: "Your Command Center shows exactly what to do right now to maximize earnings — updated based on your real streaming history.",
    target: "overview",
    position: "bottom",
  },
  {
    id: "fans",
    icon: "👑",
    title: "Top Fan Tracking",
    body: "Every high-value fan ranked by lifetime spend, churn risk, and engagement probability. Know who to message before they go cold.",
    target: "whales",
    position: "right",
  },
  {
    id: "timing",
    icon: "⏰",
    title: "Stream Optimization",
    body: "Your personal peak hours calculated from your own tip history — not generic advice. Know exactly when to go live on each platform.",
    target: "platforms",
    position: "bottom",
  },
  {
    id: "ai",
    icon: "⚡",
    title: "AI Recommendations",
    body: "Live Opportunities fires real-time alerts — which fans are active, who's close to a milestone, and which messages to send right now.",
    target: "overview",
    position: "bottom",
  },
  {
    id: "multiplatform",
    icon: "🎯",
    title: "Multi-Platform Analytics",
    body: "Compare $/hr across Chaturbate, BongaCams, and MyFreeCams. See exactly where your time is worth the most.",
    target: "platforms",
    position: "bottom",
  },
]

function WalkthroughOverlay({ onComplete, onTabChange }) {
  const [step, setStep] = React.useState(0)
  const [visible, setVisible] = React.useState(true)
  const current = WALKTHROUGH_STEPS[step]
  const isLast = step === WALKTHROUGH_STEPS.length - 1

  const handleNext = () => {
    if (isLast) { setVisible(false); onComplete(); return }
    const next = WALKTHROUGH_STEPS[step + 1]
    if (next.target !== current.target) onTabChange(next.target)
    setStep(s => s + 1)
  }
  const handleSkip = () => { setVisible(false); onComplete() }

  if (!visible) return null

  return (
    <div style={{ position:"fixed", inset:0, zIndex:500, pointerEvents:"none" }}>
      {/* Dim overlay — subtle not blocking */}
      <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.45)", pointerEvents:"all" }} onClick={handleSkip} />
      {/* Step card — bottom center */}
      <div style={{
        position:"absolute", bottom:32, left:"50%", transform:"translateX(-50%)",
        width:"min(480px,calc(100vw - 32px))",
        background:"linear-gradient(135deg,rgba(8,12,24,0.98),rgba(15,20,35,0.98))",
        border:"1px solid rgba(34,211,238,0.35)",
        borderRadius:20, padding:"24px 28px",
        boxShadow:"0 0 0 1px rgba(34,211,238,0.08), 0 40px 80px rgba(0,0,0,0.8), 0 0 40px rgba(34,211,238,0.12)",
        pointerEvents:"all",
        backdropFilter:"blur(24px)",
      }}>
        {/* Progress dots */}
        <div style={{ display:"flex", gap:6, marginBottom:18 }}>
          {WALKTHROUGH_STEPS.map((_,i) => (
            <div key={i} style={{ height:3, borderRadius:2, flex:1, background:i===step?"linear-gradient(90deg,#22D3EE,#EC4899)":i<step?"rgba(34,211,238,0.3)":"rgba(255,255,255,0.08)", transition:"all 0.3s" }} />
          ))}
        </div>
        {/* Content */}
        <div style={{ display:"flex", gap:16, marginBottom:20 }}>
          <div style={{ width:44, height:44, borderRadius:12, background:"linear-gradient(135deg,rgba(34,211,238,0.15),rgba(236,72,153,0.1))", border:"1px solid rgba(34,211,238,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>{current.icon}</div>
          <div>
            <div style={{ fontSize:15, fontWeight:800, color:"#F1F5F9", marginBottom:6 }}>{current.title}</div>
            <div style={{ fontSize:13, color:"#64748B", lineHeight:1.65 }}>{current.body}</div>
          </div>
        </div>
        {/* Actions */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <button onClick={handleSkip} style={{ background:"none", border:"none", color:"#334155", fontSize:13, cursor:"pointer", padding:"4px 0" }}>
            Skip tour
          </button>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:12, color:"#334155" }}>{step+1} of {WALKTHROUGH_STEPS.length}</span>
            <button onClick={handleNext} style={{ padding:"9px 22px", borderRadius:10, background:"linear-gradient(135deg,#22D3EE,#EC4899)", border:"none", color:"white", fontSize:13, fontWeight:700, cursor:"pointer", boxShadow:"0 0 20px rgba(34,211,238,0.3)" }}>
              {isLast ? "Explore →" : "Next →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── MAIN DEMO DASHBOARD ─────────────────────────────────────────────────────
const VALID_TABS = new Set(["overview","whales","platforms","sessions","monthly","moneymap","plan","live","titles","upload"])

export default function DemoDashboard() {
  const [activeTab, setActiveTab]         = useState("overview")
  const [selectedWhale, setSelectedWhale] = useState(null)
  const [messageTarget, setMessageTarget] = useState(null)
  const [messageIndex, setMessageIndex]   = useState(0)
  const [messageCopied, setMessageCopied] = useState(false)
  const [toast, setToast]                 = useState("")
  const [whaleFilter, setWhaleFilter]     = useState("ALL")
  const [platformFilter, setPlatformFilter] = useState("ALL")
  const [chartDrillDay, setChartDrillDay] = useState(null)
  const [platformTimeFilter, setPlatformTimeFilter] = useState("ALL")
  const [expandAlerts, setExpandAlerts]   = useState(false)
  const [expandFans, setExpandFans]       = useState(false)
  const [expandTiming, setExpandTiming]   = useState(false)
  const [expandInsights, setExpandInsights] = useState(false)
  const [showWalkthrough, setShowWalkthrough] = useState(true)

  // Deep-link support: feature cards on the landing page link here with
  // ?tab=whales / ?tab=live / etc. so each CTA opens on the right screen
  // instead of everyone landing on the same Overview tab. Runs after
  // hydration (not as a lazy useState initializer) to avoid a server/client
  // markup mismatch, since each tab renders an entirely different subtree.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab")
    if (requested && VALID_TABS.has(requested)) {
      setActiveTab(requested)
      setShowWalkthrough(false)
    }
  }, [])

  // Live Mode demo state
  const [liveActive, setLiveActive]   = useState(false)
  const [liveTips, setLiveTips]       = useState([])
  const [liveTotal, setLiveTotal]     = useState(0)
  const [liveElapsed, setLiveElapsed] = useState(0)
  const [liveGoal, setLiveGoal]       = useState(500)

  // Room Title Generator demo state
  const [titleMood, setTitleMood]           = useState("tease")
  const [titleGoal, setTitleGoal]           = useState("500")
  const [titleIdx, setTitleIdx]             = useState(0)
  const [titleGenerating, setTitleGenerating] = useState(false)

  // Upload Data demo state
  const [uploadPlatform, setUploadPlatform] = useState("Chaturbate")

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 3000) }
  const handleTabChange = (tab) => { setActiveTab(tab); window.scrollTo({ top:0, behavior:"instant" }) }

  // Simulated live tip ticker — fires while liveActive is true
  useEffect(() => {
    if (!liveActive) return
    const names = ["diamondkingx","vaultmaster99","highroller88","euro_titan","mfc_godfather","cbwhale_elite"]
    const secTimer = setInterval(() => setLiveElapsed(e => e + 1), 1000)
    const tipTimer = setInterval(() => {
      const amt = [25,50,75,100,150,250,500][Math.floor(Math.random()*7)]
      const name = names[Math.floor(Math.random()*names.length)]
      setLiveTips(prev => [{ name, amt, id: Date.now()+Math.random() }, ...prev].slice(0, 8))
      setLiveTotal(prev => prev + amt)
    }, 3200)
    return () => { clearInterval(secTimer); clearInterval(tipTimer) }
  }, [liveActive])

  const startLiveDemo = () => { setLiveActive(true); setLiveTips([]); setLiveTotal(0); setLiveElapsed(0) }
  const stopLiveDemo  = () => { setLiveActive(false) }

  // Room title generator — mood + goal driven, cycles through canned variants
  const TITLE_BANK = {
    tease:     (g) => [`let's see how far you take me 💦 hit ${g} → full control (tonight only)`, `I'm not giving it up that easy 😏 ${g} tokens and you decide what's next`, `almost… not yet 👀 tip to ${g} and find out`],
    dominant:  (g) => [`top tipper owns this room 👑 ${g} = exclusive access (live now)`, `prove you deserve it — tip to ${g} and earn your reward 🔥`, `I decide — you tip. ${g} unlocks everything tonight`],
    hype:      (g) => [`WE ARE SO CLOSE 🔥 ${g} tokens and this room explodes`, `the energy in here is insane right now — push to ${g} 💥`, `LET'S GOOO — tip to ${g}, this is happening tonight`],
    mystery:   (g) => [`you won't believe what happens at ${g} 👀 tip to find out`, `something big is coming… ${g} unlocks it 🎁`, `curious? tip to ${g} and see for yourself 🔒`],
  }
  const generateTitle = () => {
    setTitleGenerating(true)
    setTimeout(() => { setTitleIdx(i => i + 1); setTitleGenerating(false) }, 550)
  }
  const titleVariants = (TITLE_BANK[titleMood] || TITLE_BANK.tease)(titleGoal || "500")
  const currentTitle = titleVariants[titleIdx % titleVariants.length]

  const tips      = DEMO_TIPS
  const sessions  = DEMO_SESSIONS
  const whales    = DEMO_WHALES
  const analytics = DEMO_ANALYTICS
  const insights  = DEMO_ANALYTICS.insights
  const platforms = DEMO_ANALYTICS.platforms
  const totalRevenue       = DEMO_TOTAL_REVENUE
  const avgPerHour         = DEMO_AVG_PER_HOUR
  const platformVelocity   = DEMO_ANALYTICS.platformVelocity
  const platformBestTimes  = DEMO_ANALYTICS.platformBestTimes
  const earningsVelocity   = DEMO_ANALYTICS.earningsVelocity
  const missedRevenueByPlat= DEMO_ANALYTICS.missedRevenueByPlatform
  const returningVsNew     = DEMO_ANALYTICS.returningVsNew
  const topFanDependency   = DEMO_ANALYTICS.topFanDependency
  const realTimeAlerts     = []
  const whatsNextAlerts    = [
    { type:"online_now",  icon:"🟢", title:"kingwhale99 is likely online right now", message:"Your top whale ($1,000 lifetime) peaks at 1 AM UTC — you're in their window. Go live on Chaturbate immediately.", cta:"Message", whale:DEMO_WHALES[0] },
    { type:"win_back",    icon:"💔", title:"private_king — $3,500 fan gone 28 days", message:"They've spent $3,500 in private shows and haven't tipped in 28 days. High-value win-back opportunity.", cta:"Message", whale:DEMO_WHALES[2] },
    { type:"milestone",   icon:"💰", title:"vaultmaster99 is $600 from $5,000 milestone", message:"They've spent $4,400 lifetime — a personal message could push them to the $5,000 whale tier.", cta:"Message", whale:DEMO_WHALES[1] },
    { type:"strike_hot",  icon:"🔥", title:"euro_titan tipped 3 days ago — still warm", message:"High tip probability. Go live on BongaCams at 9 PM tonight while they're active.", cta:"Message", whale:DEMO_WHALES[4] },
    { type:"dormant",     icon:"💤", title:"ghost_whale — $1,000 fan gone 60 days", message:"They spent $1,000 and haven't returned in 60 days. Critical churn risk — a personal message is your last chance.", cta:"Message", whale:DEMO_WHALES[14] },
    { type:"performance", icon:"📈", title:"Thursday is your highest-earning day", message:"4 of your top 6 sessions happened on Thursdays. Schedule your next high-effort stream for Thursday 1 AM.", cta:null, whale:null },
  ]
  const reengageList = DEMO_WHALES.filter(w=>w.daysSinceLastTip>=7&&w.totalUSD>=50).slice(0,4).map((w,i) => ({
    whale:w, days:w.daysSinceLastTip, urgency:w.daysSinceLastTip>30?C.red:w.daysSinceLastTip>14?C.orange:C.gold,
    msg:`Hey ${w.username}! I've been thinking about you lately 💕 I'm going live tonight on ${w.platform} and would love to see your name in the chat 🔥`
  }))
  const dailyBrief = buildDemoDailyBrief()

  const filteredWhales = whales.filter(w => {
    if (whaleFilter!=="ALL" && w.tier!==whaleFilter) return false
    if (platformFilter!=="ALL" && w.platform!==platformFilter) return false
    return true
  })

  const ALERT_CFG = {
    strike_hot:{bg:"rgba(251,146,60,0.08)",border:"rgba(251,146,60,0.25)",dot:"#FB923C"},
    win_back:{bg:"rgba(236,72,153,0.08)",border:"rgba(236,72,153,0.25)",dot:"#EC4899"},
    milestone:{bg:"rgba(245,158,11,0.08)",border:"rgba(245,158,11,0.25)",dot:"#F59E0B"},
    online_now:{bg:"rgba(16,185,129,0.08)",border:"rgba(16,185,129,0.3)",dot:"#10B981"},
    dormant:{bg:"rgba(251,146,60,0.06)",border:"rgba(251,146,60,0.2)",dot:"#FB923C"},
    performance:{bg:"rgba(236,72,153,0.06)",border:"rgba(236,72,153,0.15)",dot:"#EC4899"},
  }

  // Scored fans for overview
  const scoredFans = whales.map(w => {
    const daysSince = w.daysSinceLastTip
    const fanTips = w.tips||[]
    const hc={}; fanTips.forEach(t=>{const h=new Date(t.date_time||t.dateRaw).getUTCHours();hc[h]=(hc[h]||0)+1})
    const peakH=Object.entries(hc).sort((a,b)=>b[1]-a[1])[0]
    const hoursAway=peakH?(parseInt(peakH[0])-new Date().getUTCHours()+24)%24:99
    const isOnline=hoursAway<=2&&fanTips.length>=2
    const nearMile=[50,100,200,500].some(m=>{const r=m-w.totalUSD;return r>0&&r<=m*0.1})
    const isHV=w.totalUSD>=80
    const isGrowing=w.tipCount>=2&&daysSince<=14
    const isChurn=w.churnRisk?.level==="High"||w.churnRisk?.level==="Critical"
    let priority="cold",score=0,sub=`${daysSince}d since last tip`,badge=null,bc=C.muted
    if(isOnline&&isHV)           {priority="urgent";score=100+w.totalUSD;sub=`likely online now · $${w.totalUSD.toFixed(0)} lifetime`;badge="Online now";bc=C.green}
    else if(isChurn&&isHV)       {priority="urgent";score=90+w.totalUSD;sub=`${daysSince}d gone · $${w.totalUSD.toFixed(0)} lifetime`;badge="At risk";bc=C.red}
    else if(nearMile)            {priority="valuable";score=80+w.totalUSD;const m=[50,100,200,500].find(m2=>{const r=m2-w.totalUSD;return r>0&&r<=m2*0.1});sub=`$${(m-w.totalUSD).toFixed(0)} from $${m} milestone`;badge="Near milestone";bc=C.gold}
    else if(isHV&&daysSince<=30) {priority="valuable";score=70+w.totalUSD;sub=`$${w.totalUSD.toFixed(0)} lifetime · ${daysSince}d ago`;badge="VIP";bc=C.gold}
    else if(isGrowing)           {priority="growing";score=50+w.tipCount;sub=`${w.tipCount} tips · active`;badge="Growing";bc=C.cyan}
    else if(daysSince>45&&w.totalUSD>=30){priority="cold";score=30+w.totalUSD/10;sub=`$${w.totalUSD.toFixed(0)} lifetime · ${daysSince}d gone`;badge="Cold";bc=C.muted}
    return {...w,priority,score,sub,badge,bc}
  }).filter(w=>w.badge).sort((a,b)=>b.score-a.score)

  const PRI_ORDER=["urgent","valuable","growing","cold"]
  const PRI_LABEL={urgent:"URGENT",valuable:"VALUABLE",growing:"GROWING",cold:"COLD"}
  const PRI_COLOR={urgent:C.red,valuable:C.gold,growing:C.cyan,cold:C.muted}
  const grouped={}; scoredFans.forEach(f=>{if(!grouped[f.priority])grouped[f.priority]=[];grouped[f.priority].push(f)})
  const shownFans = expandFans ? scoredFans : scoredFans.slice(0,4)
  const shownGrouped={}; shownFans.forEach(f=>{if(!shownGrouped[f.priority])shownGrouped[f.priority]=[];shownGrouped[f.priority].push(f)})

  const platColors2={Chaturbate:C.cyan,BongaCams:C.pink,MyFreeCams:C.gold}
  const UTC_DAYS2=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]
  const platDayUSD2={},platDayDates2={}
  tips.forEach(t=>{
    const p=t.platform,dt=new Date(t.date_time||t.dateRaw)
    const sd=UTC_DAYS2[dt.getUTCDay()],dk=dt.toISOString().slice(0,10)
    if(!platDayUSD2[p]){platDayUSD2[p]={};platDayDates2[p]={}}
    platDayUSD2[p][sd]=(platDayUSD2[p][sd]||0)+(t.usd||0)
    if(!platDayDates2[p][sd])platDayDates2[p][sd]=new Set()
    platDayDates2[p][sd].add(dk)
  })
  const platDayAvg2={}
  Object.keys(platDayUSD2).forEach(p=>{
    platDayAvg2[p]={}
    UTC_DAYS2.forEach(d=>{const tot=platDayUSD2[p][d]||0;const ac=platDayDates2[p]?.[d]?.size||1;platDayAvg2[p][d]=tot>0?parseFloat((tot/ac).toFixed(2)):0})
  })
  const platList2=Object.keys(platDayAvg2)
  const todayShort2=UTC_DAYS2[new Date().getUTCDay()]
  const todayLong2=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][new Date().getUTCDay()]

  // Message generator messages
  const demoMessages = [
    `Hey, I was just thinking about you 💕 Going live tonight — come say hi?`,
    `Miss you 😘 It's been a minute. I'm on tonight — would love to see you there 🔥`,
    `Hey love 💕 I'm going live soon and always have more fun when you're around 💋`,
    `You crossed my mind today 🥺 I stream tonight and it's always better when you're there 💗`,
    `Hey babe! Going live soon and thought of you first 😍 Come through 💕`,
  ]
  const currentMsg = messageTarget ? demoMessages[messageIndex % demoMessages.length] : ""

  return (
    <div style={{ minHeight:"100vh", background:`radial-gradient(circle at 20% 30%,rgba(59,130,246,0.25),transparent 40%),radial-gradient(circle at 80% 70%,rgba(236,72,153,0.25),transparent 40%),#05070f`, fontFamily:"'Inter',sans-serif", color:C.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:5px}
        ::-webkit-scrollbar-track{background:#05070f}
        ::-webkit-scrollbar-thumb{background:#2a3f5f;border-radius:3px}
        .demo-card{transition:transform 0.2s ease,box-shadow 0.2s ease}
        .demo-card:hover{transform:translateY(-2px)}
        .demo-alert-row{transition:transform 0.12s ease}
        .demo-alert-row:hover{transform:translateX(3px)}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse-dot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.5;transform:scale(1.4)}}
      `}</style>

      {/* Walkthrough */}
      {showWalkthrough && (
        <WalkthroughOverlay
          onComplete={() => setShowWalkthrough(false)}
          onTabChange={handleTabChange}
        />
      )}

      {/* Demo banner */}
      <div style={{ position:"fixed", top:0, left:0, right:0, zIndex:200, background:"linear-gradient(90deg,rgba(124,92,255,0.95),rgba(34,211,238,0.95))", padding:"8px 20px", display:"flex", alignItems:"center", justifyContent:"center", gap:16 }}>
        <span style={{ fontSize:13, fontWeight:700, color:"white" }}>👀 You're viewing a demo account with sample data</span>
        <a href="/landing" style={{ padding:"4px 14px", borderRadius:20, background:"rgba(255,255,255,0.2)", border:"1px solid rgba(255,255,255,0.4)", color:"white", fontSize:12, fontWeight:700, textDecoration:"none" }}>Sign Up Free →</a>
      </div>

      <DemoSidebar activeTab={activeTab} onTabChange={handleTabChange} />

      <div style={{ marginLeft:220, paddingTop:40 }}>
        <div style={{ padding:32, position:"relative", zIndex:1 }}>

          {/* Live bar */}
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16, flexWrap:"wrap" }}>
            <div style={{ display:"flex", alignItems:"center", gap:6, padding:"4px 12px", borderRadius:20, background:"rgba(16,185,129,0.1)", border:"1px solid rgba(16,185,129,0.25)" }}>
              <div style={{ width:6, height:6, borderRadius:"50%", background:"#10B981", boxShadow:"0 0 6px #10B981", animation:"pulse-dot 2s infinite" }} />
              <span style={{ fontSize:11, fontWeight:700, color:"#10B981" }}>DEMO LIVE</span>
            </div>
            <span style={{ fontSize:11, color:"#475569" }}>Sample data · 3 platforms · Last imported ~1 week ago</span>
          </div>

          {/* ═══════════ OVERVIEW TAB ═══════════ */}
          {activeTab === "overview" && (
            <div style={{ animation:"fadeUp 0.3s ease" }}>

              {/* TIER 1 — COMMAND CARD */}
              {(() => {
                const { bhLabel, atPeak, hoursUntilPeak, displayPlat, displayAvg, isBestDay, todayName,
                  predictionLow, predictionHigh, likelyOnline, reengageFans: rf, platTodayStats } = dailyBrief
                const cardState = atPeak ? "peak" : "before"
                const cfg = {
                  peak:   { icon:"🟢", label:"PEAK WINDOW OPEN — GO LIVE NOW", accent:"#10B981", border:"rgba(16,185,129,0.4)", bg:"linear-gradient(135deg,rgba(16,185,129,0.14),rgba(34,211,238,0.06))" },
                  before: { icon:"⚡", label:"BEST MOVE RIGHT NOW",              accent:"#22D3EE", border:"rgba(34,211,238,0.35)", bg:"linear-gradient(135deg,rgba(34,211,238,0.1),rgba(124,92,255,0.06))" },
                }[cardState]
                const todayChanges = []
                if (isBestDay) todayChanges.push(`${todayName} is your best earning day`)
                if (atPeak) todayChanges.push("Peak window open now")
                if (!atPeak && hoursUntilPeak <= 3) todayChanges.push(`Peak in ${hoursUntilPeak}h — ${bhLabel}`)
                todayChanges.push("kingwhale99 tipped 2 days ago — due again soon")
                return (
                  <div style={{ marginBottom:20, borderRadius:18, border:`1px solid ${cfg.border}`, background:cfg.bg, overflow:"hidden", boxShadow:`0 0 40px ${cfg.accent}15` }}>
                    <div style={{ height:3, background:`linear-gradient(90deg,${cfg.accent},#EC4899)` }} />
                    <div style={{ padding:"18px 22px" }}>
                      <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
                        {todayChanges.slice(0,3).map((c,i) => (
                          <div key={i} style={{ padding:"3px 10px", borderRadius:20, background:"rgba(34,211,238,0.08)", border:"1px solid rgba(34,211,238,0.2)", fontSize:11, color:"#22D3EE", fontWeight:600 }}>● {c}</div>
                        ))}
                      </div>
                      <div style={{ display:"flex", alignItems:"flex-start", gap:16 }}>
                        <div style={{ width:46, height:46, borderRadius:13, background:`${cfg.accent}20`, border:`1px solid ${cfg.accent}40`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>{cfg.icon}</div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:10, fontWeight:800, color:cfg.accent, textTransform:"uppercase", letterSpacing:1.2, marginBottom:5 }}>{cfg.label}</div>
                          <div style={{ fontSize:20, fontWeight:900, color:"#F1F5F9", marginBottom:8 }}>
                            Go live on {displayPlat} at {bhLabel}{hoursUntilPeak>0&&<span style={{ fontSize:15, color:"#64748B", fontWeight:500 }}> · in {hoursUntilPeak}h</span>}
                          </div>
                          <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
                            <span style={{ fontSize:12, color:"#64748B" }}>Historically <span style={{ color:"#F59E0B", fontWeight:700 }}>${displayAvg}/session</span></span>
                            <span style={{ fontSize:12, color:"#64748B" }}><span style={{ color:"#10B981", fontWeight:700 }}>{likelyOnline.length} whales</span> likely online</span>
                            <span style={{ fontSize:12, color:"#64748B" }}>Expected <span style={{ color:"#10B981", fontWeight:700 }}>${predictionLow}–${predictionHigh}</span></span>
                          </div>
                        </div>
                      </div>
                      <div style={{ marginTop:14, paddingTop:14, borderTop:"1px solid rgba(255,255,255,0.06)", display:"flex", gap:10, flexWrap:"wrap" }}>
                        {Object.entries(platTodayStats).map(([plat,stats]) => stats.todayBestHour && (
                          <div key={plat} style={{ padding:"4px 12px", borderRadius:20, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", fontSize:11, color:"#64748B" }}>
                            {plat.replace("BongaCams","Bonga")} <span style={{ color:"#F1F5F9", fontWeight:700 }}>{stats.todayBestHour}</span> <span style={{ color:"#10B981" }}>${stats.todayBestAvg}/day</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* TIER 2 — KPI STRIP */}
              {(() => {
                const thisMonthRev = DEMO_ANALYTICS.monthlyData.slice(-1)[0]?.usd || 19700
                const prevMonthRev = DEMO_ANALYTICS.monthlyData.slice(-2)[0]?.usd || 38900
                const growthPct = Math.round(((thisMonthRev-prevMonthRev)/prevMonthRev)*100)
                const returningPct = 62
                const fansActive30 = 10
                const velPlats = Object.entries(platformVelocity).sort((a,b)=>b[1]-a[1])
                const kpis = [
                  { label:"This Month", value:`${thisMonthRev.toLocaleString()}`, sub:growthPct>=0?`↑ ${growthPct}% vs last month`:`↓ ${Math.abs(growthPct)}% vs last month`, subColor:growthPct>=0?C.green:C.orange, icon:"💰" },
                  { label:"Avg $/Hour", value:`${avgPerHour.toFixed(0)}`, sub:"Top-tier performance", subColor:C.muted, icon:"⏱️" },
                  { label:"Return Rate", value:`${returningPct}%`, sub:`${fansActive30} active fans (30d)`, subColor:C.muted, icon:"🔁" },
                  { label:"Tonight's Forecast", value:"$1,100–$2,200", sub:"if you stream at 1 AM", subColor:C.muted, icon:"🎯" },
                ]
                return (
                  <div style={{ marginBottom:20 }}>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:8 }}>
                      {kpis.map((k,i) => (
                        <div key={i} className="demo-card" style={{ ...glassCard, borderRadius:14, padding:"16px 14px", animation:`fadeUp 0.3s ease ${i*0.05}s both` }}>
                          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                            <span style={{ fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:1, fontWeight:700 }}>{k.label}</span>
                            <span style={{ fontSize:16 }}>{k.icon}</span>
                          </div>
                          <div style={{ fontSize:26, fontWeight:900, background:"linear-gradient(135deg,#60a5fa,#f472b6)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", marginBottom:4, lineHeight:1.1 }}>{k.value}</div>
                          <div style={{ fontSize:11, color:k.subColor }}>{k.sub}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                      {velPlats.map(([plat,vel],i) => (
                        <div key={i} style={{ display:"flex", alignItems:"center", gap:5, padding:"4px 10px", borderRadius:20, background:"rgba(34,211,238,0.06)", border:"1px solid rgba(34,211,238,0.12)" }}>
                          <span style={{ fontSize:10, color:C.muted }}>{plat.replace("BongaCams","Bonga").replace("Chaturbate","CB")}</span>
                          <span style={{ fontSize:11, fontWeight:700, color:C.cyan }}>${vel.toFixed(2)}/hr</span>
                        </div>
                      ))}
                      <div style={{ display:"flex", alignItems:"center", gap:5, padding:"4px 10px", borderRadius:20, background:"rgba(16,185,129,0.06)", border:"1px solid rgba(16,185,129,0.12)" }}>
                        <span style={{ fontSize:10, color:C.muted }}>Overall</span>
                        <span style={{ fontSize:11, fontWeight:700, color:C.green }}>${earningsVelocity.toFixed(2)}/hr</span>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* TIER 3 — LIVE OPPORTUNITIES */}
              <div style={{ ...glassCard, borderRadius:18, padding:22, marginBottom:18, animation:"fadeUp 0.3s ease 0.05s both" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ width:34, height:34, borderRadius:10, background:"linear-gradient(135deg,#FB923C,#EC4899)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>🚨</div>
                    <div>
                      <div style={{ fontSize:15, fontWeight:800, color:C.white }}>Live Opportunities</div>
                      <div style={{ fontSize:11, color:C.muted }}>{whatsNextAlerts.length} actions waiting</div>
                    </div>
                  </div>
                  <button onClick={() => setExpandAlerts(e=>!e)} style={{ padding:"4px 12px", borderRadius:8, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:C.muted, fontSize:12, cursor:"pointer" }}>
                    {expandAlerts?"Show less":"Show all "+whatsNextAlerts.length}
                  </button>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {(expandAlerts?whatsNextAlerts:whatsNextAlerts.slice(0,3)).map((a,i) => {
                    const cfg2=ALERT_CFG[a.type]||ALERT_CFG.dormant
                    return (
                      <div key={i} className="demo-alert-row" style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 14px", borderRadius:11, background:cfg2.bg, border:`1px solid ${cfg2.border}` }}>
                        <div style={{ width:7, height:7, borderRadius:"50%", background:cfg2.dot, flexShrink:0, boxShadow:`0 0 5px ${cfg2.dot}` }} />
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:700, color:C.white, marginBottom:2 }}>{a.title}</div>
                          <div style={{ fontSize:11, color:C.muted, lineHeight:1.5 }}>{a.message}</div>
                        </div>
                        {a.cta && a.whale && (
                          <button onClick={() => { setMessageTarget(a.whale); setMessageIndex(0); setMessageCopied(false) }}
                            style={{ padding:"5px 12px", borderRadius:8, background:"linear-gradient(135deg,rgba(34,211,238,0.15),rgba(236,72,153,0.15))", border:"1px solid rgba(34,211,238,0.3)", color:C.cyan, fontSize:11, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap", flexShrink:0 }}>
                            💌 Message
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* TIER 4 — FAN INTELLIGENCE */}
              <div style={{ ...glassCard, borderRadius:18, padding:22, marginBottom:18, animation:"fadeUp 0.3s ease 0.1s both" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ width:34, height:34, borderRadius:10, background:"linear-gradient(135deg,#EC4899,#7C5CFF)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>👑</div>
                    <div>
                      <div style={{ fontSize:15, fontWeight:800, color:C.white }}>Fan Intelligence</div>
                      <div style={{ fontSize:11, color:C.muted }}>{scoredFans.filter(f=>f.priority==="urgent").length} urgent · {scoredFans.filter(f=>f.priority==="valuable").length} valuable · {scoredFans.filter(f=>f.priority==="growing").length} growing</div>
                    </div>
                  </div>
                  {scoredFans.length>4 && <button onClick={() => setExpandFans(e=>!e)} style={{ padding:"4px 12px", borderRadius:8, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:C.muted, fontSize:12, cursor:"pointer" }}>{expandFans?"Show less":`Show ${scoredFans.length-4} more`}</button>}
                </div>
                <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
                  <div style={{ padding:"4px 12px", borderRadius:20, background:"rgba(248,113,113,0.1)", border:"1px solid rgba(248,113,113,0.25)", fontSize:11, color:C.red, fontWeight:600 }}>⚠️ Top fan = {topFanDependency.top1Pct}% of revenue — concentration risk</div>
                  <div style={{ padding:"4px 12px", borderRadius:20, background:"rgba(16,185,129,0.08)", border:"1px solid rgba(16,185,129,0.2)", fontSize:11, color:C.green, fontWeight:600 }}>🔁 Returning fans spend {returningVsNew.multiplier}x more</div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                  {PRI_ORDER.filter(p=>shownGrouped[p]).map(priority => (
                    <div key={priority}>
                      <div style={{ fontSize:9, fontWeight:700, color:PRI_COLOR[priority], letterSpacing:1.5, textTransform:"uppercase", marginBottom:5, marginTop:priority!=="urgent"?10:0 }}>{PRI_LABEL[priority]}</div>
                      {shownGrouped[priority].map((w,i) => (
                        <div key={i} style={{ display:"flex", alignItems:"center", gap:11, padding:"9px 12px", borderRadius:10, background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.05)", marginBottom:4, transition:"background 0.15s" }}
                          onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                          onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.02)"}
                        >
                          <div style={{ width:30, height:30, borderRadius:8, background:`${PRI_COLOR[priority]}20`, border:`1px solid ${PRI_COLOR[priority]}30`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800, color:PRI_COLOR[priority], flexShrink:0 }}>{w.username.charAt(0).toUpperCase()}</div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:2 }}>
                              <span style={{ fontSize:13, fontWeight:700, color:C.white }}>{w.username}</span>
                              <span style={{ fontSize:9, padding:"1px 7px", borderRadius:20, background:`${w.bc}15`, color:w.bc, fontWeight:700 }}>{w.badge}</span>
                            </div>
                            <div style={{ fontSize:11, color:C.muted }}>{w.sub}</div>
                          </div>
                          <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                            <button onClick={() => setSelectedWhale(w)} style={{ padding:"3px 8px", borderRadius:6, background:"rgba(34,211,238,0.1)", border:"1px solid rgba(34,211,238,0.2)", color:C.cyan, fontSize:10, cursor:"pointer" }}>Profile</button>
                            <button onClick={() => { setMessageTarget(w); setMessageIndex(0); setMessageCopied(false) }} style={{ padding:"3px", background:"none", border:"none", color:C.pink, fontSize:20, cursor:"pointer", lineHeight:1 }}>💌</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              {/* TIER 5 — REVENUE TIMING */}
              <div style={{ ...glassCard, borderRadius:18, padding:22, marginBottom:18, animation:"fadeUp 0.3s ease 0.15s both" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ width:34, height:34, borderRadius:10, background:"linear-gradient(135deg,#22D3EE,#7C5CFF)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>📊</div>
                    <div>
                      <div style={{ fontSize:15, fontWeight:800, color:C.white }}>Revenue Timing & Platform ROI</div>
                      <div style={{ fontSize:11, color:C.muted }}>avg $/active day</div>
                    </div>
                  </div>
                  <button onClick={() => setExpandTiming(e=>!e)} style={{ padding:"4px 12px", borderRadius:8, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:C.muted, fontSize:12, cursor:"pointer" }}>{expandTiming?"Collapse":"Expand ↓"}</button>
                </div>
                {/* Heatmap */}
                {platList2.length > 0 && (
                  <div style={{ marginBottom:16 }}>
                    <div style={{ overflowX:"auto" }}>
                      <div style={{ display:"grid", gridTemplateColumns:"68px repeat(7,1fr)", gap:3, minWidth:400 }}>
                        <div/>
                        {UTC_DAYS2.map(d => <div key={d} style={{ textAlign:"center", fontSize:11, fontWeight:700, color:d===todayShort2?C.cyan:C.muted, paddingBottom:3 }}>{d}</div>)}
                        {platList2.map(plat => {
                          const dayVals=UTC_DAYS2.map(d=>platDayAvg2[plat][d]||0)
                          const maxV=Math.max(...dayVals,0.01)
                          return [
                            <div key={plat+"_l"} style={{ fontSize:10, fontWeight:700, color:C.text, display:"flex", alignItems:"center", paddingRight:4 }}>{plat.replace("BongaCams","Bonga").replace("Chaturbate","CB").replace("MyFreeCams","MFC")}</div>,
                            ...UTC_DAYS2.map(d => {
                              const val=platDayAvg2[plat][d]||0,intensity=maxV>0?val/maxV:0,isToday=d===todayShort2
                              const bg=val===0?"rgba(255,255,255,0.03)":intensity<0.25?"rgba(34,211,238,0.12)":intensity<0.5?"rgba(34,211,238,0.30)":intensity<0.75?"rgba(34,211,238,0.60)":"rgba(34,211,238,0.90)"
                              return (
                                <div key={d} style={{ height:30, borderRadius:5, background:bg, border:isToday?"2px solid rgba(34,211,238,0.6)":"1px solid rgba(255,255,255,0.05)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                                  {val>0&&<span style={{ fontSize:9, fontWeight:700, color:intensity>0.45?"#fff":C.muted }}>${val>=100?Math.round(val):val.toFixed(0)}</span>}
                                </div>
                              )
                            })
                          ]
                        })}
                      </div>
                    </div>
                    <div style={{ marginTop:5, fontSize:10, color:C.muted }}>Today ({todayLong2}) highlighted · darker = more earnings</div>
                  </div>
                )}
                {/* Platform ROI bars */}
                <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                  {platforms.map((p,i) => {
                    const roi=platformVelocity[p.platform]||null,col=platColors2[p.platform]||C.blue,isTop=i===0
                    const maxUPH=Math.max(...platforms.map(pl=>platformVelocity[pl.platform]||0),1)
                    const uptPct=maxUPH>0&&roi?Math.round((roi/maxUPH)*100):0
                    const bth=platformBestTimes[p.platform],bthHour=bth?.hour?.hour??bth?.hour??null
                    const missed2=missedRevenueByPlat[p.platform]
                    const hasWarn=missed2&&missed2.missedRevenue>5&&missed2.overallAvg>0&&missed2.bestHourAvg>missed2.overallAvg
                    const missedPct=hasWarn?Math.min(Math.round(((missed2.bestHourAvg-missed2.overallAvg)/missed2.overallAvg)*100),999):0
                    return (
                      <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 12px", borderRadius:10, background:isTop?`${col}08`:"rgba(255,255,255,0.02)", border:`1px solid ${isTop?col+"25":"rgba(255,255,255,0.05)"}` }}>
                        <div style={{ width:7, height:7, borderRadius:"50%", background:col, flexShrink:0, boxShadow:isTop?`0 0 5px ${col}`:"none" }} />
                        <div style={{ flex:1 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:3 }}>
                            <span style={{ fontSize:13, fontWeight:700, color:C.white }}>{p.platform}</span>
                            {isTop&&<span style={{ fontSize:9, color:col, fontWeight:700 }}>TOP ROI</span>}
                            {roi&&<span style={{ fontSize:12, color:col, fontWeight:700 }}>${roi.toFixed(2)}/hr</span>}
                            {bthHour!==null&&<span style={{ fontSize:11, color:C.muted }}>Best: {formatHour(bthHour)}</span>}
                          </div>
                          <div style={{ height:3, borderRadius:2, background:"rgba(255,255,255,0.06)", overflow:"hidden", maxWidth:180 }}>
                            <div style={{ height:"100%", width:`${uptPct}%`, background:col, borderRadius:2 }} />
                          </div>
                        </div>
                        {hasWarn&&<div style={{ fontSize:10, color:C.orange, fontWeight:700, whiteSpace:"nowrap" }}>↓{missedPct}% off-peak</div>}
                      </div>
                    )
                  })}
                </div>
                {/* Expanded: missed revenue + real-time intel */}
                {expandTiming && (
                  <div style={{ marginTop:14, paddingTop:14, borderTop:"1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ fontSize:11, fontWeight:700, color:C.orange, textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>💸 Missed Revenue Analysis</div>
                    {Object.entries(missedRevenueByPlat).map(([plat,m]) => (
                      <div key={plat} style={{ padding:"10px 14px", borderRadius:10, background:"rgba(251,146,60,0.07)", border:"1px solid rgba(251,146,60,0.2)", marginBottom:8 }}>
                        <div style={{ fontSize:13, fontWeight:700, color:C.white, marginBottom:3 }}>{plat}</div>
                        <div style={{ fontSize:12, color:C.muted }}>Leaving <span style={{ color:C.orange, fontWeight:700 }}>${m.missedRevenue.toFixed(0)}</span> on the table by streaming off-peak · best hour: <span style={{ color:C.green, fontWeight:700 }}>${m.bestHourAvg.toFixed(2)}/session</span> vs <span style={{ color:C.muted }}>${m.overallAvg.toFixed(2)} avg</span></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* TIER 6 — SMART INSIGHTS (collapsible) */}
              <div style={{ ...glassCard, borderRadius:18, overflow:"hidden", marginBottom:18, animation:"fadeUp 0.3s ease 0.2s both" }}>
                <button onClick={() => setExpandInsights(e=>!e)}
                  style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"16px 22px", background:"none", border:"none", cursor:"pointer", textAlign:"left" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ width:34, height:34, borderRadius:10, background:"linear-gradient(135deg,#7C5CFF,#22D3EE)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>💡</div>
                    <div>
                      <div style={{ fontSize:15, fontWeight:800, color:C.white }}>Smart Insights & Deep Analytics</div>
                      <div style={{ fontSize:11, color:C.muted }}>Earning patterns · retention · behavior analysis</div>
                    </div>
                  </div>
                  <span style={{ fontSize:16, color:C.muted, transition:"transform 0.2s", transform:expandInsights?"rotate(180deg)":"rotate(0deg)" }}>▼</span>
                </button>
                {expandInsights && (
                  <div style={{ padding:"0 22px 22px", borderTop:"1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ display:"flex", flexDirection:"column", gap:8, paddingTop:16 }}>
                      <div style={{ padding:"12px 14px", borderRadius:11, background:"rgba(245,158,11,0.06)", border:"1px solid rgba(245,158,11,0.2)" }}>
                        <div style={{ fontSize:12, fontWeight:700, color:C.gold, marginBottom:4 }}>⚠️ Revenue Concentration</div>
                        <div style={{ fontSize:12, color:C.text }}>Top fan = <span style={{ fontWeight:700, color:C.gold }}>{topFanDependency.top1Pct}%</span> of all revenue. Top 3 fans = <span style={{ fontWeight:700 }}>{topFanDependency.top3Pct}%</span>. Moderate concentration — keep building your base.</div>
                      </div>
                      <div style={{ padding:"12px 14px", borderRadius:11, background:"rgba(16,185,129,0.06)", border:"1px solid rgba(16,185,129,0.15)" }}>
                        <div style={{ fontSize:12, fontWeight:700, color:C.green, marginBottom:4 }}>🔁 Retention Intelligence</div>
                        <div style={{ fontSize:12, color:C.text }}>Returning fans spend <span style={{ color:C.green, fontWeight:700 }}>{returningVsNew.multiplier}x more</span> than new fans. <span style={{ color:C.cyan, fontWeight:700 }}>{returningVsNew.returningPct}%</span> of your tippers have come back more than once.</div>
                      </div>
                      {insights.map((ins,i) => (
                        <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"9px 12px", borderRadius:9, background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)" }}>
                          <span style={{ fontSize:14, flexShrink:0 }}>{ins.icon}</span>
                          <span style={{ fontSize:12, color:C.text, lineHeight:1.55 }}>{ins.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══════════ TOP FANS TAB ═══════════ */}
          {activeTab === "whales" && (
            <div style={{ animation:"fadeUp 0.3s ease" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:24, flexWrap:"wrap", gap:12 }}>
                <div>
                  <h1 style={{ fontSize:28, fontWeight:800, color:C.white }}>🐳 Top Fans</h1>
                  <p style={{ fontSize:13, color:C.muted }}>Ranked by lifetime spend — 3 platforms</p>
                </div>
              </div>
              {/* Filters */}
              <div style={{ display:"flex", gap:10, marginBottom:20, flexWrap:"wrap" }}>
                <div style={{ display:"flex", gap:6, background:"rgba(255,255,255,0.04)", padding:4, borderRadius:10, border:"1px solid rgba(255,255,255,0.08)" }}>
                  {["ALL","Whale","Shark","Regular","Dormant"].map(t => (
                    <button key={t} onClick={() => setWhaleFilter(t)} style={{ padding:"5px 12px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer", border:"none", background:whaleFilter===t?"linear-gradient(135deg,#3b82f6,#ec4899)":"transparent", color:whaleFilter===t?C.white:C.muted }}>{t}</button>
                  ))}
                </div>
                <div style={{ display:"flex", gap:6, background:"rgba(255,255,255,0.04)", padding:4, borderRadius:10, border:"1px solid rgba(255,255,255,0.08)" }}>
                  {["ALL","Chaturbate","BongaCams","MyFreeCams"].map(p => (
                    <button key={p} onClick={() => setPlatformFilter(p)} style={{ padding:"5px 12px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer", border:"none", background:platformFilter===p?"rgba(34,211,238,0.2)":"transparent", color:platformFilter===p?C.cyan:C.muted }}>{p}</button>
                  ))}
                </div>
              </div>
              {/* Table */}
              <div style={{ ...glassCard, borderRadius:14, overflow:"hidden", marginBottom:20 }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                  <thead>
                    <tr style={{ background:"rgba(255,255,255,0.04)", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
                      {["#","Username","Total $","Tips","Avg Tip","Platform","Tier","Last Tip","Actions"].map(h => (
                        <th key={h} style={{ padding:"12px 16px", textAlign:"left", color:C.muted, fontSize:11, textTransform:"uppercase", fontWeight:500 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredWhales.map((w,i) => (
                      <tr key={i} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)", transition:"background 0.15s" }}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(59,130,246,0.08)"}
                        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        <td style={{ padding:"12px 16px", color:i<3?C.gold:C.muted, fontWeight:i<3?700:400 }}>#{i+1}</td>
                        <td style={{ padding:"12px 16px" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                            <span style={{ color:C.white, fontWeight:600 }}>{w.username}</span>
                            <button onClick={() => { setMessageTarget(w); setMessageIndex(0); setMessageCopied(false) }} style={{ fontSize:20, background:"none", border:"none", cursor:"pointer", lineHeight:1 }}>💌</button>
                          </div>
                        </td>
                        <td style={{ padding:"12px 16px", color:C.green, fontWeight:700 }}>${w.totalUSD.toFixed(2)}</td>
                        <td style={{ padding:"12px 16px", color:C.muted }}>{w.tipCount}</td>
                        <td style={{ padding:"12px 16px", color:C.cyan }}>${w.avgTipSize.toFixed(2)}</td>
                        <td style={{ padding:"12px 16px", color:C.muted }}>{w.platform}</td>
                        <td style={{ padding:"12px 16px" }}>
                          <span style={{ padding:"4px 10px", borderRadius:100, background:`${TIER_COLORS[w.tier]}15`, color:TIER_COLORS[w.tier], fontSize:11, fontWeight:600 }}>{w.tier}</span>
                        </td>
                        <td style={{ padding:"12px 16px", color:C.muted, fontSize:12 }}>{w.daysSinceLastTip}d ago</td>
                        <td style={{ padding:"12px 16px" }}>
                          <button onClick={() => setSelectedWhale(w)} style={{ padding:"4px 10px", borderRadius:6, background:"rgba(34,211,238,0.15)", border:"1px solid rgba(34,211,238,0.3)", color:C.cyan, fontSize:11, cursor:"pointer" }}>🔍 View</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ═══════════ PLATFORMS TAB ═══════════ */}
          {activeTab === "platforms" && (
            <div style={{ animation:"fadeUp 0.3s ease" }}>
              <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", marginBottom:28, flexWrap:"wrap", gap:16 }}>
                <div>
                  <h1 style={{ fontSize:28, fontWeight:800, color:C.white }}>🎯 Platform Comparison</h1>
                  <p style={{ fontSize:13, color:C.muted }}>3 platforms · Chaturbate, BongaCams & MyFreeCams</p>
                </div>
              </div>
              <div style={{ padding:"14px 18px", borderRadius:12, background:"linear-gradient(135deg,rgba(34,211,238,0.1),rgba(124,92,255,0.1))", border:"1px solid rgba(34,211,238,0.3)", marginBottom:20, display:"flex", alignItems:"center", gap:12 }}>
                <span style={{ fontSize:20 }}>⚡</span>
                <div>
                  <div style={{ fontSize:14, fontWeight:700, color:C.white }}>You earn 2.6x more per hour on Chaturbate than MyFreeCams</div>
                  <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>$1,211/hr vs $473/hr — Chaturbate is your highest-ROI platform by far</div>
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:16, marginBottom:28 }}>
                {[
                  { icon:"💰", label:"Top Revenue", value:"Chaturbate", sub:"$1,895 total", color:C.gold },
                  { icon:"⚡", label:"Most Efficient", value:"Chaturbate", sub:"$135.40/hour", color:C.cyan },
                  { icon:"🕒", label:"Total Hours", value:"22.5h", sub:"across 4 platforms", color:C.pink },
                  { icon:"💵", label:"Combined Earned", value:`${DEMO_TOTAL_REVENUE.toLocaleString('en-US',{minimumFractionDigits:0})}`, sub:"all time", color:C.green },
                ].map(({icon,label,value,sub,color}) => (
                  <div key={label} className="demo-card" style={{ ...glassCard, borderRadius:14, padding:20 }}>
                    <div style={{ fontSize:11, color:C.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>{icon} {label}</div>
                    <div style={{ fontSize:20, fontWeight:800, color, marginBottom:4 }}>{value}</div>
                    <div style={{ fontSize:12, color:C.muted }}>{sub}</div>
                  </div>
                ))}
              </div>
              {platforms.map((p,i) => {
                const col=platColors2[p.platform]||C.blue, isTop=i===0
                const revenueBarPct=Math.round((p.totalUSD/1895)*100)
                const uphBarPct=Math.round((p.usdPerHour/135.4)*100)
                const bthHour=platformBestTimes[p.platform]?.hour?.hour
                return (
                  <div key={i} className="demo-card" style={{ ...glassCard, borderRadius:16, padding:28, marginBottom:20, border:isTop?"1px solid rgba(245,158,11,0.4)":"1px solid rgba(255,255,255,0.08)" }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:12 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                        <div style={{ width:44, height:44, borderRadius:12, background:isTop?"linear-gradient(135deg,rgba(245,158,11,0.3),rgba(251,146,60,0.2))":"rgba(255,255,255,0.06)", border:isTop?"1px solid rgba(245,158,11,0.4)":"1px solid rgba(255,255,255,0.1)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>
                          {["🟣","🔴","🟠","🔵"][i]}
                        </div>
                        <div>
                          <div style={{ fontSize:20, fontWeight:800, color:C.white }}>{p.platform}</div>
                          <div style={{ fontSize:12, color:C.muted }}>{p.sessions} sessions · {p.hours}h streamed</div>
                        </div>
                      </div>
                      <div style={{ display:"flex", gap:8 }}>
                        {isTop&&<div style={{ padding:"4px 12px", borderRadius:20, background:"rgba(245,158,11,0.2)", border:"1px solid rgba(245,158,11,0.4)", fontSize:11, fontWeight:700, color:C.gold }}>🏆 Top Platform</div>}
                        <div style={{ fontSize:11, color:C.muted, padding:"4px 10px", background:"rgba(255,255,255,0.04)", borderRadius:8 }}>#{i+1} of 4</div>
                      </div>
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:16, marginBottom:20 }}>
                      {[
                        { label:"Total Revenue", value:`$${p.totalUSD.toFixed(2)}`, color:C.green },
                        { label:"$/Hour", value:`$${p.usdPerHour.toFixed(2)}`, color:C.cyan },
                        { label:"Avg Session", value:`$${(p.totalUSD/p.sessions).toFixed(2)}`, color:C.pink },
                        { label:"Avg Tip", value:`$${p.avgTipSize.toFixed(2)}`, color:C.gold },
                      ].map(({label,value,color}) => (
                        <div key={label} style={{ background:"rgba(255,255,255,0.04)", borderRadius:10, padding:"14px 16px", border:"1px solid rgba(255,255,255,0.06)" }}>
                          <div style={{ fontSize:11, color:C.muted, marginBottom:6, textTransform:"uppercase", letterSpacing:0.5 }}>{label}</div>
                          <div style={{ fontSize:20, fontWeight:800, color }}>{value}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:16 }}>
                      {[{label:"Revenue share",pct:revenueBarPct,color:C.green},{label:"$/Hour efficiency",pct:uphBarPct,color:C.cyan}].map(({label,pct,color}) => (
                        <div key={label}>
                          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                            <span style={{ fontSize:11, color:C.muted }}>{label}</span>
                            <span style={{ fontSize:11, fontWeight:600, color }}>{pct}%</span>
                          </div>
                          <div style={{ height:6, borderRadius:4, background:"rgba(255,255,255,0.06)", overflow:"hidden" }}>
                            <div style={{ height:"100%", width:`${pct}%`, borderRadius:4, background:`linear-gradient(90deg,${color},${color}80)`, transition:"width 0.6s ease" }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    {bthHour !== undefined && (
                      <div style={{ display:"flex", gap:10 }}>
                        <div style={{ flex:1, padding:"10px 14px", background:"rgba(255,255,255,0.03)", borderRadius:10, border:"1px solid rgba(255,255,255,0.06)" }}>
                          <div style={{ fontSize:10, color:C.muted, marginBottom:3 }}>PEAK HOUR</div>
                          <div style={{ fontSize:14, fontWeight:700, color:col }}>{formatHour(bthHour)}</div>
                        </div>
                        <div style={{ flex:1, padding:"10px 14px", background:"rgba(255,255,255,0.03)", borderRadius:10, border:"1px solid rgba(255,255,255,0.06)" }}>
                          <div style={{ fontSize:10, color:C.muted, marginBottom:3 }}>BEST DAY</div>
                          <div style={{ fontSize:14, fontWeight:700, color:col }}>{platformBestTimes[p.platform]?.bestDay?.day||"—"}</div>
                        </div>
                        <div style={{ flex:1, padding:"10px 14px", background:"rgba(255,255,255,0.03)", borderRadius:10, border:"1px solid rgba(255,255,255,0.06)" }}>
                          <div style={{ fontSize:10, color:C.muted, marginBottom:3 }}>TIP COUNT</div>
                          <div style={{ fontSize:14, fontWeight:700, color:col }}>{p.tipCount}</div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* ═══════════ SESSIONS TAB ═══════════ */}
          {activeTab === "sessions" && (
            <div style={{ animation:"fadeUp 0.3s ease" }}>
              <div style={{ marginBottom:24 }}>
                <h1 style={{ fontSize:28, fontWeight:800, color:C.white }}>🎥 Session Breakdown</h1>
                <p style={{ fontSize:13, color:C.muted }}>What happened in each stream and how to earn more next time</p>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:28 }}>
                {[
                  { label:"Total Sessions", value:sessions.length, color:C.cyan },
                  { label:"Avg Earnings", value:`$${(sessions.reduce((s,x)=>s+x.totalUSD,0)/sessions.length).toFixed(2)}`, color:C.green },
                  { label:"Best Session", value:`$${Math.max(...sessions.map(s=>s.totalUSD)).toFixed(2)}`, color:C.gold },
                  { label:"Total Earned", value:`$${sessions.reduce((s,x)=>s+x.totalUSD,0).toFixed(2)}`, color:C.pink },
                ].map(({label,value,color}) => (
                  <div key={label} style={{ ...glassCard, borderRadius:12, padding:"16px 18px" }}>
                    <div style={{ fontSize:11, color:C.muted, marginBottom:4, textTransform:"uppercase" }}>{label}</div>
                    <div style={{ fontSize:22, fontWeight:800, color }}>{value}</div>
                  </div>
                ))}
              </div>
              {sessions.map((s,si) => {
                const avgSess=sessions.reduce((a,x)=>a+x.totalUSD,0)/sessions.length
                const perf=s.totalUSD>=avgSess*1.3?"high":s.totalUSD<=avgSess*0.6?"low":"average"
                const PERF={high:{label:"🔥 High Performing",color:"#10B981",bg:"rgba(16,185,129,0.1)",border:"rgba(16,185,129,0.3)"},average:{label:"📊 Average",color:"#F59E0B",bg:"rgba(245,158,11,0.1)",border:"rgba(245,158,11,0.25)"},low:{label:"📉 Underperforming",color:"#F87171",bg:"rgba(248,113,113,0.1)",border:"rgba(248,113,113,0.25)"}}[perf]
                const col=platColors2[s.platform]||C.blue
                return (
                  <div key={si} style={{ ...glassCard, borderRadius:16, marginBottom:20, overflow:"hidden" }}>
                    <div style={{ padding:"18px 24px", borderBottom:"1px solid rgba(255,255,255,0.07)", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12 }}>
                      <div>
                        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
                          <span style={{ fontSize:16, fontWeight:800, color:C.white }}>{new Date(s.startTime).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}</span>
                          <span style={{ fontSize:12, color:C.muted }}>{s.platform}</span>
                        </div>
                        <span style={{ padding:"3px 10px", borderRadius:20, background:PERF.bg, border:`1px solid ${PERF.border}`, fontSize:11, fontWeight:700, color:PERF.color }}>{PERF.label}</span>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:28, fontWeight:900, color:C.green }}>${s.totalUSD.toFixed(2)}</div>
                        <div style={{ fontSize:12, color:C.muted }}>{Math.round(s.durationMinutes)} min · ${(s.totalUSD/s.durationMinutes).toFixed(2)}/min</div>
                      </div>
                    </div>
                    <div style={{ padding:24 }}>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10, marginBottom:16 }}>
                        {[
                          { label:"Tips",value:s.tipCount,color:C.cyan },
                          { label:"Unique Fans",value:s.uniqueFans,color:C.pink },
                          { label:"Avg Tip",value:`$${s.avgTipSize.toFixed(2)}`,color:C.gold },
                          { label:"$/Hour",value:`$${s.usdPerHour.toFixed(0)}`,color:C.green },
                          { label:"Velocity",value:s.velocityTrend==="growing"?"📈 Growing":s.velocityTrend==="above"?"🔥 Hot":"→ Steady",color:s.velocityTrend==="growing"?C.green:s.velocityTrend==="above"?C.orange:C.muted },
                        ].map(({label,value,color}) => (
                          <div key={label} style={{ padding:"12px 14px", background:"rgba(255,255,255,0.04)", borderRadius:10, border:"1px solid rgba(255,255,255,0.06)" }}>
                            <div style={{ fontSize:10, color:C.muted, marginBottom:4, textTransform:"uppercase" }}>{label}</div>
                            <div style={{ fontSize:16, fontWeight:800, color }}>{value}</div>
                          </div>
                        ))}
                      </div>
                      {s.topContributorPct >= 35 && (
                        <div style={{ padding:"9px 14px", borderRadius:9, background:"rgba(245,158,11,0.07)", border:"1px solid rgba(245,158,11,0.2)", marginBottom:12, fontSize:12, color:C.gold }}>
                          ⚠️ <strong>{s.topContributor}</strong> drove {s.topContributorPct}% of this session's revenue
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ═══════════ MONTHLY TAB ═══════════ */}
          {activeTab === "monthly" && (() => {
            const monthly = DEMO_ANALYTICS.monthlyData
            const maxBarUSD = Math.max(...monthly.map(m=>m.usd),1)
            const fmtMonth = key => { const [y,m]=key.split("-"); return new Date(y,parseInt(m)-1,1).toLocaleDateString("en-US",{month:"short"})+"'"+String(y).slice(-2) }
            const thisMonthKey = "2026-05"
            return (
              <div style={{ animation:"fadeUp 0.3s ease" }}>
                <div style={{ marginBottom:24 }}>
                  <h1 style={{ fontSize:28, fontWeight:800, color:C.white }}>📈 Monthly Overview</h1>
                  <p style={{ fontSize:13, color:C.muted }}>4 months of data across all platforms</p>
                </div>
                <div style={{ ...glassCard, borderRadius:18, padding:24, marginBottom:24 }}>
                  <div style={{ fontSize:16, fontWeight:800, color:C.white, marginBottom:20 }}>Monthly Earnings</div>
                  <div style={{ display:"flex", alignItems:"flex-end", gap:8, height:180, paddingBottom:24, position:"relative" }}>
                    {monthly.map((m,i) => {
                      const h=Math.max(4,Math.round((m.usd/maxBarUSD)*156))
                      const isBest=m.month==="2026-04",isCurrent=m.month===thisMonthKey
                      const col=isBest?C.gold:isCurrent?C.green:C.indigo
                      return (
                        <div key={m.month} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                          <div style={{ fontSize:11, color:C.muted, fontWeight:600 }}>${m.usd>=100?Math.round(m.usd):m.usd}</div>
                          <div style={{ width:"100%", height:h, borderRadius:"4px 4px 0 0", background:isBest?`linear-gradient(180deg,${C.gold},${C.orange})`:isCurrent?`linear-gradient(180deg,${C.green},${C.cyan})`:`linear-gradient(180deg,${C.indigo},rgba(124,92,255,0.4))`, transition:"height 0.4s ease" }} />
                          <div style={{ fontSize:11, color:isCurrent?C.green:isBest?C.gold:C.muted, fontWeight:isCurrent||isBest?700:400 }}>{fmtMonth(m.month)}{isBest?" 🏆":isCurrent?" ◀":""}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div style={{ ...glassCard, borderRadius:18, padding:24, marginBottom:24 }}>
                  <div style={{ fontSize:16, fontWeight:800, color:C.white, marginBottom:16 }}>Revenue by Type</div>
                  {DEMO_ANALYTICS.tipTypeBreakdown.map(t => {
                    const col=t.type.includes("Private")?C.pink:t.type.includes("Spy")?C.orange:C.cyan
                    return (
                      <div key={t.type} style={{ padding:"14px 16px", borderRadius:12, background:`${col}0d`, border:`1px solid ${col}25`, marginBottom:10 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                          <div style={{ fontSize:14, fontWeight:700, color:C.white }}>{t.type}</div>
                          <div style={{ fontSize:16, fontWeight:900, color:col }}>${t.usd.toFixed(2)} <span style={{ fontSize:12, color:C.muted }}>({t.pct}%)</span></div>
                        </div>
                        <div style={{ height:6, borderRadius:3, background:"rgba(255,255,255,0.06)", overflow:"hidden", marginBottom:8 }}>
                          <div style={{ height:"100%", width:`${t.pct}%`, borderRadius:3, background:col }} />
                        </div>
                        <div style={{ display:"flex", gap:16 }}>
                          <span style={{ fontSize:11, color:C.muted }}>{t.count} tips</span>
                          <span style={{ fontSize:11, color:C.muted }}>{t.fans} fans</span>
                          <span style={{ fontSize:11, color:C.muted }}>${t.avgUsd} avg</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* ═══════════ MONEY MAP TAB ═══════════ */}
          {activeTab === "moneymap" && (() => {
            const DAY_ORDER = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
            const allDayEntries = DAY_ORDER.map(day => {
              let bestPlat = null, bestVal = 0, bestHourNum = null
              Object.entries(platformBestTimes).forEach(([plat, times]) => {
                const entry = times?.bestHourByDay?.[day]
                if (entry && entry.avg > bestVal) { bestVal = entry.avg; bestPlat = plat; bestHourNum = entry.hour }
              })
              return { day, bestPlat, bestVal, bestHourNum }
            })
            const maxVal = Math.max(...allDayEntries.map(d=>d.bestVal), 1)
            const hottest = [...allDayEntries].sort((a,b)=>b.bestVal-a.bestVal)[0]
            return (
              <div style={{ animation:"fadeUp 0.3s ease" }}>
                <div style={{ marginBottom:24 }}>
                  <h1 style={{ fontSize:28, fontWeight:800, color:C.white, display:"flex", alignItems:"center", gap:10 }}>🗺️ Money Map</h1>
                  <p style={{ fontSize:13, color:C.muted }}>Your earnings heat map — exactly when and where your room performs best</p>
                </div>

                <div style={{ ...glassCard, borderRadius:18, padding:24, marginBottom:20 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:C.white, marginBottom:16 }}>Best earning window by day (across all platforms)</div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:8 }}>
                    {allDayEntries.map(d => {
                      const intensity = d.bestVal / maxVal
                      const col = platColors2[d.bestPlat] || C.cyan
                      const isHot = d.day === hottest.day
                      return (
                        <div key={d.day} style={{
                          padding:"14px 8px", borderRadius:12, textAlign:"center",
                          background: d.bestVal===0 ? "rgba(255,255,255,0.03)" : `${col}${Math.round(intensity*40+8).toString(16).padStart(2,'0')}`,
                          border: isHot ? `1.5px solid ${col}` : "1px solid rgba(255,255,255,0.07)",
                          boxShadow: isHot ? `0 0 16px ${col}40` : "none",
                        }}>
                          <div style={{ fontSize:11, fontWeight:700, color:C.muted, marginBottom:6 }}>{d.day.slice(0,3)}</div>
                          {d.bestVal>0 ? (
                            <>
                              <div style={{ fontSize:15, fontWeight:900, color:C.white }}>${Math.round(d.bestVal)}</div>
                              <div style={{ fontSize:9, color:col, fontWeight:700, marginTop:3 }}>{formatHour(d.bestHourNum)}</div>
                              <div style={{ fontSize:8, color:C.muted, marginTop:2 }}>{d.bestPlat?.replace("BongaCams","Bonga").replace("Chaturbate","CB").replace("MyFreeCams","MFC")}</div>
                              {isHot && <div style={{ fontSize:13, marginTop:4 }}>🔥</div>}
                            </>
                          ) : <div style={{ fontSize:11, color:C.muted }}>—</div>}
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ marginTop:16, padding:"10px 14px", borderRadius:10, background:"rgba(245,158,11,0.07)", border:"1px solid rgba(245,158,11,0.2)", fontSize:12, color:C.text }}>
                    🔥 Your hottest window is <strong style={{ color:C.gold }}>{hottest.day} {formatHour(hottest.bestHourNum)}</strong> on <strong style={{ color:C.white }}>{hottest.bestPlat}</strong> — historically ${Math.round(hottest.bestVal)}/session.
                  </div>
                </div>

                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14 }}>
                  {Object.entries(platformBestTimes).map(([plat, times]) => {
                    const col = platColors2[plat] || C.blue
                    return (
                      <div key={plat} style={{ ...glassCard, borderRadius:14, padding:18, border:`1px solid ${col}25` }}>
                        <div style={{ fontSize:13, fontWeight:800, color:C.white, marginBottom:10 }}>{plat}</div>
                        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                          <div style={{ padding:"8px 10px", borderRadius:8, background:`${col}10` }}>
                            <div style={{ fontSize:9, color:C.muted, textTransform:"uppercase" }}>Peak Hour</div>
                            <div style={{ fontSize:14, fontWeight:700, color:col }}>{formatHour(times?.hour?.hour)}</div>
                          </div>
                          <div style={{ padding:"8px 10px", borderRadius:8, background:`${col}10` }}>
                            <div style={{ fontSize:9, color:C.muted, textTransform:"uppercase" }}>Best Day</div>
                            <div style={{ fontSize:14, fontWeight:700, color:col }}>{times?.bestDay?.day} · ${Math.round(times?.bestDay?.avg||0)}</div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* ═══════════ STREAMING PLAN TAB ═══════════ */}
          {activeTab === "plan" && (() => {
            const TAG_BY_RANK = ["Top Pick","Peak","High $/hr","Reliable","Good","Steady"]
            const planRows = []
            Object.entries(platformBestTimes).forEach(([plat, times]) => {
              if (!times?.bestDay) return
              planRows.push({ plat, day: times.bestDay.day, hour: times.hour?.hour ?? null, avg: times.bestDay.avg })
            })
            // also add a couple of secondary days for the top platform
            const topPlat = Object.entries(platformVelocity).sort((a,b)=>b[1]-a[1])[0]?.[0]
            if (topPlat && platformBestTimes[topPlat]) {
              Object.entries(platformBestTimes[topPlat].bestHourByDay || {}).forEach(([day, entry]) => {
                if (day !== platformBestTimes[topPlat].bestDay.day) {
                  planRows.push({ plat: topPlat, day, hour: entry.hour, avg: entry.avg })
                }
              })
            }
            const sortedRows = planRows.sort((a,b)=>b.avg-a.avg).slice(0,6)
            return (
              <div style={{ animation:"fadeUp 0.3s ease" }}>
                <div style={{ marginBottom:24 }}>
                  <h1 style={{ fontSize:28, fontWeight:800, color:C.white, display:"flex", alignItems:"center", gap:10 }}>📅 Personalized Streaming Plan</h1>
                  <p style={{ fontSize:13, color:C.muted }}>Built from your Money Map — a suggested weekly schedule designed around when you actually earn the most</p>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {sortedRows.map((r,i) => {
                    const col = platColors2[r.plat] || C.cyan
                    const tag = TAG_BY_RANK[i] || "Good"
                    const winStart = r.hour, winEnd = (r.hour + 3) % 24
                    return (
                      <div key={i} style={{ ...glassCard, borderRadius:14, padding:"16px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                          <div style={{ width:38, height:38, borderRadius:10, background:`${col}20`, border:`1px solid ${col}40`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:800, color:col }}>{r.day.slice(0,2)}</div>
                          <div>
                            <div style={{ fontWeight:800, fontSize:15, color:C.white }}>{r.day}</div>
                            <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>{r.plat} · expected ${Math.round(r.avg)}/session</div>
                          </div>
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                          <span style={{ fontSize:13, fontWeight:700, color:C.text }}>{formatHour(winStart)} – {formatHour(winEnd)}</span>
                          <span style={{ fontSize:11, fontWeight:800, padding:"5px 10px", borderRadius:999, background: i===0?"rgba(255,43,174,0.18)":`${col}18`, color: i===0?C.pink:col, border:`1px solid ${i===0?"rgba(255,43,174,0.4)":col+"40"}` }}>{tag}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div style={{ marginTop:16, padding:"12px 16px", borderRadius:12, background:"rgba(34,211,238,0.06)", border:"1px solid rgba(34,211,238,0.18)", fontSize:12, color:C.text }}>
                  💡 This plan updates automatically as you stream more — the more sessions you log, the sharper these windows get.
                </div>
              </div>
            )
          })()}

          {/* ═══════════ LIVE MODE TAB ═══════════ */}
          {activeTab === "live" && (() => {
            const pace = liveElapsed > 0 ? (liveTotal / Math.max(liveElapsed/60,0.2)) : 0
            const benchmarkPerMin = avgPerHour / 60
            const paceState = liveElapsed < 15 ? "warming" : pace >= benchmarkPerMin*1.15 ? "hot" : pace <= benchmarkPerMin*0.7 ? "slow" : "steady"
            const paceCfg = {
              warming: { label:"⏳ Warming up", color:C.muted },
              hot:     { label:"🔥 Hot — above your average pace", color:C.green },
              steady:  { label:"✅ On track", color:C.cyan },
              slow:    { label:"📉 Slowing — try a micro-goal", color:C.orange },
            }[paceState]
            const mm = Math.floor(liveElapsed/60), ss = liveElapsed%60
            return (
              <div style={{ animation:"fadeUp 0.3s ease" }}>
                <div style={{ marginBottom:24, display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
                  <div>
                    <h1 style={{ fontSize:28, fontWeight:800, color:C.white, display:"flex", alignItems:"center", gap:10 }}>
                      🔴 Live Mode
                      {liveActive && <span style={{ fontSize:11, fontWeight:800, color:C.red, background:"rgba(248,113,113,0.12)", border:"1px solid rgba(248,113,113,0.35)", padding:"3px 10px", borderRadius:999 }}>● LIVE DEMO</span>}
                    </h1>
                    <p style={{ fontSize:13, color:C.muted }}>Simulated tip ticker — sign up to track your real stream</p>
                  </div>
                  {!liveActive ? (
                    <button onClick={startLiveDemo} style={{ padding:"10px 22px", borderRadius:10, background:"linear-gradient(135deg,#10B981,#22D3EE)", border:"none", color:"white", fontWeight:800, fontSize:13, cursor:"pointer", boxShadow:"0 0 18px rgba(16,185,129,0.35)" }}>▶ Start Demo Stream</button>
                  ) : (
                    <button onClick={stopLiveDemo} style={{ padding:"10px 22px", borderRadius:10, background:"rgba(248,113,113,0.15)", border:"1px solid rgba(248,113,113,0.4)", color:C.red, fontWeight:700, fontSize:13, cursor:"pointer" }}>⏹ End Demo Stream</button>
                  )}
                </div>

                {!liveActive && liveTips.length===0 ? (
                  <div style={{ ...glassCard, borderRadius:16, padding:48, textAlign:"center" }}>
                    <div style={{ fontSize:44, marginBottom:14 }}>🔴</div>
                    <div style={{ fontSize:18, fontWeight:700, color:C.white, marginBottom:8 }}>Hit "Start Demo Stream" to see Live Mode in action</div>
                    <div style={{ fontSize:13, color:C.muted, maxWidth:440, margin:"0 auto" }}>Tips will start coming in automatically — watch your pace, total, and coaching message update in real time, just like your real dashboard.</div>
                  </div>
                ) : (
                  <>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:18 }}>
                      <div style={{ ...glassCard, borderRadius:14, padding:18 }}>
                        <div style={{ fontSize:10, color:C.muted, textTransform:"uppercase", marginBottom:6 }}>Session Total</div>
                        <div style={{ fontSize:28, fontWeight:900, color:C.green }}>${liveTotal}</div>
                      </div>
                      <div style={{ ...glassCard, borderRadius:14, padding:18 }}>
                        <div style={{ fontSize:10, color:C.muted, textTransform:"uppercase", marginBottom:6 }}>Time Live</div>
                        <div style={{ fontSize:28, fontWeight:900, color:C.white }}>{mm}:{String(ss).padStart(2,"0")}</div>
                      </div>
                      <div style={{ ...glassCard, borderRadius:14, padding:18 }}>
                        <div style={{ fontSize:10, color:C.muted, textTransform:"uppercase", marginBottom:6 }}>Pace</div>
                        <div style={{ fontSize:16, fontWeight:800, color:paceCfg.color }}>{paceCfg.label}</div>
                      </div>
                    </div>

                    <div style={{ ...glassCard, borderRadius:14, padding:18, marginBottom:18 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                        <span style={{ fontSize:12, color:C.muted, textTransform:"uppercase" }}>Goal: {liveGoal} tokens</span>
                        <span style={{ fontSize:12, fontWeight:700, color:C.cyan }}>{Math.min(100,Math.round((liveTotal/liveGoal)*100))}%</span>
                      </div>
                      <div style={{ height:8, borderRadius:4, background:"rgba(255,255,255,0.08)", overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${Math.min(100,(liveTotal/liveGoal)*100)}%`, borderRadius:4, background:"linear-gradient(90deg,#22D3EE,#EC4899)", transition:"width 0.5s ease" }} />
                      </div>
                    </div>

                    <div style={{ ...glassCard, borderRadius:14, padding:18 }}>
                      <div style={{ fontSize:11, color:C.muted, textTransform:"uppercase", marginBottom:10 }}>Tip Ticker</div>
                      <div style={{ display:"flex", flexDirection:"column", gap:7, minHeight:140 }}>
                        {liveTips.length===0 && <div style={{ fontSize:12, color:C.muted, textAlign:"center", padding:"24px 0" }}>Waiting for the first tip…</div>}
                        {liveTips.map(t => (
                          <div key={t.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"9px 13px", borderRadius:10, background:"rgba(34,211,238,0.06)", border:"1px solid rgba(34,211,238,0.16)" }}>
                            <span style={{ fontSize:13, fontWeight:600, color:C.white }}>{t.name}</span>
                            <span style={{ fontSize:13, fontWeight:800, color:C.gold }}>+{t.amt} tokens</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )
          })()}

          {/* ═══════════ ROOM TITLES TAB ═══════════ */}
          {activeTab === "titles" && (
            <div style={{ animation:"fadeUp 0.3s ease" }}>
              <div style={{ marginBottom:24 }}>
                <h1 style={{ fontSize:28, fontWeight:800, color:C.white }}>🎬 Room Title Generator</h1>
                <p style={{ fontSize:13, color:C.muted }}>Pick a mood and a goal — generate a title live, right here</p>
              </div>

              <div style={{ ...glassCard, borderRadius:16, padding:24, marginBottom:20 }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
                  <div>
                    <div style={{ fontSize:10, color:C.muted, textTransform:"uppercase", marginBottom:5 }}>Mood</div>
                    <select value={titleMood} onChange={e=>{ setTitleMood(e.target.value); setTitleIdx(0) }} style={{ width:"100%", padding:"9px 11px", borderRadius:9, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.12)", color:C.white, fontSize:13, outline:"none" }}>
                      <option value="tease">Tease</option>
                      <option value="dominant">Dominant</option>
                      <option value="hype">Hype</option>
                      <option value="mystery">Mystery</option>
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize:10, color:C.muted, textTransform:"uppercase", marginBottom:5 }}>Token Goal</div>
                    <input type="number" value={titleGoal} onChange={e=>{ setTitleGoal(e.target.value); setTitleIdx(0) }} placeholder="e.g. 500"
                      style={{ width:"100%", padding:"9px 11px", borderRadius:9, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.12)", color:C.white, fontSize:13, outline:"none", boxSizing:"border-box" }} />
                  </div>
                </div>
                <div style={{
                  background:"rgba(5,9,24,0.6)", border:"1px solid rgba(236,72,153,0.25)", borderRadius:14, padding:"18px",
                  fontSize:16, fontWeight:800, color:C.white, textAlign:"center", minHeight:30,
                  opacity: titleGenerating?0.35:1, transition:"opacity 180ms ease", marginBottom:16,
                }}>
                  {titleGenerating ? "Thinking of something good…" : `"${currentTitle}"`}
                </div>
                <div style={{ display:"flex", justifyContent:"center" }}>
                  <button onClick={generateTitle} disabled={titleGenerating} style={{
                    padding:"11px 26px", borderRadius:11, background:"linear-gradient(135deg,#EC4899,#7C5CFF)", border:"none",
                    color:"white", fontWeight:800, fontSize:14, cursor:titleGenerating?"default":"pointer", opacity:titleGenerating?0.7:1,
                    boxShadow:"0 0 20px rgba(236,72,153,0.3)",
                  }}>
                    {titleGenerating ? "Generating…" : "✨ Generate New Title"}
                  </button>
                </div>
              </div>

              <div style={{ textAlign:"center", padding:"24px", ...glassCard, borderRadius:16 }}>
                <div style={{ fontSize:14, fontWeight:700, color:C.white, marginBottom:6 }}>Sign up to generate titles from your own peak hours and fan data</div>
                <div style={{ fontSize:12, color:C.muted, marginBottom:16 }}>The real generator factors in your actual best hours, top fans, and tipping history</div>
                <a href="/landing" style={{ display:"inline-block", padding:"10px 28px", borderRadius:10, background:"linear-gradient(135deg,#EC4899,#7C5CFF)", color:"white", fontWeight:700, fontSize:13, textDecoration:"none" }}>
                  Start Free →
                </a>
              </div>
            </div>
          )}

          {/* ═══════════ UPLOAD DATA TAB ═══════════ */}
          {activeTab === "upload" && (
            <div style={{ animation:"fadeUp 0.3s ease", maxWidth:640 }}>
              <div style={{ marginBottom:24 }}>
                <h1 style={{ fontSize:28, fontWeight:800, color:C.white, display:"flex", alignItems:"center", gap:10 }}>📥 Upload Your Data</h1>
                <p style={{ fontSize:13, color:C.muted }}>Paste once. Get insights fast. Pick your platform, then paste your tip history.</p>
              </div>

              <div style={{ display:"flex", gap:10, marginBottom:18, flexWrap:"wrap" }}>
                {[
                  { name:"Chaturbate",  initials:"CB",  color:C.cyan },
                  { name:"BongaCams",   initials:"BC",  color:C.pink },
                  { name:"MyFreeCams",  initials:"MFC", color:C.indigo },
                ].map(p => {
                  const isSel = uploadPlatform === p.name
                  return (
                    <button key={p.name} onClick={() => setUploadPlatform(p.name)} style={{
                      flex:1, minWidth:150, padding:16, borderRadius:14, cursor:"pointer", textAlign:"left",
                      background: isSel ? `${p.color}14` : "rgba(255,255,255,0.03)",
                      border: isSel ? `1px solid ${p.color}` : "1px solid rgba(255,255,255,0.08)",
                      boxShadow: isSel ? `0 0 16px ${p.color}30` : "none",
                    }}>
                      <div style={{ width:32, height:32, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", background:`${p.color}20`, color:p.color, fontWeight:800, fontSize:11, marginBottom:8 }}>{p.initials}</div>
                      <div style={{ fontWeight:700, fontSize:13, color:C.white }}>{p.name}</div>
                    </button>
                  )
                })}
              </div>

              <div style={{ ...glassCard, borderRadius:16, border:"1.5px dashed rgba(34,211,238,0.3)", background:"rgba(34,211,238,0.025)", padding:"40px 20px", textAlign:"center", marginBottom:16 }}>
                <div style={{ fontSize:30, marginBottom:10 }}>📁</div>
                <div style={{ fontWeight:700, color:C.white, marginBottom:4 }}>Paste your {uploadPlatform} tip history</div>
                <div style={{ fontSize:12, color:C.muted, marginBottom:18 }}>Drag a CSV here, or paste raw text — we detect the format automatically</div>
                <button onClick={() => showToast("Sign up free to import your real tip history →")} style={{
                  padding:"11px 26px", borderRadius:11, background:"linear-gradient(135deg,#22D3EE,#EC4899)", border:"none",
                  color:"white", fontWeight:800, fontSize:13, cursor:"pointer", boxShadow:"0 0 18px rgba(34,211,238,0.3)",
                }}>Preview My Import</button>
              </div>

              <div style={{ fontSize:12, color:C.text, display:"flex", alignItems:"center", gap:6, borderTop:"1px solid rgba(255,255,255,0.08)", paddingTop:14 }}>
                🔒 Your data is stored securely and never shared.
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ═══════════ WHALE PROFILE MODAL ═══════════ */}
      {selectedWhale && (() => {
        const w = selectedWhale
        const tierColor = TIER_COLORS[w.tier]||C.cyan
        const daysSince = w.daysSinceLastTip
        return (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:20 }}>
            <div style={{ width:520, maxHeight:"90vh", overflowY:"auto", ...glassCard, borderRadius:20 }}>
              <div style={{ padding:"24px 24px 20px", background:`linear-gradient(135deg,${tierColor}15,transparent)`, borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                    <div style={{ width:52, height:52, borderRadius:14, background:`linear-gradient(135deg,${tierColor},${tierColor}80)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, fontWeight:800, color:"#fff" }}>{w.username.charAt(0).toUpperCase()}</div>
                    <div>
                      <div style={{ fontSize:20, fontWeight:800, color:C.white }}>{w.username}</div>
                      <div style={{ display:"flex", gap:8, marginTop:4 }}>
                        <span style={{ padding:"2px 8px", borderRadius:100, background:`${tierColor}20`, border:`1px solid ${tierColor}50`, color:tierColor, fontSize:11, fontWeight:700 }}>{w.tier}</span>
                        <span style={{ fontSize:11, color:C.muted }}>{w.platform}</span>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => setSelectedWhale(null)} style={{ width:32, height:32, borderRadius:"50%", background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.1)", color:C.muted, fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
                  {[
                    { label:"Total Spent", value:`$${w.totalUSD.toFixed(2)}`, color:C.green },
                    { label:"Tips", value:w.tipCount, color:C.cyan },
                    { label:"Avg Tip", value:`$${w.avgTipSize.toFixed(2)}`, color:C.gold },
                    { label:"Last Tip", value:`${daysSince}d ago`, color:daysSince>30?C.red:daysSince>14?C.orange:C.green },
                  ].map(({label,value,color}) => (
                    <div key={label} style={{ background:"rgba(255,255,255,0.05)", borderRadius:10, padding:12, textAlign:"center" }}>
                      <div style={{ fontSize:11, color:C.muted, marginBottom:4 }}>{label}</div>
                      <div style={{ fontSize:16, fontWeight:800, color }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ padding:24 }}>
                <div style={{ fontSize:13, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:12 }}>AI Predictions</div>
                <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:20 }}>
                  {[
                    { label:"📅 Likely to tip again in", value:`~${Math.max(0,w.avgDaysBetweenTips-daysSince)} days`, color:C.cyan },
                    { label:"💸 Predicted next tip", value:`$${(w.avgTipSize*1.1).toFixed(2)}`, color:C.gold },
                    { label:"🎯 Churn risk", value:w.churnRisk.level, color:w.churnRisk.level==="High"||w.churnRisk.level==="Critical"?C.red:w.churnRisk.level==="Medium"?C.orange:C.green },
                    { label:"💰 Monthly value", value:w.lifetimeValue.monthly>0?`$${w.lifetimeValue.monthly}`:"—", color:C.green },
                  ].map(({label,value,color}) => (
                    <div key={label} style={{ display:"flex", justifyContent:"space-between", padding:"10px 14px", background:"rgba(255,255,255,0.04)", borderRadius:8 }}>
                      <div style={{ fontSize:13, color:C.text }}>{label}</div>
                      <div style={{ fontSize:13, fontWeight:700, color }}>{value}</div>
                    </div>
                  ))}
                </div>
                {w.tipNotes.length > 0 && (
                  <div style={{ marginBottom:20 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>Tip Notes</div>
                    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                      {w.tipNotes.slice(-3).map((note,i) => (
                        <div key={i} style={{ padding:"8px 12px", background:`${C.indigo}10`, border:`1px solid ${C.indigo}20`, borderRadius:8, fontSize:12, color:C.text, fontStyle:"italic" }}>"{note}"</div>
                      ))}
                    </div>
                  </div>
                )}
                <button onClick={() => { setMessageTarget(w); setMessageIndex(0); setMessageCopied(false); setSelectedWhale(null) }}
                  style={{ width:"100%", padding:"12px", borderRadius:10, background:"linear-gradient(135deg,#22D3EE,#EC4899)", border:"none", color:"white", fontSize:14, fontWeight:700, cursor:"pointer", marginBottom:10 }}>
                  💌 Generate Message for {w.username}
                </button>
                <button onClick={() => setSelectedWhale(null)} style={{ width:"100%", padding:"10px", borderRadius:10, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", color:C.muted, fontSize:13, cursor:"pointer" }}>Close</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ═══════════ MESSAGE MODAL ═══════════ */}
      {messageTarget && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1001, padding:20 }}>
          <div style={{ width:500, ...glassCard, borderRadius:20, overflow:"hidden" }}>
            <div style={{ padding:"20px 24px", background:"linear-gradient(135deg,rgba(236,72,153,0.2),rgba(124,92,255,0.15))", borderBottom:"1px solid rgba(255,255,255,0.08)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:17, fontWeight:800, color:C.white }}>💌 Message Generator</div>
                <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>For <span style={{ color:C.pink, fontWeight:600 }}>{messageTarget.username}</span> · <span style={{ color:C.cyan }}>{messageTarget.platform}</span> · {messageTarget.daysSinceLastTip}d since last tip</div>
              </div>
              <button onClick={() => setMessageTarget(null)} style={{ width:30, height:30, borderRadius:"50%", background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.1)", color:C.muted, fontSize:15, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            </div>
            <div style={{ padding:24 }}>
              <div style={{ padding:18, background:"rgba(255,255,255,0.04)", borderRadius:14, border:"1px solid rgba(255,255,255,0.08)", fontSize:15, color:C.white, lineHeight:1.7, minHeight:80, marginBottom:16 }}>{currentMsg}</div>
              <div style={{ display:"flex", gap:10, marginBottom:12 }}>
                <button onClick={() => { setMessageIndex(i=>i+1); setMessageCopied(false) }} style={{ flex:1, padding:"11px", borderRadius:10, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", color:C.white, fontSize:14, fontWeight:600, cursor:"pointer" }}>🔄 Generate Another</button>
                <button onClick={() => { navigator.clipboard.writeText(currentMsg); setMessageCopied(true); setTimeout(()=>setMessageCopied(false),2500) }}
                  style={{ flex:1, padding:"11px", borderRadius:10, background:messageCopied?"rgba(16,185,129,0.2)":"linear-gradient(135deg,#22D3EE,#EC4899)", border:messageCopied?"1px solid rgba(16,185,129,0.4)":"none", color:"white", fontSize:14, fontWeight:700, cursor:"pointer" }}>
                  {messageCopied?"✅ Copied!":"📋 Copy Message"}
                </button>
              </div>
              <div style={{ fontSize:11, color:C.muted, textAlign:"center" }}>Sign up to get messages personalized to this fan's exact behavior</div>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={{ position:"fixed", bottom:24, left:252, background:"rgba(15,20,32,0.95)", backdropFilter:"blur(20px)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:12, padding:"14px 20px", color:C.white, fontSize:14, zIndex:9999 }}>{toast}</div>}
    </div>
  )
}
