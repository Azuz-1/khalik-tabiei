import type { CountdownStep } from "./hostAudioEvents.js";

export const AUDIO_MUTE_STORAGE_KEY = "khalik_tabiei_muted";
const MASTER_VOLUME = 0.26;
const SILENCE = 0;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, time: number): void;
  linearRampToValueAtTime(value: number, time: number): void;
}

export interface AudioNodeLike {
  connect(destination: unknown): unknown;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike;
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: string;
  frequency: AudioParamLike;
  onended: (() => void) | null;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface AudioContextLike {
  currentTime: number;
  state: string;
  destination: unknown;
  createGain(): GainNodeLike;
  createOscillator(): OscillatorNodeLike;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export type AudioContextConstructorLike = new () => AudioContextLike;

export interface GameAudioEnvironment {
  getAudioContextConstructor?: () => AudioContextConstructorLike | undefined;
  getStorage?: () => StorageLike | undefined;
}

function browserAudioContextConstructor(): AudioContextConstructorLike | undefined {
  try {
    const scope = globalThis as unknown as {
      AudioContext?: AudioContextConstructorLike;
      webkitAudioContext?: AudioContextConstructorLike;
    };
    return scope.AudioContext ?? scope.webkitAudioContext;
  } catch {
    return undefined;
  }
}

function browserStorage(): StorageLike | undefined {
  try {
    return (globalThis as unknown as { localStorage?: StorageLike }).localStorage;
  } catch {
    return undefined;
  }
}

function readMuted(storage: StorageLike | undefined): boolean {
  try {
    const value = storage?.getItem(AUDIO_MUTE_STORAGE_KEY);
    return value === "1" || value === "true";
  } catch {
    return false;
  }
}

function writeMuted(storage: StorageLike | undefined, muted: boolean): void {
  try {
    storage?.setItem(AUDIO_MUTE_STORAGE_KEY, muted ? "1" : "0");
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}

export interface GameAudioRuntime {
  unlockAudio(): Promise<boolean>;
  playCountdownTick(step: CountdownStep): void;
  playAction(): void;
  playHold(): void;
  playPromptReveal(): void;
  playVotingStart(): void;
  playVoteReceived(count?: number): void;
  playCaught(): void;
  playEscaped(): void;
  playChallengeSurvived(): void;
  playGameOver(): void;
  playJoin(): void;
  setMuted(value: boolean): void;
  isMuted(): boolean;
  disposeAudio(): Promise<void>;
}

export function createGameAudioRuntime(environment: GameAudioEnvironment = {}): GameAudioRuntime {
  const getConstructor = environment.getAudioContextConstructor ?? browserAudioContextConstructor;
  const getStorage = environment.getStorage ?? browserStorage;

  let context: AudioContextLike | null = null;
  let masterGain: GainNodeLike | null = null;
  let muted = readMuted(getStorage());

  const ensureMaster = (ctx: AudioContextLike): GainNodeLike => {
    if (masterGain) return masterGain;
    const gain = ctx.createGain();
    gain.gain.value = muted ? SILENCE : MASTER_VOLUME;
    gain.connect(ctx.destination);
    masterGain = gain;
    return gain;
  };

  const playableContext = (): AudioContextLike | null => {
    if (muted || !context || context.state !== "running") return null;
    ensureMaster(context);
    return context;
  };

  const tone = (
    frequency: number,
    durationSeconds: number,
    peakGain: number,
    wave: "sine" | "triangle" = "sine",
    delaySeconds = 0,
    endFrequency?: number,
  ): void => {
    const ctx = playableContext();
    if (!ctx || !masterGain) return;

    const startAt = ctx.currentTime + Math.max(0, delaySeconds);
    const attackEndsAt = startAt + Math.min(0.018, durationSeconds * 0.24);
    const stopAt = startAt + durationSeconds;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();

    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    if (endFrequency != null) {
      oscillator.frequency.linearRampToValueAtTime(endFrequency, stopAt);
    }

    envelope.gain.setValueAtTime(0, startAt);
    envelope.gain.linearRampToValueAtTime(peakGain, attackEndsAt);
    envelope.gain.linearRampToValueAtTime(0, stopAt);

    oscillator.connect(envelope);
    envelope.connect(masterGain);

    oscillator.onended = () => {
      try {
        oscillator.disconnect();
      } catch {
        // Already disconnected/closed.
      }
      try {
        envelope.disconnect();
      } catch {
        // Already disconnected/closed.
      }
    };

    oscillator.start(startAt);
    oscillator.stop(stopAt + 0.01);
  };

  const unlockAudio = async (): Promise<boolean> => {
    try {
      if (!context || context.state === "closed") {
        const Constructor = getConstructor();
        if (!Constructor) return false;
        context = new Constructor();
        masterGain = null;
        ensureMaster(context);
      }

      // Safari/WebKit can expose interruption-like non-running states in
      // addition to the standard "suspended" state. A user gesture should try
      // resume for any live context that is not already running.
      if (context.state !== "running" && context.state !== "closed") {
        await context.resume();
      }
      return context.state === "running";
    } catch {
      return false;
    }
  };

  const setMuted = (value: boolean): void => {
    muted = value;
    writeMuted(getStorage(), value);
    if (context && masterGain) {
      try {
        masterGain.gain.setValueAtTime(value ? SILENCE : MASTER_VOLUME, context.currentTime);
      } catch {
        masterGain.gain.value = value ? SILENCE : MASTER_VOLUME;
      }
    }
  };

  const disposeAudio = async (): Promise<void> => {
    const ctx = context;
    context = null;
    if (masterGain) {
      try {
        masterGain.disconnect();
      } catch {
        // Already disconnected.
      }
      masterGain = null;
    }
    if (ctx && ctx.state !== "closed") {
      try {
        await ctx.close();
      } catch {
        // Audio is progressive enhancement; disposal errors stay silent.
      }
    }
  };

  return {
    unlockAudio,
    playCountdownTick(step) {
      const frequencies: Record<CountdownStep, number> = {
        5: 320,
        4: 380,
        3: 450,
        2: 530,
        1: 640,
      };
      const intensity = step === 1 ? 0.18 : 0.14;
      tone(frequencies[step], 0.095, intensity, "triangle");
    },
    playAction() {
      tone(165, 0.2, 0.22, "sine", 0, 95);
      tone(930, 0.085, 0.1, "triangle");
    },
    playHold() {
      tone(145, 0.14, 0.075, "sine", 0, 125);
    },
    playPromptReveal() {
      tone(500, 0.18, 0.11, "sine");
      tone(660, 0.22, 0.1, "triangle", 0.075);
    },
    playVotingStart() {
      tone(480, 0.13, 0.075, "triangle");
    },
    playVoteReceived(count = 1) {
      const frequency = 760 + Math.min(Math.max(count - 1, 0), 3) * 35;
      tone(frequency, 0.075, 0.052, "sine");
    },
    playCaught() {
      tone(440, 0.28, 0.12, "triangle");
      tone(554, 0.28, 0.115, "triangle", 0.12);
      tone(659, 0.32, 0.11, "sine", 0.24);
    },
    playEscaped() {
      tone(620, 0.23, 0.1, "triangle");
      tone(520, 0.23, 0.095, "triangle", 0.12);
      tone(430, 0.25, 0.09, "sine", 0.24);
    },
    playChallengeSurvived() {
      tone(430, 0.12, 0.065, "triangle");
      tone(350, 0.13, 0.06, "sine", 0.08);
    },
    playGameOver() {
      tone(480, 0.18, 0.07, "sine");
      tone(600, 0.2, 0.065, "triangle", 0.11);
    },
    playJoin() {
      tone(820, 0.09, 0.05, "sine");
    },
    setMuted,
    isMuted: () => muted,
    disposeAudio,
  };
}

const runtime = createGameAudioRuntime();

export const unlockAudio = runtime.unlockAudio;
export const playCountdownTick = runtime.playCountdownTick;
export const playAction = runtime.playAction;
export const playHold = runtime.playHold;
export const playPromptReveal = runtime.playPromptReveal;
export const playVotingStart = runtime.playVotingStart;
export const playVoteReceived = runtime.playVoteReceived;
export const playCaught = runtime.playCaught;
export const playEscaped = runtime.playEscaped;
export const playChallengeSurvived = runtime.playChallengeSurvived;
export const playGameOver = runtime.playGameOver;
export const playJoin = runtime.playJoin;
export const setMuted = runtime.setMuted;
export const isMuted = runtime.isMuted;
export const disposeAudio = runtime.disposeAudio;
