import { useEffect, useMemo, useState } from "react";
import { actions, useGame } from "../net/socket.js";
import { errorText } from "../i18n/errors.js";
import {
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
          <p className="subtitle">
            واحد منكم هو المتخفي. يعرف دوره، لكن ما يعرف المطلوب ويحاول يقلّدكم
            وقت الحركة بدون ما ينكشف.
          </p>
        </div>

        <div className="stack" style={{ marginTop: 24 }}>
          <button
            className="btn btn-primary"
            disabled={disabled}
            onClick={() => actions.createRoom()}
          >
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
            <p className="subtitle" style={{ margin: 0 }}>
              ١. المضيف يختار من 🙋 ارفع، 👉 أشر، و🔢 كم؟ وكل جولة تستخدم مود واحد ثابت.
            </p>
            <p className="subtitle" style={{ margin: 0 }}>
              ٢. الباقين يشوفون المهمة في الجوال. المتخفي يعرف أنه المتخفي، لكنه ما يشوف المطلوب.
            </p>
            <p className="subtitle" style={{ margin: 0 }}>
              ٣. عند العد تنفذون الحركة كلّكم بنفس اللحظة، تثبّتونها شوي، وبعدها ينكشف المطلوب وتناقشون.
            </p>
            <p className="subtitle" style={{ margin: 0 }}>
              ٤. تحتاجون أكثر من نصف الأصوات على المتخفي عشان ينكشف. عندكم حتى ٣ تحديات بنفس المتخفي.
            </p>
            <p className="subtitle" style={{ margin: 0 }}>
              ٥. إذا انكشف أو خلصت تحدياته، تبدأ جولة جديدة بمتخفي جديد. اللعبة تستمر لين يخلص عدد الجولات.
            </p>
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
        <button className="link-btn" onClick={() => setStep("home")}>
          ← رجوع
        </button>
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
          onChange={(event) => {
            const value = event.target.value
              .toUpperCase()
              .split("")
              .filter((char) => ROOM_CODE_ALPHABET.includes(char))
              .join("")
              .slice(0, ROOM_CODE_LENGTH);
            setCode(value);
            setLocalErr(null);
          }}
        />
        {localErr ? (
          <p className="helper" style={{ color: "var(--bad)" }}>
            {localErr}
          </p>
        ) : null}
        <button className="btn btn-primary" disabled={!ok} onClick={() => setStep("name")}>
          التالي
        </button>
        <div className="spacer" />
      </div>
    );
  }

  const trimmed = name.replace(/\s+/g, " ").trim();
  const length = [...trimmed].length;
  const ok = length >= NAME_MIN && length <= NAME_MAX;

  return (
    <div className="screen">
      <button className="link-btn" onClick={() => setStep(deepCode ? "home" : "code")}>
        ← رجوع
      </button>
      <div className="spacer" />
      <div className="center stack">
        <h2 className="title">وش نناديك؟</h2>
        <span className="pill-note" style={{ direction: "ltr" }}>
          غرفة {code}
        </span>
      </div>
      <input
        className="input"
        value={name}
        autoFocus
        maxLength={NAME_MAX}
        placeholder="اسمك"
        onChange={(event) => {
          setName(event.target.value);
          setLocalErr(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && ok) actions.joinRoom(code, trimmed);
        }}
      />
      {localErr ? (
        <p className="helper" style={{ color: "var(--bad)" }}>
          {localErr}
        </p>
      ) : null}
      <button
        className="btn btn-primary"
        disabled={!ok || disabled}
        onClick={() => actions.joinRoom(code, trimmed)}
      >
        دخول الغرفة
      </button>
      <div className="spacer" />
    </div>
  );
}
