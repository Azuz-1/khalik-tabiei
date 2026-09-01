import { useState } from "react";
import type { ClientView } from "../../../shared/types.js";
import { actions } from "../net/socket.js";
import { ResultBody, Scoreboard, roundLabel } from "../components/Bits.js";
import { Players } from "../components/Players.js";
import { ANSWER_MAX } from "../../../shared/constants.js";

export function Player({ view }: { view: ClientView }) {
  switch (view.room.phase) {
    case "LOBBY":
      return <PlayerLobby view={view} />;
    case "QUESTION":
      return <PlayerQuestion view={view} ready />;
    case "ANSWERING":
      return <PlayerAnswer view={view} />;
    case "REVEAL":
      return <PlayerWatch view={view} title="ظهرت الإجابات 👀" note="شوفوا الشاشة الكبيرة" />;
    case "DISCUSSION":
      return <PlayerDiscussion view={view} />;
    case "VOTING":
      return <PlayerVote view={view} />;
    case "RESULT":
      return <PlayerResult view={view} />;
    case "GAME_OVER":
      return <PlayerGameOver view={view} />;
    default:
      return <PlayerQuestion view={view} ready />;
  }
}

function LeaveLink() {
  return (
    <div className="footer-note">
      <button className="link-btn" onClick={() => actions.leaveRoom()}>
        مغادرة الغرفة
      </button>
    </div>
  );
}

function PlayerLobby({ view }: { view: ClientView }) {
  return (
    <div className="screen">
      <div className="spacer" />
      <div className="center stack">
        <h1 className="title" style={{ fontSize: "clamp(30px,9vw,44px)" }}>أنت داخل 🎉</h1>
        <span className="pill-note" style={{ direction: "ltr", marginInline: "auto" }}>
          غرفة {view.room.code}
        </span>
        <p className="subtitle">ننتظر المضيف يبدأ اللعبة…</p>
      </div>
      <div className="card">
        <div className="code-label" style={{ marginBottom: 10 }}>اللاعبين ({view.players.length})</div>
        <Players players={view.players} selfUid={view.self.uid} />
      </div>
      <div className="spacer" />
      <LeaveLink />
    </div>
  );
}

function PlayerQuestion({ view, ready }: { view: ClientView; ready?: boolean }) {
  return (
    <div className="screen">
      <div className="center">
        <div className="eyebrow">{roundLabel(view)}</div>
      </div>
      <div className="spacer" />
      <div className="q-card stack">
        <span className="eyebrow">سؤالك 👀</span>
        <div className="q-text">{view.myQuestion ?? "…"}</div>
      </div>
      <p className="helper">{ready ? "استعد… بنفتح لك الكتابة بعد ثواني" : ""}</p>
      <div className="spacer" />
    </div>
  );
}

function PlayerAnswer({ view }: { view: ClientView }) {
  const [answer, setAnswer] = useState("");
  const submitted = view.myAnswerSubmitted;
  const trimmed = answer.replace(/\s+/g, " ").trim();
  const ok = [...trimmed].length >= 1 && [...trimmed].length <= ANSWER_MAX;

  if (submitted) {
    const p = view.answersProgress ?? { submitted: 0, total: 0 };
    return (
      <div className="screen">
        <div className="spacer" />
        <div className="center stack">
          <div className="ok-badge">تم تسجيل إجابتك ✅</div>
          <p className="subtitle">ننتظر الباقين… <span className="num-ltr">{p.submitted}/{p.total}</span></p>
        </div>
        <div className="spacer" />
        <LeaveLink />
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="center">
        <div className="eyebrow">{roundLabel(view)}</div>
      </div>
      <div className="q-card stack">
        <span className="eyebrow">سؤالك 👀</span>
        <div className="q-text">{view.myQuestion ?? "…"}</div>
      </div>
      <input
        className="input"
        value={answer}
        autoFocus
        maxLength={ANSWER_MAX}
        placeholder="اكتب إجابة قصيرة"
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && ok) actions.submitAnswer(trimmed);
        }}
      />
      <button className="btn btn-primary" disabled={!ok} onClick={() => actions.submitAnswer(trimmed)}>
        إرسال الإجابة
      </button>
      <div className="spacer" />
    </div>
  );
}

