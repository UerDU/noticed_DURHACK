/* =========================================================
   Saccade · Glance Test
   Compares the AI's predicted eye path with a real person's eyes.
   Uses the poster + result from the main page (sessionStorage),
   or the Bloom Café example if nothing was analysed yet.
   ========================================================= */

const LOOK_MS = 3000;          // how long people look at the poster
const CLICKS_PER_DOT = 3;      // more clicks = the tracker learns your eyes better
const MIN_DWELL_MS = 150;      // total time on a part before it counts as "seen"
const SETTLE_MS = 300;         // ignore the first moment while the eyes land on the poster
const NEAR_PCT = 20;           // a look outside every box goes to the nearest part if it's this close (webcams wobble a lot)
const WEBGAZER_ASSETS = "https://cdn.jsdelivr.net/npm/webgazer@3.5.3/dist/mediapipe/face_mesh";

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const show = (id) => document.querySelectorAll(".gt-screen").forEach(s => s.classList.toggle("on", s.id === id));

/* ---------- the poster + AI prediction to test ---------- */
const SAMPLE = {
  image: "sample-poster.png",
  objective: "50% off",
  result: {
    target: "offer",
    elements: [
      { label: "logo", box: [6, 4, 88, 10] }, { label: "photo", box: [6, 19, 88, 45] },
      { label: "headline", box: [6, 67, 55, 10] }, { label: "offer", box: [66, 92, 31, 4] }
    ],
    eye_path: [
      { label: "logo", x: 50, y: 9 }, { label: "photo", x: 50, y: 46 },
      { label: "headline", x: 30, y: 71 }, { label: "offer", x: 81, y: 94 }
    ]
  }
};
let data = SAMPLE;
try {
  const saved = JSON.parse(sessionStorage.getItem("saccade:last") || "null");
  if (saved && saved.image && saved.result && saved.result.eye_path && saved.result.elements) data = saved;
} catch (e) { /* storage blocked: use the sample */ }
$("posterNote").textContent = data === SAMPLE
  ? "Testing with the Bloom Café example poster. Analyse your own poster first to test that one instead."
  : "Testing with the poster you just analysed.";

/* ---------- gaze source: webcam (WebGazer) or mouse fallback ---------- */
let mode = "camera";
let samples = [];        // {x, y, t} in viewport pixels during the look
let recording = false;

let fix = { ax: 1, bx: 0, ay: 1, by: 0 };   // per-person correction measured after the dots: true = a * guess + b
let checking = null;               // samples collected during the accuracy check
function onGaze(x, y) {
  if (x == null || y == null) return;
  if (checking) checking.push({ x, y, t: performance.now() });
  if (recording) samples.push({ x: fix.ax * x + fix.bx, y: fix.ay * y + fix.by, t: performance.now() });
}
document.addEventListener("mousemove", e => { if (mode === "mouse") onGaze(e.clientX, e.clientY); });

$("startBtn").onclick = async () => {
  mode = "camera";
  if (!window.webgazer) { alert("The eye tracker couldn't load (check the internet connection). Using the mouse instead."); return startMouse(); }
  try {
    webgazer.params.faceMeshSolutionPath = WEBGAZER_ASSETS;
    webgazer.params.saveDataAcrossSessions = false;
    webgazer.setRegression("ridge").setGazeListener((d) => { if (d) onGaze(d.x, d.y); });
    await webgazer.begin();
    webgazer.showVideoPreview(false).showPredictionPoints(false).applyKalmanFilter(true);
  } catch (err) {
    console.error(err);
    alert("We couldn't use the camera. Using the mouse instead.");
    return startMouse();
  }
  calibrate();
};
$("mouseBtn").onclick = startMouse;
function startMouse() { mode = "mouse"; look(); }

