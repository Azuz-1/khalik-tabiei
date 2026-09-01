import { useEffect, useState } from "react";
import type { ClientView, GameMode } from "../../../shared/types.js";
import { actions } from "../net/socket.js";
import { Qr } from "../components/Qr.js";
import { Players, Progress } from "../components/Players.js";
import { ResultBody, Scoreboard, roundLabel } from "../components/Bits.js";
import { MIN_PLAYERS, ROUND_OPTIONS } from "../../../shared/constants.js";

export function Host({ view }: { view: ClientView }) {
  switch (view.room.phase) {
    case "LOBBY": return <HostLobby view={view} />;
    case "QUESTION": return <HostReady view={view} />;
    case "REVEAL": return <HostCountdown view={view} />;
    case "DISCUSSION": return <HostDiscussion view={view} />;
    case "VOTING": return <HostVoting view={view} />;
    case "RESULT": return <HostResult view={view} />;
    case "GAME_OVER": return <HostGameOver view={view} />;
    default: return <HostReady view={view} />;
  }
}
function CloseRoom() { return <div className="footer-note"><button className="link-btn" onClick={() => confirm("إغلاق الغرفة للجميع؟") && actions.closeRoom()}>إغلاق الغرفة</button></div>; }

function HostLobby({ view }: { view: ClientView }) {
  const [copied, setCopied] = useState(false); const active = view.players.filter((p) => p.connected).length;
  const modes = new Set(view.room.selectedModes); const totalRounds = view.room.totalRounds || 5; const canStart = active >= MIN_PLAYERS && modes.size > 0;
  const toggleMode = (id: GameMode) => { const next = new Set(modes); if (next.has(id)) { if (next.size === 1) return; next.delete(id); } else next.add(id); actions.setSettings({ selectedModes: [...next] }); };
  const modeSummary = modes.size === 1 ? `مختار: ${view.room.availableModes.find((m) => modes.has(m.id))?.label ?? ""} فقط` : "اللعبة بتنويع بينهم 🎲";
  return <div className="screen host"><div className="center" style={{ marginBottom: 8 }}><h1 className="brand">خلك طبيعي</h1></div><div className="host-grid">
    <div className="card codebox"><span className="code-label">كود الغرفة</span><span className="code-value">{view.room.code}</span><button className="btn btn-ghost btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(view.room.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}>{copied ? "تم النسخ ✓" : "نسخ الكود"}</button><div style={{ marginTop: 18 }}><Qr url={view.room.joinUrl} /></div><span className="helper" style={{ direction: "ltr" }}>{view.room.joinUrl}</span></div>
    <div className="stack"><div className="card"><div className="row between" style={{ marginBottom: 12 }}><span className="code-label">اللاعبين</span><span className="count-pill">{active} <small>/ {view.room.maxPlayers}</small></span></div>{view.players.length === 0 ? <p className="subtitle">امسحوا الكود من جوالكم عشان تدخلون…</p> : <Players players={view.players} canKick onKick={(uid) => actions.kick(uid)} />}</div>
      <div className="card stack"><span className="code-label">اختر طرق اللعب</span><div className="cats">{view.room.availableModes.map((m) => <button key={m.id} className={`cat${modes.has(m.id) ? " on" : ""}`} onClick={() => toggleMode(m.id)}><strong>{m.icon} {m.label}</strong><br/><small>{m.description}</small></button>)}</div><p className="helper center">{modeSummary}</p><span className="code-label" style={{ marginTop: 8 }}>عدد الجولات</span><div className="rounds">{ROUND_OPTIONS.map((r) => <button key={r} className={`round-opt${totalRounds === r ? " on" : ""}`} onClick={() => actions.setSettings({ totalRounds: r })}>{r}</button>)}</div></div>
      <button className="btn btn-primary" disabled={!canStart} onClick={() => actions.startGame()}>{active < MIN_PLAYERS ? `ننتظر ${MIN_PLAYERS - active} لاعبين` : "ابدأ اللعبة"}</button>
    </div></div><CloseRoom /></div>;
}

