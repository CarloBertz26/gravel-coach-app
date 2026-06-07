import { useState, useEffect, useRef, useCallback } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const STRAVA_CLIENT_ID = "253711";
const STRAVA_BACKEND_URL = "/api/strava-token";
const STRAVA_REDIRECT_URI = typeof window !== "undefined" ? window.location.origin + window.location.pathname : "";
const STRAVA_SCOPE = "read,activity:read_all";

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const m2km = (m) => (m / 1000).toFixed(1);
const s2hhmm = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; };
const w2wkg = (w, kg) => (w / kg).toFixed(2);
const fmtDate = (iso) => new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
const fmtDateShort = (iso) => new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
const daysUntil = (dateStr) => { const d = new Date(dateStr) - new Date(); return Math.max(0, Math.ceil(d / 86400000)); };
// FTP stimato: usa il 95% della potenza media delle 3 uscite più intense (proxy del 20min best)
const calcFTP = (activities, weight) => {
  const withWatts = activities.filter(a => a.average_watts > 0);
  if (!withWatts.length) return 0;
  const sorted = [...withWatts].sort((a,b) => b.average_watts - a.average_watts);
  const top3 = sorted.slice(0, Math.min(3, sorted.length));
  const avg = Math.round(top3.reduce((s,a) => s+a.average_watts, 0) / top3.length);
  return Math.round(avg * 0.95);
};
const calcTSS = (duration_s, avgWatts, ftp) => { if (!avgWatts || !ftp) return 0; const IF = avgWatts / ftp; return Math.round((duration_s * avgWatts * IF) / (ftp * 3600) * 100); };

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
function getMockActivities() {
  const now = Date.now(), day = 86400000;
  const base = [
    { id:1, name:"Giro sui Colli Euganei", sport_type:"GravelRide", distance:68400, moving_time:9720, total_elevation_gain:820, average_watts:178, suffer_score:67, start_date:new Date(now-day).toISOString(), average_heartrate:142, max_heartrate:171 },
    { id:2, name:"Lungo del mattino", sport_type:"Ride", distance:42100, moving_time:5400, total_elevation_gain:310, average_watts:162, suffer_score:38, start_date:new Date(now-3*day).toISOString(), average_heartrate:135, max_heartrate:158 },
    { id:3, name:"Asolo - Cima Grappa", sport_type:"GravelRide", distance:54200, moving_time:8100, total_elevation_gain:1240, average_watts:201, suffer_score:89, start_date:new Date(now-6*day).toISOString(), average_heartrate:155, max_heartrate:178 },
    { id:4, name:"Recovery spin", sport_type:"Ride", distance:28000, moving_time:3600, total_elevation_gain:120, average_watts:128, suffer_score:18, start_date:new Date(now-8*day).toISOString(), average_heartrate:118, max_heartrate:138 },
    { id:5, name:"Intervalli in piano", sport_type:"Ride", distance:38500, moving_time:4800, total_elevation_gain:180, average_watts:215, suffer_score:72, start_date:new Date(now-10*day).toISOString(), average_heartrate:148, max_heartrate:176 },
    { id:6, name:"Fondo domenicale gravel", sport_type:"GravelRide", distance:92300, moving_time:14400, total_elevation_gain:1580, average_watts:188, suffer_score:112, start_date:new Date(now-14*day).toISOString(), average_heartrate:145, max_heartrate:173 },
    { id:7, name:"Mattutina veloce", sport_type:"Ride", distance:33200, moving_time:4200, total_elevation_gain:220, average_watts:174, suffer_score:42, start_date:new Date(now-17*day).toISOString(), average_heartrate:138, max_heartrate:162 },
    { id:8, name:"Gravel avventura", sport_type:"GravelRide", distance:76800, moving_time:12600, total_elevation_gain:1100, average_watts:191, suffer_score:95, start_date:new Date(now-21*day).toISOString(), average_heartrate:149, max_heartrate:175 },
    { id:9, name:"Salita Valstagna", sport_type:"Ride", distance:48000, moving_time:7200, total_elevation_gain:980, average_watts:207, suffer_score:103, start_date:new Date(now-24*day).toISOString(), average_heartrate:158, max_heartrate:181 },
    { id:10, name:"Piano e recupero", sport_type:"Ride", distance:35000, moving_time:4500, total_elevation_gain:140, average_watts:155, suffer_score:28, start_date:new Date(now-27*day).toISOString(), average_heartrate:128, max_heartrate:150 },
    { id:11, name:"Lungo fondo weekend", sport_type:"GravelRide", distance:88000, moving_time:13800, total_elevation_gain:1420, average_watts:183, suffer_score:108, start_date:new Date(now-31*day).toISOString(), average_heartrate:143, max_heartrate:170 },
    { id:12, name:"Soglia x3", sport_type:"Ride", distance:44000, moving_time:5700, total_elevation_gain:260, average_watts:219, suffer_score:85, start_date:new Date(now-35*day).toISOString(), average_heartrate:153, max_heartrate:179 },
  ];
  return base.map(a => ({ ...a, type: "Ride" }));
}

// ─── STRAVA ───────────────────────────────────────────────────────────────────
function getStravaAuthUrl() {
  return `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(STRAVA_REDIRECT_URI)}&scope=${STRAVA_SCOPE}&approval_prompt=force`;
}
async function exchangeStravaCode(code) {
  const r = await fetch(STRAVA_BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!r.ok) throw new Error("Errore connessione backend");
  return r.json();
}
async function fetchStravaActivities(token) {
  if (token === "MOCK") return getMockActivities();
  const r = await fetch(`https://www.strava.com/api/v3/athlete/activities?per_page=40&access_token=${token}`);
  return r.json();
}

// ─── AI CALLS ─────────────────────────────────────────────────────────────────
async function callClaude(messages, max_tokens = 5000) {
  // Chiamata tramite backend Vercel — evita CORS e protegge la API key
  const r = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, max_tokens }),
  });
  if (!r.ok) throw new Error("Errore connessione al coach AI");
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d.content.map(c => c.text || "").join("");
}

async function analyzeWithClaude(activities, goal, goalType, weight, goalDate) {
  const acts = activities.slice(0, 10).map(a => ({
    date: fmtDate(a.start_date), name: a.name, km: m2km(a.distance),
    duration: s2hhmm(a.moving_time), elev: Math.round(a.total_elevation_gain),
    watts: a.average_watts || null, hr: a.average_heartrate || null,
    type: a.sport_type,
  }));
  const totalKm = (activities.reduce((s,a) => s+a.distance, 0)/1000).toFixed(0);
  const wattsArr = activities.filter(a => a.average_watts);
  const avgW = wattsArr.length ? Math.round(wattsArr.reduce((s,a)=>s+a.average_watts,0)/wattsArr.length) : 170;
  const ftp = calcFTP(activities, weight);
  const avgElev = Math.round(activities.reduce((s,a)=>s+a.total_elevation_gain,0)/activities.length);
  const daysLeft = goalDate ? daysUntil(goalDate) : null;

  // Zone di potenza calcolate lato client — non chiediamo all'AI di calcolarle
  const zones = [
    {zone:"Z1 Recupero", min:0, max:Math.round(ftp*0.55), color:"#6b7280"},
    {zone:"Z2 Endurance", min:Math.round(ftp*0.56), max:Math.round(ftp*0.75), color:"#3b82f6"},
    {zone:"Z3 Tempo", min:Math.round(ftp*0.76), max:Math.round(ftp*0.9), color:"#10b981"},
    {zone:"Z4 Soglia", min:Math.round(ftp*0.91), max:Math.round(ftp*1.05), color:"#f59e0b"},
    {zone:"Z5 VO2max", min:Math.round(ftp*1.06), max:Math.round(ftp*1.2), color:"#ef4444"},
    {zone:"Z6 Anaerobica", min:Math.round(ftp*1.21), max:999, color:"#a855f7"},
  ];

  const prompt = `Sei un coach professionista di ciclismo. Rispondi SOLO con un oggetto JSON valido, senza markdown, senza testo prima o dopo.

ATLETA: ${weight}kg, FTP ${ftp}W (${w2wkg(ftp,weight)} W/kg), volume ${totalKm}km/mese, dislivello medio ${avgElev}m/uscita${daysLeft !== null ? `, giorni all'obiettivo: ${daysLeft}` : ""}.
ULTIME USCITE: ${JSON.stringify(acts)}
OBIETTIVO (${goalType}): ${goal}

Rispondi con questo JSON (compila tutti i campi con dati reali, non placeholder):
{"fitnessLevel":"Intermedio","fitnessScore":65,"weeklyTSSTarget":320,"strengths":["forza 1","forza 2","forza 3"],"weaknesses":["limite 1","limite 2","limite 3"],"readinessForGoal":60,"readinessText":"testo breve","estimatedWeeksToGoal":8,"weeklyPlan":[{"day":"Lunedì","type":"Riposo","title":"Riposo attivo","duration":"—","distance":"—","elevation":"—","intensity":"Bassa","tss":0,"zones":"—","description":"Riposo o stretching leggero","purpose":"Recupero muscolare"},{"day":"Martedì","type":"Endurance","title":"Fondo Z2","duration":"1h 30m","distance":"40-45km","elevation":"200m","intensity":"Bassa","tss":65,"zones":"Z2 prevalente","description":"Pedalata continua a ${Math.round(ftp*0.65)}-${Math.round(ftp*0.75)}W, cadenza 85-95rpm","purpose":"Costruisce base aerobica"},{"day":"Mercoledì","type":"Recovery","title":"Recovery spin","duration":"45m","distance":"20-25km","elevation":"50m","intensity":"Bassa","tss":25,"zones":"Z1","description":"Pedalata leggerissima sotto ${Math.round(ftp*0.55)}W","purpose":"Recupero attivo"},{"day":"Giovedì","type":"Soglia","title":"Intervalli soglia","duration":"1h 15m","distance":"35-40km","elevation":"150m","intensity":"Alta","tss":85,"zones":"Z4","description":"3x10min a ${Math.round(ftp*0.95)}-${Math.round(ftp*1.05)}W con 5min recupero","purpose":"Migliora FTP e resistenza"},{"day":"Venerdì","type":"Riposo","title":"Riposo completo","duration":"—","distance":"—","elevation":"—","intensity":"Bassa","tss":0,"zones":"—","description":"Riposo completo o yoga","purpose":"Recupero pre-weekend"},{"day":"Sabato","type":"Lungo","title":"Uscita lunga","duration":"2h 30m","distance":"65-75km","elevation":"600m","intensity":"Media","tss":110,"zones":"Z2-Z3","description":"Lungo fondo con variazioni di ritmo, ultimi 20min a ${Math.round(ftp*0.8)}W","purpose":"Costruisce resistenza specifica per l'obiettivo"},{"day":"Domenica","type":"Endurance","title":"Recupero attivo lungo","duration":"1h 30m","distance":"35-40km","elevation":"200m","intensity":"Bassa","tss":55,"zones":"Z1-Z2","description":"Pedalata facile per smaltire la fatica del sabato","purpose":"Recupero attivo e adattamento"}],"periodization":[{"week":1,"focus":"Base aerobica","tssTarget":280,"longRide":"65km"},{"week":2,"focus":"Volume progressivo","tssTarget":320,"longRide":"75km"},{"week":3,"focus":"Intensità soglia","tssTarget":360,"longRide":"80km"},{"week":4,"focus":"Recupero","tssTarget":200,"longRide":"55km"}],"keyMetrics":[{"metric":"FTP","current":"${ftp}W","target":"target reale in W","tip":"consiglio specifico"},{"metric":"W/kg","current":"${w2wkg(ftp,weight)}","target":"target reale","tip":"consiglio specifico"},{"metric":"Volume settimanale","current":"${Math.round(totalKm/4)}km","target":"target reale","tip":"consiglio specifico"}],"nutritionPlan":{"preRide":"consiglio reale","duringRide":"consiglio reale","postRide":"consiglio reale","generalTip":"consiglio reale"},"coachMessage":"messaggio motivazionale reale di 2-3 frasi"}`;

  const text = await callClaude([{ role: "user", content: prompt }], 5000);
  const clean = text.replace(/```json|```/g, "").trim();
  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Risposta AI non valida");
  const parsed = JSON.parse(jsonMatch[0]);
  // Aggiungi le zone calcolate lato client (non dall'AI)
  parsed.powerZones = zones;
  parsed.ftpEstimate = ftp;
  parsed.wkg = w2wkg(ftp, weight);
  return parsed;
}

async function chatWithCoach(messages, activities, plan, weight) {
  const context = `Sei un coach professionista di ciclismo. Stai seguendo questo atleta:
- Peso: ${weight}kg, FTP: ${plan?.ftpEstimate || "N/D"}W (${plan?.wkg || "N/D"} W/kg)
- Livello: ${plan?.fitnessLevel || "N/D"}, Score: ${plan?.fitnessScore || "N/D"}/100
- Obiettivo attuale: readiness ${plan?.readinessForGoal || "N/D"}%
Rispondi in italiano, in modo diretto e professionale come un coach esperto. Max 150 parole.`;

  const msgs = [{ role: "user", content: context + "\n\n" + messages[0].content }, ...messages.slice(1)];
  return callClaude(msgs, 400);
}

// ─── ICONS ────────────────────────────────────────────────────────────────────
const IC = ({ n, s = 18 }) => {
  const p = { stroke: "currentColor", fill: "none", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" };
  const m = {
    bike: <svg width={s} height={s} viewBox="0 0 24 24" {...p}><circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M9 17h5l2-5H7"/><path d="M12 17V9l-3-4h6"/></svg>,
    hill: <svg width={s} height={s} viewBox="0 0 24 24" {...p}><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>,
    zap: <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
    heart: <svg width={s} height={s} viewBox="0 0 24 24" {...p}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
    target: <svg width={s} height={s} viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
    clock: <svg width={s} height={s} viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    trend: <svg width={s} height={s} viewBox="0 0 24 24" {...p}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
    strava: <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>,
    award: <svg width={s} height={s} viewBox="0 0 24 24" {...p}><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>,
    spin: <svg width={s} height={s} viewBox="0 0 24 24" {...p} style={{animation:"spin 1s linear infinite"}}><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>,
    upload: <svg width={s} height={s} viewBox="0 0 24 24" {...p}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
    check: <svg width={s} height={s} viewBox="0 0 24 24" {...p} strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>,
    chat: <svg width={s} height={s} viewBox="0 0 24 24" {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    cal: <svg width={s} height={s} viewBox="0 0 24 24" {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
    note: <svg width={s} height={s} viewBox="0 0 24 24" {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    send: <svg width={s} height={s} viewBox="0 0 24 24" {...p}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
    dash: <svg width={s} height={s} viewBox="0 0 24 24" {...p}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
    chevR: <svg width={s} height={s} viewBox="0 0 24 24" {...p}><polyline points="9 18 15 12 9 6"/></svg>,
    x: <svg width={s} height={s} viewBox="0 0 24 24" {...p} strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    info: <svg width={s} height={s} viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
    sun: <svg width={s} height={s} viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  };
  return m[n] || null;
};

// ─── COLORS ───────────────────────────────────────────────────────────────────
const TC = { Riposo:"#374151", Recovery:"#1e3a8a", Endurance:"#064e3b", Soglia:"#78350f", "VO2max":"#7c1d2c", Forza:"#3b0764", Lungo:"#0c2e48" };
const TA = { Riposo:"#6b7280", Recovery:"#60a5fa", Endurance:"#34d399", Soglia:"#fbbf24", "VO2max":"#f87171", Forza:"#c084fc", Lungo:"#38bdf8" };
const IC2 = { Bassa:"#22c55e", Media:"#f59e0b", Alta:"#f97316", Massima:"#ef4444" };
const tc = (t) => TC[t] || "#1a2035";
const ta = (t) => TA[t] || "#6b7280";
const ic = (i) => IC2[i] || "#6b7280";

// ─── SHARED CSS ───────────────────────────────────────────────────────────────
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  @keyframes spin { to { transform:rotate(360deg); } }
  @keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
  @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
  @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:.35;} }
  @keyframes slideIn { from { opacity:0; transform:translateX(16px); } to { opacity:1; transform:translateX(0); } }
  @keyframes glowPulse { 0%,100%{box-shadow:0 0 0 0 rgba(252,76,2,.4);} 50%{box-shadow:0 0 0 8px rgba(252,76,2,0);} }
  @keyframes shimmer { 0%{background-position:-468px 0} 100%{background-position:468px 0} }
  .skeleton { background:linear-gradient(90deg,#111827 25%,#1e2d40 50%,#111827 75%); background-size:468px 100%; animation:shimmer 1.5s ease-in-out infinite; border-radius:8px; }
  body { background:#080c12; }
  .app { font-family:'Inter',sans-serif; background:#080c12; color:#e2e8f0; min-height:100vh; }
  .mono { font-family:'JetBrains Mono',monospace; }
  .cond { font-family:'Barlow Condensed',sans-serif; font-weight:700; letter-spacing:.02em; }
  .fade-up { animation:fadeUp .45s ease both; }
  .slide-in { animation:slideIn .3s ease both; }
  .card { background:#0d1520; border:1px solid rgba(255,255,255,.12); border-radius:14px; box-shadow:0 1px 3px rgba(0,0,0,.4); }
  .card-hover { transition:border-color .2s,transform .15s; cursor:pointer; }
  .card-hover:hover { border-color:rgba(252,76,2,.3); transform:translateY(-1px); }
  .pill { display:inline-flex; align-items:center; gap:4px; padding:3px 9px; border-radius:20px; font-size:10px; font-weight:600; letter-spacing:.07em; text-transform:uppercase; }
  input,textarea,select { background:#111827; border:1px solid rgba(255,255,255,.09); border-radius:9px; color:#e2e8f0; font-family:'Inter',sans-serif; font-size:13px; padding:10px 14px; outline:none; transition:border-color .2s,box-shadow .2s; width:100%; }
  input:focus,textarea:focus,select:focus { border-color:#FC4C02; box-shadow:0 0 0 3px rgba(252,76,2,.12); }
  textarea { resize:vertical; min-height:80px; line-height:1.6; }
  button { font-family:'Inter',sans-serif; cursor:pointer; }
  ::-webkit-scrollbar { width:3px; height:3px; }
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:#1e2d40; border-radius:2px; }
  .nav-btn { background:transparent; border:none; display:flex; flex-direction:column; align-items:center; gap:4px; color:#4b5563; padding:8px 12px; border-radius:10px; transition:color .2s,background .2s; font-size:10px; font-weight:500; letter-spacing:.04em; text-transform:uppercase; }
  .nav-btn.active { color:#FC4C02; background:rgba(252,76,2,.1); }
  .nav-btn:hover:not(.active) { color:#9ca3af; }
  .bar { height:3px; background:#1a2535; border-radius:2px; overflow:hidden; }
  .bar-fill { height:100%; border-radius:2px; transition:width 1.2s cubic-bezier(.4,0,.2,1); }
  .strava-btn { background:#FC4C02; color:#fff; border:none; border-radius:10px; padding:15px 28px; font-weight:600; font-size:15px; display:inline-flex; align-items:center; gap:10px; transition:all .2s; }
  .strava-btn:hover { background:#e04300; transform:translateY(-2px); box-shadow:0 12px 32px rgba(252,76,2,.4); }
  .ghost-btn { background:transparent; border:1px solid rgba(255,255,255,.1); border-radius:9px; padding:10px 18px; color:#6b7280; font-size:13px; transition:all .2s; }
  .ghost-btn:hover { border-color:rgba(255,255,255,.2); color:#9ca3af; }
  .primary-btn { background:#FC4C02; color:#fff; border:none; border-radius:10px; padding:13px 22px; font-size:14px; font-weight:600; display:inline-flex; align-items:center; gap:8px; transition:all .2s; }
  .primary-btn:hover:not(:disabled) { background:#e04300; transform:translateY(-1px); box-shadow:0 8px 24px rgba(252,76,2,.35); }
  .primary-btn:disabled { background:#1f2937; color:#4b5563; cursor:not-allowed; }
  .recharts-cartesian-grid-horizontal line, .recharts-cartesian-grid-vertical line { stroke:rgba(255,255,255,.05); }
  .recharts-text { fill:#4b5563 !important; font-family:'JetBrains Mono',monospace; font-size:10px; }
  .recharts-tooltip-wrapper { filter:drop-shadow(0 4px 16px rgba(0,0,0,.5)); }
`;

// ─── CUSTOM TOOLTIP ───────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:"#0d1520", border:"1px solid rgba(255,255,255,.1)", borderRadius:8, padding:"8px 12px" }}>
      <div style={{ fontSize:11, color:"#6b7280", marginBottom:4 }}>{label}</div>
      {payload.map((p,i) => (
        <div key={i} style={{ fontSize:12, color:p.color, fontFamily:"'JetBrains Mono',monospace" }}>
          {p.name}: <strong>{p.value}</strong>
        </div>
      ))}
    </div>
  );
};