/* ---------- step 2: calibration (9 dots) ---------- */
function calibrate() {
  $("calHead").textContent = `Look at each dot and click it ${CLICKS_PER_DOT} times`;
  const spots = [[10,12],[50,12],[90,12],[10,50],[50,50],[90,50],[10,88],[50,88],[90,88]];
  const box = $("dots"); box.innerHTML = "";
  let left = spots.length;
  $("calCount").textContent = `${left} dots left · the number on each dot = clicks left`;
  spots.forEach(([x, y]) => {
    const b = document.createElement("button");
    b.className = "cal-dot"; b.style.left = x + "%"; b.style.top = y + "%";
    b.setAttribute("aria-label", `Calibration dot: click ${CLICKS_PER_DOT} times`);
    b.textContent = CLICKS_PER_DOT;            // the number shows how many clicks are left on this dot
    let clicks = 0;
    b.onclick = () => {                      // WebGazer learns from each click automatically
      clicks++;
      b.textContent = clicks < CLICKS_PER_DOT ? CLICKS_PER_DOT - clicks : "✓";
      b.style.transform = `scale(${1 - clicks * 0.06})`;
      if (clicks >= CLICKS_PER_DOT) {
        b.classList.add("done"); left--;
        $("calCount").textContent = left ? `${left} dots left` : "Great! Get ready…";
        if (!left) setTimeout(accuracyCheck, 600);
      }
    };
    box.appendChild(b);
  });
  $("calib").classList.add("on");
}

/* ---------- step 2b: accuracy check (like real eye-tracking labs do) ----------
   The person just LOOKS at 5 dots (no clicking). We measure how far the tracker's guess is
   from each dot, then subtract that constant offset from every later gaze point. */
async function accuracyCheck() {
  const box = $("dots"); box.innerHTML = "";
  $("calHead").textContent = "Now just look at the pink dot";
  $("calCount").textContent = "No clicking. Follow it with your eyes and keep your head still.";
  const spots = [[50, 50], [20, 20], [80, 20], [80, 80], [20, 80], [50, 50]];
  const dot = document.createElement("div"); dot.className = "cal-dot check"; box.appendChild(dot);
  const med = (a) => a.slice().sort((m, n) => m - n)[a.length >> 1];
  const pts = [];                                       // [true x, guessed x, true y, guessed y]
  for (const [px, py] of spots) {
    dot.style.left = px + "%"; dot.style.top = py + "%";
    await wait(700);                                    // let the eyes land
    checking = []; await wait(1500);                    // longer, so slow webcams still collect enough readings
    const got = checking; checking = null;
    if (got.length < 3) continue;
    pts.push([px / 100 * innerWidth, med(got.map(g => g.x)), py / 100 * innerHeight, med(got.map(g => g.y))]);
  }
  box.innerHTML = "";
  if (pts.length < 3) { fix = { ax: 1, bx: 0, ay: 1, by: 0 }; return finishCalib(null); }
  // straight-line fit per axis: true = a * guess + b (fixes both an offset and a squashed range)
  const fit = (T, G) => {
    const n = T.length, mg = G.reduce((s, v) => s + v, 0) / n, mt = T.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0; for (let i = 0; i < n; i++) { num += (G[i] - mg) * (T[i] - mt); den += (G[i] - mg) ** 2; }
    let a = den > 1 ? num / den : 1; if (!(a > 0.6 && a < 2.2)) a = 1;   // keep it sane
    return { a, b: mt - a * mg };
  };
  const fx = fit(pts.map(p => p[0]), pts.map(p => p[1])), fy = fit(pts.map(p => p[2]), pts.map(p => p[3]));
  fix = { ax: fx.a, bx: fx.b, ay: fy.a, by: fy.b };
  // how far off is it AFTER the correction, as a % of the screen height?
  const err = med(pts.map(([tx, gx, ty, gy]) => Math.hypot(fix.ax * gx + fix.bx - tx, fix.ay * gy + fix.by - ty))) / innerHeight * 100;
  finishCalib(err);
}
function finishCalib(err) {
  // bands chosen for ordinary laptop webcams (they are often 15-25% of the screen off)
  const quality = err == null ? "unknown" : err < 15 ? "good" : err < 25 ? "ok" : "rough";
  $("calHead").textContent = quality === "good" ? "Tracking looks good ✓" : quality === "ok" ? "Tracking is okay ✓" : quality === "rough" ? "Your camera is a bit blurry" : "Ready";
  $("calCount").textContent = quality === "rough"
    ? "That's fine. We'll still run the test, results will just be a bit rougher. More light on your face helps."
    : "Get ready…";
  const box = $("dots"); box.innerHTML = "";
  const row = document.createElement("div"); row.className = "cal-actions";
  const go = document.createElement("button"); go.className = "btn"; go.textContent = "Start the test →";
  const again = document.createElement("button"); again.className = "btn-ghost"; again.textContent = "Redo the dots";
  row.append(go, again); box.appendChild(row);
  let started = false;
  const start = () => { if (started) return; started = true; $("calib").classList.remove("on"); look(); };
  go.onclick = start;
  again.onclick = () => { started = true; try { webgazer.clearData(); } catch (e) {} fix = { ax: 1, bx: 0, ay: 1, by: 0 }; calibrate(); };
  setTimeout(start, quality === "rough" ? 4000 : 1500);   // never blocks: starts by itself
}

