import { useState } from "react";
import type { ClientView, GameModeInfo } from "../../../shared/types.js";
import { actions } from "../net/socket.js";
import { ResultBody, roundLabel } from "../components/Bits.js";
import { Players } from "../components/Players.js";

export function Player({ view }: { view: ClientView }) {
  switch (view.room.phase) {
    case "LOBBY":
      return <PlayerLobby view={view} />;
    case "QUESTION":
      return <PlayerPrompt view={view} />;
    case "COUNTDOWN":
    case "ACTION":
    case "HOLD":
      return <PlayerWatchScreen />;
    case "PROMPT_REVEAL":
      return <PlayerPromptReveal view={view} />;
    case "DISCUSSION":
      return <PlayerDiscussion view={view} />;
    case "VOTING":
      return <PlayerVote view={view} />;
    case "RESULT":
      return <PlayerResult view={view} />;
    case "GAME_OVER":
      return <PlayerGameOver view={view} />;
    default:
      return <PlayerWatchScreen />;
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

function modeInfo(view: ClientView): GameModeInfo | undefined {
  return view.room.availableModes.find((candidate) => candidate.id === view.challenge?.mode);
}

function modeTitle(view: ClientView): string {
  const mode = modeInfo(view);
  return mode ? `${mode.icon} ${mode.label}` : "";
}

function PlayerLobby({ view }: { view: ClientView }) {
  const selectedModes = view.room.availableModes.filter((mode) =>
    view.room.selectedModes.includes(mode.id),
  );

  return (
    <div className="screen">
      <div className="spacer" />
      <div className="center stack">
        <h1 className="title" style={{ fontSize: "clamp(30px,9vw,44px)" }}>
          أنت داخل 🎉
        </h1>
        <span className="pill-note" style={{ direction: "ltr", marginInline: "auto" }}>
          غرفة {view.room.code}
        </span>
        <p className="subtitle">ننتظر المضيف يبدأ اللعبة…</p>
        <div className="players">
          {selectedModes.map((mode) => (
            <span className="chip" key={mode.id}>
              {mode.icon} {mode.label}
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="code-label" style={{ marginBottom: 10 }}>
          اللاعبين ({view.players.length})
        </div>
        <Players players={view.players} selfUid={view.self.uid} />
      </div>

      <div className="spacer" />
      <LeaveLink />
    </div>
  );
}

function PlayerPrompt({ view }: { view: ClientView }) {
  const ready = view.myReady === true;
  const mode = modeInfo(view);

  if (ready) return <PlayerWatchScreen />;

  return (
    <div className="screen">
      <div className="center">
        <div className="eyebrow">{roundLabel(view)}</div>
      </div>
      <div className="spacer" />
      <div className="q-card stack">
        <span className="eyebrow">{modeTitle(view)}</span>
        {view.isImpostor ? (
          <>
            <div className="q-text">أنت المتخفي 👀</div>
            <p className="subtitle center" style={{ marginBottom: 0 }}>
              ما تعرف المطلوب.
            </p>
            <p className="subtitle center" style={{ marginTop: 0 }}>
              {mode?.impostorInstruction ?? "راقب الباقين وخلك طبيعي."}
            </p>
          </>
        ) : (
          <>
            <div className="q-text">{view.myPrompt?.text ?? "…"}</div>
            <p className="subtitle center" style={{ marginBottom: 0 }}>
              {mode?.normalInstruction}
            </p>
          </>
        )}
      </div>
      <button className="btn btn-primary" onClick={() => actions.markReady()}>
        جاهز
      </button>
      <div className="spacer" />
    </div>
  );
}

function PlayerWatchScreen() {
  return (
    <div className="screen center stack">
      <div className="spacer" />
      <h1 className="title" style={{ fontSize: "clamp(38px,11vw,58px)" }}>
        طالع الشاشة 👀
      </h1>
      <div className="spacer" />
    </div>
  );
}

function PlayerPromptReveal({ view }: { view: ClientView }) {
  return (
    <div className="screen center stack">
      <div className="spacer" />
      <div className="eyebrow">المطلوب كان…</div>
      <div className="q-text">{view.publicPrompt?.text ?? "…"}</div>
      <div className="spacer" />
    </div>
  );
}

function PlayerDiscussion({ view }: { view: ClientView }) {
  return (
    <div className="screen">
      <div className="center">
        <div className="eyebrow">{roundLabel(view)}</div>
      </div>
      <div className="spacer" />
      <div className="q-card stack">
        <span className="eyebrow">المطلوب كان</span>
        <div className="q-text" style={{ fontSize: "clamp(22px,6vw,30px)" }}>
          {view.publicPrompt?.text ?? "…"}
        </div>
      </div>
      <h2 className="title center" style={{ fontSize: "clamp(28px,8vw,42px)" }}>
        مين تصرفه مو طبيعي؟ 👀
      </h2>
      <p className="subtitle center">تناقشوا… وبعدها المضيف يفتح التصويت</p>
      <div className="spacer" />
      <LeaveLink />
    </div>
  );
}

function PlayerVote({ view }: { view: ClientView }) {
  const [picked, setPicked] = useState<string | null>(null);
  const targets = view.voteTargets ?? [];
  const progress = view.votesProgress ?? { submitted: 0, total: 0, requiredVotes: 0 };

  if (view.myVoteSubmitted) {
    return (
      <div className="screen">
        <div className="spacer" />
        <div className="center stack">
          <div className="ok-badge">تم تسجيل صوتك 🤫</div>
          <p className="subtitle">
            ننتظر الباقين… <span className="num-ltr">{progress.submitted}/{progress.total}</span>
          </p>
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
        <p className="helper">
          يحتاج المتخفي {progress.requiredVotes} أصوات أو أكثر عشان ينكشف
        </p>
      </div>
      <div className="vote-list">
        {targets.map((target) => (
          <button
            key={target.uid}
            className={`vote-opt${picked === target.uid ? " picked" : ""}`}
            onClick={() => setPicked(target.uid)}
          >
            <span>{target.name}</span>
            {picked === target.uid ? <span>✓</span> : null}
          </button>
        ))}
      </div>
      <button
        className="btn btn-primary"
        disabled={!picked}
        onClick={() => picked && actions.submitVote(picked)}
      >
        أكّد التصويت
      </button>
      <p className="helper">التصويت سرّي وما تقدر تغيّره بعدين</p>
      <div className="spacer" />
    </div>
  );
}

function PlayerResult({ view }: { view: ClientView }) {
  return (
    <div className="screen">
      <div className="spacer" />
      {view.result ? (
        <div className="card">
          <ResultBody result={view.result} />
        </div>
      ) : null}
      <p className="subtitle center">
        {view.result?.roundComplete
          ? "ننتظر المضيف للجولة الجاية…"
          : "نفس المتخفي مكمل… ننتظر التحدي الجاي 👀"}
      </p>
      <div className="spacer" />
    </div>
  );
}

function PlayerGameOver({ view }: { view: ClientView }) {
  const gameOver = view.gameOver;

  return (
    <div className="screen">
      <div className="spacer" />
      <div className="center stack">
        <h1 className="brand" style={{ fontSize: "clamp(34px,11vw,56px)" }}>
          خلصت اللعبة 🎉
        </h1>
        {gameOver ? (
          <>
            <p className="subtitle">
              مسكتوا المتخفي في {gameOver.caughtRounds} من {gameOver.totalRounds} جولات 👏
            </p>
            <div className="card stack" style={{ width: "100%" }}>
              <div className="row between" style={{ fontWeight: 900 }}>
                <span>✅ انكشف</span>
                <span>{gameOver.caughtRounds}</span>
              </div>
              <div className="row between" style={{ fontWeight: 900 }}>
                <span>😈 نجا</span>
                <span>{gameOver.escapedRounds}</span>
              </div>
            </div>
          </>
        ) : null}
        <p className="subtitle center">ننتظر المضيف يبدأ لعبة جديدة أو يقفل الغرفة</p>
      </div>
      <div className="spacer" />
      <LeaveLink />
    </div>
  );
}
