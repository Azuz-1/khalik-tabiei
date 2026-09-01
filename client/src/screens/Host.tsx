import { useState } from "react";
import type { CategoryId, ClientView } from "../../../shared/types.js";
import { actions } from "../net/socket.js";
import { Qr } from "../components/Qr.js";
import { Players, Progress } from "../components/Players.js";
import { ResultBody, Scoreboard, roundLabel } from "../components/Bits.js";
import { MIN_PLAYERS, ROUND_OPTIONS } from "../../../shared/constants.js";

export function Host({ view }: { view: ClientView }) {
  switch (view.room.phase) {
    case "LOBBY":
      return <HostLobby view={view} />;
    case "QUESTION":
      return <HostGetReady view={view} />;
    case "ANSWERING":
      return <HostAnswering view={view} />;
    case "REVEAL":
      return <HostReveal view={view} title="الإجابات 👀" />;
    case "DISCUSSION":
      return <HostDiscussion view={view} />;
    case "VOTING":
      return <HostVoting view={view} />;
    case "RESULT":
      return <HostResult view={view} />;
    case "GAME_OVER":
      return <HostGameOver view={view} />;
    default:
      return <HostGetReady view={view} />;
  }
}

function CloseRoom() {
  return (
    <div className="footer-note">
      <button className="link-btn" onClick={() => confirm("إغلاق الغرفة للجميع؟") && actions.closeRoom()}>
        إغلاق الغرفة
      </button>
    </div>
  );
}

