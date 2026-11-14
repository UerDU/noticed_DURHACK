/* =========================================================
   Saccade · in-browser analysis (no server needed)
   Predicts where eyes go on ANY image, using the same ideas as
   eye-tracking research:
     - contrast and colour pull the eye (saliency)
     - edges and text pull the eye
     - people look at the middle first (centre bias)
     - after looking somewhere, eyes move on (inhibition of return)
   Used in fake mode for uploaded posters, and as a backup if the
   real backend is slow or down. Returns the same JSON as the backend.
   ========================================================= */

const SACCADE_LOCAL = (() => {
  const W = 96;                 // analysis width in pixels (small = fast)
  const CFG = Object.assign({ centre: 0.2, blur: 10, bgUniq: 1.0, jump: 0.36 }, window.SACCADE_TUNE || {});
  const CENTRE_BIAS = CFG.centre; // 0 = none, 1 = strong "look at the middle first"
  const STOPS = 4;              // how many eye stops to predict

  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += src[y * w + xx]; n++; } }
      tmp[y * w + x] = s / n;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; n++; } }
      out[y * w + x] = s / n;
    }
    return out;
  }
  const normalise = (a) => { let mx = 0; for (const v of a) mx = Math.max(mx, v); if (mx > 0) for (let i = 0; i < a.length; i++) a[i] /= mx; return a; };

  function where(x, y) {                      // friendly label from position (percent)
    const v = y < 33 ? "top" : y > 66 ? "bottom" : "middle";
    const h = x < 33 ? " left" : x > 66 ? " right" : "";
    return (v === "middle" && !h) ? "centre" : v + h;
  }

  async function analyse(imageURL, objective, targetPt) {
    const img = new Image(); img.src = imageURL; await img.decode();
    const H = Math.max(8, Math.round(W * img.height / img.width));
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;
    const N = W * H, L = new Float32Array(N), S = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const r = px[i * 4] / 255, g = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
      L[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b); S[i] = mx ? (mx - mn) / mx : 0;
    }
    // 1) local contrast + colour
    const Lb = boxBlur(L, W, H, 8), Sb = boxBlur(S, W, H, 8);
    const contrast = new Float32Array(N);
    for (let i = 0; i < N; i++) contrast[i] = Math.abs(L[i] - Lb[i]) + 0.6 * Math.abs(S[i] - Sb[i]);
    // 2) edges (text and shapes)
    const edge = new Float32Array(N);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = L[i + 1] - L[i - 1], gy = L[i + W] - L[i - W];
      edge[i] = Math.hypot(gx, gy);
    }
    // 3) colour uniqueness: a colour unlike the rest of the poster pops out (big bright blobs)
    const R_ = new Float32Array(N), G_ = new Float32Array(N), B_ = new Float32Array(N);
    for (let i = 0; i < N; i++) { R_[i] = px[i * 4] / 255; G_[i] = px[i * 4 + 1] / 255; B_[i] = px[i * 4 + 2] / 255; }
    const Rb = boxBlur(R_, W, H, 2), Gb = boxBlur(G_, W, H, 2), Bb = boxBlur(B_, W, H, 2);
    // background colour = the most common colour (coarse histogram), blended with the average
    const hist = new Map(); let best = null, bestN = 0;
    for (let i = 0; i < N; i++) { const k = (R_[i] * 7 | 0) * 64 + (G_[i] * 7 | 0) * 8 + (B_[i] * 7 | 0); const n = (hist.get(k) || 0) + 1; hist.set(k, n); if (n > bestN) { bestN = n; best = i; } }
    let mr = 0, mg = 0, mb = 0; for (let i = 0; i < N; i++) { mr += R_[i]; mg += G_[i]; mb += B_[i]; } mr /= N; mg /= N; mb /= N;
    const bw = CFG.bgUniq; mr = bw * R_[best] + (1 - bw) * mr; mg = bw * G_[best] + (1 - bw) * mg; mb = bw * B_[best] + (1 - bw) * mb;
    const uniq = new Float32Array(N);
    for (let i = 0; i < N; i++) uniq[i] = Math.hypot(Rb[i] - mr, Gb[i] - mg, Bb[i] - mb) * (0.5 + S[i]);
    const sal = new Float32Array(N);
    const cN = normalise(boxBlur(contrast, W, H, 3)), eN = normalise(boxBlur(edge, W, H, 4)), uN = normalise(boxBlur(uniq, W, H, 3));
    for (let i = 0; i < N; i++) sal[i] = 0.3 * cN[i] + 0.3 * eN[i] + 0.4 * uN[i];
    // 4) centre bias: people look at the middle first
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = x / W - 0.5, dy = y / H - 0.5;
      const g = Math.exp(-(dx * dx + dy * dy) / (2 * 0.3 * 0.3));
      sal[y * W + x] *= (1 - CENTRE_BIAS) + CENTRE_BIAS * g;
    }
    const salS = boxBlur(sal, W, H, CFG.blur); for (let i = 0; i < N; i++) sal[i] = salS[i];
    normalise(sal);

    // 5) eye path: strongest spot, then "inhibition of return" so the eye moves on
    const work = Float32Array.from(sal);
    const R = Math.round(W * CFG.jump);
    const peaks = [];
    for (let s = 0; s < STOPS + 2; s++) {
      let bi = 0; for (let i = 1; i < N; i++) if (work[i] > work[bi]) bi = i;
      const px_ = bi % W, py_ = Math.floor(bi / W);
      peaks.push({ x: px_ / W * 100, y: py_ / H * 100, v: work[bi] });
      for (let y = Math.max(0, py_ - R); y < Math.min(H, py_ + R); y++)
        for (let x = Math.max(0, px_ - R); x < Math.min(W, px_ + R); x++)
          if ((x - px_) ** 2 + (y - py_) ** 2 < R * R) work[y * W + x] *= 0.08;
    }

    // 6) where is the message? (the tap, if given)
    let targetRank = -1;
    const near = (a, b) => Math.hypot(a.x - b.x, (a.y - b.y) * H / W) < 20;
    if (targetPt) {
      targetRank = peaks.findIndex(p => near(p, targetPt));
      if (targetRank === -1) {
        const tv = sal[Math.min(H - 1, Math.round(targetPt.y / 100 * H)) * W + Math.min(W - 1, Math.round(targetPt.x / 100 * W))];
        targetRank = peaks.findIndex(p => tv > p.v);        // slot it in by strength
        if (targetRank === -1) targetRank = peaks.length;
        peaks.splice(targetRank, 0, { x: targetPt.x, y: targetPt.y, v: tv });
      }
    }
    const path = peaks.slice(0, STOPS);
    const msgLabel = (objective || "your message").trim().replace(/^(the|our|my|your|a|an)\s+/i, "").toLowerCase().slice(0, 24);
    const eye_path = path.map((p, i) => ({ label: i === targetRank ? msgLabel : where(p.x, p.y), x: +p.x.toFixed(1), y: +p.y.toFixed(1) }));
    // make labels unique
    const seen = {}; eye_path.forEach(p => { if (seen[p.label]) p.label += " " + (++seen[p.label]); else seen[p.label] = 1; });
    const elements = eye_path.map((p, i) => ({ label: p.label, box: [Math.max(0, p.x - 10), Math.max(0, p.y - 7), 20, 14], is_target: i === targetRank }));
    if (targetPt && targetRank >= STOPS) elements.push({ label: msgLabel, box: [targetPt.x - 10, targetPt.y - 7, 20, 14], is_target: true });

    // 7) scores (same rubric and max points as the backend)
    let mean = 0; for (const v of L) mean += v; mean /= N;
    let varr = 0; for (const v of L) varr += (v - mean) ** 2; const rms = Math.sqrt(varr / N);
    const sorted = Float32Array.from(L).sort(); const range = sorted[Math.floor(N * 0.95)] - sorted[Math.floor(N * 0.05)];
    let dens = 0; for (const v of edge) if (v > 0.12) dens++; dens /= N;
    let Lw = 0, Rw = 0, Tw = 0, Bw = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = sal[y * W + x]; if (x < W / 2) Lw += v; else Rw += v; if (y < H / 2) Tw += v; else Bw += v; }
    const imbalance = Math.abs(Lw - Rw) / (Lw + Rw) + 0.5 * Math.abs(Tw - Bw) / (Tw + Bw);
    const dominance = path.length > 1 ? path[0].v / Math.max(0.01, path[1].v) : 2;

    const subscores = {
      focal_match: targetPt ? [25, 25, 15, 5][targetRank] ?? 0 : 13,
      focal_point: Math.round(15 * clamp01((dominance - 1) / 0.6) * 0.8 + 3),
      legibility: Math.round(15 * clamp01((rms - 0.08) / 0.22)),
      contrast: Math.round(15 * clamp01((range - 0.25) / 0.55)),
      clutter: Math.round(15 * clamp01(1 - (dens - 0.06) / 0.22)),
      balance: Math.round(15 * clamp01(1 - imbalance * 2.2))
    };
    const ord = (n) => n + (["st", "nd", "rd"][n - 1] || "th");
    const explanations = {
      focal_match: !targetPt ? "Tap your message on the poster to check this one."
        : targetRank <= 1 ? `Your message is seen ${ord(targetRank + 1)}. Great.` : targetRank < STOPS ? `Your message is seen ${ord(targetRank + 1)}. Most people move on before that.` : "Your message isn't in the first 4 places people look.",
      focal_point: dominance > 1.4 ? "One area clearly wins attention." : "A few areas compete for attention.",
      legibility: rms > 0.2 ? "Strong light and dark areas, so it reads well small." : "Quite flat. It may be hard to read at phone size.",
      contrast: range > 0.6 ? "Text and shapes stand out from the background." : "Some parts blend into the background.",
      clutter: dens < 0.12 ? "Good breathing space." : "Lots of detail. It may feel busy.",
      balance: imbalance < 0.2 ? "Visual weight is nicely spread." : "One side feels heavier than the other."
    };
    const problems = [];
    if (targetPt && targetRank > 1) problems.push(`Your message is seen ${targetRank < STOPS ? ord(targetRank + 1) : "late"}. Make it bigger, bolder, or move it towards the middle-top.`);
    if (targetPt && targetRank !== 0 && eye_path[0]) problems.push(`The ${eye_path[0].label} area grabs eyes first. Make it smaller or calmer.`);
    Object.entries(subscores).filter(([k]) => k !== "focal_match").sort((a, b) => a[1] - b[1]).slice(0, 2)
      .forEach(([k, v]) => { if (v < 9) problems.push(explanations[k]); });
    if (!problems.length) problems.push("Looks well composed. Small tweaks only.");

    return { objective, target: targetRank >= 0 ? msgLabel : null, elements, eye_path, subscores, explanations, problems, fixes: [], local: true };
  }
  return { analyse };
})();
