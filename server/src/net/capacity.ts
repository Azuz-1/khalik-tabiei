export interface CapacityLease {
  release(): void;
}

/** Concurrent admission accounting; release is idempotent by construction. */
export class ConnectionCapacity {
  private total = 0;
  private readonly byIp = new Map<string, number>();

  constructor(
    private readonly maxTotal: number,
    private readonly maxPerIp: number,
  ) {}

  acquire(ip: string): CapacityLease | null {
    const currentIp = this.byIp.get(ip) ?? 0;
    if (this.total >= this.maxTotal || currentIp >= this.maxPerIp) return null;
    this.total += 1;
    this.byIp.set(ip, currentIp + 1);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.total = Math.max(0, this.total - 1);
        const next = Math.max(0, (this.byIp.get(ip) ?? 1) - 1);
        if (next === 0) this.byIp.delete(ip);
        else this.byIp.set(ip, next);
      },
    };
  }

  get active(): number { return this.total; }
  activeForIp(ip: string): number { return this.byIp.get(ip) ?? 0; }
}
