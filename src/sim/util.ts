export function angDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function turnToward(a: number, b: number, maxStep: number): number {
  const d = angDiff(a, b);
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
