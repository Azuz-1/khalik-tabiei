import type { ReactNode } from "react";
import type { ClientView } from "../../../shared/types.js";
import { OwnerDisplayControl } from "../components/OwnerDisplayControl.js";
import { Icon } from "../ui/Icon.js";
import { useHostGameAudio } from "./useHostGameAudio.js";
import "./hostAudio.css";

export function HostAudioLayer({
  view,
  children,
}: {
  view: ClientView;
  children: ReactNode;
}) {
  const { muted, toggleMuted } = useHostGameAudio(view);

  return (
    <>
      <button
        type="button"
        className="host-audio-toggle"
        onClick={toggleMuted}
        aria-label={muted ? "تشغيل صوت اللعبة" : "كتم صوت اللعبة"}
        title={muted ? "تشغيل الصوت" : "كتم الصوت"}
      >
        <Icon name={muted ? "mute" : "sound"} />
      </button>
      {view.self.isOwner === true ? <OwnerDisplayControl view={view} /> : null}
      {children}
    </>
  );
}
