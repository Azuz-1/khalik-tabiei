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
type InfoTab = "how" | "modes" | "points";

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

function RulesTabs() {
  const [tab, setTab] = useState<InfoTab>("how");
  const tabs: Array<{ id: InfoTab; label: string }> = [
    { id: "how", label: "كيف نلعب؟" },
    { id: "modes", label: "التحديات" },
    { id: "points", label: "النقاط" },
  ];

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, current: number) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? 1 : -1;
    const next = (current + direction + tabs.length) % tabs.length;
    setTab(tabs[next]!.id);
    document.getElementById(`home-tab-${tabs[next]!.id}`)?.focus();
  };

  return (
    <section className="card stack home-rules" aria-labelledby="home-rules-title">
      <div className="center stack" style={{ gap: 6 }}>
        <div className="eyebrow">اعرفها بسرعة</div>
        <h2 className="title" id="home-rules-title">كل اللي تحتاجه قبل تبدأ</h2>
      </div>
      <div className="home-tabs" role="tablist" aria-label="شرح اللعبة">
        {tabs.map((item, index) => (
          <button
            key={item.id}
            id={`home-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`home-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            className={`home-tab${tab === item.id ? " active" : ""}`}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div id={`home-panel-${tab}`} role="tabpanel" aria-labelledby={`home-tab-${tab}`} className="home-tab-panel">
        {tab === "how" ? (
          <div className="stack" style={{ gap: 10 }}>
            <p className="subtitle" style={{ margin: 0 }}>١. كل واحد يشوف المطلوب سرًا، إلا المتخفي يعرف دوره بس ما يعرف المطلوب.</p>
            <p className="subtitle" style={{ margin: 0 }}>٢. وقت العد تنفذون الحركة كلّكم بنفس اللحظة.</p>
            <p className="subtitle" style={{ margin: 0 }}>٣. بعدها تناقشون: مين تصرفه مو طبيعي؟ ثم كل واحد يصوّت بجواله.</p>
            <p className="subtitle" style={{ margin: 0 }}>٤. الأغلبية تمسك المتخفي. إذا ما انمسك يكمل نفس المتخفي للتحدّي اللي بعده.</p>
            <p className="helper" style={{ margin: 0 }}>المضيف يختار 3 أو 6 أو 9 أو 12 تحديًا أساسيًا، ونكمّل دور آخر متخفي حتى لو تجاوزنا العدد المختار.</p>
          </div>
        ) : null}

        {tab === "modes" ? (
          <div className="stack home-mode-list">
            {GAME_MODES.map((mode) => (
              <div className="row home-mode-row" key={mode.id}>
                <span className="mode-explainer-icon" aria-hidden="true">{mode.icon}</span>
                <div>
                  <strong>{mode.fullLabel}</strong>
                  <p className="helper" style={{ margin: 0 }}>{mode.description}</p>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {tab === "points" ? (
          <div className="stack home-points-copy" style={{ gap: 10 }}>
            <p className="subtitle" style={{ margin: 0 }}><strong>3 لاعبين:</strong> إذا بدأت تصوّت صح من أول فرصة واستمرّيت = +2، ومن الثانية = +1.</p>
            <p className="subtitle" style={{ margin: 0 }}><strong>4–10 لاعبين:</strong> من أول فرصة = +3، من الثانية = +2، من الثالثة = +1.</p>
            <p className="subtitle" style={{ margin: 0 }}><strong>المتخفي:</strong> +1 عن كل تحدّي ينجو منه.</p>
            <p className="helper" style={{ margin: 0 }}>إذا غيّرت تصويتك وصار غلط، تنقطع سلسلتك. النقاط وتوزيع الأصوات ما تظهر إلا بعد نهاية دور المتخفي.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function Home() {
  const { error, status, pendingActions } = useGame();
  const deepCode = useMemo(readDeepLinkCode, []);
  const [step, setStep] = useState<Step>(deepCode ? "name" : "home");
  const [code, setCode] = useState(deepCode ?? "");
  const [name, setName] = useState("");
  const [localErr, setLocalErr] = useState<string | null>(null);

  useEffect(() => {
    if (error) setLocalErr(errorText(error.code));
  }, [error]);

  const offline = status !== "online";
  const creating = pendingActions.includes("CREATE_ROOM");
  const joining = pendingActions.includes("JOIN_ROOM");

  if (step === "home") {
    return (
      <div className="screen home-screen">
        <div className="spacer" />
        <div className="center stack home-hero">
          <h1 className="brand">خلك طبيعي</h1>
          <p className="subtitle">واحد منكم متخفي وما يعرف المطلوب. اكتشفه بدري واجمع نقاط أكثر.</p>
          <span className="pill-note">3–10 لاعبين · شاشة مشتركة وجوال لكل لاعب</span>
        </div>

        <div className="stack home-actions">
          <button
            className="btn btn-primary"
            disabled={offline || creating}
            onClick={() => {
              void unlockAudio();
              actions.createRoom();
            }}
          >
            {creating ? "جاري إنشاء الغرفة…" : "سوّ غرفة"}
          </button>
          <button className="btn btn-ghost" disabled={offline} onClick={() => { setLocalErr(null); setStep("code"); }}>
            ادخل غرفة
          </button>
          <p className="helper" style={{ margin: 0 }}>بدون تحميل ولا تسجيل</p>
        </div>

        <RulesTabs />
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
        onKeyDown={(event) => { if (event.key === "Enter" && ok && !joining && !offline) actions.joinRoom(code, cleanedName); }}
      />
      <p className="helper" aria-live="polite">الاسم من {NAME_MIN} إلى {NAME_MAX} محرفًا مرئيًا؛ الإيموجي المركب يُحسب محرفًا واحدًا.</p>
      {localErr ? <p className="helper" role="alert" style={{ color: "var(--bad)" }}>{localErr}</p> : null}
      <button className="btn btn-primary" disabled={!ok || offline || joining} onClick={() => actions.joinRoom(code, cleanedName)}>{joining ? "جاري الدخول…" : "دخول الغرفة"}</button>
      <div className="spacer" />
    </div>
  );
}