/* ---------- step 3: the 3-second glance ---------- */
async function look() {
  const img = $("lookImg");
  img.src = data.image;
  await img.decode().catch(() => {});
  $("look").classList.add("on");
  for (const n of ["3", "2", "1"]) { $("countTxt").textContent = `Get ready… ${n}`; img.style.opacity = "0"; await wait(650); }
  $("countTxt").textContent = mode === "mouse" ? "Move your mouse where your eyes go" : "Look at the poster";
  img.style.opacity = "1";
  samples = []; recording = true;
  await wait(LOOK_MS);
  recording = false;
  const rect = img.getBoundingClientRect();
  $("look").classList.remove("on");
  if (mode === "camera" && window.webgazer) { try { webgazer.pause(); } catch (e) {} }
  analyse(rect);
}

/* ---------- step 4: compare with the AI ---------- */
function analyse(rect) {
  const r = data.result;
  // gaze points -> percent of the poster
  const pts = samples
    .map(s => ({ x: (s.x - rect.left) / rect.width * 100, y: (s.y - rect.top) / rect.height * 100, t: s.t }))
    .filter(p => p.x >= -5 && p.x <= 105 && p.y >= -5 && p.y <= 105);

  // 1) skip the first moment: eyes are still landing from wherever they were before the poster appeared
  const t0 = pts.length ? pts[0].t : 0;
  const live = pts.filter(p => p.t - t0 >= SETTLE_MS);

  // 2) smooth the webcam jitter: median of everything within a quarter of a second either side
  //    (time-based, so slow webcams with only ~8 readings a second are treated the same as fast ones)
  const med = (a) => a.slice().sort((m, n) => m - n)[a.length >> 1];
  const smooth = live.map((p) => {
    const win = live.filter(q => Math.abs(q.t - p.t) <= 250);
    return { x: med(win.map(q => q.x)), y: med(win.map(q => q.y)), t: p.t };
  });

  // 3) which part is each moment on? inside a box (smallest wins), else the nearest box if it's close
  const byArea = [...r.elements].sort((a, b) => a.box[2] * a.box[3] - b.box[2] * b.box[3]);
  const dist = (p, b) => Math.hypot(Math.max(b[0] - p.x, 0, p.x - b[0] - b[2]), Math.max(b[1] - p.y, 0, p.y - b[1] - b[3]));
  const hit = (p) => {
    const inside = byArea.find(e => dist(p, e.box) === 0);
    if (inside) return inside.label;
    const near = [...r.elements].sort((a, b) => dist(p, a.box) - dist(p, b.box))[0];
    return near && dist(p, near.box) <= NEAR_PCT ? near.label : null;
  };

  // 4) order the parts by WHEN most of the looking at them happened (the middle of their look time).
  //    Webcam wobble spills a few stray dots onto neighbours at random times; a real look is bunched
  //    together, so its middle moment is a much steadier signal than "first dot to land there".
  const times = {};
  smooth.forEach((p, i) => {
    const h = hit(p); if (!h) return;
    const dt = i ? Math.min(200, p.t - smooth[i - 1].t) : 0;
    (times[h] = times[h] || []).push({ t: p.t, dt });
  });
  const dwellTotals = {};
  const youOrder = Object.entries(times)
    .map(([label, arr]) => {
      const total = arr.reduce((s, q) => s + q.dt, 0);
      let acc = 0, mid = arr[0].t;
      for (const q of arr) { acc += q.dt; if (acc >= total / 2) { mid = q.t; break; } }
      dwellTotals[label] = total;
      return { label, total, mid };
    })
    .filter(e => e.total >= MIN_DWELL_MS)                  // a part only counts if it really got looked at
    .sort((a, b) => a.mid - b.mid)
    .map(e => e.label);
  const aiOrder = r.eye_path.map(p => p.label).filter((l, i, a) => l && a.indexOf(l) === i);

  const pct = matchPct(aiOrder, youOrder, dwellTotals);
  const target = r.target || (r.elements.find(e => e.is_target) || {}).label;
  const tYou = youOrder.indexOf(target), tAi = aiOrder.indexOf(target);

  renderResult({ pts, youOrder, aiOrder, pct, target, tYou, tAi });
  saveBoard(pct, tYou);
  saveCrowd(pts, youOrder, dwellTotals);
  drawCrowd();
}


