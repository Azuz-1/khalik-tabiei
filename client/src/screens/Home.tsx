import { useEffect, useMemo, useState } from "react";
import { unlockAudio } from "../audio/gameAudio.js";
import { SuggestionDialog } from "../components/SuggestionDialog.js";
import { actions, useGame } from "../net/socket.js";
import { errorText } from "../i18n/errors.js";
import { EyesMark } from "../ui/EyesMark.js";
import { Icon } from "../ui/Icon.js";
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
    <section className="home-rules" aria-labelledby="home-rules-title">
      <div className="home-rules-head">
        <div className="eyebrow">اعرفها بسرعة</div>
        <h2 className="section-heading" id="home-rules-title">كل اللي تحتاجه قبل تبدأ</h2>
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
        <ol className="rule-steps">
          <li>كل واحد يشوف المطلوب سرًا، إلا المتخفي يعرف دوره بس ما يعرف المطلوب.</li>
          <li>وقت العد تنفذون الحركة كلّكم بنفس اللحظة.</li>
          <li>بعدها تناقشون: مين تصرفه مو طبيعي؟ ثم كل واحد يصوّت بجواله.</li>
          <li>الأغلبية تمسك المتخفي. إذا ما انمسك يكمل دوره حسب عدد اللاعبين: تحدّي واحد مع 3 لاعبين، تحدّيين مع 4، و3 تحدّيات مع 5 أو أكثر.</li>
        </ol>
        <p className="helper home-rules-foot">مالك الغرفة يلعب معكم ويختار {CHALLENGE_OPTIONS.join(" / ")} تحدّي، والمباراة تنتهي بالعدد المختار بالضبط.</p>
      </div>

      <div id="home-panel-modes" role="tabpanel" aria-labelledby="home-tab-modes" className="home-tab-panel" hidden={tab !== "modes"} tabIndex={0}>
        <div className="stack home-mode-list">
          {GAME_MODES.map((mode) => (
            <div className="row home-mode-row" key={mode.id}>
              <span className="mode-explainer-icon" aria-hidden="true">{mode.icon}</span>
              <div>
                <strong>{mode.fullLabel}</strong>
                <p className="helper">{mode.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div id="home-panel-points" role="tabpanel" aria-labelledby="home-tab-points" className="home-tab-panel" hidden={tab !== "points"} tabIndex={0}>
        <div className="home-points-copy">
          <div className="points-group">
            <strong>إذا أنت طبيعي</strong>
            <table className="points-table">
              <tbody>
                <tr><td>آخر تصويت صح</td><td>+1</td></tr>
                <tr><td>آخر تصويتين ورا بعض صح</td><td>+2</td></tr>
                <tr><td>آخر 3 تصويتات ورا بعض صح</td><td>+3</td></tr>
                <tr><td>آخر تصويت غلط</td><td>0</td></tr>
              </tbody>
            </table>
            <p className="helper home-rules-foot">كل ما قفطته بدري واستمريت مصوّت عليه صح، تكسب أكثر. مو لازم الأغلبية توافقك.</p>
          </div>
          <div className="points-group">
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

        <header className="home-hero">
          <EyesMark size={108} />
          <h1 className="brand">خلك طبيعي</h1>
          <p className="home-tagline">واحد منكم متخفي وما يعرف المطلوب. اكتشفوه بدري واجمعوا نقاط أكثر.</p>
          <p className="home-meta"><span dir="ltr" className="num-ltr">3–10</span> لاعبين · جوال لكل لاعب · بدون تحميل ولا تسجيل</p>
        </header>

        <div className="home-actions">
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
          <button className="btn btn-secondary" disabled={offline} onClick={() => { setLocalErr(null); setStep("code"); }}>
            ادخل غرفة
          </button>
          <p className="helper home-actions-note">صاحب الغرفة لاعب مثل الباقين</p>
        </div>

        <RulesTabs />

        <p className="home-tv-hint">
          <Icon name="tv" />
          <span>عندكم تلفزيون؟ افتحوا <span dir="ltr" className="num-ltr">{location.host}/tv</span> عليه، واربطوه من جوال مالك الغرفة.</span>
        </p>

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
      <div className="screen join-screen">
        <button className="link-btn back-btn" onClick={() => setStep("home")}><Icon name="back" /> رجوع</button>
        <div className="join-body">
          <div className="join-head">
            <h2 className="title">اكتب كود الغرفة</h2>
            <p className="subtitle">الكود 5 حروف وأرقام، تلقاه على جوال مالك الغرفة أو التلفزيون.</p>
          </div>
          <input
            className="input code"
            aria-label="كود الغرفة"
            value={code}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            maxLength={ROOM_CODE_LENGTH}
            placeholder="•••••"
            onChange={(event) => {
              const value = event.target.value.toUpperCase().split("").filter((char) => ROOM_CODE_ALPHABET.includes(char)).join("").slice(0, ROOM_CODE_LENGTH);
              setCode(value);
              setLocalErr(null);
            }}
            onKeyDown={(event) => { if (event.key === "Enter" && ok) { setName(""); setStep("join-name"); } }}
          />
          <div className="code-slots" aria-hidden="true">
            {Array.from({ length: ROOM_CODE_LENGTH }, (_, index) => <i key={index} className={index < code.length ? "filled" : undefined} />)}
          </div>
          {localErr ? <p className="form-error" role="alert">{localErr}</p> : null}
        </div>
        <div className="join-dock">
          <button className="btn btn-primary" disabled={!ok} onClick={() => { setName(""); setStep("join-name"); }}>التالي</button>
        </div>
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
    <div className="screen join-screen">
      <button className="link-btn back-btn" onClick={() => setStep(creatingOwner || deepCode ? "home" : "code")}><Icon name="back" /> رجوع</button>
      <div className="join-body">
        <div className="join-head">
          {creatingOwner
            ? <span className="pill-note">أنت مالك الغرفة وبتلعب معهم</span>
            : <span className="pill-note">غرفة <span dir="ltr" className="num-ltr">{code}</span></span>}
          <h2 className="title">وش نناديك؟</h2>
          <p className="subtitle">{creatingOwner ? <>ينحسب اسمك ضمن <span dir="ltr" className="num-ltr">3–10</span> لاعبين، وبيوصلك دورك وتصويتك على نفس الجوال.</> : "اسمك بيظهر للاعبين وعلى الشاشة."}</p>
        </div>
        <input
          className="input"
          aria-label="اسمك"
          value={name}
          autoFocus
          autoComplete="nickname"
          enterKeyHint="go"
          placeholder="اسمك"
          onChange={(event) => { setName(event.target.value); setLocalErr(null); }}
          onKeyDown={(event) => { if (event.key === "Enter") submitName(); }}
        />
        <p className="helper field-hint" aria-live="polite">اسمك من {NAME_MIN} إلى {NAME_MAX} حرف.</p>
        {localErr ? <p className="form-error" role="alert">{localErr}</p> : null}
      </div>
      <div className="join-dock">
        <button className="btn btn-primary" disabled={!ok || offline || pending} onClick={submitName}>
          {pending ? (creatingOwner ? "جاري إنشاء الغرفة…" : "جاري الدخول…") : (creatingOwner ? "إنشاء الغرفة" : "دخول الغرفة")}
        </button>
      </div>
    </div>
  );
}
