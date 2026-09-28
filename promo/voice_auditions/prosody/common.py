import numpy as np

def trim(x, sr, thr_db=-50, pad=0.08):  # conservative: keeps weak onset bursts (e.g. /t/)
    e = np.abs(x); idx = np.where(e > 10 ** (thr_db / 20) * max(e.max(), 1e-9))[0]
    if not len(idx): return x
    return x[max(idx[0] - int(pad * sr), 0): idx[-1] + int(pad * sr)]

def join(parts, gaps_ms, sr):
    """Trim each separately generated phrase and join with exact silences."""
    out = []
    for k, x in enumerate(parts):
        x = trim(x.astype(np.float32), sr)
        f = int(0.008 * sr); x[:f] *= np.linspace(0, 1, f); x[-f:] *= np.linspace(1, 0, f)
        out.append(x)
        if k < len(parts) - 1: out.append(np.zeros(int(gaps_ms[k] / 1000 * sr), np.float32))
    return np.concatenate(out)
