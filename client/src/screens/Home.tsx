import { useEffect, useMemo, useState } from "react";
import { unlockAudio } from "../audio/gameAudio.js";
import { SuggestionDialog } from "../components/SuggestionDialog.js";
import { actions, useGame } from "../net/socket.js";
import { errorText } from "../i18n/errors.js";
import {
  CHALLENGE_OPTIONS,
  GAME_MODES,
  NAME_MAX,
  NAME_MIN,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from "../../../shared/constants.js";

type Step = "home" | "code" | "join-name" | "create-name";
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
    { id: "modes", label: "طرق اللعب" },
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

      <div id="home-panel-how" role="tabpanel" aria-labelledby="home-tab-how" className="home-tab-panel" hidden={tab !== "how"} tabIndex={0}>
        <div className="stack" style={{ gap: 10 }}>
          <p className="subtitle" style={{ margin: 0 }}>1. كل واحد يشوف المطلوب سرًا، إلا المتخفي يعرف دوره بس ما يعرف المطلوب.</p>
          <p className="subtitle" style={{ margin: 0 }}>2. وقت العد تنفذون الحركة كلّكم بنفس اللحظة.</p>
          <p className="subtitle" style={{ margin: 0 }}>3. بعدها تناقشون: مين تصرفه مو طبيعي؟ ثم كل واحد يصوّت بجواله.</p>
          <p className="subtitle" style={{ margin: 0 }}>4. الأغلبية تمسك المتخفي. إذا ما انمسك يكمل نفس المتخفي، وبحد أقصى 3 تحدّيات في دوره.</p>
          <p className="helper" style={{ margin: 0 }}>مالك الغرفة يلعب معكم ويختار {CHALLENGE_OPTIONS.join(" / ")} تحدّي، والمباراة تنتهي بالعدد المختار بالضبط.</p>
        </div>
      </div>

      <div id="home-panel-modes" role="tabpanel" aria-labelledby="home-tab-modes" className="home-tab-panel" hidden={tab !== "modes"} tabIndex={0}>
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
      </div>

      <div id="home-panel-points" role="tabpanel" aria-labelledby="home-tab-points" className="home-tab-panel" hidden={tab !== "points"} tabIndex={0}>
        <div className="stack home-points-copy" style={{ gap: 14 }}>
          <div>
            <strong>إذا أنت طبيعي</strong>
            <table className="points-table">
              <tbody>
                <tr><td>آخر تصويت صح</td><td>+1</td></tr>
                <tr><td>آخر تصويتين ورا بعض صح</td><td>+2</td></tr>
                <tr><td>آخر 3 تصويتات ورا بعض صح</td><td>+3</td></tr>
                <tr><td>آخر تصويت غلط</td><td>0</td></tr>
              </tbody>
            </table>
            <p className="helper" style={{ margin: "8px 0 0" }}>كل ما قفطته بدري واستمريت مصوّت عليه صح، تكسب أكثر. مو لازم الأغلبية توافقك.</p>
          </div>
          <div>
            <strong>إذا أنت المتخفي</strong>
            <table className="points-table">
              <tbody>
                <tr><td>انمسكت في أول تحدّي</td><td>0</td></tr>
                <tr><td>نجوت من تحدّي</td><td>+1</td></tr>
                <tr><td>نجوت من تحدّيين</td><td>+2</td></tr>
                <tr><td>نجوت من 3 تحدّيات</td><td>+3</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Home() {
  const { error, status, pendingActions } = useGame();
  const deepCode = useMemo(readDeepLinkCode, []);
  const [step, setStep] = useState<Step>(deepCode ? "join-name" : "home");
  const [code, setCode] = useState(deepCode ?? "");
  const [name, setName] = useState("");
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [suggestionOpen, setSuggestionOpen] = useState(false);

  useEffect(() => {
    if (error) setLocalErr(errorText(error.code));
  }, [error]);

  const offline = status !== "online";
  const creating = pendingActions.includes("CREATE_ROOM");
  const joining = pendingActions.includes("JOIN_ROOM");

  if (step === "home") {
    return (
      <div className="screen home-screen">
        <button
          type="button"
          className="btn btn-ghost suggestion-trigger"
          disabled={offline}
          aria-label={offline ? "الاقتراحات تحتاج اتصال" : "أرسل اقتراحًا"}
          onClick={() => setSuggestionOpen(true)}
        >
          💡 اقتراح
        </button>

        <div className="spacer" />
        <div className="center stack home-hero">
          <h1 className="brand">خلك طبيعي</h1>
          <p className="subtitle">واحد منكم متخفي وما يعرف المطلوب. اكتشفه بدري واجمع نقاط أكثر.</p>
          <span className="pill-note">3–10 لاعبين · جوال لكل لاعب</span>
        </div>

        <div className="stack home-actions">
          <button
            className="btn btn-primary"
            disabled={offline || creating}
            onClick={() => {
              void unlockAudio();
              setLocalErr(null);
              setName("");
              setStep("create-name");
            }}
          >
            سوّ غرفة والعب معنا
          </button>
          <button className="btn btn-ghost" disabled={offline} onClick={() => { setLocalErr(null); setStep("code"); }}>
            ادخل غرفة
          </button>
          <p className="helper" style={{ margin: 0 }}>صاحب الغرفة لاعب مثل الباقين · بدون تحميل ولا تسجيل</p>
        </div>

        <RulesTabs />
        <div className="spacer" />

        <SuggestionDialog
          open={suggestionOpen}
          disabled={offline}
          onClose={() => setSuggestionOpen(false)}
        />
      </div>
    );
  }

  if (step === "code") {
    const ok = code.length === ROOM_CODE_LENGTH;
    return (
      <div className="screen">
        <button className="link-btn" onClick={() => setStep("home")}>← رجوع</button>
        <div className="spacer" />
        <div className="center stack"><h2 className="title">اكتب كود الغرفة</h2><p className="subtitle">الكود مكوّن من 5 حروف وأرقام</p></div>
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
        <button className="btn btn-primary" disabled={!ok} onClick={() => { setName(""); setStep("join-name"); }}>التالي</button>
        <div className="spacer" />
      </div>
    );
  }

  const creatingOwner = step === "create-name";
  const cleanedName = cleanDisplayName(name);
  const length = graphemeLength(cleanedName);
  const ok = hasVisibleContent(cleanedName) && length >= NAME_MIN && length <= NAME_MAX;
  const pending = creatingOwner ? creating : joining;

  const submitName = () => {
    if (!ok || offline || pending) return;
    if (creatingOwner) actions.createRoom(cleanedName);
    else actions.joinRoom(code, cleanedName);
  };

  return (
    <div className="screen">
      <button className="link-btn" onClick={() => setStep(creatingOwner || deepCode ? "home" : "code")}>← رجوع</button>
      <div className="spacer" />
      <div className="center stack">
        <h2 className="title">وش نناديك؟</h2>
        {creatingOwner
          ? <span className="pill-note">أنت مالك الغرفة وبتكون لاعب</span>
          : <span className="pill-note" style={{ direction: "ltr" }}>غرفة {code}</span>}
      </div>
      <input
        className="input"
        aria-label="اسمك"
        value={name}
        autoFocus
        placeholder="اسمك"
        onChange={(event) => { setName(event.target.value); setLocalErr(null); }}
        onKeyDown={(event) => { if (event.key === "Enter") submitName(); }}
      />
      <p className="helper" aria-live="polite">اسمك من {NAME_MIN} إلى {NAME_MAX} حرف.</p>
      {creatingOwner ? <p className="helper center">ينحسب اسمك ضمن 3–10 لاعبين، وبيوصلك دورك وتصويتك على نفس الجوال.</p> : null}
      {localErr ? <p className="helper" role="alert" style={{ color: "var(--bad)" }}>{localErr}</p> : null}
      <button className="btn btn-primary" disabled={!ok || offline || pending} onClick={submitName}>
        {pending ? (creatingOwner ? "جاري إنشاء الغرفة…" : "جاري الدخول…") : (creatingOwner ? "إنشاء الغرفة" : "دخول الغرفة")}
      </button>
      <div className="spacer" />
    </div>
  );
}
