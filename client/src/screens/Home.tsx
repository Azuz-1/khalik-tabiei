import { useEffect, useMemo, useState } from "react";
import { actions, useGame } from "../net/socket.js";
import { errorText } from "../i18n/errors.js";
import { NAME_MAX, NAME_MIN, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "../../../shared/constants.js";

type Step = "home" | "code" | "name";

function readDeepLinkCode(): string | null {
  const m = location.pathname.match(/^\/join\/([A-Za-z0-9]+)/);
  if (!m) return null;
  const code = m[1]
    .toUpperCase()
    .split("")
    .filter((c) => ROOM_CODE_ALPHABET.includes(c))
    .join("");
  return code.length === ROOM_CODE_LENGTH ? code : null;
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
      <div className="screen">
        <div className="spacer" />
        <div className="center stack">
          <h1 className="brand">خلك طبيعي</h1>
          <p className="subtitle">واحد منكم عنده سؤال مختلف… جاوب كأن كل شيء طبيعي ولا تفضح نفسك.</p>
        </div>

        <div className="stack" style={{ marginTop: 24 }}>
          <button className="btn btn-primary" disabled={disabled} onClick={() => actions.createRoom()}>
            سو غرفة
          </button>
          <button
            className="btn btn-ghost"
            disabled={disabled}
            onClick={() => {
              setLocalErr(null);
              setStep("code");
            }}
          >
            ادخل غرفة
          </button>
        </div>
        <p className="helper">بدون تحميل وبدون تسجيل</p>

        <div className="card stack" style={{ marginTop: 20 }}>
          <div className="eyebrow">وش السالفة؟</div>
          <div className="stack" style={{ gap: 10 }}>
            <p className="subtitle" style={{ margin: 0 }}>١. كل اللاعبين يوصلهم سؤال متشابه — إلا شخص واحد يوصله سؤال مختلف.</p>
            <p className="subtitle" style={{ margin: 0 }}>٢. كل واحد يكتب إجابة قصيرة بدون ما يقول سؤاله.</p>
            <p className="subtitle" style={{ margin: 0 }}>٣. تظهر الإجابات، تناقشون، وبعدها كل واحد يصوّت مين يحس إنه المتخفي.</p>
            <p className="subtitle" style={{ margin: 0 }}>٤. بالنهاية نكشف المتخفي، السؤالين، ومين صوّت لمين.</p>
          </div>
        </div>

        <div className="card stack" style={{ marginTop: 14 }}>
          <div className="eyebrow">كيف تنحسب النقاط؟</div>
          <div className="stack" style={{ gap: 10 }}>
            <p className="subtitle" style={{ margin: 0 }}><strong>+١</strong> لكل لاعب عادي صوّت للمتخفي، بشرط إن المتخفي ينكشف بدون تعادل.</p>
            <p className="subtitle" style={{ margin: 0 }}><strong>+٢</strong> للمتخفي إذا نجا — يعني أعلى تصويت راح لشخص ثاني أو صار تعادل.</p>
            <p className="helper" style={{ margin: 0 }}>المتخفي ما ياخذ نقطة حتى لو صوّت صح. الهدف عنده ينجو من التصويت.</p>
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
        <div className="center stack">
          <h2 className="title">اكتب كود الغرفة</h2>
          <p className="subtitle">الكود مكوّن من ٥ حروف وأرقام</p>
        </div>
        <input
          className="input code"
          value={code}
          inputMode="text"
          autoCapitalize="characters"
          autoFocus
          maxLength={ROOM_CODE_LENGTH}
          placeholder="•••••"
          onChange={(e) => {
            const v = e.target.value
              .toUpperCase()
              .split("")
              .filter((c) => ROOM_CODE_ALPHABET.includes(c))
              .join("")
              .slice(0, ROOM_CODE_LENGTH);
            setCode(v);
            setLocalErr(null);
          }}
        />
        {localErr ? <p className="helper" style={{ color: "var(--bad)" }}>{localErr}</p> : null}
        <button className="btn btn-primary" disabled={!ok} onClick={() => setStep("name")}>التالي</button>
        <div className="spacer" />
      </div>
    );
  }

  const trimmed = name.replace(/\s+/g, " ").trim();
  const len = [...trimmed].length;
  const ok = len >= NAME_MIN && len <= NAME_MAX;
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
        value={name}
        autoFocus
        maxLength={NAME_MAX}
        placeholder="اسمك"
        onChange={(e) => {
          setName(e.target.value);
          setLocalErr(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && ok) actions.joinRoom(code, trimmed);
        }}
      />
      {localErr ? <p className="helper" style={{ color: "var(--bad)" }}>{localErr}</p> : null}
      <button className="btn btn-primary" disabled={!ok || disabled} onClick={() => actions.joinRoom(code, trimmed)}>
        دخول الغرفة
      </button>
      <div className="spacer" />
    </div>
  );
}
