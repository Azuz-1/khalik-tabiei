import { useEffect, useMemo, useState } from "react";
import { unlockAudio } from "../audio/gameAudio.js";
import { actions, useGame } from "../net/socket.js";
import { errorText } from "../i18n/errors.js";
import {
  GAME_MODES,
  NAME_MAX,
  NAME_MIN,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from "../../../shared/constants.js";

type Step = "home" | "code" | "name";

function readDeepLinkCode(): string | null {
  const match = location.pathname.match(/^\/join\/([A-Za-z0-9]+)/);
  if (!match) return null;
  const code = match[1]
    .toUpperCase()
    .split("")
    .filter((char) => ROOM_CODE_ALPHABET.includes(char))
    .join("");
  return code.length === ROOM_CODE_LENGTH ? code : null;
}

function cleanDisplayName(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function graphemeLength(value: string): number {
  if (Intl.Segmenter) return [...new Intl.Segmenter("ar", { granularity: "grapheme" }).segment(value)].length;
  return [...value].length;
}

function hasVisibleContent(value: string): boolean {
  return value.replace(/\s/gu, "").replace(/\p{Default_Ignorable_Code_Point}/gu, "").length > 0;
}

export function Home() {
  const { error, status } = useGame();
  const deepCode = useMemo(readDeepLinkCode, []);
  const [step, setStep] = useState<Step>(deepCode ? "name" : "home");
  const [code, setCode] = useState(deepCode ?? "");
  const [name, setName] = useState("");
  const [localErr, setLocalErr] = useState<string | null>(null);

  useEffect(() => {
    if (error) setLocalErr(errorText(error.code));
  }, [error]);

  const disabled = status !== "online";

  if (step === "home") {
    return (
      <div className="screen home-screen">
        <div className="spacer" />
        <div className="center stack home-hero">
          <h1 className="brand">خلك طبيعي</h1>
          <p className="subtitle">واحد منكم متخفي وما يعرف المطلوب. امسكوه قبل لا يخلّص التحدّيات.</p>
        </div>

        <div className="stack home-actions">
          <button
            className="btn btn-primary"
            disabled={disabled}
            onClick={() => {
              void unlockAudio();
              actions.createRoom();
            }}
          >
            سوّ غرفة
          </button>
          <button className="btn btn-ghost" disabled={disabled} onClick={() => { setLocalErr(null); setStep("code"); }}>
            ادخل غرفة
          </button>
          <p className="helper" style={{ margin: 0 }}>بدون تحميل ولا تسجيل</p>
        </div>

        <section className="stack mode-explainer" aria-labelledby="mode-explainer-title">
          <div className="center stack" style={{ gap: 6 }}>
            <div className="eyebrow">طرق اللعب</div>
            <h2 className="title" id="mode-explainer-title">اعرف طرق اللعب قبل تبدأ</h2>
          </div>
          <div className="mode-explainer-grid">
            {GAME_MODES.map((mode) => (
              <article className="mode-explainer-card" key={mode.id}>
                <div className="mode-explainer-icon" aria-hidden="true">{mode.icon}</div>
                <h3>{mode.fullLabel}</h3>
                <div className="mode-explainer-copy">
                  {mode.onboardingInstructions.map((instruction) => <p key={instruction}>{instruction}</p>)}
                </div>
              </article>
            ))}
          </div>
        </section>

        <div className="card stack home-story">
          <div className="eyebrow">وش السالفة؟</div>
          <div className="stack" style={{ gap: 10 }}>
            <p className="subtitle" style={{ margin: 0 }}>١. المضيف يختار طرق اللعب، وكل تحدّي ياخذ طريقة من اختياراته.</p>
            <p className="subtitle" style={{ margin: 0 }}>٢. كل اللاعبين يشوفون المطلوب بجوالهم، إلا المتخفي. هو يعرف إنه المتخفي، بس ما يعرف المطلوب.</p>
            <p className="subtitle" style={{ margin: 0 }}>٣. وقت العد، الكل يطالع الشاشة وينفذ الحركة بنفس اللحظة.</p>
            <p className="subtitle" style={{ margin: 0 }}>٤. بعدها ينكشف المطلوب، تتناقشون، وتصوّتون.</p>
            <p className="subtitle" style={{ margin: 0 }}>٥. إذا أكثر من نصف اللاعبين صوّتوا على المتخفي، ينكشف. إذا نجا، يكمل للتحدّي اللي بعده، وإذا انتهت الجولة تبدأ جولة جديدة.</p>
          </div>
        </div>
        <div className="spacer" />
      </div>
    );
  }

  if (step === "code") {
    const ok = code.length === ROOM_CODE_LENGTH;
    return (
      <div className="screen">
        <button className="link-btn" onClick={() => setStep("home")}>← رجوع</button>
        <div className="spacer" />
        <div className="center stack"><h2 className="title">اكتب كود الغرفة</h2><p className="subtitle">الكود مكوّن من ٥ حروف وأرقام</p></div>
        <input
          className="input code"
          aria-label="كود الغرفة"
          value={code}
          inputMode="text"
          autoCapitalize="characters"
          autoFocus
          maxLength={ROOM_CODE_LENGTH}
          placeholder="•••••"
          onChange={(event) => {
            const value = event.target.value.toUpperCase().split("").filter((char) => ROOM_CODE_ALPHABET.includes(char)).join("").slice(0, ROOM_CODE_LENGTH);
            setCode(value);
            setLocalErr(null);
          }}
        />
        {localErr ? <p className="helper" role="alert" style={{ color: "var(--bad)" }}>{localErr}</p> : null}
        <button className="btn btn-primary" disabled={!ok} onClick={() => setStep("name")}>التالي</button>
        <div className="spacer" />
      </div>
    );
  }

  const cleanedName = cleanDisplayName(name);
  const length = graphemeLength(cleanedName);
  const ok = hasVisibleContent(cleanedName) && length >= NAME_MIN && length <= NAME_MAX;

  return (
    <div className="screen">
      <button className="link-btn" onClick={() => setStep(deepCode ? "home" : "code")}>← رجوع</button>
      <div className="spacer" />
      <div className="center stack">
        <h2 className="title">وش نناديك؟</h2>
        <span className="pill-note" style={{ direction: "ltr" }}>غرفة {code}</span>
      </div>
      <input
        className="input"
        aria-label="اسمك"
        value={name}
        autoFocus
        placeholder="اسمك"
        onChange={(event) => { setName(event.target.value); setLocalErr(null); }}
        onKeyDown={(event) => { if (event.key === "Enter" && ok) actions.joinRoom(code, cleanedName); }}
      />
      <p className="helper" aria-live="polite">الاسم من {NAME_MIN} إلى {NAME_MAX} محرفًا مرئيًا؛ الإيموجي المركب يُحسب محرفًا واحدًا.</p>
      {localErr ? <p className="helper" role="alert" style={{ color: "var(--bad)" }}>{localErr}</p> : null}
      <button className="btn btn-primary" disabled={!ok || disabled} onClick={() => actions.joinRoom(code, cleanedName)}>دخول الغرفة</button>
      <div className="spacer" />
    </div>
  );
}