function PlayerWatch({ view, title, note }: { view: ClientView; title: string; note: string }) {
  return (
    <div className="screen">
      <div className="center"><div className="eyebrow">{roundLabel(view)}</div></div>
      <div className="spacer" />
      <div className="center stack">
        <h1 className="title">{title}</h1>
        <p className="subtitle">{note}</p>
      </div>
      {view.reveal ? (
        <div className="card">
          <div className="players">
            {view.reveal.map((a) => (
              <span key={a.uid} className="chip"><span className="dot" />{a.name}: {a.answer}</span>
            ))}
          </div>
        </div>
      ) : null}
      <div className="spacer" />
    </div>
  );
}

function PlayerDiscussion({ view }: { view: ClientView }) {
  return (
    <div className="screen">
      <div className="center"><div className="eyebrow">{roundLabel(view)}</div></div>
      <div className="spacer" />
      <div className="q-card stack">
        <span className="eyebrow">دافع عن إجابتك 👀</span>
        <div className="q-text" style={{ fontSize: "clamp(22px,6vw,30px)" }}>لا تقول السؤال اللي وصلك</div>
      </div>
      <p className="subtitle center">تناقشوا… وبعدها المضيف يفتح التصويت</p>
      <div className="spacer" />
      <LeaveLink />
    </div>
  );
}

function PlayerVote({ view }: { view: ClientView }) {
  const [picked, setPicked] = useState<string | null>(null);
  const targets = view.voteTargets ?? [];

  if (view.myVoteSubmitted) {
    const p = view.votesProgress ?? { submitted: 0, total: 0 };
    return (
      <div className="screen">
        <div className="spacer" />
        <div className="center stack">
          <div className="ok-badge">تم تسجيل صوتك 🤫</div>
          <p className="subtitle">ننتظر الباقين… <span className="num-ltr">{p.submitted}/{p.total}</span></p>
        </div>
        <div className="spacer" />
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="center stack">
        <div className="eyebrow">{roundLabel(view)}</div>
        <h1 className="title">مين تحس المتخفي؟</h1>
      </div>
      <div className="vote-list">
        {targets.map((t) => (
          <button
            key={t.uid}
            className={`vote-opt${picked === t.uid ? " picked" : ""}`}
            onClick={() => setPicked(t.uid)}
          >
            <span>{t.name}</span>
            {picked === t.uid ? <span>✓</span> : null}
          </button>
        ))}
      </div>
      <button className="btn btn-primary" disabled={!picked} onClick={() => picked && actions.submitVote(picked)}>
        أكّد التصويت
      </button>
      <p className="helper">التصويت سرّي وما تقدر تغيّره بعدين</p>
      <div className="spacer" />
    </div>
  );
}

function PlayerResult({ view }: { view: ClientView }) {
  const myDelta = view.result?.roundScores.find((r) => r.uid === view.self.uid)?.delta ?? 0;
  return (
    <div className="screen">
      {view.result ? (
        <div className="card"><ResultBody result={view.result} /></div>
      ) : null}
      {myDelta > 0 ? <div className="ok-badge">+{myDelta} لك هالجولة 🎯</div> : null}
      {view.scoreboard ? (
        <div className="card">
          <div className="code-label" style={{ marginBottom: 10 }}>الترتيب</div>
          <Scoreboard rows={view.scoreboard} selfUid={view.self.uid} />
        </div>
      ) : null}
      <p className="subtitle center">ننتظر المضيف للجولة الجاية…</p>
    </div>
  );
}

function PlayerGameOver({ view }: { view: ClientView }) {
  const go = view.gameOver;
  const mine = go?.ranking.find((r) => r.uid === view.self.uid);
  const tied = (go?.winners.length ?? 0) > 1;
  return (
    <div className="screen">
      <div className="center stack">
        <h1 className="brand" style={{ fontSize: "clamp(34px,11vw,56px)" }}>خلصت اللعبة 🎉</h1>
        {go ? (
          <div className="impostor-name" style={{ fontSize: "clamp(28px,8vw,44px)" }}>
            {tied ? "تعادل! 🔥 " : "الفائز: "}
            {go.winners.map((winner) => winner.name).join("، ")}{tied ? "" : " 🏆"}
          </div>
        ) : null}
        {mine ? <p className="subtitle">ترتيبك: {mine.rank} — {mine.score} نقطة</p> : null}
      </div>
      {go ? (
        <div className="card"><Scoreboard rows={go.ranking} selfUid={view.self.uid} /></div>
      ) : null}
      <p className="subtitle center">ننتظر المضيف يبدأ جولة جديدة أو يقفل الغرفة</p>
      <LeaveLink />
    </div>
  );
}