/* ---------- thermal-camera heatmap (shared by "you" and "crowd") ---------- */
// cold -> hot, like a thermal camera: deep blue, purple, red, orange, yellow, white
const THERMAL = [[0, [8, 10, 60]], [0.18, [40, 20, 140]], [0.36, [140, 20, 150]], [0.54, [230, 40, 60]], [0.72, [255, 130, 20]], [0.88, [255, 225, 60]], [1, [255, 255, 235]]];
function thermalColour(t) {
  for (let k = 1; k < THERMAL.length; k++) if (t <= THERMAL[k][0]) {
    const [a0, ca] = THERMAL[k - 1], [a1, cb] = THERMAL[k], f = (t - a0) / (a1 - a0);
    return ca.map((v, j) => v + (cb[j] - v) * f);
  }
  return THERMAL[THERMAL.length - 1][1];
}
// people = [[ [x%, y%], ... ], ...]  (one list of gaze dots per person)
async function paintThermal(canvas, img, people) {
  if (!img.complete || !img.naturalWidth) await new Promise(res => { img.addEventListener("load", res, { once: true }); img.addEventListener("error", res, { once: true }); });
  const W = 240, H = Math.max(1, Math.round(W * (img.naturalHeight || 4) / (img.naturalWidth || 3)));
  canvas.width = W; canvas.height = H;
  const grid = new Float32Array(W * H);
  const rad = Math.round(W * 0.09), sig2 = 2 * (rad / 2.2) ** 2;
  people.forEach(dots => {
    const per = new Float32Array(W * H);                    // each person counts equally
    dots.forEach(([x, y]) => {
      const cx = Math.round(x / 100 * W), cy = Math.round(y / 100 * H);
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const X = cx + dx, Y = cy + dy;
        if (X >= 0 && X < W && Y >= 0 && Y < H) per[Y * W + X] += Math.exp(-(dx * dx + dy * dy) / sig2);
      }
    });
    let m = 0; for (const v of per) m = Math.max(m, v);
    if (m) for (let i = 0; i < per.length; i++) grid[i] += per[i] / m;
  });
  let mx = 0; for (const v of grid) mx = Math.max(mx, v);
  const ctx = canvas.getContext("2d"), out = ctx.createImageData(W, H);
  for (let i = 0; i < grid.length; i++) {
    const t = mx ? Math.pow(grid[i] / mx, 0.7) : 0;
    const c = thermalColour(t);
    out.data[i * 4] = c[0]; out.data[i * 4 + 1] = c[1]; out.data[i * 4 + 2] = c[2];
    out.data[i * 4 + 3] = Math.round(255 * (0.84 + 0.14 * t));   // cold areas stay see-through enough to read the poster
  }
  ctx.putImageData(out, 0, 0);
}

