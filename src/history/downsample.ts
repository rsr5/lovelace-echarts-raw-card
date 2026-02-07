export function downsample(
  points: Array<[number, unknown]>,
  maxPoints: number,
  method: "mean" | "last",
): Array<[number, unknown]> {
  if (points.length <= maxPoints || maxPoints <= 1) return points;

  const firstT = points[0][0];
  const lastT = points[points.length - 1][0];
  const span = Math.max(1, lastT - firstT);
  const bucketSize = span / maxPoints;

  const buckets: Array<Array<[number, unknown]>> = Array.from({ length: maxPoints }, () => []);
  for (const p of points) {
    const idx = Math.min(maxPoints - 1, Math.floor((p[0] - firstT) / bucketSize));
    buckets[idx].push(p);
  }

  const out: Array<[number, unknown]> = [];
  for (const b of buckets) {
    if (b.length === 0) continue;
    const t = b[b.length - 1][0];

    if (method === "last") {
      out.push([t, b[b.length - 1][1]]);
      continue;
    }

    let sum = 0;
    let count = 0;
    for (const [, v] of b) {
      const n = Number(v);
      if (Number.isFinite(n)) {
        sum += n;
        count += 1;
      }
    }

    out.push([t, count ? sum / count : b[b.length - 1][1]]);
  }

  // Guarantee last point is preserved (nice for step/line endings)
  const last = points[points.length - 1];
  const outLast = out[out.length - 1];
  if (outLast && outLast[0] !== last[0]) out.push(last);

  return out;
}
