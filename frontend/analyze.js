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

  /* ---------- find the parts of a poster ----------
     1. the background = the most common colour
     2. anything clearly different from it (colour or edges) is "ink"
     3. smear ink sideways so letters join into words and lines
     4. each joined blob = one part; describe its size, contrast and whether it looks like text */
  function findParts(img) {
    const PW = 180, PH = Math.max(8, Math.round(PW * img.height / img.width)), M = PW * PH;
    const c = document.createElement("canvas"); c.width = PW; c.height = PH;
    const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, PW, PH);
    const d = ctx.getImageData(0, 0, PW, PH).data;
    const R = new Float32Array(M), G = new Float32Array(M), B = new Float32Array(M), Lm = new Float32Array(M), Sat = new Float32Array(M);
    const hist = new Map(); let bestK = 0, bestN = 0;
    for (let i = 0; i < M; i++) {
      R[i] = d[i * 4] / 255; G[i] = d[i * 4 + 1] / 255; B[i] = d[i * 4 + 2] / 255;
      Lm[i] = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i];
      const mx = Math.max(R[i], G[i], B[i]), mn = Math.min(R[i], G[i], B[i]); Sat[i] = mx ? (mx - mn) / mx : 0;
      const k = (R[i] * 6 | 0) * 49 + (G[i] * 6 | 0) * 7 + (B[i] * 6 | 0);
      const n = (hist.get(k) || 0) + 1; hist.set(k, n); if (n > bestN) { bestN = n; bestK = k; }
    }
    if (bestN / M < 0.18) return [];                       // no clear background (full photo)
    let br = 0, bg = 0, bb = 0, bn = 0;
    for (let i = 0; i < M; i++) if ((R[i] * 6 | 0) * 49 + (G[i] * 6 | 0) * 7 + (B[i] * 6 | 0) === bestK) { br += R[i]; bg += G[i]; bb += B[i]; bn++; }
    br /= bn; bg /= bn; bb /= bn;
    const bgL = 0.2126 * br + 0.7152 * bg + 0.0722 * bb;
    const ink = new Uint8Array(M), cd = new Float32Array(M);
    for (let y = 1; y < PH - 1; y++) for (let x = 1; x < PW - 1; x++) {
      const i = y * PW + x;
      cd[i] = Math.hypot(R[i] - br, G[i] - bg, B[i] - bb);
      const e = Math.hypot(Lm[i + 1] - Lm[i - 1], Lm[i + PW] - Lm[i - PW]);
      if (cd[i] > 0.16 || e > 0.22) ink[i] = 1;
    }
    // join letters: grow ink 3px sideways and 1px up/down
    const grown = new Uint8Array(M);
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
      if (!ink[y * PW + x]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -3; dx <= 3; dx++) {
        const X = x + dx, Y = y + dy; if (X >= 0 && X < PW && Y >= 0 && Y < PH) grown[Y * PW + X] = 1;
      }
    }
    // connected blobs
    const lab = new Int32Array(M).fill(-1), blobs = [];
    for (let i = 0; i < M; i++) {
      if (!grown[i] || lab[i] !== -1) continue;
      const id = blobs.length, st = [i]; lab[i] = id;
      const b = { x0: PW, y0: PH, x1: 0, y1: 0, n: 0, inkN: 0, sx: 0, sy: 0, con: 0, sat: 0, edges: 0 };
      while (st.length) {
        const j = st.pop(), x = j % PW, y = (j / PW) | 0;
        b.n++; if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
        if (ink[j]) { b.inkN++; b.sx += x; b.sy += y; b.con += cd[j] + Math.abs(Lm[j] - bgL); b.sat += Sat[j]; }
        if (x > 0 && x < PW - 1 && ink[j] !== ink[j - 1]) b.edges++;          // light/dark switches = letter strokes
        for (const k of [j - 1, j + 1, j - PW, j + PW]) {
          if (k < 0 || k >= M || lab[k] !== -1 || !grown[k]) continue;
          if ((k === j - 1 && x === 0) || (k === j + 1 && x === PW - 1)) continue;
          lab[k] = id; st.push(k);
        }
      }
      blobs.push(b);
    }
    const parts = [];
    blobs.forEach(b => {
      const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1, boxA = w * h;
      if (b.inkN < M * 0.0012 || h < 2 || (h <= 2 && w > PW * 0.5)) return;   // specks and divider lines
      if (boxA > M * 0.8) return;                                            // a frame around everything
      const fill = b.inkN / boxA, strokes = b.edges / Math.max(1, h * w / PW * 4);
      const text = w / h > 1.8 && fill > 0.12 && fill < 0.75 && b.edges / h > 6;
      parts.push({
        box: [b.x0 / PW * 100, b.y0 / PH * 100, w / PW * 100, h / PH * 100],
        cx: b.sx / b.inkN / PW * 100, cy: b.sy / b.inkN / PH * 100,
        area: boxA / M, contrast: Math.min(1, b.con / b.inkN), colour: b.sat / b.inkN,
        text, big: h / PH > 0.045, strokes
      });
    });
    // join words on the same line ("BLOOM" + "CAFÉ" = one title)
    for (let changed = true; changed;) {
      changed = false;
      for (let i = 0; i < parts.length && !changed; i++) for (let j = i + 1; j < parts.length && !changed; j++) {
        const a = parts[i], b = parts[j];
        if (!a.text || !b.text) continue;
        const [ax, ay, aw, ah] = a.box, [bx, by, bw, bh] = b.box;
        const overlapY = Math.min(ay + ah, by + bh) - Math.max(ay, by);
        const gapX = Math.max(bx - (ax + aw), ax - (bx + bw));
        if (overlapY > 0.5 * Math.min(ah, bh) && gapX < 7 && Math.abs(ah - bh) < 0.5 * Math.max(ah, bh)) {
          const x0 = Math.min(ax, bx), y0 = Math.min(ay, by), x1 = Math.max(ax + aw, bx + bw), y1 = Math.max(ay + ah, by + bh);
          const wa = a.area, wb = b.area, t = wa + wb;
          parts[i] = { box: [x0, y0, x1 - x0, y1 - y0], cx: (a.cx * wa + b.cx * wb) / t, cy: (a.cy * wa + b.cy * wb) / t,
            area: (x1 - x0) * (y1 - y0) / 10000, contrast: (a.contrast * wa + b.contrast * wb) / t, colour: (a.colour * wa + b.colour * wb) / t,
            text: true, big: a.big || b.big, strokes: a.strokes + b.strokes };
          parts.splice(j, 1); changed = true;
        }
      }
    }
    // one giant part covering most of the poster = it's really a photo poster
    if (parts.some(p => p.area > 0.65)) return [];
    // keep the strongest 8 so the path stays readable
    return parts.sort((a, b) => b.area * (0.4 + b.contrast) - a.area * (0.4 + a.contrast)).slice(0, 8);
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

    // 5) find the PARTS of the poster (text lines, images, shapes) instead of loose hot spots
    const parts = findParts(img);

    let path = [], elements = [], targetRank = -1;
    const msgLabel = (objective || "your message").trim().replace(/^(the|our|my|your|a|an)\s+/i, "").toLowerCase().slice(0, 24);

    if (parts.length >= 3) {
      // how strongly each part pulls the eye: size, contrast, text, position, plus the saliency inside it
      parts.forEach(pt => {
        let sv = 0, n = 0;
        for (let y = Math.floor(pt.box[1] / 100 * H); y < Math.ceil((pt.box[1] + pt.box[3]) / 100 * H); y++)
          for (let x = Math.floor(pt.box[0] / 100 * W); x < Math.ceil((pt.box[0] + pt.box[2]) / 100 * W); x++)
            if (x >= 0 && x < W && y >= 0 && y < H) { sv = Math.max(sv, sal[y * W + x]); n++; }
        const top = 1.15 - 0.35 * (pt.cy / 100);                                  // higher up = seen earlier
        const mid = 0.8 + 0.2 * Math.exp(-((pt.cx - 50) ** 2) / (2 * 30 * 30));   // a little centre bias
        pt.pull = Math.sqrt(pt.area) * (0.4 + pt.contrast) * (pt.text ? (pt.big ? 1.45 : 0.75) : 1) * (0.85 + 0.3 * pt.colour) * top * mid * (0.6 + 0.4 * sv);
      });
      // eye path: strongest first, then short jumps are preferred (eyes move to nearby things)
      const left = [...parts], order = [];
      let cur = null;
      while (left.length) {
        let bi = 0, bs = -1;
        left.forEach((pt, i) => {
          const d = cur ? Math.hypot(pt.cx - cur.cx, (pt.cy - cur.cy) * H / W) / 100 : 0;
          const sc = pt.pull * (1 - 0.4 * Math.min(1, d));
          if (sc > bs) { bs = sc; bi = i; }
        });
        cur = left.splice(bi, 1)[0]; order.push(cur);
      }
      // name the parts
      const bigText = order.filter(p => p.text && p.big).sort((a, b) => b.box[3] - a.box[3]);   // biggest letters = title
      order.forEach(p => {
        p.label = p.text ? (p === bigText[0] ? "title" : p.big ? "headline" : "small print")
                : p.area > 0.06 ? (p.colour > 0.35 ? "picture" : "image") : "shape";
      });
      // the tapped message
      if (targetPt) {
        const dist = (p) => Math.hypot(Math.max(p.box[0] - targetPt.x, 0, targetPt.x - p.box[0] - p.box[2]), Math.max(p.box[1] - targetPt.y, 0, targetPt.y - p.box[1] - p.box[3]));
        const inside = order.filter(p => dist(p) === 0).sort((a, b) => a.area - b.area)[0];
        const tgt = inside || [...order].sort((a, b) => dist(a) - dist(b))[0];
        if (tgt && dist(tgt) < 8) { targetRank = order.indexOf(tgt); tgt.label = msgLabel; }
      }
      const seen = {}; order.forEach(p => { if (seen[p.label]) p.label += " " + (++seen[p.label]); else seen[p.label] = 1; });
      elements = order.map((p, i) => ({ label: p.label, box: p.box.map(v => +v.toFixed(1)), is_target: i === targetRank }));
      path = order.slice(0, STOPS).map(p => ({ x: p.cx, y: p.cy, v: p.pull, label: p.label }));
      if (targetPt && targetRank === -1) {                   // tapped somewhere with nothing there
        elements.push({ label: msgLabel, box: [targetPt.x - 10, targetPt.y - 7, 20, 14], is_target: true });
        targetRank = order.length;
      }
    } else {
      // full-bleed photo (no clear parts): fall back to saliency hot spots
      const work = Float32Array.from(sal), R = Math.round(W * CFG.jump), peaks = [];
      const edge = Math.max(2, Math.round(W * 0.04));          // ignore the very edge of the picture
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
        if (x < edge || y < edge || x >= W - edge || y >= H - edge) work[y * W + x] *= 0.3;
      for (let s = 0; s < STOPS + 2; s++) {
        let bi = 0; for (let i = 1; i < N; i++) if (work[i] > work[bi]) bi = i;
        const px_ = bi % W, py_ = Math.floor(bi / W);
        peaks.push({ x: px_ / W * 100, y: py_ / H * 100, v: work[bi] });
        for (let y = Math.max(0, py_ - R); y < Math.min(H, py_ + R); y++)
          for (let x = Math.max(0, px_ - R); x < Math.min(W, px_ + R); x++)
            if ((x - px_) ** 2 + (y - py_) ** 2 < R * R) work[y * W + x] *= 0.08;
      }
      const near = (a, b) => Math.hypot(a.x - b.x, (a.y - b.y) * H / W) < 20;
      if (targetPt) {
        targetRank = peaks.findIndex(p => near(p, targetPt));
        if (targetRank === -1) {
          const tv = sal[Math.min(H - 1, Math.round(targetPt.y / 100 * H)) * W + Math.min(W - 1, Math.round(targetPt.x / 100 * W))];
          targetRank = peaks.findIndex(p => tv > p.v); if (targetRank === -1) targetRank = peaks.length;
          peaks.splice(targetRank, 0, { x: targetPt.x, y: targetPt.y, v: tv });
        }
      }
      path = peaks.slice(0, STOPS).map((p, i) => ({ ...p, label: i === targetRank ? msgLabel : where(p.x, p.y) }));
      const seen = {}; path.forEach(p => { if (seen[p.label]) p.label += " " + (++seen[p.label]); else seen[p.label] = 1; });
      elements = path.map((p, i) => ({ label: p.label, box: [Math.max(0, p.x - 10), Math.max(0, p.y - 7), 20, 14], is_target: i === targetRank }));
      if (targetPt && targetRank >= STOPS) elements.push({ label: msgLabel, box: [targetPt.x - 10, targetPt.y - 7, 20, 14], is_target: true });
    }
    const eye_path = path.map(p => ({ label: p.label, x: +p.x.toFixed(1), y: +p.y.toFixed(1) }));

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