function renderResult({ pts, youOrder, aiOrder, pct, target, tYou, tAi }) {
  show("sResult");
  $("cmpImg").src = data.image;
  const r = data.result;
  $("aiLine").setAttribute("points", r.eye_path.map(p => `${p.x},${p.y}`).join(" "));

  // your path: one point per element you looked at (centre of where you looked)
  const yourPts = youOrder.map(l => {
    const e = r.elements.find(x => x.label === l);
    const mine = pts.filter(p => p.x >= e.box[0] && p.x <= e.box[0] + e.box[2] && p.y >= e.box[1] && p.y <= e.box[1] + e.box[3]);
    const avg = (k) => mine.length ? mine.reduce((s, p) => s + p[k], 0) / mine.length : (k === "x" ? e.box[0] + e.box[2] / 2 : e.box[1] + e.box[3] / 2);
    return { x: avg("x"), y: avg("y") };
  });
  $("youLine").setAttribute("points", yourPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "));

  paintThermal($("youHeat"), $("cmpImg"), [pts.map(p => [p.x, p.y])]);
  $("tagLayer").innerHTML =
    r.eye_path.map((p, i) => `<div class="tag ai" style="left:${p.x}%;top:${p.y}%">0${i + 1}</div>`).join("") +
    yourPts.map((p, i) => `<div class="tag you" style="left:calc(${p.x}% + 18px);top:calc(${p.y}% + 18px)">${i + 1}</div>`).join("");

  const pill = (l, cls, match) => `<span class="pill ${cls}${match ? " match" : ""}">${l === target ? "★ " : ""}${l}</span>`;
  $("aiSeq").innerHTML = aiOrder.map((l, i) => pill(l, "ai", youOrder[i] === l)).join("→") || "—";
  $("youSeq").innerHTML = youOrder.map((l, i) => pill(l, "you", aiOrder[i] === l)).join("→") || `<span class="muted">No clear look detected</span>`;

  $("matchNum").textContent = pct + "%";
  $("matchNum").style.color = pct >= 85 ? "var(--good)" : pct >= 70 ? "var(--ok)" : "var(--warn)";
  $("matchSub").textContent = youOrder.length ? `Your eyes followed the AI's prediction on ${pct >= 85 ? "almost every step" : pct >= 70 ? "most steps" : "some steps"}.` : "We couldn't follow your eyes well. Try again with better light.";
  $("resHead").innerHTML = pct >= 70
    ? `Saccade guessed your eyes <span class="serif">${pct >= 85 ? "almost perfectly." : "pretty well."}</span>`
    : `Your eyes took <span class="serif">their own path.</span>`;

  let msg = "";
  if (target) {
    msg = tYou === -1
      ? `<b>You never looked at ★ ${target}</b>, the thing this poster wants you to notice. The AI predicted it would come ${tAi + 1}${["st","nd","rd"][tAi] || "th"}. That's exactly the problem Saccade fixes.`
      : `<b>You noticed ★ ${target} ${tYou + 1}${["st","nd","rd"][tYou] || "th"}.</b> ${tYou > 1 ? "Most people walking past would have looked away by then." : "Great, the message got through."}`;
  }
  $("msgBox").innerHTML = msg + (mode === "mouse" ? `<p class="note" style="margin: 8px 0 0">Mouse mode: this used your mouse, not your eyes.</p>` : "");
}

/* ---------- scoreboard across everyone (this laptop only) ---------- */
function readBoard() { try { return JSON.parse(localStorage.getItem("saccade:board") || "[]"); } catch (e) { return []; } }
function saveBoard(pct, tYou) {
  const b = readBoard(); b.push({ pct, early: tYou >= 0 && tYou <= 1 });
  try { localStorage.setItem("saccade:board", JSON.stringify(b)); } catch (e) {}
  drawBoard(b);
}
function drawBoard(b) {
  $("bPeople").textContent = b.length;
  $("bAvg").textContent = b.length ? Math.round(b.reduce((s, x) => s + x.pct, 0) / b.length) + "%" : "–";
  $("bTarget").textContent = b.length ? `${b.filter(x => x.early).length}/${b.length}` : "–";
}
drawBoard(readBoard());
$("resetBoard").onclick = () => {
  try { localStorage.removeItem("saccade:board"); localStorage.removeItem("saccade:" + posterKey()); } catch (e) {}
  drawBoard([]); drawCrowd();
};

$("againBtn").onclick = () => {
  if (mode === "camera" && window.webgazer) { try { webgazer.clearData(); webgazer.resume(); } catch (e) {} fix = { ax: 1, bx: 0, ay: 1, by: 0 }; calibrate(); }
  else look();
};
window.addEventListener("beforeunload", () => { try { window.webgazer && webgazer.end(); } catch (e) {} });


// match score: how well your eyes agreed with the AI, built from three parts so it moves smoothly
//   45%  order       share of pairs of parts you looked at in the same order as the AI
//   25%  first look  your first look = the AI's #1 (full), or its #2 (half)
//   30%  attention   how your looking time was shared out vs the AI's ranking (more time on its top picks)
// Tested with simulated jittery webcams: same order ~90%, one swap ~75%, random order ~60%, reverse ~20%.
function matchPct(aiOrder, youOrder, dwell) {
  if (!youOrder.length || !aiOrder.length) return 0;
  const both = aiOrder.filter(l => youOrder.includes(l));
  let order = 0.5;
  if (both.length >= 2) {
    let agree = 0, pairs = 0;
    for (let i = 0; i < both.length; i++) for (let j = i + 1; j < both.length; j++) { pairs++; if (youOrder.indexOf(both[i]) < youOrder.indexOf(both[j])) agree++; }
    order = agree / pairs;
  } else if (both.length === 1) order = youOrder[0] === aiOrder[0] ? 1 : 0.5;
  const first = youOrder[0] === aiOrder[0] ? 1 : (youOrder[0] === aiOrder[1] || youOrder[1] === aiOrder[0]) ? 0.5 : 0;
  if (!dwell) return Math.round(100 * (0.6 * order + 0.4 * first));
  const W = aiOrder.map((_, i) => Math.max(0.05, 0.4 - 0.1 * i)), wSum = W.reduce((s, v) => s + v, 0);
  const tSum = aiOrder.reduce((s, l) => s + (dwell[l] || 0), 0) || 1;
  const attention = aiOrder.reduce((s, l, i) => s + Math.min(W[i] / wSum, (dwell[l] || 0) / tSum), 0);
  return Math.round(100 * (0.45 * order + 0.25 * first + 0.3 * attention));
}

/* ---------- crowd view: everyone's eyes on this poster ---------- */
function posterKey() {                      // same poster -> same crowd
  const img = String(data.image);
  if (img.length < 200) return "crowd:" + img;
  let h = 0; for (let i = 0; i < img.length; i += 97) h = (h * 31 + img.charCodeAt(i)) | 0;
  return "crowd:" + img.length + ":" + h;
}
function readCrowd() { try { return JSON.parse(localStorage.getItem("saccade:" + posterKey()) || "[]"); } catch (e) { return []; } }
function saveCrowd(pts, order, dwell) {
  if (!pts.length) return;
  const crowd = readCrowd();
  const step = Math.max(1, Math.floor(pts.length / 60));  // keep ~60 anonymous dots per person
  crowd.push({ p: pts.filter((_, i) => i % step === 0).map(q => [+q.x.toFixed(1), +q.y.toFixed(1)]), o: order, d: dwell || null, m: mode === "mouse" ? 1 : 0 });
  try { localStorage.setItem("saccade:" + posterKey(), JSON.stringify(crowd.slice(-60))); } catch (e) {}
}

function drawCrowd() {
  const crowd = readCrowd();
  const r = data.result;
  const nMouse = crowd.filter(c => c.m).length;
  $("crowdN").textContent = (crowd.length === 1 ? "1 person" : `${crowd.length} people`);
  $("crowdMouse").textContent = nMouse ? `${nMouse} of ${crowd.length} used the mouse, not their eyes. Use the camera for real results.` : "";
  $("crowdEmpty").hidden = crowd.length > 0;
  $("crowdImg").src = data.image;
  $("crowdAiLine").setAttribute("points", r.eye_path.map(p => `${p.x},${p.y}`).join(" "));
  $("crowdTags").innerHTML = r.eye_path.map((p, i) => `<div class="tag ai" style="left:${p.x}%;top:${p.y}%">0${i + 1}</div>`).join("");

  // heatmap
  const cv = $("crowdHeat");
  if (crowd.length) { cv.hidden = false; paintThermal(cv, $("crowdImg"), crowd.map(c => c.p)); }
  else cv.hidden = true;

  // stats
  if (!crowd.length) {
    $("crowdFirst").textContent = "–"; $("crowdFirstSub").textContent = "Test a few people to fill this in.";
    $("crowdTarget").textContent = "–"; $("crowdTargetSub").textContent = ""; $("crowdBars").innerHTML = ""; $("crowdMatch").textContent = "–"; return;
  }
  const firsts = {}; crowd.forEach(c => { const f = c.o[0] || "nothing clear"; firsts[f] = (firsts[f] || 0) + 1; });
  const [topFirst, nFirst] = Object.entries(firsts).sort((a, b) => b[1] - a[1])[0];
  const aiFirst = r.eye_path[0] && r.eye_path[0].label;
  $("crowdFirst").textContent = `${topFirst} (${nFirst}/${crowd.length})`;
  $("crowdFirstSub").textContent = topFirst === aiFirst ? "✓ The AI predicted this would be first." : `The AI predicted "${aiFirst}" would be first.`;
  const aiOrder = r.eye_path.map(p => p.label).filter((l, i, a) => l && a.indexOf(l) === i);
  const avg = Math.round(crowd.reduce((s, c) => s + matchPct(aiOrder, c.o, c.d), 0) / crowd.length);
  $("crowdMatch").textContent = avg + "%";
  $("crowdMatch").style.color = avg >= 85 ? "var(--good)" : avg >= 70 ? "var(--ok)" : "var(--warn)";
  const target = r.target || (r.elements.find(e => e.is_target) || {}).label;
  const early = crowd.filter(c => { const i = c.o.indexOf(target); return i === 0 || i === 1; }).length;
  $("crowdTarget").textContent = target ? `${early}/${crowd.length} people` : "–";
  $("crowdTargetSub").textContent = target ? `Your message: ★ ${target}` : "No message was marked for this poster.";
  const labels = [...new Set(r.elements.map(e => e.label))];
  $("crowdBars").innerHTML = labels.map(l => {
    const n = crowd.filter(c => c.o.includes(l)).length, pctSeen = Math.round(n / crowd.length * 100);
    return `<div><div style="display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 4px"><span>${l === target ? "★ " : ""}${l}</span><b>${n}/${crowd.length} saw it</b></div>
      <div class="track"><div class="fill" style="width: ${pctSeen}%; background: ${l === target ? "var(--accent)" : "var(--pearl)"}"></div></div></div>`;
  }).join("");
}

// save the crowd view as a picture for the slides
$("saveCrowd").onclick = async () => {
  const img = $("crowdImg"), heat = $("crowdHeat");
  const W = 1200, ph = Math.round(700 * img.naturalHeight / img.naturalWidth), H = Math.max(ph + 120, 900);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#120709"; ctx.fillRect(0, 0, W, H);
  const pw = Math.round(700 * Math.min(1, (H - 140) / ph)), phh = Math.round(pw * img.naturalHeight / img.naturalWidth);
  ctx.filter = "grayscale(1) contrast(1.2)"; ctx.drawImage(img, 40, 100, pw, phh); ctx.filter = "none";
  if (!heat.hidden) { ctx.imageSmoothingEnabled = true; ctx.drawImage(heat, 40, 100, pw, phh); }
  ctx.strokeStyle = "#F3E6BD"; ctx.setLineDash([8, 6]); ctx.lineWidth = 2; ctx.beginPath();
  data.result.eye_path.forEach((p, i) => { const x = 40 + p.x / 100 * pw, y = 100 + p.y / 100 * phh; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = "#F7EEDC"; ctx.font = "700 40px Inter, sans-serif"; ctx.fillText("Where " + $("crowdN").textContent + " actually looked", 40, 64);
  ctx.font = "600 26px Inter, sans-serif";
  const lines = [["Looked at first", $("crowdFirst").textContent], ["Saw the message early", $("crowdTarget").textContent], ["AI matched this crowd", $("crowdMatch").textContent]];
  lines.forEach(([k, v], i) => { ctx.fillStyle = "#C2ACA2"; ctx.fillText(k, 40 + pw + 50, 160 + i * 110); ctx.fillStyle = "#FD9BB7"; ctx.font = "800 36px Inter, sans-serif"; ctx.fillText(v, 40 + pw + 50, 205 + i * 110); ctx.font = "600 26px Inter, sans-serif"; });
  ctx.fillStyle = "#C2ACA2"; ctx.font = "500 20px Inter, sans-serif"; ctx.fillText("Saccade · Glance Test · dashed = AI prediction · white-hot = most looked at", 40, H - 24);
  const a = document.createElement("a"); a.download = "saccade-crowd-heatmap.png"; a.href = c.toDataURL("image/png"); a.click();
};
drawCrowd();
