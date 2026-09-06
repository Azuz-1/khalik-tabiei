export type ClockAnchor = { serverMs: number; monoMs: number };

interface ClockSample {
  sampleId: string;
  sentMonoMs: number;
  receivedMonoMs: number;
  serverMs: number;
  rttMs: number;
  offsetMs: number;
}

export class ServerClock {
  private anchor: ClockAnchor | null = null;
  private readonly outstanding = new Map<string, number>();
  private samples: ClockSample[] = [];
  private lastAcceptedSequence = -1;

  constructor(private readonly monoNow: () => number = () => performance.now()) {}

  beginSample(sampleId: string): number {
    const sent = this.monoNow();
    this.outstanding.set(sampleId, sent);
    if (this.outstanding.size > 16) this.outstanding.delete(this.outstanding.keys().next().value as string);
    return sent;
  }

  acceptSample(sampleId: string, serverMs: number, receivedMonoMs = this.monoNow()): boolean {
    const sentMonoMs = this.outstanding.get(sampleId);
    this.outstanding.delete(sampleId);
    if (sentMonoMs === undefined || !Number.isFinite(serverMs) || receivedMonoMs < sentMonoMs) return false;

    const sequence = Number(sampleId.split("-").at(-1));
    if (Number.isFinite(sequence) && sequence < this.lastAcceptedSequence - 8) return false;
    if (Number.isFinite(sequence)) this.lastAcceptedSequence = Math.max(this.lastAcceptedSequence, sequence);

    const rttMs = receivedMonoMs - sentMonoMs;
    const offsetMs = serverMs + rttMs / 2 - receivedMonoMs;
    this.samples.push({ sampleId, sentMonoMs, receivedMonoMs, serverMs, rttMs, offsetMs });
    this.samples = this.samples
      .filter((sample) => receivedMonoMs - sample.receivedMonoMs <= 120_000)
      .sort((a, b) => a.rttMs - b.rttMs)
      .slice(0, 8);

    // Do not let one arbitrary delayed response determine the synchronized
    // clock. Once two samples exist, use the median offset among the best-RTT
    // samples; before then the single sample is only a provisional anchor.
    const offsets = this.samples.map((sample) => sample.offsetMs).sort((a, b) => a - b);
    const midpoint = Math.floor(offsets.length / 2);
    const median = offsets.length % 2 === 1
      ? offsets[midpoint]!
      : (offsets[midpoint - 1]! + offsets[midpoint]!) / 2;
    this.anchor = { serverMs: receivedMonoMs + median, monoMs: receivedMonoMs };
    return true;
  }

  seed(serverMs: number, monoMs = this.monoNow()): void {
    if (!this.anchor && Number.isFinite(serverMs)) this.anchor = { serverMs, monoMs };
  }

  now(monoMs = this.monoNow()): number {
    return this.anchor ? this.anchor.serverMs + monoMs - this.anchor.monoMs : Date.now();
  }

  resetSamples(): void {
    this.outstanding.clear();
    this.samples = [];
    this.lastAcceptedSequence = -1;
  }

  anchorForTests(): ClockAnchor | null { return this.anchor ? { ...this.anchor } : null; }
}

export const serverClock = new ServerClock();
export const estimatedServerNow = () => serverClock.now();