function HostLobby({ view }: { view: ClientView }) {
  const [copied, setCopied] = useState(false);
  const joinUrl = view.room.joinUrl;
  const active = view.players.filter((p) => p.connected).length;
  const cats = new Set(view.room.categories);
  const totalRounds = view.room.totalRounds || 5;
  const canStart = active >= MIN_PLAYERS && cats.size > 0;

  const toggleCat = (id: CategoryId) => {
    const next = new Set(cats);
    next.has(id) ? next.delete(id) : next.add(id);
    actions.setSettings({ categories: [...next] });
  };

  return (
    <div className="screen host">
      <div className="center" style={{ marginBottom: 8 }}>
        <h1 className="brand">خلك طبيعي</h1>
      </div>
      <div className="host-grid">
        <div className="card codebox">
          <span className="code-label">كود الغرفة</span>
          <span className="code-value">{view.room.code}</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(view.room.code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* ignore */
              }
            }}
          >
            {copied ? "تم النسخ ✓" : "نسخ الكود"}
          </button>
          <div style={{ marginTop: 18 }}>
            <Qr url={joinUrl} />
          </div>
          <span className="helper" style={{ direction: "ltr" }}>{joinUrl}</span>
        </div>

        <div className="stack">
          <div className="card">
            <div className="row between" style={{ marginBottom: 12 }}>
              <span className="code-label">اللاعبين</span>
              <span className="count-pill">
                {active} <small>/ {view.room.maxPlayers}</small>
              </span>
            </div>
            {view.players.length === 0 ? (
              <p className="subtitle">امسحوا الكود من جوالكم عشان تدخلون…</p>
            ) : (
              <Players players={view.players} canKick onKick={(uid) => actions.kick(uid)} />
            )}
          </div>

          <div className="card stack">
            <span className="code-label">عدد الجولات</span>
            <div className="rounds">
              {ROUND_OPTIONS.map((r) => (
                <button
                  key={r}
                  className={`round-opt${totalRounds === r ? " on" : ""}`}
                  onClick={() => actions.setSettings({ totalRounds: r })}
                >
                  {r}
                </button>
              ))}
            </div>
            <span className="code-label" style={{ marginTop: 8 }}>التصنيفات</span>
            <div className="cats">
              {view.room.availableCategories.map((c) => (
                <button key={c.id} className={`cat${cats.has(c.id) ? " on" : ""}`} onClick={() => toggleCat(c.id)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <button className="btn btn-primary" disabled={!canStart} onClick={() => actions.startGame()}>
            {active < MIN_PLAYERS ? `ننتظر ${MIN_PLAYERS - active} لاعبين` : cats.size === 0 ? "اختر تصنيف" : "ابدأ اللعبة"}
          </button>
        </div>
      </div>
      <CloseRoom />
    </div>
  );
}

function HostGetReady({ view }: { view: ClientView }) {
  return (
    <div className="screen host center">
      <div className="spacer" />
      <div className="eyebrow">{roundLabel(view)}</div>
      <h1 className="title" style={{ fontSize: "clamp(40px,6vw,80px)" }}>وزّعنا الأسئلة 👀</h1>
      <p className="subtitle">كل واحد يشوف السؤال في جواله… استعدوا</p>
      <div className="spacer" />
    </div>
  );
}

function HostAnswering({ view }: { view: ClientView }) {
  const p = view.answersProgress ?? { submitted: 0, total: 0 };
  return (
    <div className="screen host center stack">
      <div className="spacer" />
      <div className="eyebrow">{roundLabel(view)}</div>
      <h1 className="title">اكتبوا إجاباتكم</h1>
      <div className="card" style={{ maxWidth: 520, marginInline: "auto", width: "100%" }}>
        <Progress submitted={p.submitted} total={p.total} verb="جاوبوا" />
      </div>
      <p className="subtitle">السؤال في جوالكم — الإجابة سرّية لين يخلصون الكل</p>
      <div className="spacer" />
    </div>
  );
}

function HostReveal({ view, title }: { view: ClientView; title: string }) {
  return (
    <div className="screen host stack">
      <div className="center">
        <div className="eyebrow">{roundLabel(view)}</div>
        <h1 className="title">{title}</h1>
      </div>
      <div className="answers">
        {(view.reveal ?? []).map((a) => (
          <div key={a.uid} className="answer-card">
            <div className="answer-name">{a.name}</div>
            <div className="answer-value">{a.answer}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HostDiscussion({ view }: { view: ClientView }) {
  return (
    <div className="screen host stack">
      <div className="center">
        <div className="eyebrow">{roundLabel(view)}</div>
        <h1 className="title" style={{ fontSize: "clamp(38px,5vw,72px)" }}>دافع عن إجابتك 👀</h1>
        <p className="subtitle">لا تقول السؤال اللي وصلك — بس دافع عن جوابك</p>
      </div>
      <div className="answers">
        {(view.reveal ?? []).map((a) => (
          <div key={a.uid} className="answer-card">
            <div className="answer-name">{a.name}</div>
            <div className="answer-value">{a.answer}</div>
          </div>
        ))}
      </div>
      <button className="btn btn-primary" style={{ maxWidth: 480, marginInline: "auto" }} onClick={() => actions.startVoting()}>
        ابدأ التصويت
      </button>
      <CloseRoom />
    </div>
  );
}

function HostVoting({ view }: { view: ClientView }) {
  const p = view.votesProgress ?? { submitted: 0, total: 0 };
  return (
    <div className="screen host center stack">
      <div className="spacer" />
      <div className="eyebrow">{roundLabel(view)}</div>
      <h1 className="title">صوّتوا من جوالكم 🤫</h1>
      <div className="card" style={{ maxWidth: 520, marginInline: "auto", width: "100%" }}>
        <Progress submitted={p.submitted} total={p.total} verb="صوّتوا" />
      </div>
      <p className="subtitle">مين تحسّونه المتخفي؟</p>
      <div className="spacer" />
    </div>
  );
}

function HostResult({ view }: { view: ClientView }) {
  const isLast = view.room.currentRound >= view.room.totalRounds;
  return (
    <div className="screen host stack">
      <div className="host-grid">
        <div className="card">{view.result ? <ResultBody result={view.result} /> : null}</div>
        <div className="stack">
          <h2 className="title center">الترتيب</h2>
          {view.scoreboard ? <Scoreboard rows={view.scoreboard} /> : null}
          <button className="btn btn-primary" onClick={() => actions.nextRound()}>
            {isLast ? "النتيجة النهائية 🏁" : "الجولة الجاية"}
          </button>
        </div>
      </div>
    </div>
  );
}

function HostGameOver({ view }: { view: ClientView }) {
  const go = view.gameOver;
  const tied = (go?.winners.length ?? 0) > 1;
  return (
    <div className="screen host stack center">
      <h1 className="brand">خلصت اللعبة 🎉</h1>
      {go ? (
        <>
          <p className="subtitle">{tied ? "تعادل! 🔥" : "الفائز"}</p>
          <div className="impostor-name" style={{ fontSize: "clamp(40px,7vw,92px)" }}>
            {go.winners.map((winner) => winner.name).join("، ")} {tied ? "🔥" : "🏆"}
          </div>
          <div className="card" style={{ maxWidth: 560, marginInline: "auto", width: "100%" }}>
            <Scoreboard rows={go.ranking} />
          </div>
        </>
      ) : null}
      <div className="row" style={{ maxWidth: 560, marginInline: "auto", width: "100%" }}>
        <button className="btn btn-primary" onClick={() => actions.rematch()}>العبوا مرة ثانية</button>
        <button className="btn btn-ghost" onClick={() => actions.closeRoom()}>الرئيسية</button>
      </div>
    </div>
  );
}