// ─── STAT CARD ────────────────────────────────────────────────────────────────
const StatCard = ({ icon, label, value, unit, color, sub }) => (
  <div className="card" style={{ padding:"16px 14px", position:"relative", overflow:"hidden" }}>
    <div style={{ position:"absolute", top:-20, right:-20, width:80, height:80, borderRadius:"50%", background:`${color}09`, pointerEvents:"none" }} />
    <div style={{ color, marginBottom:8 }}><IC n={icon} s={15} /></div>
    <div className="cond" style={{ fontSize:26, color:"#fff", lineHeight:1 }}>
      {value}<span style={{ fontSize:13, color, marginLeft:3 }}>{unit}</span>
    </div>
    <div style={{ fontSize:10, color:"#4b5563", marginTop:4, textTransform:"uppercase", letterSpacing:".07em" }}>{label}</div>
    {sub && <div style={{ fontSize:11, color:"#374151", marginTop:2 }}>{sub}</div>}
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [screen, setScreen] = useState("landing"); // landing | loading | onboarding | main
  const [tab, setTab] = useState("dashboard");      // dashboard | plan | calendar | notes | coach
  const [athlete, setAthlete] = useState(() => { try { return JSON.parse(localStorage.getItem("gc_athlete")||"null"); } catch { return null; } });
  const [token, setToken] = useState(() => localStorage.getItem("gc_token")||null);
  const [activities, setActivities] = useState(() => { try { return JSON.parse(localStorage.getItem("gc_activities")||"[]"); } catch { return []; } });
  // Onboarding
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [ftpMode, setFtpMode] = useState("auto"); // auto | manual | ramp
  const [ftpManual, setFtpManual] = useState(() => localStorage.getItem("gc_ftpManual")||"");
  const [rampPhase, setRampPhase] = useState("idle"); // idle | warmup | test | result
  const [rampTimer, setRampTimer] = useState(0);
  const [rampInterval, setRampInterval] = useState(null);
  const [bikeType, setBikeType] = useState(() => localStorage.getItem("gc_bikeType")||"gravel");
  const [daysPerWeek, setDaysPerWeek] = useState(() => parseInt(localStorage.getItem("gc_daysPerWeek")||"4"));
  const [userName, setUserName] = useState("");
  const [plan, setPlan] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [weight, setWeight] = useState(() => parseInt(localStorage.getItem("gc_weight")||"70"));
  const [goalType, setGoalType] = useState(() => localStorage.getItem("gc_goalType")||"route");
  const [goalText, setGoalText] = useState(() => localStorage.getItem("gc_goalText")||"");
  const [goalDate, setGoalDate] = useState(() => localStorage.getItem("gc_goalDate")||"");
  const [gpxFile, setGpxFile] = useState(null);
  const [notes, setNotes] = useState(() => { try { return JSON.parse(localStorage.getItem("gc_notes")||"{}"); } catch { return {}; } });
  const [chatMessages, setChatMessages] = useState([
    { role:"assistant", content:"Ciao! Sono il tuo coach. Analizza le tue attività e imposta un obiettivo per iniziare. Poi posso rispondere a qualsiasi domanda sul tuo allenamento." }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [activeDay, setActiveDay] = useState(0);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [noteText, setNoteText] = useState("");
  // Calendario
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [showAddRide, setShowAddRide] = useState(false);
  const [addRideDay, setAddRideDay] = useState(null);
  const [addRideForm, setAddRideForm] = useState({ name:"", km:"", elev:"", duration:"", notes:"" });
  const [manualRides, setManualRides] = useState(() => { try { return JSON.parse(localStorage.getItem("gc_manualRides")||"[]"); } catch { return []; } });
  const [selectedCalDay, setSelectedCalDay] = useState(null);
  // Tranche 5 — Engagement
  const [showNutrition, setShowNutrition] = useState(false);
  const [nutritionRideKm, setNutritionRideKm] = useState(50);
  const fileRef = useRef();
  const chatEndRef = useRef();

  // Auto-login all'avvio se token e attività già salvati
  useEffect(() => {
    const savedToken = localStorage.getItem("gc_token");
    const savedAthlete = localStorage.getItem("gc_athlete");
    const savedActivities = localStorage.getItem("gc_activities");
    const alreadyOnboarded = localStorage.getItem("gc_onboarded") === "true";
    if (savedToken && savedAthlete && savedActivities && alreadyOnboarded) {
      // Già loggato — vai direttamente in dashboard
      setScreen("main");
      return;
    }
  }, []);

  // Handle OAuth redirect
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const code = p.get("code");
    if (code) {
      setScreen("loading");
      exchangeStravaCode(code)
        .then(({ access_token, athlete: a }) => {
          setToken(access_token);
          setAthlete(a);
          // Salva per auto-login futuro
          localStorage.setItem("gc_token", access_token);
          localStorage.setItem("gc_athlete", JSON.stringify(a));
          return fetchStravaActivities(access_token);
        })
        .then((acts) => {
          const rides = acts.filter(a => a.type === "Ride" || a.sport_type?.includes("Ride"));
          setActivities(rides);
          // Salva in localStorage per auto-login futuro
          localStorage.setItem("gc_activities", JSON.stringify(rides));
          // Salta onboarding se già completato in precedenza
          const alreadyOnboarded = localStorage.getItem("gc_onboarded") === "true";
          if (alreadyOnboarded) {
            setScreen("main");
          } else {
            setOnboardingStep(0);
            setScreen("onboarding");
          }
          window.history.replaceState({}, "", window.location.pathname);
        })
        .catch((err) => {
          console.error(err);
          alert("Errore connessione Strava: " + err.message);
          setScreen("landing");
        });
    }
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [chatMessages]);

  // Salva profilo su localStorage ogni volta che cambia
  useEffect(() => { localStorage.setItem("gc_weight", weight); }, [weight]);
  useEffect(() => { localStorage.setItem("gc_bikeType", bikeType); }, [bikeType]);
  useEffect(() => { localStorage.setItem("gc_daysPerWeek", daysPerWeek); }, [daysPerWeek]);
  useEffect(() => { if (ftpManual) localStorage.setItem("gc_ftpManual", ftpManual); }, [ftpManual]);
  useEffect(() => { localStorage.setItem("gc_goalType", goalType); }, [goalType]);
  useEffect(() => { localStorage.setItem("gc_goalText", goalText); }, [goalText]);
  useEffect(() => { localStorage.setItem("gc_goalDate", goalDate); }, [goalDate]);
  useEffect(() => { localStorage.setItem("gc_notes", JSON.stringify(notes)); }, [notes]);
  useEffect(() => { if (manualRides.length) localStorage.setItem("gc_manualRides", JSON.stringify(manualRides)); }, [manualRides]);

  const connectMock = () => {
    setScreen("loading");
    setTimeout(() => {
      const a = { firstname:"Carlo", lastname:"R." };
      const acts = getMockActivities();
      setAthlete(a);
      setToken("MOCK");
      setActivities(acts);
      // Salva per auto-login futuro
      localStorage.setItem("gc_token", "MOCK");
      localStorage.setItem("gc_athlete", JSON.stringify(a));
      localStorage.setItem("gc_activities", JSON.stringify(acts));
      const alreadyOnboarded = localStorage.getItem("gc_onboarded") === "true";
      if (alreadyOnboarded) {
        setScreen("main");
      } else {
        setOnboardingStep(0);
        setScreen("onboarding");
      }
    }, 2000);
  };

  const refreshActivities = async () => {
    if (!token || refreshing) return;
    setRefreshing(true);
    try {
      const acts = await fetchStravaActivities(token);
      const rides = token === "MOCK"
        ? acts
        : acts.filter(a => a.type === "Ride" || a.sport_type?.includes("Ride"));
      setActivities(rides);
      localStorage.setItem("gc_activities", JSON.stringify(rides));
      localStorage.setItem("gc_lastRefresh", new Date().toISOString());
    } catch(e) {
      console.error("Errore aggiornamento attività:", e);
    }
    setRefreshing(false);
  };

  const runAnalysis = async () => {
    if (!goalText.trim()) return;
    setAnalyzing(true);
    setPlan(null); // reset piano precedente
    try {
      const g = gpxFile ? `${goalText} [GPX: ${gpxFile.name}]` : goalText;
      const result = await analyzeWithClaude(activities, g, goalType, weight, goalDate || null);
      // Validazione risposta: deve avere almeno i campi essenziali
      if (!result.weeklyPlan || !Array.isArray(result.weeklyPlan) || result.weeklyPlan.length === 0) {
        throw new Error("Piano incompleto — riprova");
      }
      setPlan(result);
      setActiveDay(0);
      setTab("plan");
    } catch(e) {
      console.error("Errore analisi AI:", e);
      setPlan({ _error: true, _errorMsg: e.message || "Errore sconosciuto" });
      setTab("plan");
    }
    setAnalyzing(false);
  };

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = { role:"user", content: chatInput };
    const newMsgs = [...chatMessages, userMsg];
    setChatMessages(newMsgs);
    setChatInput("");
    setChatLoading(true);
    try {
      const apiMsgs = newMsgs.filter(m => m.role !== "system").map(m => ({ role:m.role, content:m.content }));
      const reply = await chatWithCoach(apiMsgs, activities, plan, weight);
      setChatMessages(prev => [...prev, { role:"assistant", content:reply }]);
    } catch(e) { setChatMessages(prev => [...prev, { role:"assistant", content:"Errore di connessione. Riprova." }]); }
    setChatLoading(false);
  };

  // ── RECORD PERSONALI ──────────────────────────────────────────────────────
  const personalRecords = (() => {
    if (!activities.length) return null;
    const maxDist = activities.reduce((m,a) => a.distance > m.distance ? a : m, activities[0]);
    const maxElev = activities.reduce((m,a) => a.total_elevation_gain > m.total_elevation_gain ? a : m, activities[0]);
    const maxWatts = activities.filter(a => a.average_watts).reduce((m,a) => a.average_watts > (m?.average_watts||0) ? a : m, null);
    const maxHR = activities.filter(a => a.max_heartrate).reduce((m,a) => a.max_heartrate > (m?.max_heartrate||0) ? a : m, null);
    return {
      distance: { value: m2km(maxDist.distance), unit: "km", name: maxDist.name, date: fmtDate(maxDist.start_date) },
      elevation: { value: Math.round(maxElev.total_elevation_gain), unit: "m↑", name: maxElev.name, date: fmtDate(maxElev.start_date) },
      watts: maxWatts ? { value: maxWatts.average_watts, unit: "W", name: maxWatts.name, date: fmtDate(maxWatts.start_date) } : null,
      hr: maxHR ? { value: maxHR.max_heartrate, unit: "bpm", name: maxHR.name, date: fmtDate(maxHR.start_date) } : null,
    };
  })();

  // ── RAMP TEST ─────────────────────────────────────────────────────────────
  const startRamp = () => {
    setRampPhase("warmup");
    setRampTimer(600); // 10min warmup
    const iv = setInterval(() => {
      setRampTimer(prev => {
        if (prev <= 1) {
          clearInterval(iv);
          setRampPhase("test");
          setRampTimer(1200); // 20min test
          const testIv = setInterval(() => {
            setRampTimer(prev2 => {
              if (prev2 <= 1) {
                clearInterval(testIv);
                setRampPhase("result");
                return 0;
              }
              return prev2 - 1;
            });
          }, 1000);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    setRampInterval(iv);
  };

  const stopRamp = () => {
    if (rampInterval) clearInterval(rampInterval);
    setRampPhase("idle");
    setRampTimer(0);
  };

  const completeOnboarding = () => {
    localStorage.setItem("gc_onboarded", "true");
    setScreen("main");
  };

  // ── CALENDAR HELPERS ──────────────────────────────────────────────────────
  const calPrevMonth = () => {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y-1); }
    else setCalMonth(m => m-1);
  };
  const calNextMonth = () => {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y+1); }
    else setCalMonth(m => m+1);
  };

  const handleAddRide = () => {
    if (!addRideForm.name || !addRideForm.km) return;
    const dateStr = new Date(calYear, calMonth, addRideDay).toISOString();
    const newRide = {
      id: `manual_${Date.now()}`,
      name: addRideForm.name,
      sport_type: "Ride",
      type: "Ride",
      distance: parseFloat(addRideForm.km) * 1000,
      total_elevation_gain: parseFloat(addRideForm.elev) || 0,
      moving_time: (() => {
        const parts = addRideForm.duration.split(":");
        return parts.length === 2 ? parseInt(parts[0])*3600 + parseInt(parts[1])*60 : 0;
      })(),
      start_date: dateStr,
      average_watts: null,
      average_heartrate: null,
      _manual: true,
      _notes: addRideForm.notes,
    };
    setManualRides(prev => [...prev, newRide]);
    setAddRideForm({ name:"", km:"", elev:"", duration:"", notes:"" });
    setShowAddRide(false);
    setAddRideDay(null);
  };

  const generateGPX = (session) => {
    if (!session) return;
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="GravelCoachAI">
  <metadata>
    <name>${session.title}</name>
    <desc>${session.description}</desc>
  </metadata>
  <trk>
    <name>${session.title}</name>
    <desc>Tipo: ${session.type} | Durata: ${session.duration} | Distanza: ${session.distance} | Dislivello: ${session.elevation} | Zone: ${session.zones}</desc>
  </trk>
</gpx>`;
    const blob = new Blob([gpx], { type:"application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${session.title.replace(/\s+/g,"-").toLowerCase()}.gpx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatTimer = (secs) => {
    const m = Math.floor(secs / 60), s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // ── DERIVED STATS ──────────────────────────────────────────────────────────
  const totalKm = activities.reduce((s,a) => s+a.distance, 0)/1000;
  const totalElev = activities.reduce((s,a) => s+a.total_elevation_gain, 0);
  const wattsArr = activities.filter(a => a.average_watts);
  const avgW = wattsArr.length ? Math.round(wattsArr.reduce((s,a)=>s+a.average_watts,0)/wattsArr.length) : 0;
  // FTP: usa manuale se inserito, altrimenti calcola dalle uscite
  const ftp = ftpManual && parseInt(ftpManual) > 0 ? parseInt(ftpManual) : calcFTP(activities, weight);
  const weeklyTSS = activities.slice(0,5).reduce((s,a) => s + calcTSS(a.moving_time, a.average_watts, ftp), 0);

  // Chart data
  const chartData = [...activities].reverse().slice(-10).map(a => ({
    date: fmtDateShort(a.start_date),
    km: parseFloat(m2km(a.distance)),
    elev: Math.round(a.total_elevation_gain),
    watts: a.average_watts || 0,
    tss: calcTSS(a.moving_time, a.average_watts, ftp),
    hr: a.average_heartrate || 0,
  }));

  // Periodization chart
  const periodData = plan?.periodization?.map(w => ({ week:`S${w.week}`, tss:w.tssTarget, focus:w.focus })) || [];

  // ── TRANCHE 5 COMPUTED ────────────────────────────────────────────────────
  // Settimana corrente vs precedente
  const now7 = Date.now() - 7*86400000;
  const now14 = Date.now() - 14*86400000;
  const thisWeekActs = activities.filter(a => new Date(a.start_date).getTime() > now7);
  const lastWeekActs = activities.filter(a => { const t = new Date(a.start_date).getTime(); return t > now14 && t <= now7; });
  const thisWeekKm = parseFloat((thisWeekActs.reduce((s,a)=>s+a.distance,0)/1000).toFixed(1));
  const lastWeekKm = parseFloat((lastWeekActs.reduce((s,a)=>s+a.distance,0)/1000).toFixed(1));
  const thisWeekElev = Math.round(thisWeekActs.reduce((s,a)=>s+a.total_elevation_gain,0));
  const lastWeekElev = Math.round(lastWeekActs.reduce((s,a)=>s+a.total_elevation_gain,0));
  const thisWeekTSS = thisWeekActs.reduce((s,a)=>s+calcTSS(a.moving_time,a.average_watts,ftp),0);
  const lastWeekTSS = lastWeekActs.reduce((s,a)=>s+calcTSS(a.moving_time,a.average_watts,ftp),0);

  // Streak settimane consecutive con almeno 1 uscita
  const streakWeeks = (() => {
    let streak = 0;
    for (let w = 0; w < 52; w++) {
      const start = Date.now() - (w+1)*7*86400000;
      const end = Date.now() - w*7*86400000;
      const hasRide = activities.some(a => { const t = new Date(a.start_date).getTime(); return t >= start && t < end; });
      if (hasRide) streak++;
      else break;
    }
    return streak;
  })();

  // Challenge settimanali automatiche basate su statistiche
  const weeklyChallenge = (() => {
    const challenges = [];
    // Challenge km
    if (lastWeekKm > 0) {
      const target = Math.round(lastWeekKm * 1.1);
      const pct = Math.min(100, Math.round((thisWeekKm / target) * 100));
      challenges.push({ icon:"🚴", label:"Volume settimanale", current:`${thisWeekKm}km`, target:`${target}km`, pct, color:"#FC4C02" });
    } else {
      challenges.push({ icon:"🚴", label:"Prima uscita questa settimana", current:`${thisWeekKm}km`, target:"1 uscita", pct: thisWeekActs.length > 0 ? 100 : 0, color:"#FC4C02" });
    }
    // Challenge dislivello
    if (lastWeekElev > 0) {
      const target = Math.round(lastWeekElev * 1.1);
      const pct = Math.min(100, Math.round((thisWeekElev / target) * 100));
      challenges.push({ icon:"⛰️", label:"Dislivello settimanale", current:`${thisWeekElev}m`, target:`${target}m`, pct, color:"#0ea5e9" });
    }
    // Challenge TSS
    const tssTarget = plan?.weeklyTSSTarget || Math.round(lastWeekTSS * 1.05) || 200;
    const tssPct = Math.min(100, Math.round((thisWeekTSS / tssTarget) * 100));
    challenges.push({ icon:"⚡", label:"Carico settimanale (TSS)", current:`${thisWeekTSS}`, target:`${tssTarget}`, pct:tssPct, color:"#a855f7" });
    return challenges;
  })();

  // Sessione di oggi dal piano AI
  const todaySession = (() => {
    if (!plan?.weeklyPlan || plan._error) return null;
    const days = ["Domenica","Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato"];
    const todayName = days[new Date().getDay()];
    return plan.weeklyPlan.find(s => s.day === todayName) || null;
  })();

  // Calcolo calorie uscita per nutrition tracker
  const calcCalories = (km, elevGain=0) => {
    const base = km * 30; // ~30 kcal/km base
    const elevBonus = elevGain * 0.1;
    return Math.round(base + elevBonus);
  };
  const nutritionCalories = calcCalories(nutritionRideKm);

  // ── ONBOARDING ────────────────────────────────────────────────────────────
  if (screen === "onboarding") {
    const STEPS = ["Benvenuto", "Tipo di bici", "Il tuo peso", "FTP", "Giorni/settimana", "Pronto!"];
    const totalSteps = STEPS.length;
    const progress = ((onboardingStep + 1) / totalSteps) * 100;

    const stepContent = () => {
      // STEP 0 — Welcome
      if (onboardingStep === 0) return (
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:56, marginBottom:16 }}>👋</div>
          <h2 className="cond" style={{ fontSize:34, color:"#fff", marginBottom:12 }}>
            Ciao, {athlete?.firstname || "Atleta"}!
          </h2>
          <p style={{ color:"#64748b", fontSize:14, lineHeight:1.7, marginBottom:32 }}>
            Benvenuto in Gravel Coach AI. Ti faccio 4 domande veloci per configurare il tuo profilo e generare un piano di allenamento su misura per te.
          </p>
          <div style={{ display:"grid", gap:10, marginBottom:24 }}>
            {[["🚴", "Piano settimanale personalizzato"], ["⚡", "Zone di potenza calibrate su di te"], ["🤖", "Coach AI sempre disponibile"], ["📊", "Analisi delle tue uscite Strava"]].map(([ic, txt]) => (
              <div key={txt} style={{ display:"flex", alignItems:"center", gap:12, background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", borderRadius:10, padding:"10px 14px" }}>
                <span style={{ fontSize:20 }}>{ic}</span>
                <span style={{ fontSize:13, color:"#e2e8f0" }}>{txt}</span>
              </div>
            ))}
          </div>
        </div>
      );

      // STEP 1 — Bike type
      if (onboardingStep === 1) return (
        <div>
          <div style={{ textAlign:"center", marginBottom:24 }}>
            <div style={{ fontSize:48, marginBottom:12 }}>🚵</div>
            <h2 className="cond" style={{ fontSize:28, color:"#fff", marginBottom:8 }}>Che tipo di bici usi?</h2>
            <p style={{ color:"#64748b", fontSize:13 }}>Questo personalizza il piano e le sessioni consigliate</p>
          </div>
          <div style={{ display:"grid", gap:10 }}>
            {[["gravel","🪨 Gravel","Terreni misti, avventura, fondi sterrati"],["road","🛣️ Road","Asfalto, velocità, granfondo"],["both","🔄 Entrambe","Uso entrambe le bici regolarmente"]].map(([val, label, sub]) => (
              <div key={val} onClick={() => setBikeType(val)} style={{ padding:"16px 20px", border:`2px solid ${bikeType===val?"#FC4C02":"rgba(255,255,255,.08)"}`, borderRadius:12, background:bikeType===val?"rgba(252,76,2,.1)":"rgba(255,255,255,.02)", cursor:"pointer", transition:"all .2s" }}>
                <div style={{ fontWeight:600, color: bikeType===val?"#FC4C02":"#e2e8f0", marginBottom:4 }}>{label}</div>
                <div style={{ fontSize:12, color:"#64748b" }}>{sub}</div>
              </div>
            ))}
          </div>
        </div>
      );

      // STEP 2 — Weight
      if (onboardingStep === 2) return (
        <div>
          <div style={{ textAlign:"center", marginBottom:28 }}>
            <div style={{ fontSize:48, marginBottom:12 }}>⚖️</div>
            <h2 className="cond" style={{ fontSize:28, color:"#fff", marginBottom:8 }}>Il tuo peso corporeo</h2>
            <p style={{ color:"#64748b", fontSize:13 }}>Serve per calcolare W/kg e calibrare le zone di potenza</p>
          </div>
          <div style={{ textAlign:"center" }}>
            <div style={{ display:"inline-flex", alignItems:"center", gap:16, background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.1)", borderRadius:16, padding:"20px 32px" }}>
              <button onClick={() => setWeight(w => Math.max(40, w-1))} style={{ width:40, height:40, borderRadius:"50%", background:"rgba(255,255,255,.08)", border:"none", color:"#fff", fontSize:20, cursor:"pointer" }}>−</button>
              <div style={{ textAlign:"center" }}>
                <div className="cond" style={{ fontSize:52, color:"#FC4C02", lineHeight:1 }}>{weight}</div>
                <div style={{ fontSize:12, color:"#64748b" }}>kg</div>
              </div>
              <button onClick={() => setWeight(w => Math.min(130, w+1))} style={{ width:40, height:40, borderRadius:"50%", background:"rgba(255,255,255,.08)", border:"none", color:"#fff", fontSize:20, cursor:"pointer" }}>+</button>
            </div>
            <p style={{ marginTop:16, fontSize:12, color:"#374151" }}>Puoi modificarlo in qualsiasi momento nelle impostazioni</p>
          </div>
        </div>
      );

      // STEP 3 — FTP
      if (onboardingStep === 3) return (
        <div>
          <div style={{ textAlign:"center", marginBottom:20 }}>
            <div style={{ fontSize:48, marginBottom:12 }}>⚡</div>
            <h2 className="cond" style={{ fontSize:28, color:"#fff", marginBottom:8 }}>Conosci il tuo FTP?</h2>
            <p style={{ color:"#64748b", fontSize:13 }}>Functional Threshold Power — la potenza massima sostenibile per ~60 minuti</p>
          </div>
          <div style={{ display:"flex", gap:8, marginBottom:20 }}>
            {[["auto","🤖 Calcola auto"],["manual","✏️ Inserisci"],["ramp","🧪 Ramp Test"]].map(([mode, label]) => (
              <button key={mode} onClick={() => { setFtpMode(mode); setRampPhase("idle"); }} style={{ flex:1, padding:"10px 8px", borderRadius:10, border:`2px solid ${ftpMode===mode?"#FC4C02":"rgba(255,255,255,.08)"}`, background:ftpMode===mode?"rgba(252,76,2,.1)":"transparent", color:ftpMode===mode?"#FC4C02":"#64748b", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'Inter',sans-serif" }}>
                {label}
              </button>
            ))}
          </div>

          {ftpMode === "auto" && (
            <div style={{ background:"rgba(14,165,233,.08)", border:"1px solid rgba(14,165,233,.2)", borderRadius:12, padding:"16px 20px", textAlign:"center" }}>
              <div className="cond" style={{ fontSize:36, color:"#0ea5e9", marginBottom:4 }}>{calcFTP(activities, weight)}W</div>
              <div style={{ fontSize:12, color:"#64748b" }}>FTP stimato dalle tue {activities.length} uscite Strava</div>
              <div style={{ fontSize:11, color:"#374151", marginTop:8 }}>Calcolato usando le 3 uscite più intense — puoi affinarlo con un Ramp Test in futuro</div>
            </div>
          )}

          {ftpMode === "manual" && (
            <div>
              <label style={{ fontSize:12, color:"#64748b", display:"block", marginBottom:8 }}>Inserisci il tuo FTP (Watt)</label>
              <input type="number" value={ftpManual} onChange={e => setFtpManual(e.target.value)} placeholder="es. 220" min="80" max="500" style={{ textAlign:"center", fontSize:24, fontWeight:700, color:"#FC4C02" }} />
              <p style={{ fontSize:11, color:"#374151", marginTop:8, textAlign:"center" }}>Puoi trovarlo sul tuo Garmin, Wahoo o dall'ultima gara/test</p>
            </div>
          )}

          {ftpMode === "ramp" && (
            <div>
              {rampPhase === "idle" && (
                <div style={{ background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.08)", borderRadius:12, padding:"16px 20px" }}>
                  <div style={{ fontWeight:600, color:"#fff", marginBottom:8 }}>Protocollo Ramp Test</div>
                  <div style={{ fontSize:12, color:"#64748b", lineHeight:1.7, marginBottom:16 }}>
                    <b style={{color:"#e2e8f0"}}>1.</b> Warm-up 10 min in Z1-Z2 (facile)<br/>
                    <b style={{color:"#e2e8f0"}}>2.</b> Test 20 min al massimo sforzo sostenibile<br/>
                    <b style={{color:"#e2e8f0"}}>3.</b> L'app calcola il tuo FTP automaticamente
                  </div>
                  <button onClick={startRamp} className="primary-btn" style={{ width:"100%", justifyContent:"center" }}>
                    ▶ Inizia Ramp Test
                  </button>
                </div>
              )}
              {(rampPhase === "warmup" || rampPhase === "test") && (
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#FC4C02", textTransform:"uppercase", letterSpacing:".1em", marginBottom:8 }}>
                    {rampPhase === "warmup" ? "FASE WARM-UP" : "FASE TEST — SPINGI AL MASSIMO"}
                  </div>
                  <div className="cond" style={{ fontSize:72, color: rampPhase==="test"?"#ef4444":"#0ea5e9", lineHeight:1, marginBottom:8 }}>
                    {formatTimer(rampTimer)}
                  </div>
                  <div style={{ fontSize:12, color:"#64748b", marginBottom:20 }}>
                    {rampPhase === "warmup" ? "Pedala leggero in Z1-Z2 per scaldarti" : "Mantieni il massimo sforzo sostenibile per 20 minuti"}
                  </div>
                  <div style={{ height:4, background:"#1a2535", borderRadius:2, marginBottom:16, overflow:"hidden" }}>
                    <div style={{ height:"100%", background:rampPhase==="test"?"#ef4444":"#0ea5e9", borderRadius:2, width: rampPhase==="warmup" ? `${((600-rampTimer)/600)*100}%` : `${((1200-rampTimer)/1200)*100}%`, transition:"width 1s linear" }} />
                  </div>
                  <button onClick={stopRamp} style={{ background:"transparent", border:"1px solid rgba(255,255,255,.1)", borderRadius:8, padding:"8px 20px", color:"#64748b", fontSize:12, cursor:"pointer", fontFamily:"'Inter',sans-serif" }}>
                    Annulla test
                  </button>
                </div>
              )}
              {rampPhase === "result" && (
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontSize:40, marginBottom:8 }}>🎉</div>
                  <div style={{ fontSize:13, color:"#64748b", marginBottom:8 }}>FTP stimato dal test</div>
                  <div className="cond" style={{ fontSize:56, color:"#FC4C02", marginBottom:4 }}>{calcFTP(activities, weight)}W</div>
                  <div style={{ fontSize:12, color:"#64748b", marginBottom:16 }}>{w2wkg(calcFTP(activities, weight), weight)} W/kg</div>
                  <p style={{ fontSize:11, color:"#374151" }}>Ottimo lavoro! Inserisci manualmente la potenza media degli ultimi 20 min per un risultato preciso</p>
                  <input type="number" value={ftpManual} onChange={e => setFtpManual(e.target.value)} placeholder="Potenza media 20min (W)" style={{ marginTop:12, textAlign:"center" }} />
                </div>
              )}
            </div>
          )}
        </div>
      );

      // STEP 4 — Days per week
      if (onboardingStep === 4) return (
        <div>
          <div style={{ textAlign:"center", marginBottom:28 }}>
            <div style={{ fontSize:48, marginBottom:12 }}>📅</div>
            <h2 className="cond" style={{ fontSize:28, color:"#fff", marginBottom:8 }}>Quante volte pedali a settimana?</h2>
            <p style={{ color:"#64748b", fontSize:13 }}>Il coach calibra il volume e il recupero in base alla tua disponibilità</p>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
            {[2,3,4,5,6,7].map(d => (
              <div key={d} onClick={() => setDaysPerWeek(d)} style={{ padding:"20px 0", textAlign:"center", border:`2px solid ${daysPerWeek===d?"#FC4C02":"rgba(255,255,255,.08)"}`, borderRadius:12, background:daysPerWeek===d?"rgba(252,76,2,.1)":"rgba(255,255,255,.02)", cursor:"pointer", transition:"all .2s" }}>
                <div className="cond" style={{ fontSize:36, color:daysPerWeek===d?"#FC4C02":"#fff" }}>{d}</div>
                <div style={{ fontSize:11, color:"#64748b" }}>giorni</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop:16, padding:"12px 16px", background:"rgba(255,255,255,.03)", borderRadius:10, fontSize:12, color:"#64748b", textAlign:"center" }}>
            {daysPerWeek <= 3 ? "Piano con ampio recupero — ideale per chi inizia o ha poco tempo" :
             daysPerWeek <= 5 ? "Piano bilanciato — ottimo per progressione costante" :
             "Piano ad alto volume — assicurati di recuperare bene"}
          </div>
        </div>
      );

      // STEP 5 — Ready
      if (onboardingStep === 5) return (
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:64, marginBottom:16 }}>🚀</div>
          <h2 className="cond" style={{ fontSize:34, color:"#fff", marginBottom:12 }}>Tutto pronto!</h2>
          <p style={{ color:"#64748b", fontSize:14, lineHeight:1.7, marginBottom:24 }}>
            Il tuo profilo è configurato. Ora vai nella Dashboard, imposta il tuo obiettivo e genera il primo piano di allenamento personalizzato.
          </p>
          <div style={{ background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", borderRadius:14, padding:"20px", marginBottom:24, textAlign:"left" }}>
            <div style={{ fontWeight:600, color:"#e2e8f0", marginBottom:12, fontSize:13 }}>Il tuo profilo</div>
            {[
              ["Bici", bikeType === "gravel" ? "🪨 Gravel" : bikeType === "road" ? "🛣️ Road" : "🔄 Entrambe"],
              ["Peso", `${weight} kg`],
              ["FTP", `${ftpManual && parseInt(ftpManual) > 0 ? parseInt(ftpManual) : calcFTP(activities, weight)} W (${w2wkg(ftpManual && parseInt(ftpManual) > 0 ? parseInt(ftpManual) : calcFTP(activities, weight), weight)} W/kg)`],
              ["Giorni/settimana", `${daysPerWeek} uscite`],
              ["Attività caricate", `${activities.length} uscite da Strava`],
            ].map(([label, value]) => (
              <div key={label} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid rgba(255,255,255,.05)" }}>
                <span style={{ fontSize:12, color:"#64748b" }}>{label}</span>
                <span style={{ fontSize:12, color:"#e2e8f0", fontWeight:500 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      );
    };

    const canProceed = () => {
      if (onboardingStep === 3 && ftpMode === "manual" && (!ftpManual || parseInt(ftpManual) < 80)) return false;
      if (onboardingStep === 3 && ftpMode === "ramp" && rampPhase !== "idle" && rampPhase !== "result") return false;
      return true;
    };

    return (
      <>
        <style>{GLOBAL_CSS}</style>
        <div className="app" style={{ minHeight:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"24px 20px" }}>
          {/* bg */}
          <div style={{ position:"fixed", inset:0, background:"radial-gradient(ellipse 80% 60% at 50% -10%, rgba(252,76,2,.1) 0%, transparent 60%)", pointerEvents:"none" }} />

          <div style={{ maxWidth:460, width:"100%", position:"relative", zIndex:1 }}>
            {/* Header */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:32 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ background:"#FC4C02", borderRadius:7, padding:"5px 7px", display:"flex" }}><IC n="bike" s={16} /></div>
                <span className="cond" style={{ fontSize:18, color:"#fff" }}>GRAVEL COACH</span>
              </div>
              <div style={{ fontSize:12, color:"#374151" }}>{onboardingStep + 1} / {STEPS.length}</div>
            </div>

            {/* Progress bar */}
            <div style={{ height:3, background:"#1a2535", borderRadius:2, marginBottom:32, overflow:"hidden" }}>
              <div style={{ height:"100%", background:"linear-gradient(90deg,#FC4C02,#ff7c45)", borderRadius:2, width:`${progress}%`, transition:"width .4s ease" }} />
            </div>

            {/* Step content */}
            <div className="card" style={{ padding:"28px 24px", marginBottom:20, border:"1px solid rgba(255,255,255,.1)" }}>
              {stepContent()}
            </div>

            {/* Navigation */}
            <div style={{ display:"flex", gap:12 }}>
              {onboardingStep > 0 && (
                <button onClick={() => setOnboardingStep(s => s-1)} className="ghost-btn" style={{ flex:1 }}>
                  ← Indietro
                </button>
              )}
              {onboardingStep < STEPS.length - 1 ? (
                <button onClick={() => { if(canProceed()) setOnboardingStep(s => s+1); }} disabled={!canProceed()} className="primary-btn" style={{ flex:2, justifyContent:"center" }}>
                  Avanti →
                </button>
              ) : (
                <button onClick={completeOnboarding} className="primary-btn" style={{ flex:2, justifyContent:"center", fontSize:15 }}>
                  <IC n="zap" s={16} /> Inizia ad allenarti!
                </button>
              )}
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── LANDING ────────────────────────────────────────────────────────────────
  if (screen === "landing") return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div className="app" style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:24, position:"relative", overflow:"hidden" }}>
        {/* Ambient bg */}
        <div style={{ position:"fixed", inset:0, background:"radial-gradient(ellipse 80% 60% at 50% -10%, rgba(252,76,2,.14) 0%, transparent 60%)", pointerEvents:"none" }} />
        <div style={{ position:"fixed", inset:0, backgroundImage:"linear-gradient(rgba(255,255,255,.015) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.015) 1px,transparent 1px)", backgroundSize:"56px 56px", pointerEvents:"none" }} />

        <div style={{ maxWidth:560, width:"100%", textAlign:"center", position:"relative", zIndex:1 }}>
          <div style={{ display:"inline-flex", alignItems:"center", gap:8, background:"rgba(252,76,2,.1)", border:"1px solid rgba(252,76,2,.2)", borderRadius:24, padding:"5px 14px", marginBottom:36 }}>
            <div style={{ width:5, height:5, borderRadius:"50%", background:"#FC4C02", animation:"pulse 1.5s ease-in-out infinite" }} />
            <span style={{ fontSize:10, fontWeight:700, letterSpacing:".12em", color:"#FC4C02", textTransform:"uppercase", fontFamily:"'JetBrains Mono',monospace" }}>AI Cycling Coach — Beta</span>
          </div>

          <h1 className="cond fade-up" style={{ fontSize:"clamp(56px,14vw,108px)", lineHeight:.88, marginBottom:22, color:"#fff" }}>
            IL TUO<br />
            <span style={{ WebkitTextStroke:"2px #FC4C02", color:"transparent" }}>COACH</span><br />
            PERSONALE
          </h1>

          <p style={{ color:"#64748b", lineHeight:1.7, fontSize:14, marginBottom:40, maxWidth:420, margin:"0 auto 40px" }}>
            Analisi AI delle tue attività Strava, piani d'allenamento periodizzati, zone di potenza, TSS, grafico progressione e un coach sempre disponibile.
          </p>

          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10, marginBottom:48 }}>
            <button className="strava-btn" onClick={connectMock}>
              <IC n="strava" s={20} /> Connetti con Strava (Demo)
            </button>
            <button className="ghost-btn" onClick={() => window.location.href = getStravaAuthUrl()}>
              Usa credenziali Strava reali →
            </button>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
            {[["🔥","Zone di Potenza","FTP + Z1-Z6 calcolate"],["📊","Grafico Progressione","Km, watt, TSS nel tempo"],["🤖","Chat col Coach","Domande libere all'AI"],].map(([ic,t,s]) => (
              <div key={t} className="card" style={{ padding:"14px 12px", textAlign:"center" }}>
                <div style={{ fontSize:22, marginBottom:6 }}>{ic}</div>
                <div style={{ fontSize:12, fontWeight:600, color:"#e2e8f0", marginBottom:2 }}>{t}</div>
                <div style={{ fontSize:11, color:"#374151" }}>{s}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );

  // ── LOADING ────────────────────────────────────────────────────────────────
  if (screen === "loading") return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div className="app" style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh" }}>
        <div style={{ textAlign:"center" }}>
          <div style={{ color:"#FC4C02", marginBottom:16 }}><IC n="spin" s={44} /></div>
          <p className="cond" style={{ fontSize:32, color:"#fff" }}>Connessione a Strava</p>
          <p style={{ color:"#4b5563", marginTop:8, fontSize:13 }}>Recupero attività in corso…</p>
        </div>
      </div>
    </>
  );

  // ── MAIN APP ───────────────────────────────────────────────────────────────
  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div className="app" style={{ display:"flex", flexDirection:"column", minHeight:"100vh" }}>

        {/* HEADER */}
        <header style={{ padding:"12px 20px", borderBottom:"1px solid rgba(255,255,255,.06)", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, background:"rgba(8,12,18,.95)", backdropFilter:"blur(16px)", zIndex:100 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ background:"#FC4C02", borderRadius:7, padding:"5px 7px", display:"flex", animation:"glowPulse 3s ease infinite" }}><IC n="bike" s={16} /></div>
            <span className="cond" style={{ fontSize:20, color:"#fff", letterSpacing:".04em" }}>GRAVEL COACH</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            {plan && (
              <div style={{ display:"flex", alignItems:"center", gap:6, background:"rgba(34,197,94,.1)", border:"1px solid rgba(34,197,94,.2)", borderRadius:20, padding:"4px 10px" }}>
                <div style={{ width:5, height:5, borderRadius:"50%", background:"#22c55e" }} />
                <span style={{ fontSize:11, color:"#22c55e", fontWeight:600 }}>Piano attivo</span>
              </div>
            )}
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ fontSize:12, color:"#4b5563" }}>{athlete?.firstname} {athlete?.lastname}</div>
              {/* Tasto aggiorna attività */}
              <button onClick={refreshActivities} disabled={refreshing} title="Aggiorna attività Strava"
                style={{ background:"transparent", border:"1px solid rgba(255,255,255,.1)", borderRadius:6, width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center", color:refreshing?"#374151":"#6b7280", cursor:refreshing?"not-allowed":"pointer", transition:"all .2s" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ animation:refreshing?"spin 1s linear infinite":"none" }}>
                  <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
              </button>
              {/* Tasto disconnetti */}
              <button onClick={() => {
                if (window.confirm("Vuoi disconnetterti e tornare alla schermata iniziale?")) {
                  ["gc_onboarded","gc_token","gc_athlete","gc_activities",
                   "gc_weight","gc_bikeType","gc_daysPerWeek","gc_ftpManual",
                   "gc_goalText","gc_goalDate","gc_goalType","gc_lastRefresh"].forEach(k => localStorage.removeItem(k));
                  setToken(null);
                  setAthlete(null);
                  setActivities([]);
                  setPlan(null);
                  setScreen("landing");
                }
              }} style={{ background:"transparent", border:"none", color:"#374151", fontSize:13, cursor:"pointer", padding:"2px 4px", borderRadius:4 }} title="Disconnetti">⚙️</button>
            </div>
          </div>
        </header>

        {/* ANALYZING OVERLAY */}
        {analyzing && (
          <div style={{ position:"fixed", inset:0, background:"rgba(8,12,18,.95)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(12px)" }}>
            <div style={{ textAlign:"center", maxWidth:380, padding:"0 24px" }}>
              <div style={{ width:64, height:64, borderRadius:"50%", background:"rgba(252,76,2,.15)", border:"2px solid rgba(252,76,2,.3)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 24px", color:"#FC4C02" }}>
                <IC n="spin" s={32} />
              </div>
              <p className="cond" style={{ fontSize:38, color:"#fff", marginBottom:8 }}>IL COACH LAVORA</p>
              <p style={{ color:"#4b5563", fontSize:13, lineHeight:1.7, marginBottom:24 }}>Analisi di {activities.length} uscite in corso — FTP, TSS, periodizzazione e piano su misura per il tuo obiettivo…</p>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {["Analisi volume e intensità…","Calcolo FTP e zone potenza…","Valutazione TSS settimanale…","Generazione piano periodizzato…","Definizione metriche target…"].map((s,i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", background:"rgba(255,255,255,.03)", borderRadius:8, animation:`fadeUp .4s ease both ${i*.1}s` }}>
                    <div style={{ width:20, height:20, borderRadius:"50%", background:"rgba(252,76,2,.15)", border:"1px solid rgba(252,76,2,.3)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, color:"#FC4C02" }}><IC n="spin" s={10} /></div>
                    <span style={{ fontSize:12, color:"#64748b" }}>{s}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* CONTENT */}
        <div style={{ flex:1, overflowY:"auto" }}>
          {/* ── DASHBOARD TAB ── */}
          {tab === "dashboard" && (
            <div style={{ maxWidth:960, margin:"0 auto", padding:"20px 16px" }}>

              {/* Ultima sincronizzazione */}
              {localStorage.getItem("gc_lastRefresh") && (
                <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", gap:5, marginBottom:8 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  <span style={{ fontSize:10, color:"#374151", fontFamily:"'JetBrains Mono',monospace" }}>
                    Aggiornato: {new Date(localStorage.getItem("gc_lastRefresh")).toLocaleString("it-IT",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}
                  </span>
                </div>
              )}

              {/* Stats row */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:16 }}>
                <StatCard icon="bike" label="km totali" value={totalKm.toFixed(0)} unit="km" color="#FC4C02" sub={`${activities.length} uscite`} />
                <StatCard icon="hill" label="dislivello" value={(totalElev/1000).toFixed(1)} unit="km↑" color="#0ea5e9" sub="totale" />
                <StatCard icon="zap" label="FTP stimato" value={ftp} unit="W" color="#f59e0b" sub={`${w2wkg(ftp,weight)} W/kg`} />
                <StatCard icon="heart" label="TSS settimana" value={weeklyTSS} unit="" color="#a855f7" sub="carico stimato" />
              </div>

              {/* ── SESSIONE DI OGGI ── */}
              {todaySession && (
                <div className="card" style={{ padding:18, marginBottom:16, border:`1px solid ${ta(todaySession.type)}33`, background:`${tc(todaySession.type)}` }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:18 }}>📅</span>
                      <div>
                        <div style={{ fontSize:10, color:ta(todaySession.type), fontWeight:700, textTransform:"uppercase", letterSpacing:".07em" }}>Oggi — {todaySession.type}</div>
                        <div className="cond" style={{ fontSize:22, color:"#fff" }}>{todaySession.title}</div>
                      </div>
                    </div>
                    <span className="pill" style={{ background:`${ta(todaySession.type)}18`, color:ta(todaySession.type), border:`1px solid ${ta(todaySession.type)}33` }}>{todaySession.intensity}</span>
                  </div>
                  <div style={{ display:"flex", gap:16, marginBottom:10, flexWrap:"wrap" }}>
                    {[[todaySession.duration,"🕐"],[todaySession.distance,"📍"],[todaySession.elevation,"⛰️"],[todaySession.zones,"⚡"]].map(([v,ic]) => v && v !== "—" && (
                      <span key={ic} style={{ fontSize:12, color:"#94a3b8", fontFamily:"'JetBrains Mono',monospace" }}>{ic} {v}</span>
                    ))}
                  </div>
                  <p style={{ fontSize:12, color:"#94a3b8", lineHeight:1.6, marginBottom:10 }}>{todaySession.description}</p>
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={()=>setTab("plan")} style={{ background:`${ta(todaySession.type)}18`, border:`1px solid ${ta(todaySession.type)}33`, borderRadius:8, padding:"7px 14px", color:ta(todaySession.type), fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'Inter',sans-serif" }}>
                      Dettaglio completo →
                    </button>
                    {todaySession.tss > 0 && <span style={{ display:"flex", alignItems:"center", fontSize:12, color:"#a855f7", fontFamily:"'JetBrains Mono',monospace" }}>TSS ~{todaySession.tss}</span>}
                  </div>
                </div>
              )}

              {/* ── CHALLENGE SETTIMANALI ── */}
              <div className="card" style={{ padding:18, marginBottom:16 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:16 }}>🎯</span>
                    <span style={{ fontSize:12, fontWeight:600, color:"#fff" }}>Challenge Settimana</span>
                  </div>
                  {streakWeeks > 0 && (
                    <div style={{ display:"flex", alignItems:"center", gap:5, background:"rgba(245,158,11,.1)", border:"1px solid rgba(245,158,11,.2)", borderRadius:20, padding:"3px 10px" }}>
                      <span style={{ fontSize:12 }}>🔥</span>
                      <span style={{ fontSize:11, color:"#f59e0b", fontWeight:600 }}>{streakWeeks} {streakWeeks === 1 ? "settimana" : "settimane"} di fila</span>
                    </div>
                  )}
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {weeklyChallenge.map((c, i) => (
                    <div key={i}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          <span style={{ fontSize:14 }}>{c.icon}</span>
                          <span style={{ fontSize:12, color:"#e2e8f0" }}>{c.label}</span>
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          <span className="mono" style={{ fontSize:11, color:"#6b7280" }}>{c.current}</span>
                          <span style={{ color:"#374151", fontSize:11 }}>/ {c.target}</span>
                          <span className="mono" style={{ fontSize:11, color:c.pct >= 100 ? "#22c55e" : c.color, fontWeight:600 }}>{c.pct}%</span>
                        </div>
                      </div>
                      <div style={{ height:5, background:"#1a2535", borderRadius:3, overflow:"hidden" }}>
                        <div style={{ height:"100%", background: c.pct >= 100 ? "#22c55e" : c.color, borderRadius:3, width:`${c.pct}%`, transition:"width 1s ease" }} />
                      </div>
                      {c.pct >= 100 && <div style={{ fontSize:10, color:"#22c55e", marginTop:3 }}>✓ Challenge completata!</div>}
                    </div>
                  ))}
                </div>
              </div>

              {/* ── RIEPILOGO SETTIMANA ── */}
              <div className="card" style={{ padding:18, marginBottom:16 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
                  <span style={{ fontSize:16 }}>📈</span>
                  <span style={{ fontSize:12, fontWeight:600, color:"#fff" }}>Questa settimana vs precedente</span>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                  {[
                    { label:"Km", current:thisWeekKm, prev:lastWeekKm, unit:"km", color:"#FC4C02" },
                    { label:"Dislivello", current:thisWeekElev, prev:lastWeekElev, unit:"m↑", color:"#0ea5e9" },
                    { label:"TSS", current:thisWeekTSS, prev:lastWeekTSS, unit:"", color:"#a855f7" },
                  ].map(({label, current, prev, unit, color}) => {
                    const diff = prev > 0 ? Math.round(((current - prev) / prev) * 100) : null;
                    const isUp = diff !== null && diff >= 0;
                    return (
                      <div key={label} style={{ background:"#0a1120", borderRadius:10, padding:"12px 10px", textAlign:"center" }}>
                        <div style={{ fontSize:10, color:"#4b5563", textTransform:"uppercase", letterSpacing:".06em", marginBottom:4 }}>{label}</div>
                        <div className="cond" style={{ fontSize:24, color, lineHeight:1 }}>{current}<span style={{ fontSize:11, marginLeft:2 }}>{unit}</span></div>
                        {diff !== null ? (
                          <div style={{ fontSize:10, color:isUp?"#22c55e":"#ef4444", marginTop:4 }}>
                            {isUp ? "▲" : "▼"} {Math.abs(diff)}% vs sett. prec.
                          </div>
                        ) : (
                          <div style={{ fontSize:10, color:"#374151", marginTop:4 }}>prima settimana</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Charts row */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
                {/* KM trend */}
                <div className="card" style={{ padding:18 }}>
                  <div style={{ fontSize:11, color:"#4b5563", textTransform:"uppercase", letterSpacing:".07em", marginBottom:12 }}>Distanza per uscita (km)</div>
                  <ResponsiveContainer width="100%" height={130}>
                    <BarChart data={chartData} margin={{top:0,right:0,left:-20,bottom:0}}>
                      <XAxis dataKey="date" tick={{fontSize:9}} />
                      <YAxis tick={{fontSize:9}} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="km" name="km" fill="#FC4C02" opacity={0.8} radius={[3,3,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {/* Potenza trend */}
                <div className="card" style={{ padding:18 }}>
                  <div style={{ fontSize:11, color:"#4b5563", textTransform:"uppercase", letterSpacing:".07em", marginBottom:12 }}>Potenza media (W) + TSS</div>
                  <ResponsiveContainer width="100%" height={130}>
                    <LineChart data={chartData} margin={{top:0,right:0,left:-20,bottom:0}}>
                      <XAxis dataKey="date" tick={{fontSize:9}} />
                      <YAxis tick={{fontSize:9}} />
                      <Tooltip content={<ChartTooltip />} />
                      <ReferenceLine y={ftp} stroke="#f59e0b" strokeDasharray="3 3" opacity={.5} />
                      <Line dataKey="watts" name="Watt" stroke="#f59e0b" strokeWidth={2} dot={false} />
                      <Line dataKey="tss" name="TSS" stroke="#a855f7" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* HR + Elev chart */}
              <div className="card" style={{ padding:18, marginBottom:16 }}>
                <div style={{ fontSize:11, color:"#4b5563", textTransform:"uppercase", letterSpacing:".07em", marginBottom:12 }}>Frequenza cardiaca media & Dislivello</div>
                <ResponsiveContainer width="100%" height={110}>
                  <LineChart data={chartData} margin={{top:0,right:0,left:-20,bottom:0}}>
                    <XAxis dataKey="date" tick={{fontSize:9}} />
                    <YAxis yAxisId="hr" tick={{fontSize:9}} domain={['auto','auto']} />
                    <YAxis yAxisId="elev" orientation="right" tick={{fontSize:9}} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line yAxisId="hr" dataKey="hr" name="FC bpm" stroke="#ef4444" strokeWidth={2} dot={false} />
                    <Line yAxisId="elev" dataKey="elev" name="Elev m" stroke="#0ea5e9" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Power Zones (if plan available) */}
              {plan?.powerZones && (
                <div className="card" style={{ padding:18, marginBottom:16 }}>
                  <div style={{ fontSize:11, color:"#4b5563", textTransform:"uppercase", letterSpacing:".07em", marginBottom:12 }}>Zone di Potenza — FTP {plan.ftpEstimate}W ({plan.wkg} W/kg)</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {plan.powerZones.map(z => {
                      const pct = Math.min(100, ((z.max === 999 ? z.min + 40 : (z.min+z.max)/2) / (plan.ftpEstimate*1.3)) * 100);
                      return (
                        <div key={z.zone} style={{ display:"flex", alignItems:"center", gap:10 }}>
                          <div style={{ width:90, fontSize:11, color:z.color, fontWeight:600, fontFamily:"'JetBrains Mono',monospace", flexShrink:0 }}>{z.zone}</div>
                          <div className="bar" style={{ flex:1 }}>
                            <div className="bar-fill" style={{ width:`${pct}%`, background:z.color, opacity:.8 }} />
                          </div>
                          <div style={{ fontSize:10, color:"#4b5563", fontFamily:"'JetBrains Mono',monospace", minWidth:80, textAlign:"right" }}>
                            {z.min}–{z.max === 999 ? `${z.min}+` : z.max}W
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Record Personali */}
              {personalRecords && (
                <div className="card" style={{ padding:18, marginBottom:16 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
                    <span style={{ fontSize:16 }}>🏆</span>
                    <span style={{ fontSize:12, fontWeight:600, color:"#f59e0b" }}>I tuoi Record Personali</span>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
                    {[
                      {label:"Distanza massima", color:"#FC4C02", ...personalRecords.distance},
                      {label:"Dislivello massimo", color:"#0ea5e9", ...personalRecords.elevation},
                      ...(personalRecords.watts ? [{label:"Potenza media picco", color:"#f59e0b", ...personalRecords.watts}] : []),
                      ...(personalRecords.hr ? [{label:"FC massima", color:"#ef4444", ...personalRecords.hr}] : []),
                    ].map((pr, i) => (
                      <div key={i} style={{ background:"#0a1120", borderRadius:10, padding:"12px 14px" }}>
                        <div style={{ fontSize:10, color:"#4b5563", textTransform:"uppercase", letterSpacing:".06em", marginBottom:4 }}>{pr.label}</div>
                        <div className="cond" style={{ fontSize:28, color:pr.color, lineHeight:1 }}>{pr.value}<span style={{ fontSize:13, marginLeft:2 }}>{pr.unit}</span></div>
                        <div style={{ fontSize:10, color:"#374151", marginTop:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{pr.name}</div>
                        <div style={{ fontSize:10, color:"#1e2d40" }}>{pr.date}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Activities list */}
              <div className="card" style={{ padding:18, marginBottom:16 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <IC n="strava" s={15} />
                    <span style={{ fontSize:12, fontWeight:600, color:"#FC4C02" }}>Attività recenti</span>
                  </div>
                  <span style={{ fontSize:10, color:"#374151", fontFamily:"'JetBrains Mono',monospace" }}>{activities.length} rides</span>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {activities.slice(0,8).map(a => (
                    <div key={a.id} className="card-hover" onClick={() => { setSelectedActivity(a); setNoteText(notes[a.id]||""); setTab("notes"); }}
                      style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", background:"#0a1120", borderRadius:9, border:"1px solid rgba(255,255,255,.04)" }}>
                      <div style={{ fontSize:10, color:"#374151", minWidth:40, fontFamily:"'JetBrains Mono',monospace" }}>{fmtDate(a.start_date)}</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:12, fontWeight:500, color:"#cbd5e1", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.name}</div>
                        <div style={{ fontSize:10, color:"#374151" }}>{a.sport_type}</div>
                      </div>
                      <div style={{ display:"flex", gap:10, flexShrink:0 }}>
                        <span style={{ fontSize:11, color:"#FC4C02", fontFamily:"'JetBrains Mono',monospace" }}>{m2km(a.distance)}km</span>
                        <span style={{ fontSize:11, color:"#0ea5e9", fontFamily:"'JetBrains Mono',monospace" }}>{Math.round(a.total_elevation_gain)}m↑</span>
                        {a.average_watts && <span style={{ fontSize:11, color:"#f59e0b", fontFamily:"'JetBrains Mono',monospace" }}>{a.average_watts}W</span>}
                        {notes[a.id] && <div style={{ width:6, height:6, borderRadius:"50%", background:"#22c55e", marginTop:2 }} />}
                      </div>
                      <IC n="chevR" s={12} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Goal setup */}
              <div className="card" style={{ padding:22 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:18 }}>
                  <div style={{ background:"rgba(252,76,2,.12)", borderRadius:8, padding:8 }}><IC n="target" s={18} /></div>
                  <div>
                    <div style={{ fontWeight:600, color:"#fff", fontSize:14 }}>{plan ? "Modifica obiettivo" : "Imposta il tuo obiettivo"}</div>
                    <div style={{ fontSize:11, color:"#4b5563" }}>Il coach genera un piano periodizzato personalizzato</div>
                  </div>
                </div>

                <div style={{ display:"flex", gap:6, marginBottom:14 }}>
                  {[["route","🗺️ Percorso"],["event","🏆 Gara"],["fitness","📈 Fitness"]].map(([v,l]) => (
                    <button key={v} onClick={() => setGoalType(v)} style={{ flex:1, padding:"8px 4px", borderRadius:8, border:`1px solid ${goalType===v?"#FC4C02":"rgba(255,255,255,.07)"}`, background:goalType===v?"rgba(252,76,2,.12)":"transparent", color:goalType===v?"#FC4C02":"#4b5563", fontSize:11, fontWeight:600, cursor:"pointer", transition:"all .2s" }}>
                      {l}
                    </button>
                  ))}
                </div>

                <div style={{ display:"grid", gap:10 }}>
                  <textarea value={goalText} onChange={e=>setGoalText(e.target.value)} placeholder={
                    goalType==="route" ? "Es: Giro del Monte Grappa da Bassano, ~70km e 1700m di dislivello" :
                    goalType==="event" ? "Es: Granfondo Nove Colli 200km 3200m dislivello, data 25 maggio" :
                    "Es: Voglio mantenere 280W per un'ora e fare 100km in meno di 3h"
                  } />
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                    <div>
                      <label style={{ fontSize:11, color:"#4b5563", display:"block", marginBottom:4 }}>Peso (kg)</label>
                      <input type="number" value={weight} onChange={e=>setWeight(+e.target.value)} min={40} max={130} />
                    </div>
                    <div>
                      <label style={{ fontSize:11, color:"#4b5563", display:"block", marginBottom:4 }}>Data obiettivo</label>
                      <input type="date" value={goalDate} onChange={e=>setGoalDate(e.target.value)} />
                    </div>
                    <div>
                      <label style={{ fontSize:11, color:"#4b5563", display:"block", marginBottom:4 }}>GPX percorso</label>
                      <div onClick={()=>fileRef.current?.click()} style={{ background:"#111827", border:"1px dashed rgba(255,255,255,.09)", borderRadius:9, padding:"9px 12px", cursor:"pointer", display:"flex", alignItems:"center", gap:6, color:gpxFile?"#22c55e":"#4b5563", fontSize:12 }}>
                        <IC n="upload" s={13} />{gpxFile?gpxFile.name:"Carica GPX"}
                      </div>
                      <input ref={fileRef} type="file" accept=".gpx" style={{display:"none"}} onChange={e=>setGpxFile(e.target.files[0])} />
                    </div>
                  </div>
                  {goalDate && (
                    <div style={{ background:"rgba(14,165,233,.08)", border:"1px solid rgba(14,165,233,.15)", borderRadius:8, padding:"8px 12px", display:"flex", alignItems:"center", gap:8 }}>
                      <IC n="clock" s={13} />
                      <span style={{ fontSize:12, color:"#38bdf8" }}><strong>{daysUntil(goalDate)} giorni</strong> all'obiettivo</span>
                    </div>
                  )}
                  <button className="primary-btn" onClick={runAnalysis} disabled={!goalText.trim()} style={{ justifyContent:"center", fontSize:14 }}>
                    <IC n="zap" s={16} /> {plan ? "Rigenera Piano" : "Genera Piano di Allenamento"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── PLAN TAB ── */}
          {tab === "plan" && (
            <div style={{ maxWidth:960, margin:"0 auto", padding:"20px 16px" }}>
              {plan?._error ? (
                <div style={{ textAlign:"center", padding:"60px 24px" }}>
                  <div style={{ fontSize:40, marginBottom:12 }}>⚠️</div>
                  <p className="cond" style={{ fontSize:28, color:"#fff", marginBottom:8 }}>Errore nella generazione</p>
                  <p style={{ color:"#4b5563", fontSize:13, marginBottom:8 }}>Il coach ha avuto un problema a elaborare il piano.</p>
                  <p style={{ color:"#374151", fontSize:11, marginBottom:20, fontFamily:"'JetBrains Mono',monospace" }}>{plan._errorMsg}</p>
                  <button className="primary-btn" onClick={()=>{ setPlan(null); setTab("dashboard"); }}><IC n="dash" s={15} /> Riprova</button>
                </div>
              ) : !plan ? (
                <div style={{ textAlign:"center", padding:"60px 24px" }}>
                  <div style={{ fontSize:40, marginBottom:12 }}>🎯</div>
                  <p className="cond" style={{ fontSize:28, color:"#fff", marginBottom:8 }}>Nessun piano attivo</p>
                  <p style={{ color:"#4b5563", fontSize:13, marginBottom:20 }}>Vai nella Dashboard, imposta un obiettivo e genera il tuo piano personalizzato.</p>
                  <button className="primary-btn" onClick={()=>setTab("dashboard")}><IC n="dash" s={15} /> Vai alla Dashboard</button>
                </div>
              ) : (
                <>
                  {/* Top overview */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:16 }}>
                    {/* Fitness */}
                    <div className="card" style={{ padding:18, position:"relative", overflow:"hidden" }}>
                      <div style={{ position:"absolute", top:-30, right:-30, width:100, height:100, borderRadius:"50%", background:"rgba(252,76,2,.06)", pointerEvents:"none" }} />
                      <div style={{ fontSize:10, color:"#4b5563", textTransform:"uppercase", letterSpacing:".08em", marginBottom:4 }}>Livello Fitness</div>
                      <div className="cond" style={{ fontSize:32, color:"#FC4C02" }}>{plan.fitnessLevel}</div>
                      <div style={{ marginTop:8, marginBottom:4 }}>
                        <div className="bar"><div className="bar-fill" style={{ width:`${plan.fitnessScore}%`, background:"linear-gradient(90deg,#FC4C02,#ff7c45)" }} /></div>
                      </div>
                      <div style={{ fontSize:11, color:"#4b5563", display:"flex", justifyContent:"space-between" }}>
                        <span>Score</span><span className="mono" style={{ color:"#FC4C02" }}>{plan.fitnessScore}/100</span>
                      </div>
                    </div>
                    {/* Readiness */}
                    <div className="card" style={{ padding:18, position:"relative", overflow:"hidden" }}>
                      <div style={{ position:"absolute", top:-30, right:-30, width:100, height:100, borderRadius:"50%", background:"rgba(14,165,233,.05)", pointerEvents:"none" }} />
                      <div style={{ fontSize:10, color:"#4b5563", textTransform:"uppercase", letterSpacing:".08em", marginBottom:4 }}>Readiness Obiettivo</div>
                      <div className="cond" style={{ fontSize:32, color:"#0ea5e9" }}>{plan.readinessForGoal}%</div>
                      <div style={{ marginTop:8, marginBottom:4 }}>
                        <div className="bar"><div className="bar-fill" style={{ width:`${plan.readinessForGoal}%`, background:"linear-gradient(90deg,#0ea5e9,#38bdf8)" }} /></div>
                      </div>
                      <div style={{ fontSize:11, color:"#4b5563" }}>{plan.estimatedWeeksToGoal} settimane al traguardo</div>
                    </div>
                    {/* TSS target */}
                    <div className="card" style={{ padding:18, position:"relative", overflow:"hidden" }}>
                      <div style={{ position:"absolute", top:-30, right:-30, width:100, height:100, borderRadius:"50%", background:"rgba(168,85,247,.05)", pointerEvents:"none" }} />
                      <div style={{ fontSize:10, color:"#4b5563", textTransform:"uppercase", letterSpacing:".08em", marginBottom:4 }}>TSS Settimana Target</div>
                      <div className="cond" style={{ fontSize:32, color:"#a855f7" }}>{plan.weeklyTSSTarget}</div>
                      <div style={{ marginTop:8, marginBottom:4 }}>
                        <div className="bar"><div className="bar-fill" style={{ width:`${Math.min(100,(weeklyTSS/plan.weeklyTSSTarget)*100)}%`, background:"linear-gradient(90deg,#a855f7,#c084fc)" }} /></div>
                      </div>
                      <div style={{ fontSize:11, color:"#4b5563" }}>Attuale: <span className="mono" style={{color:"#a855f7"}}>{weeklyTSS}</span></div>
                    </div>
                  </div>

                  {/* Coach message */}
                  <div className="card" style={{ padding:16, marginBottom:14, display:"flex", gap:12, alignItems:"flex-start", borderColor:"rgba(252,76,2,.15)" }}>
                    <div style={{ fontSize:24, flexShrink:0 }}>🏋️</div>
                    <div>
                      <div style={{ fontSize:10, fontWeight:700, color:"#FC4C02", textTransform:"uppercase", letterSpacing:".08em", marginBottom:4 }}>Il tuo Coach dice</div>
                      <p style={{ fontSize:13, color:"#94a3b8", lineHeight:1.65, fontStyle:"italic" }}>"{plan.coachMessage}"</p>
                    </div>
                  </div>

                  {/* Strengths & weaknesses */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14 }}>
                    <div className="card" style={{ padding:16 }}>
                      <div style={{ fontSize:10, fontWeight:700, color:"#22c55e", textTransform:"uppercase", letterSpacing:".08em", marginBottom:10 }}>✓ Punti di Forza</div>
                      {plan.strengths?.map((s,i) => (
                        <div key={i} style={{ display:"flex", gap:8, marginBottom:7 }}>
                          <IC n="check" s={13} /><span style={{ fontSize:12, color:"#94a3b8", lineHeight:1.5 }}>{s}</span>
                        </div>
                      ))}
                    </div>
                    <div className="card" style={{ padding:16 }}>
                      <div style={{ fontSize:10, fontWeight:700, color:"#f59e0b", textTransform:"uppercase", letterSpacing:".08em", marginBottom:10 }}>↑ Da Migliorare</div>
                      {plan.weaknesses?.map((s,i) => (
                        <div key={i} style={{ display:"flex", gap:8, marginBottom:7 }}>
                          <span style={{ color:"#f59e0b", fontSize:12, flexShrink:0 }}>→</span>
                          <span style={{ fontSize:12, color:"#94a3b8", lineHeight:1.5 }}>{s}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Weekly plan */}
                  <div className="card" style={{ padding:20, marginBottom:14 }}>
                    <div style={{ fontWeight:600, color:"#fff", fontSize:13, marginBottom:14, display:"flex", alignItems:"center", gap:8 }}>
                      <IC n="cal" s={16} /> Piano Settimanale Tipo
                    </div>
                    {/* Day selector */}
                    <div style={{ display:"flex", gap:5, marginBottom:16, overflowX:"auto", paddingBottom:2 }}>
                      {plan.weeklyPlan?.map((d,i) => (
                        <button key={i} onClick={()=>setActiveDay(i)} style={{ flexShrink:0, padding:"6px 12px", borderRadius:8, border:`1px solid ${activeDay===i?ta(d.type):"rgba(255,255,255,.07)"}`, background:activeDay===i?tc(d.type):"transparent", color:activeDay===i?ta(d.type):"#4b5563", fontSize:11, fontWeight:600, cursor:"pointer", transition:"all .2s", whiteSpace:"nowrap" }}>
                          <div style={{ fontSize:9, marginBottom:1 }}>{d.day}</div>
                          {d.type}
                        </button>
                      ))}
                    </div>
                    {/* Day detail */}
                    {plan.weeklyPlan?.[activeDay] && (() => {
                      const d = plan.weeklyPlan[activeDay];
                      return (
                        <div className="slide-in" style={{ background:tc(d.type), border:`1px solid ${ta(d.type)}22`, borderRadius:12, padding:18 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                            <div>
                              <span className="pill" style={{ background:`${ta(d.type)}18`, color:ta(d.type), border:`1px solid ${ta(d.type)}33`, marginBottom:6 }}>{d.type}</span>
                              <h3 className="cond" style={{ fontSize:26, color:"#fff" }}>{d.title}</h3>
                            </div>
                            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
                              <span className="pill" style={{ background:`${ic(d.intensity)}18`, color:ic(d.intensity), border:`1px solid ${ic(d.intensity)}33` }}>{d.intensity}</span>
                              {d.tss && <span className="mono" style={{ fontSize:10, color:"#4b5563" }}>TSS ~{d.tss}</span>}
                            </div>
                          </div>
                          <div style={{ display:"flex", gap:16, marginBottom:12, flexWrap:"wrap" }}>
                            {[["clock",d.duration],["bike",d.distance],["hill",d.elevation],["zap",d.zones]].map(([ic,v]) => v && (
                              <div key={ic} style={{ display:"flex", alignItems:"center", gap:5 }}>
                                <span style={{ color:ta(d.type) }}><IC n={ic} s={12} /></span>
                                <span className="mono" style={{ fontSize:11, color:"#94a3b8" }}>{v}</span>
                              </div>
                            ))}
                          </div>
                          <p style={{ fontSize:13, color:"#94a3b8", lineHeight:1.65, marginBottom:12 }}>{d.description}</p>
                          <div style={{ background:`${ta(d.type)}0f`, border:`1px solid ${ta(d.type)}1a`, borderRadius:8, padding:"10px 12px" }}>
                            <div style={{ fontSize:10, color:ta(d.type), textTransform:"uppercase", letterSpacing:".08em", marginBottom:3 }}>💡 Perché questo allenamento</div>
                            <p style={{ fontSize:12, color:"#64748b", lineHeight:1.55 }}>{d.purpose}</p>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Periodization chart */}
                  {periodData.length > 0 && (
                    <div className="card" style={{ padding:18, marginBottom:14 }}>
                      <div style={{ fontWeight:600, color:"#fff", fontSize:13, marginBottom:12 }}>📆 Periodizzazione — TSS target per settimana</div>
                      <ResponsiveContainer width="100%" height={120}>
                        <BarChart data={periodData} margin={{top:0,right:0,left:-20,bottom:0}}>
                          <XAxis dataKey="week" tick={{fontSize:10}} />
                          <YAxis tick={{fontSize:10}} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="tss" name="TSS target" fill="#FC4C02" opacity={0.75} radius={[3,3,0,0]} />
                        </BarChart>
                      </ResponsiveContainer>
                      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:10 }}>
                        {plan.periodization?.map(w => (
                          <div key={w.week} style={{ background:"#0a1120", border:"1px solid rgba(255,255,255,.06)", borderRadius:6, padding:"5px 10px" }}>
                            <span style={{ fontSize:10, color:"#4b5563", fontFamily:"'JetBrains Mono',monospace" }}>S{w.week} </span>
                            <span style={{ fontSize:11, color:"#94a3b8" }}>{w.focus}</span>
                            <span style={{ fontSize:10, color:"#FC4C02", marginLeft:6 }}>— {w.longRide}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Key metrics */}
                  <div className="card" style={{ padding:18, marginBottom:14 }}>
                    <div style={{ fontWeight:600, color:"#fff", fontSize:13, marginBottom:12 }}>📊 Metriche Chiave</div>
                    <div style={{ display:"grid", gap:8 }}>
                      {plan.keyMetrics?.map((m,i) => (
                        <div key={i} style={{ background:"#0a1120", borderRadius:9, padding:"12px 14px" }}>
                          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                            <span style={{ fontWeight:600, color:"#e2e8f0", fontSize:13 }}>{m.metric}</span>
                            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                              <span className="pill mono" style={{ background:"rgba(107,114,128,.12)", color:"#6b7280" }}>{m.current}</span>
                              <span style={{ color:"#374151" }}>→</span>
                              <span className="pill mono" style={{ background:"rgba(34,197,94,.1)", color:"#4ade80" }}>{m.target}</span>
                            </div>
                          </div>
                          <p style={{ fontSize:11, color:"#374151", lineHeight:1.5 }}>{m.tip}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Nutrition */}
                  {plan.nutritionPlan && (
                    <div className="card" style={{ padding:18 }}>
                      <div style={{ fontWeight:600, color:"#fff", fontSize:13, marginBottom:12 }}>🥗 Piano Nutrizionale</div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                        {[["Pre-uscita", plan.nutritionPlan.preRide, "#f59e0b"],["In sella (>2h)", plan.nutritionPlan.duringRide, "#0ea5e9"],["Post-allenamento", plan.nutritionPlan.postRide, "#22c55e"],["Consiglio generale", plan.nutritionPlan.generalTip, "#a855f7"]].map(([t,v,c]) => v && (
                          <div key={t} style={{ background:"#0a1120", borderRadius:9, padding:"12px 14px" }}>
                            <div style={{ fontSize:10, color:c, fontWeight:700, textTransform:"uppercase", letterSpacing:".07em", marginBottom:5 }}>{t}</div>
                            <p style={{ fontSize:12, color:"#64748b", lineHeight:1.55 }}>{v}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── CALENDAR TAB ── */}
          {tab === "calendar" && (() => {
            const allActivities = [...activities, ...manualRides];
            const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
            const firstDay = new Date(calYear, calMonth, 1).getDay();
            const today = new Date();
            const isCurrentMonth = calMonth === today.getMonth() && calYear === today.getFullYear();

            // Attività per giorno
            const actByDay = {};
            allActivities.forEach(a => {
              const d = new Date(a.start_date);
              if (d.getMonth() === calMonth && d.getFullYear() === calYear) {
                const k = d.getDate();
                actByDay[k] = [...(actByDay[k]||[]), a];
              }
            });

            // Piano per giorno (dal piano AI se esiste)
            const planByDay = {};
            if (plan?.weeklyPlan && !plan._error) {
              const days = ["Domenica","Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato"];
              plan.weeklyPlan.forEach(p => {
                const idx = days.indexOf(p.day);
                if (idx >= 0) {
                  for (let d = 1; d <= daysInMonth; d++) {
                    if (new Date(calYear, calMonth, d).getDay() === idx) {
                      planByDay[d] = p;
                    }
                  }
                }
              });
            }

            // TSS per giorno
            const tssByDay = {};
            Object.entries(actByDay).forEach(([day, acts]) => {
              tssByDay[day] = acts.reduce((s,a) => s + calcTSS(a.moving_time, a.average_watts, ftp), 0);
            });
            const maxTSS = Math.max(1, ...Object.values(tssByDay));

            // Celle griglia
            const cells = [];
            const adj = firstDay === 0 ? 6 : firstDay - 1;
            for (let i = 0; i < adj; i++) cells.push(null);
            for (let d = 1; d <= daysInMonth; d++) cells.push(d);

            const selectedDayActs = selectedCalDay ? (actByDay[selectedCalDay] || []) : [];
            const selectedDayPlan = selectedCalDay ? planByDay[selectedCalDay] : null;
            const selectedDayTSS = selectedCalDay ? (tssByDay[selectedCalDay] || 0) : 0;

            return (
              <div style={{ maxWidth:960, margin:"0 auto", padding:"20px 16px" }}>

                {/* Modal aggiungi uscita */}
                {showAddRide && (
                  <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.75)", zIndex:300, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }} onClick={e => { if(e.target === e.currentTarget) setShowAddRide(false); }}>
                    <div className="card" style={{ width:"100%", maxWidth:420, padding:24, border:"1px solid rgba(252,76,2,.3)" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
                        <span style={{ fontWeight:700, color:"#fff", fontSize:15 }}>
                          ➕ Aggiungi uscita — {addRideDay} {new Date(calYear, calMonth).toLocaleDateString("it-IT",{month:"long"})}
                        </span>
                        <button onClick={()=>setShowAddRide(false)} style={{ background:"none", border:"none", color:"#6b7280", fontSize:18, cursor:"pointer" }}>✕</button>
                      </div>
                      <div style={{ display:"grid", gap:10 }}>
                        <div>
                          <label style={{ fontSize:11, color:"#6b7280", display:"block", marginBottom:4 }}>Nome uscita *</label>
                          <input value={addRideForm.name} onChange={e=>setAddRideForm(f=>({...f,name:e.target.value}))} placeholder="Es. Giro colline domenicale" />
                        </div>
                        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                          <div>
                            <label style={{ fontSize:11, color:"#6b7280", display:"block", marginBottom:4 }}>Distanza (km) *</label>
                            <input type="number" value={addRideForm.km} onChange={e=>setAddRideForm(f=>({...f,km:e.target.value}))} placeholder="Es. 45" />
                          </div>
                          <div>
                            <label style={{ fontSize:11, color:"#6b7280", display:"block", marginBottom:4 }}>Dislivello (m)</label>
                            <input type="number" value={addRideForm.elev} onChange={e=>setAddRideForm(f=>({...f,elev:e.target.value}))} placeholder="Es. 400" />
                          </div>
                        </div>
                        <div>
                          <label style={{ fontSize:11, color:"#6b7280", display:"block", marginBottom:4 }}>Durata (h:mm)</label>
                          <input value={addRideForm.duration} onChange={e=>setAddRideForm(f=>({...f,duration:e.target.value}))} placeholder="Es. 1:45" />
                        </div>
                        <div>
                          <label style={{ fontSize:11, color:"#6b7280", display:"block", marginBottom:4 }}>Note</label>
                          <textarea value={addRideForm.notes} onChange={e=>setAddRideForm(f=>({...f,notes:e.target.value}))} placeholder="Come è andata?" style={{ minHeight:60 }} />
                        </div>
                        <div style={{ display:"flex", gap:8 }}>
                          <button className="primary-btn" onClick={handleAddRide} disabled={!addRideForm.name || !addRideForm.km} style={{ flex:1, justifyContent:"center" }}>
                            <IC n="check" s={14} /> Salva uscita
                          </button>
                          <button className="ghost-btn" onClick={()=>setShowAddRide(false)}>Annulla</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Header calendario */}
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <button onClick={calPrevMonth} style={{ background:"rgba(255,255,255,.06)", border:"1px solid rgba(255,255,255,.1)", borderRadius:8, width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", color:"#e2e8f0", cursor:"pointer" }}>‹</button>
                    <span className="cond" style={{ fontSize:22, color:"#fff", minWidth:200, textAlign:"center" }}>
                      {new Date(calYear, calMonth).toLocaleDateString("it-IT",{month:"long",year:"numeric"}).toUpperCase()}
                    </span>
                    <button onClick={calNextMonth} style={{ background:"rgba(255,255,255,.06)", border:"1px solid rgba(255,255,255,.1)", borderRadius:8, width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", color:"#e2e8f0", cursor:"pointer" }}>›</button>
                  </div>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <div style={{ display:"flex", gap:10 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:10, color:"#FC4C02" }}><div style={{width:7,height:7,borderRadius:"50%",background:"#FC4C02"}}/> Uscita</div>
                      <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:10, color:"#0ea5e9" }}><div style={{width:7,height:7,borderRadius:"50%",background:"#0ea5e9"}}/> Piano</div>
                    </div>
                    {isCurrentMonth && (
                      <button onClick={()=>{ setCalMonth(today.getMonth()); setCalYear(today.getFullYear()); }} style={{ background:"rgba(255,255,255,.06)", border:"1px solid rgba(255,255,255,.1)", borderRadius:6, padding:"4px 10px", color:"#9ca3af", fontSize:11, cursor:"pointer", fontFamily:"'Inter',sans-serif" }}>Oggi</button>
                    )}
                  </div>
                </div>

                {/* Griglia calendario */}
                <div className="card" style={{ padding:14, marginBottom:12 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:1, marginBottom:6 }}>
                    {["Lun","Mar","Mer","Gio","Ven","Sab","Dom"].map(d => (
                      <div key={d} style={{ textAlign:"center", fontSize:9, color:"#4b5563", padding:"4px 0", fontWeight:700, letterSpacing:".06em" }}>{d}</div>
                    ))}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2 }}>
                    {cells.map((d, i) => {
                      const acts = d ? actByDay[d] : null;
                      const planned = d ? planByDay[d] : null;
                      const isToday = isCurrentMonth && d === today.getDate();
                      const tss = d ? (tssByDay[d] || 0) : 0;
                      const isSelected = d === selectedCalDay;
                      const hasManual = acts?.some(a => a._manual);

                      return (
                        <div key={i} onClick={() => d && setSelectedCalDay(isSelected ? null : d)}
                          style={{ minHeight:60, background: d ? (acts?"rgba(252,76,2,.08)" : planned?"rgba(14,165,233,.05)" : "rgba(255,255,255,.02)") : "transparent", borderRadius:8, border:`1px solid ${isSelected?"#FC4C02":isToday?"rgba(252,76,2,.5)":d?"rgba(255,255,255,.07)":"transparent"}`, padding:"5px 6px", cursor:d?"pointer":"default", transition:"all .15s", position:"relative" }}>
                          {d && (
                            <>
                              <div style={{ fontSize:11, color:isToday?"#FC4C02":acts?"#e2e8f0":"#4b5563", fontWeight:isToday||isSelected?700:400, marginBottom:3 }}>{d}</div>
                              {/* TSS bar */}
                              {tss > 0 && (
                                <div style={{ height:2, background:"rgba(252,76,2,.15)", borderRadius:1, marginBottom:3, overflow:"hidden" }}>
                                  <div style={{ height:"100%", background:"#FC4C02", borderRadius:1, width:`${Math.min(100,(tss/maxTSS)*100)}%` }} />
                                </div>
                              )}
                              {acts?.slice(0,2).map((a,idx) => (
                                <div key={idx} style={{ fontSize:8, color: a._manual?"#22c55e":"#FC4C02", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", lineHeight:1.4 }}>
                                  {a._manual?"✎":"●"} {m2km(a.distance)}km
                                </div>
                              ))}
                              {!acts && planned && (
                                <div style={{ fontSize:8, color:ta(planned.type), lineHeight:1.4 }}>● {planned.type}</div>
                              )}
                              {/* TSS badge */}
                              {tss > 0 && (
                                <div style={{ fontSize:7, color:"#4b5563", marginTop:2 }}>{tss} TSS</div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Dettaglio giorno selezionato */}
                {selectedCalDay && (
                  <div className="card slide-in" style={{ padding:18, marginBottom:12, border:"1px solid rgba(252,76,2,.2)" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                      <span className="cond" style={{ fontSize:20, color:"#fff" }}>
                        {selectedCalDay} {new Date(calYear, calMonth).toLocaleDateString("it-IT",{month:"long"})} {calYear}
                      </span>
                      <div style={{ display:"flex", gap:8 }}>
                        <button onClick={()=>{ setAddRideDay(selectedCalDay); setShowAddRide(true); }} className="primary-btn" style={{ fontSize:12, padding:"7px 14px" }}>
                          + Aggiungi uscita
                        </button>
                        <button onClick={()=>setSelectedCalDay(null)} style={{ background:"none", border:"none", color:"#6b7280", cursor:"pointer", fontSize:16 }}>✕</button>
                      </div>
                    </div>

                    {/* Uscite del giorno */}
                    {selectedDayActs.length > 0 && (
                      <div style={{ marginBottom:selectedDayPlan ? 14 : 0 }}>
                        <div style={{ fontSize:10, color:"#FC4C02", fontWeight:700, textTransform:"uppercase", letterSpacing:".07em", marginBottom:8 }}>Uscite registrate</div>
                        {selectedDayActs.map((a,i) => (
                          <div key={i} style={{ background:"#0a1120", borderRadius:9, padding:"10px 14px", marginBottom:6 }}>
                            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                              <div>
                                <div style={{ fontSize:13, fontWeight:500, color:"#e2e8f0", marginBottom:4 }}>
                                  {a._manual && <span style={{ fontSize:10, color:"#22c55e", marginRight:6 }}>✎ manuale</span>}
                                  {a.name}
                                </div>
                                <div style={{ display:"flex", gap:10 }}>
                                  <span style={{ fontSize:11, color:"#FC4C02", fontFamily:"'JetBrains Mono',monospace" }}>{m2km(a.distance)}km</span>
                                  <span style={{ fontSize:11, color:"#0ea5e9", fontFamily:"'JetBrains Mono',monospace" }}>{Math.round(a.total_elevation_gain)}m↑</span>
                                  {a.moving_time > 0 && <span style={{ fontSize:11, color:"#6b7280", fontFamily:"'JetBrains Mono',monospace" }}>{s2hhmm(a.moving_time)}</span>}
                                  {a.average_watts && <span style={{ fontSize:11, color:"#f59e0b", fontFamily:"'JetBrains Mono',monospace" }}>{a.average_watts}W</span>}
                                </div>
                                {a._notes && <div style={{ fontSize:11, color:"#4b5563", marginTop:4, fontStyle:"italic" }}>"{a._notes}"</div>}
                              </div>
                              {calcTSS(a.moving_time, a.average_watts, ftp) > 0 && (
                                <span style={{ fontSize:11, color:"#a855f7", fontFamily:"'JetBrains Mono',monospace", background:"rgba(168,85,247,.1)", borderRadius:6, padding:"3px 8px" }}>
                                  {calcTSS(a.moving_time, a.average_watts, ftp)} TSS
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                        {selectedDayTSS > 0 && (
                          <div style={{ fontSize:12, color:"#4b5563", textAlign:"right" }}>
                            Totale giorno: <span style={{ color:"#a855f7", fontWeight:600 }}>{selectedDayTSS} TSS</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Piano del giorno */}
                    {selectedDayPlan && (
                      <div style={{ background:tc(selectedDayPlan.type), border:`1px solid ${ta(selectedDayPlan.type)}33`, borderRadius:10, padding:14 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                          <div>
                            <span className="pill" style={{ background:`${ta(selectedDayPlan.type)}18`, color:ta(selectedDayPlan.type), marginBottom:4 }}>{selectedDayPlan.type}</span>
                            <div style={{ fontWeight:600, color:"#fff", fontSize:14 }}>{selectedDayPlan.title}</div>
                          </div>
                          <button onClick={() => generateGPX(selectedDayPlan)} style={{ background:"rgba(255,255,255,.06)", border:"1px solid rgba(255,255,255,.1)", borderRadius:7, padding:"6px 12px", color:"#9ca3af", fontSize:11, cursor:"pointer", fontFamily:"'Inter',sans-serif", display:"flex", alignItems:"center", gap:5 }}>
                            <IC n="upload" s={12} /> GPX
                          </button>
                        </div>
                        <div style={{ display:"flex", gap:12, marginBottom:8, flexWrap:"wrap" }}>
                          {[[selectedDayPlan.duration,"🕐"],[selectedDayPlan.distance,"📍"],[selectedDayPlan.elevation,"⛰️"]].map(([v,ic]) => v && v !== "—" && (
                            <span key={ic} style={{ fontSize:11, color:"#94a3b8", fontFamily:"'JetBrains Mono',monospace" }}>{ic} {v}</span>
                          ))}
                          {selectedDayPlan.tss > 0 && <span style={{ fontSize:11, color:"#a855f7", fontFamily:"'JetBrains Mono',monospace" }}>TSS ~{selectedDayPlan.tss}</span>}
                        </div>
                        <p style={{ fontSize:12, color:"#94a3b8", lineHeight:1.6 }}>{selectedDayPlan.description}</p>
                      </div>
                    )}

                    {/* Giorno vuoto */}
                    {selectedDayActs.length === 0 && !selectedDayPlan && (
                      <div style={{ textAlign:"center", padding:"20px 0", color:"#374151" }}>
                        <div style={{ fontSize:28, marginBottom:8 }}>😴</div>
                        <div style={{ fontSize:13 }}>Nessuna attività — giorno di riposo</div>
                        <button onClick={()=>{ setAddRideDay(selectedCalDay); setShowAddRide(true); }} style={{ marginTop:12, background:"transparent", border:"1px solid rgba(255,255,255,.08)", borderRadius:8, padding:"8px 16px", color:"#6b7280", fontSize:12, cursor:"pointer", fontFamily:"'Inter',sans-serif" }}>
                          + Aggiungi uscita manuale
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Riepilogo mese */}
                <div className="card" style={{ padding:16 }}>
                  <div style={{ fontSize:11, fontWeight:600, color:"#fff", marginBottom:12, textTransform:"uppercase", letterSpacing:".06em" }}>📊 Riepilogo {new Date(calYear, calMonth).toLocaleDateString("it-IT",{month:"long"})}</div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
                    {[
                      { label:"Uscite", value: Object.values(actByDay).reduce((s,a)=>s+a.length,0), color:"#FC4C02" },
                      { label:"km totali", value: Object.values(actByDay).flat().reduce((s,a)=>s+(a.distance/1000),0).toFixed(0), color:"#0ea5e9" },
                      { label:"Dislivello", value: Object.values(actByDay).flat().reduce((s,a)=>s+a.total_elevation_gain,0).toFixed(0)+"m", color:"#22c55e" },
                      { label:"TSS totale", value: Object.values(tssByDay).reduce((s,t)=>s+t,0), color:"#a855f7" },
                    ].map(({label, value, color}) => (
                      <div key={label} style={{ background:"#0a1120", borderRadius:9, padding:"10px 12px", textAlign:"center" }}>
                        <div className="cond" style={{ fontSize:22, color, lineHeight:1 }}>{value}</div>
                        <div style={{ fontSize:10, color:"#4b5563", marginTop:3 }}>{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── NOTES TAB ── */}
          {tab === "notes" && (
            <div style={{ maxWidth:960, margin:"0 auto", padding:"20px 16px" }}>
              <div style={{ fontWeight:600, color:"#fff", marginBottom:16, display:"flex", alignItems:"center", gap:8 }}>
                <IC n="note" s={16} /> Diario di Allenamento
              </div>
              {selectedActivity && (
                <div className="card" style={{ padding:18, marginBottom:14, borderColor:"rgba(252,76,2,.2)" }}>
                  <div style={{ fontSize:10, color:"#4b5563", marginBottom:4, fontFamily:"'JetBrains Mono',monospace" }}>{fmtDate(selectedActivity.start_date)}</div>
                  <div style={{ fontSize:15, fontWeight:600, color:"#fff", marginBottom:8 }}>{selectedActivity.name}</div>
                  <div style={{ display:"flex", gap:12, marginBottom:12 }}>
                    <span className="mono" style={{ fontSize:11, color:"#FC4C02" }}>{m2km(selectedActivity.distance)}km</span>
                    <span className="mono" style={{ fontSize:11, color:"#0ea5e9" }}>{Math.round(selectedActivity.total_elevation_gain)}m↑</span>
                    <span className="mono" style={{ fontSize:11, color:"#f59e0b" }}>{selectedActivity.average_watts || "-"}W</span>
                    <span className="mono" style={{ fontSize:11, color:"#ef4444" }}>{selectedActivity.average_heartrate || "-"}bpm</span>
                  </div>
                  <textarea value={noteText} onChange={e=>setNoteText(e.target.value)} placeholder="Come ti sei sentito? Note tecniche, sensazioni, condizioni meteo, modifiche al piano..." style={{ minHeight:100 }} />
                  <div style={{ display:"flex", gap:8, marginTop:10 }}>
                    <button className="primary-btn" onClick={() => { setNotes(prev => ({...prev,[selectedActivity.id]:noteText})); setSelectedActivity(null); }} style={{ fontSize:13 }}>
                      <IC n="check" s={14} /> Salva nota
                    </button>
                    <button className="ghost-btn" onClick={()=>setSelectedActivity(null)} style={{ fontSize:13 }}>Annulla</button>
                  </div>
                </div>
              )}
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {activities.map(a => (
                  <div key={a.id} className="card card-hover" onClick={()=>{ setSelectedActivity(a); setNoteText(notes[a.id]||""); }} style={{ padding:"12px 14px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <div style={{ flex:1 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}>
                          <span style={{ fontSize:12, fontWeight:500, color:"#e2e8f0" }}>{a.name}</span>
                          {notes[a.id] && <span className="pill" style={{ background:"rgba(34,197,94,.1)", color:"#4ade80" }}>nota ✓</span>}
                        </div>
                        <div style={{ fontSize:10, color:"#374151", fontFamily:"'JetBrains Mono',monospace" }}>
                          {fmtDate(a.start_date)} · {m2km(a.distance)}km · {Math.round(a.total_elevation_gain)}m↑ {a.average_watts ? `· ${a.average_watts}W` : ""}
                        </div>
                        {notes[a.id] && <p style={{ fontSize:11, color:"#4b5563", marginTop:5, lineHeight:1.5, fontStyle:"italic" }}>"{notes[a.id].slice(0,100)}{notes[a.id].length>100?"…":""}"</p>}
                      </div>
                      <IC n="chevR" s={14} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── COACH CHAT TAB ── */}
          {tab === "coach" && (
            <div style={{ maxWidth:720, margin:"0 auto", padding:"20px 16px", display:"flex", flexDirection:"column", height:"calc(100vh - 130px)" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <IC n="chat" s={16} />
                  <span style={{ fontWeight:600, color:"#fff" }}>Coach AI</span>
                  {!plan && <span className="pill" style={{ background:"rgba(245,158,11,.1)", color:"#f59e0b" }}>Imposta un obiettivo per analisi completa</span>}
                </div>
                <button onClick={()=>setShowNutrition(n=>!n)} style={{ background:showNutrition?"rgba(34,197,94,.15)":"rgba(255,255,255,.05)", border:`1px solid ${showNutrition?"rgba(34,197,94,.3)":"rgba(255,255,255,.1)"}`, borderRadius:8, padding:"6px 12px", color:showNutrition?"#22c55e":"#6b7280", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'Inter',sans-serif" }}>
                  🥗 Nutrizione
                </button>
              </div>

              {/* NUTRITION TRACKER */}
              {showNutrition && (
                <div className="card" style={{ padding:20, marginBottom:16, border:"1px solid rgba(34,197,94,.2)" }}>
                  <div style={{ fontWeight:600, color:"#22c55e", marginBottom:16, fontSize:14 }}>🥗 Nutrition Tracker</div>
                  <div style={{ marginBottom:16 }}>
                    <label style={{ fontSize:12, color:"#6b7280", display:"block", marginBottom:8 }}>Distanza dell'uscita pianificata</label>
                    <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                      <input type="range" min={10} max={200} value={nutritionRideKm} onChange={e=>setNutritionRideKm(+e.target.value)} style={{ flex:1, accentColor:"#FC4C02", background:"transparent", border:"none", padding:0 }} />
                      <span className="cond" style={{ fontSize:28, color:"#FC4C02", minWidth:60 }}>{nutritionRideKm}km</span>
                    </div>
                  </div>
                  <div style={{ background:"rgba(34,197,94,.08)", border:"1px solid rgba(34,197,94,.15)", borderRadius:10, padding:"12px 16px", marginBottom:14, textAlign:"center" }}>
                    <div style={{ fontSize:11, color:"#6b7280", marginBottom:4 }}>Calorie stimate bruciate</div>
                    <div className="cond" style={{ fontSize:40, color:"#22c55e" }}>{nutritionCalories} <span style={{ fontSize:16 }}>kcal</span></div>
                  </div>
                  <div style={{ display:"grid", gap:8 }}>
                    {[
                      {
                        fase:"🌅 Pre-uscita (1-2h prima)",
                        color:"#f59e0b",
                        items: nutritionRideKm < 40
                          ? ["Banana o 2 biscotti secchi","Caffè o tè senza zucchero","150ml acqua"]
                          : nutritionRideKm < 80
                          ? ["Porridge con miele (60g avena)","Banana matura","200ml acqua + pizzico di sale"]
                          : ["Pasta o riso con poco condimento (150g)","Banana + miele","300ml acqua con sali"]
                      },
                      {
                        fase: nutritionRideKm < 60 ? "🚴 In sella (non necessario)" : "🚴 In sella (ogni 45-60min)",
                        color:"#0ea5e9",
                        items: nutritionRideKm < 60
                          ? ["Acqua a sufficienza","Nessun cibo solido necessario"]
                          : nutritionRideKm < 100
                          ? ["1 gel energetico o barretta ogni ora","500ml acqua/ora con elettroliti","Dattero o banana se preferisci naturale"]
                          : ["60-90g carboidrati/ora (gel + barrette)","750ml acqua/ora con sali minerali","Piccoli spuntini salati ogni 1.5h"]
                      },
                      {
                        fase:"💪 Post-uscita (entro 30min)",
                        color:"#a855f7",
                        items: nutritionRideKm < 50
                          ? ["Frutto fresco","Yogurt greco","Acqua a volontà"]
                          : ["20-30g proteine (yogurt greco, uova, shake)","Carboidrati semplici (frutta, pane)","Acqua + bevanda con elettroliti"]
                      },
                    ].map(({fase, color, items}) => (
                      <div key={fase} style={{ background:"#0a1120", borderRadius:9, padding:"12px 14px" }}>
                        <div style={{ fontSize:11, fontWeight:700, color, marginBottom:6 }}>{fase}</div>
                        {items.map((item,i) => (
                          <div key={i} style={{ fontSize:12, color:"#94a3b8", marginBottom:3, display:"flex", alignItems:"flex-start", gap:6 }}>
                            <span style={{ color, flexShrink:0 }}>·</span>{item}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Messages */}
              <div style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:10, paddingBottom:12 }}>
                {chatMessages.map((m,i) => (
                  <div key={i} style={{ display:"flex", justifyContent:m.role==="user"?"flex-end":"flex-start" }}>
                    {m.role==="assistant" && (
                      <div style={{ width:28, height:28, borderRadius:"50%", background:"rgba(252,76,2,.15)", border:"1px solid rgba(252,76,2,.25)", display:"flex", alignItems:"center", justifyContent:"center", marginRight:8, flexShrink:0, marginTop:4 }}>
                        <IC n="bike" s={13} />
                      </div>
                    )}
                    <div style={{ maxWidth:"75%", background:m.role==="user"?"rgba(252,76,2,.15)":"#0d1520", border:`1px solid ${m.role==="user"?"rgba(252,76,2,.25)":"rgba(255,255,255,.07)"}`, borderRadius:m.role==="user"?"14px 14px 4px 14px":"14px 14px 14px 4px", padding:"10px 14px" }}>
                      <p style={{ fontSize:13, color:"#e2e8f0", lineHeight:1.65, whiteSpace:"pre-wrap" }}>{m.content}</p>
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ width:28, height:28, borderRadius:"50%", background:"rgba(252,76,2,.1)", display:"flex", alignItems:"center", justifyContent:"center" }}><IC n="spin" s={13} /></div>
                    <div style={{ background:"#0d1520", border:"1px solid rgba(255,255,255,.07)", borderRadius:14, padding:"10px 14px" }}>
                      <div style={{ display:"flex", gap:4 }}>{[0,1,2].map(i=><div key={i} style={{width:5,height:5,borderRadius:"50%",background:"#4b5563",animation:`pulse 1s ease ${i*.2}s infinite`}}/>)}</div>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              {/* Quick prompts */}
              {chatMessages.length < 3 && (
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
                  {["Qual è la mia potenza soglia?","Come miglioro in salita?","Cosa mangio prima di un lungo?","Sto allenandomi troppo?","Come affronto un giorno di recupero?"].map(q => (
                    <button key={q} onClick={()=>{ setChatInput(q); }} style={{ background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.09)", borderRadius:20, padding:"5px 12px", fontSize:11, color:"#6b7280", cursor:"pointer", transition:"all .15s", whiteSpace:"nowrap" }}
                      onMouseEnter={e=>e.target.style.borderColor="rgba(252,76,2,.3)"}
                      onMouseLeave={e=>e.target.style.borderColor="rgba(255,255,255,.09)"}>
                      {q}
                    </button>
                  ))}
                </div>
              )}
              {/* Input */}
              <div style={{ display:"flex", gap:8 }}>
                <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); sendChat(); }}} placeholder="Chiedi qualcosa al tuo coach…" style={{ flex:1 }} />
                <button onClick={sendChat} disabled={!chatInput.trim()||chatLoading} style={{ background:chatInput.trim()&&!chatLoading?"#FC4C02":"#1f2937", color:chatInput.trim()&&!chatLoading?"#fff":"#4b5563", border:"none", borderRadius:9, width:44, height:42, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, transition:"all .2s" }}>
                  <IC n="send" s={16} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* BOTTOM NAV */}
        <nav style={{ borderTop:"1px solid rgba(255,255,255,.06)", background:"rgba(8,12,18,.97)", backdropFilter:"blur(16px)", display:"flex", justifyContent:"space-around", padding:"6px 0 8px", position:"sticky", bottom:0 }}>
          {[["dashboard","dash","Dashboard"],["plan","award","Piano"],["calendar","cal","Calendario"],["notes","note","Diario"],["coach","chat","Coach"],].map(([id,ic,label]) => (
            <button key={id} className={`nav-btn ${tab===id?"active":""}`} onClick={()=>setTab(id)}>
              <IC n={ic} s={20} />{label}
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}
