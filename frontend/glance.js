/* =========================================================
   Saccade · Glance Test
   Compares the AI's predicted eye path with a real person's eyes.
   Uses the poster + result from the main page (sessionStorage),
   or the Bloom Café example if nothing was analysed yet.
   ========================================================= */

const LOOK_MS = 3000;          // how long people look at the poster
const MIN_DWELL_MS = 120;      // must look this long at an element to count as "seen"
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

function onGaze(x, y) {
  if (recording && x != null && y != null) samples.push({ x, y, t: performance.now() });
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
  const spots = [[10,12],[50,12],[90,12],[10,50],[50,50],[90,50],[10,88],[50,88],[90,88]];
  const box = $("dots"); box.innerHTML = "";
  let left = spots.length;
  $("calCount").textContent = `${left} dots left`;
  spots.forEach(([x, y]) => {
    const b = document.createElement("button");
    b.className = "cal-dot"; b.style.left = x + "%"; b.style.top = y + "%";
    b.setAttribute("aria-label", "Calibration dot");
    let clicks = 0;
    b.onclick = () => {                      // WebGazer learns from each click automatically
      clicks++;
      b.style.opacity = String(1 - clicks * 0.25);
      if (clicks >= 3) {
        b.classList.add("done"); left--;
        $("calCount").textContent = left ? `${left} dots left` : "Great! Get ready…";
        if (!left) setTimeout(() => { $("calib").classList.remove("on"); look(); }, 700);
      }
    };
    box.appendChild(b);
  });
  $("calib").classList.add("on");
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

  const inBox = (p, b) => p.x >= b[0] - 3 && p.x <= b[0] + b[2] + 3 && p.y >= b[1] - 3 && p.y <= b[1] + b[3] + 3;
  // which element was each point on? (smallest box wins, so the small offer beats the big photo)
  const byArea = [...r.elements].sort((a, b) => a.box[2] * a.box[3] - b.box[2] * b.box[3]);
  const hit = (p) => (byArea.find(e => inBox(p, e.box)) || {}).label || null;

  // human order: first time each element is looked at for at least MIN_DWELL_MS
  const youOrder = []; let cur = null, since = 0;
  pts.forEach(p => {
    const h = hit(p);
    if (h !== cur) { cur = h; since = p.t; }
    if (h && !youOrder.includes(h) && p.t - since >= MIN_DWELL_MS) youOrder.push(h);
  });
  const aiOrder = r.eye_path.map(p => p.label).filter((l, i, a) => l && a.indexOf(l) === i);

  const pct = matchPct(aiOrder, youOrder);
  const target = r.target || (r.elements.find(e => e.is_target) || {}).label;
  const tYou = youOrder.indexOf(target), tAi = aiOrder.indexOf(target);

  renderResult({ pts, youOrder, aiOrder, pct, target, tYou, tAi });
  saveBoard(pct, tYou);
  saveCrowd(pts, youOrder);
  drawCrowd();
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

  $("heatLayer").innerHTML = pts.filter((_, i) => i % 2 === 0).map(p =>
    `<div class="heat" style="left:${p.x}%;top:${p.y}%"></div>`).join("");
  $("tagLayer").innerHTML =
    r.eye_path.map((p, i) => `<div class="tag ai" style="left:${p.x}%;top:${p.y}%">0${i + 1}</div>`).join("") +
    yourPts.map((p, i) => `<div class="tag you" style="left:calc(${p.x}% + 18px);top:calc(${p.y}% + 18px)">${i + 1}</div>`).join("");

  const pill = (l, cls, match) => `<span class="pill ${cls}${match ? " match" : ""}">${l === target ? "★ " : ""}${l}</span>`;
  $("aiSeq").innerHTML = aiOrder.map((l, i) => pill(l, "ai", youOrder[i] === l)).join("→") || "—";
  $("youSeq").innerHTML = youOrder.map((l, i) => pill(l, "you", aiOrder[i] === l)).join("→") || `<span class="muted">No clear look detected</span>`;

  $("matchNum").textContent = pct + "%";
  $("matchNum").style.color = pct >= 75 ? "var(--good)" : pct >= 50 ? "var(--ok)" : "var(--warn)";
  $("matchSub").textContent = youOrder.length ? `Your eyes followed the AI's prediction on ${pct >= 75 ? "almost every step" : pct >= 50 ? "most steps" : "some steps"}.` : "We couldn't follow your eyes well. Try again with better light.";
  $("resHead").innerHTML = pct >= 50
    ? `Saccade guessed your eyes <span class="serif">${pct >= 75 ? "almost perfectly." : "pretty well."}</span>`
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
  if (mode === "mouse") { drawBoard(readBoard()); return; }     // only count real eyes
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
$("resetBoard").onclick = () => { try { localStorage.removeItem("saccade:board"); } catch (e) {} drawBoard([]); };

$("againBtn").onclick = () => {
  if (mode === "camera" && window.webgazer) { try { webgazer.clearData(); webgazer.resume(); } catch (e) {} calibrate(); }
  else look();
};
window.addEventListener("beforeunload", () => { try { window.webgazer && webgazer.end(); } catch (e) {} });


// match score: same position = full point, off by one = half point
function matchPct(aiOrder, youOrder) {
  let score = 0;
  aiOrder.forEach((l, i) => { const j = youOrder.indexOf(l); if (j === i) score += 1; else if (j !== -1 && Math.abs(j - i) === 1) score += 0.5; });
  return aiOrder.length ? Math.round(score / aiOrder.length * 100) : 0;
}

/* ---------- crowd view: everyone's eyes on this poster ---------- */
function posterKey() {                      // same poster -> same crowd
  const img = String(data.image);
  if (img.length < 200) return "crowd:" + img;
  let h = 0; for (let i = 0; i < img.length; i += 97) h = (h * 31 + img.charCodeAt(i)) | 0;
  return "crowd:" + img.length + ":" + h;
}
function readCrowd() { try { return JSON.parse(localStorage.getItem("saccade:" + posterKey()) || "[]"); } catch (e) { return []; } }
function saveCrowd(pts, order) {
  if (mode === "mouse" || !pts.length) return;             // only real eyes
  const crowd = readCrowd();
  const step = Math.max(1, Math.floor(pts.length / 60));  // keep ~60 anonymous dots per person
  crowd.push({ p: pts.filter((_, i) => i % step === 0).map(q => [+q.x.toFixed(1), +q.y.toFixed(1)]), o: order });
  try { localStorage.setItem("saccade:" + posterKey(), JSON.stringify(crowd.slice(-60))); } catch (e) {}
}

function drawCrowd() {
  const crowd = readCrowd();
  const r = data.result;
  $("crowdN").textContent = crowd.length === 1 ? "1 person" : `${crowd.length} people`;
  $("crowdImg").src = data.image;
  $("crowdAiLine").setAttribute("points", r.eye_path.map(p => `${p.x},${p.y}`).join(" "));
  $("crowdTags").innerHTML = r.eye_path.map((p, i) => `<div class="tag ai" style="left:${p.x}%;top:${p.y}%">0${i + 1}</div>`).join("");

  // heatmap
  const img = $("crowdImg");
  const paint = () => {
    const cv = $("crowdHeat");
    const W = 300, H = Math.round(300 * (img.naturalHeight || 4) / (img.naturalWidth || 3));
    cv.width = W; cv.height = H;
    const grid = new Float32Array(W * H);
    const rad = Math.round(W * 0.06), sig2 = 2 * (rad / 2) ** 2;
    crowd.forEach(person => person.p.forEach(([x, y]) => {
      const cx = Math.round(x / 100 * W), cy = Math.round(y / 100 * H);
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const X = cx + dx, Y = cy + dy;
        if (X >= 0 && X < W && Y >= 0 && Y < H) grid[Y * W + X] += Math.exp(-(dx * dx + dy * dy) / sig2);
      }
    }));
    let mx = 0; for (const v of grid) mx = Math.max(mx, v);
    const ctx = cv.getContext("2d"), out = ctx.createImageData(W, H);
    for (let i = 0; i < grid.length; i++) {
      const t = mx ? grid[i] / mx : 0;
      // cherry -> cotton candy -> pearl, transparent where nobody looked
      const stops = [[0, [173, 40, 49]], [0.4, [253, 155, 183]], [0.75, [255, 214, 120]], [1, [255, 248, 225]]];
      let c = stops[0][1];
      for (let k = 1; k < stops.length; k++) if (t <= stops[k][0]) { const [a0, ca] = stops[k - 1], [a1, cb] = stops[k], f = (t - a0) / (a1 - a0); c = ca.map((v, j) => v + (cb[j] - v) * f); break; }
      out.data[i * 4] = c[0]; out.data[i * 4 + 1] = c[1]; out.data[i * 4 + 2] = c[2];
      out.data[i * 4 + 3] = t < 0.05 ? 0 : Math.round(255 * Math.min(0.85, 0.25 + t));
    }
    ctx.putImageData(out, 0, 0);
  };
  if (img.complete && img.naturalWidth) paint(); else img.onload = paint;

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
  const avg = Math.round(crowd.reduce((s, c) => s + matchPct(aiOrder, c.o), 0) / crowd.length);
  $("crowdMatch").textContent = avg + "%";
  $("crowdMatch").style.color = avg >= 75 ? "var(--good)" : avg >= 50 ? "var(--ok)" : "var(--warn)";
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
  ctx.drawImage(img, 40, 100, pw, phh);
  ctx.fillStyle = "rgba(18,7,9,0.55)"; ctx.fillRect(40, 100, pw, phh);
  ctx.drawImage(heat, 40, 100, pw, phh);
  ctx.strokeStyle = "#F3E6BD"; ctx.setLineDash([8, 6]); ctx.lineWidth = 2; ctx.beginPath();
  data.result.eye_path.forEach((p, i) => { const x = 40 + p.x / 100 * pw, y = 100 + p.y / 100 * phh; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = "#F7EEDC"; ctx.font = "700 40px Inter, sans-serif"; ctx.fillText("Where " + $("crowdN").textContent + " actually looked", 40, 64);
  ctx.font = "600 26px Inter, sans-serif";
  const lines = [["Looked at first", $("crowdFirst").textContent], ["Saw the message early", $("crowdTarget").textContent], ["AI matched this crowd", $("crowdMatch").textContent]];
  lines.forEach(([k, v], i) => { ctx.fillStyle = "#C2ACA2"; ctx.fillText(k, 40 + pw + 50, 160 + i * 110); ctx.fillStyle = "#FD9BB7"; ctx.font = "800 36px Inter, sans-serif"; ctx.fillText(v, 40 + pw + 50, 205 + i * 110); ctx.font = "600 26px Inter, sans-serif"; });
  ctx.fillStyle = "#C2ACA2"; ctx.font = "500 20px Inter, sans-serif"; ctx.fillText("Saccade · Glance Test · dashed = AI prediction, glow = real eyes", 40, H - 24);
  const a = document.createElement("a"); a.download = "saccade-crowd-heatmap.png"; a.href = c.toDataURL("image/png"); a.click();
};
drawCrowd();