function HostReady({ view }: { view: ClientView }) { const p = view.readyProgress ?? { submitted: 0, total: view.players.length }; return <div className="screen host center stack"><div className="spacer"/><div className="eyebrow">{roundLabel(view)}</div><h1 className="title">شوفوا جوالاتكم 👀</h1><p className="subtitle">كل واحد يشوف سره ويضغط جاهز</p><div className="card" style={{ maxWidth: 520, marginInline: "auto", width: "100%" }}><Progress submitted={p.submitted} total={p.total} verb="جاهزين" /></div><div className="spacer"/></div>; }

function HostCountdown({ view }: { view: ClientView }) {
  const [, tick] = useState(0); useEffect(() => { const id = window.setInterval(() => tick((x) => x + 1), 100); return () => clearInterval(id); }, []);
  const remaining = Math.max(0, (view.room.phaseEndsAt ?? Date.now()) - Date.now()); const sec = Math.ceil(Math.max(0, remaining - 900) / 1000);
  const action = view.challenge?.mode === "POINT" ? "أشر!" : view.challenge?.mode === "NUMBER" ? "ورّونا!" : "الحين!";
  return <div className="screen host center stack"><div className="spacer"/><div className="eyebrow">{roundLabel(view)}</div><h1 className="title" style={{ fontSize: "clamp(64px,15vw,160px)" }}>{remaining <= 900 ? action : Math.max(1, Math.min(3, sec))}</h1><p className="subtitle">نفّذوا بنفس اللحظة وثبّتوا الحركة شوي</p><div className="spacer"/></div>;
}
function HostDiscussion({ view }: { view: ClientView }) { return <div className="screen host center stack"><div className="spacer"/><div className="eyebrow">{roundLabel(view)}</div><h1 className="title">مين تصرفه مو طبيعي؟ 👀</h1><p className="subtitle">تناقشوا شوي… وبعدين افتحوا التصويت</p><button className="btn btn-primary" style={{ maxWidth: 480 }} onClick={() => actions.startVoting()}>ابدأ التصويت</button><div className="spacer"/><CloseRoom /></div>; }
function HostVoting({ view }: { view: ClientView }) { const p = view.votesProgress ?? { submitted: 0, total: 0 }; return <div className="screen host center stack"><div className="spacer"/><div className="eyebrow">{roundLabel(view)}</div><h1 className="title">صوّتوا من جوالكم 🤫</h1><div className="card" style={{ maxWidth: 520, marginInline: "auto", width: "100%" }}><Progress submitted={p.submitted} total={p.total} verb="صوّتوا" /></div><p className="subtitle">مين تحسّونه المتخفي؟</p><div className="spacer"/></div>; }
function HostResult({ view }: { view: ClientView }) { const result = view.result; const next = result?.roundComplete ? (view.room.currentRound >= view.room.totalRounds ? "النتيجة النهائية 🏁" : "الجولة الجاية") : `التحدي ${Math.min((result?.challengeIndex ?? 1) + 1, 3)} 👀`; return <div className="screen host stack"><div className="host-grid"><div className="card">{result ? <ResultBody result={result} /> : null}</div><div className="stack"><h2 className="title center">الترتيب</h2>{view.scoreboard ? <Scoreboard rows={view.scoreboard} /> : null}<button className="btn btn-primary" onClick={() => actions.nextRound()}>{next}</button></div></div></div>; }
function HostGameOver({ view }: { view: ClientView }) { const go = view.gameOver; const tied = (go?.winners.length ?? 0) > 1; return <div className="screen host stack center"><h1 className="brand">خلصت اللعبة 🎉</h1>{go ? <><p className="subtitle">{tied ? "تعادل! 🔥" : "الفائز"}</p><div className="impostor-name" style={{ fontSize: "clamp(40px,7vw,92px)" }}>{go.winners.map((w) => w.name).join("، ")} {tied ? "🔥" : "🏆"}</div><div className="card" style={{ maxWidth: 560, marginInline: "auto", width: "100%" }}><Scoreboard rows={go.ranking} /></div></> : null}<div className="row" style={{ maxWidth: 560, marginInline: "auto", width: "100%" }}><button className="btn btn-primary" onClick={() => actions.rematch()}>العبوا مرة ثانية</button><button className="btn btn-ghost" onClick={() => actions.closeRoom()}>الرئيسية</button></div></div>; }
