/**
 * Shared indicator computation functions.
 * Used by the cache domain for compute_indicator tool.
 */

export function computeSMA(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j]!;
    result.push(Math.round(sum / period * 10000) / 10000);
  }
  return result;
}

export function computeEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let ema = data[0]!;
  for (let i = 0; i < data.length; i++) {
    if (i === 0) { result.push(data[0]!); continue; }
    ema = data[i]! * k + ema * (1 - k);
    result.push(Math.round(ema * 10000) / 10000);
  }
  return result;
}

export function computeRSI(data: number[], period: number): number[] {
  const result: number[] = [];
  if (data.length < 2) return result;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period && i < data.length; i++) {
    const change = data[i]! - data[i - 1]!;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = 0; i < data.length; i++) {
    if (i < period) { result.push(NaN); continue; }
    if (i === period) {
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      result.push(Math.round((100 - 100 / (1 + rs)) * 100) / 100);
      continue;
    }
    const change = data[i]! - data[i - 1]!;
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(Math.round((100 - 100 / (1 + rs)) * 100) / 100);
  }
  return result;
}
