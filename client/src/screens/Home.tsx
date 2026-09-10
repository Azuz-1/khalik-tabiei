import { useEffect, useMemo, useState } from "react";
import { unlockAudio } from "../audio/gameAudio.js";
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

type Step = "home" | "code" | "name";
type InfoTab = "how" | "modes" | "points";
type SuggestionCategory = "idea" | "content" | "bug" | "other";

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

function SuggestionCard({ disabled }: { disabled: boolean }) {
  const [category, setCategory] = useState<SuggestionCategory>("idea");
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ good: boolean; text: string } | null>(null);
  const length = [...text.trim()].length;
  const canSubmit = !disabled && !submitting && length >= 4 && length <= 600;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFeedback(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 7_000);

    try {
      const response = await fetch("/api/suggestions", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ category, text }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as { code?: string };
      if (response.ok) {
        setText("");
        setFeedback({ good: true, text: "وصل اقتراحك، يعطيك العافية 🙌" });
      } else if (response.status === 429) {
        setFeedback({ good: false, text: "وصلتنا منك اقتراحات كثيرة. جرّب بعد شوي." });
      } else if (payload.code === "CONTACT_INFO") {
        setFeedback({ good: false, text: "خل الاقتراح بدون رقم جوال أو إيميل، حفاظًا على خصوصيتك." });
      } else if (response.status === 400) {
        setFeedback({ good: false, text: "تأكد إن الاقتراح من 4 إلى 600 حرف وجرّب مرة ثانية." });
      } else {
        setFeedback({ good: false, text: "استقبال الاقتراحات مو جاهز الحين. جرّب لاحقًا." });
      }
    } catch {
      setFeedback({ good: false, text: "ما قدرنا نرسل الاقتراح الحين. جرّب لاحقًا." });
    } finally {
      window.clearTimeout(timeout);
      setSubmitting(false);
    }
  };

  return (
    <section className="card stack" aria-labelledby="home-suggestion-title">
      <div className="stack" style={{ gap: 5 }}>
        <div className="eyebrow">ساعدنا نحسنها</div>
        <h2 className="title" id="home-suggestion-title">عندك فكرة أو ملاحظة؟</h2>
        <p className="subtitle" style={{ margin: 0 }}>قول لنا وش ودك يتغير في اللعب، التحدّيات، الأسئلة أو التجربة.</p>
      </div>

      <form className="stack" onSubmit={submit} style={{ gap: 10 }}>
        <label className="stack" style={{ gap: 6 }}>
          <span className="helper">نوع الملاحظة</span>
          <select
            className="input"
            value={category}
            disabled={disabled || submitting}
            onChange={(event) => setCategory(event.target.value as SuggestionCategory)}
          >
            <option value="idea">فكرة للعبة</option>
            <option value="content">اقتراح تحدّي أو محتوى</option>
            <option value="bug">مشكلة واجهتني</option>
            <option value="other">شيء ثاني</option>
          </select>
        </label>

        <label className="stack" style={{ gap: 6 }}>
          <span className="helper">اقتراحك</span>
          <textarea
            className="input"
            aria-label="اقتراحك لتحسين اللعبة"
            rows={4}
            maxLength={600}
            value={text}
            disabled={disabled || submitting}
            placeholder="مثال: ودي تحدّيات أشر تكون أكثر تنوع…"
            onChange={(event) => {
              setText(event.target.value);
              if (feedback) setFeedback(null);
            }}
          />
        </label>

        <div className="row between" style={{ alignItems: "flex-start", gap: 12 }}>
          <p className="helper" style={{ margin: 0 }}>
            لا تكتب اسمك أو رقمك أو إيميلك. نستخدم اقتراحك لتحسين اللعبة فقط.
          </p>
          <span className="helper" style={{ direction: "ltr", whiteSpace: "nowrap" }}>{length}/600</span>
        </div>

        <button className="btn btn-ghost" type="submit" disabled={!canSubmit}>
          {submitting ? "جاري الإرسال…" : "أرسل الاقتراح"}
        </button>
        {feedback ? (
          <p
            className="helper"
            role="status"
            style={{ margin: 0, color: feedback.good ? "var(--good)" : "var(--bad)" }}
          >
            {feedback.text}
          </p>
        ) : null}
      </form>

      <p className="helper" style={{ margin: 0 }}>
        ونستخدم إحصائيات لعب مجهولة لتحسين توازن التحدّيات والأسئلة — بدون أسماء أو أكواد غرف أو معرفة مين صوّت لمين.
      </p>
    </section>
  );
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
          <p className="helper" style={{ margin: 0 }}>المضيف يختار {CHALLENGE_OPTIONS.join(" / ")} تحدّي، والمباراة تنتهي بالعدد المختار بالضبط.</p>
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

        <SuggestionCard disabled={offline} />
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
      <p className="helper" aria-live="polite">اسمك من {NAME_MIN} إلى {NAME_MAX} حرف.</p>
      {localErr ? <p className="helper" role="alert" style={{ color: "var(--bad)" }}>{localErr}</p> : null}
      <button className="btn btn-primary" disabled={!ok || offline || joining} onClick={() => actions.joinRoom(code, cleanedName)}>{joining ? "جاري الدخول…" : "دخول الغرفة"}</button>
      <div className="spacer" />
    </div>
  );
}
