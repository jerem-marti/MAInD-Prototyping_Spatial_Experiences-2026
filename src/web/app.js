const feed = document.getElementById("feed");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");

const btnMode = document.getElementById("mode");
const btnSnap = document.getElementById("snap");
const statusEl = document.getElementById("status");

let mode = 0; // 0 AP, 1 BT, 2 both
let state = null;

function resize() {
  overlay.width = overlay.clientWidth;
  overlay.height = overlay.clientHeight;
}
window.addEventListener("resize", resize);
resize();

function hashToXY(hex, w, h) {
  const a = parseInt(hex.slice(0, 8), 16) || 1;
  const b = parseInt(hex.slice(8, 16), 16) || 2;
  const x = (a % 10000) / 10000;
  const y = (b % 10000) / 10000;
  return [Math.floor(x * w), Math.floor(y * h)];
}

function drawFog(x, y, strength, t) {
  const base = 40 + 180 * strength;
  const wob = 8 * Math.sin(t * 1.7 + x * 0.01);
  const r1 = base + wob;
  const r2 = r1 * 0.6;
  const r3 = r1 * 0.35;

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = `rgba(255,255,255,${0.10 + 0.28 * strength})`;
  ctx.beginPath(); ctx.arc(x, y, r1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = `rgba(255,255,255,${0.08 + 0.22 * strength})`;
  ctx.beginPath(); ctx.arc(x, y, r2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = `rgba(255,255,255,${0.05 + 0.14 * strength})`;
  ctx.beginPath(); ctx.arc(x, y, r3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawSparks(x, y, strength, t) {
  const n = Math.floor(3 + 18 * strength);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < n; i++) {
    const ang = (i * 2.399963) + t * (0.8 + strength);
    const rad = (8 + 110 * strength) * (0.3 + 0.7 * ((i % 7) / 6));
    const px = Math.floor(x + Math.cos(ang) * rad);
    const py = Math.floor(y + Math.sin(ang) * rad);
    const a = 0.15 + 0.55 * strength * (0.5 + 0.5 * Math.sin(t * 6 + i));
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.beginPath();
    ctx.arc(px, py, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function render(tMs) {
  const t = tMs / 1000;
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  const w = overlay.width, h = overlay.height;
  const aps = state?.wifi?.aps || [];
  const bts = state?.bt?.devices || [];

  if (mode === 0 || mode === 2) {
    aps.slice(0, 25).forEach(ap => {
      const [x, y] = hashToXY(ap.id || "0", w, h);
      drawFog(x, y, ap.strength || 0, t);
    });
  }

  if (mode === 1 || mode === 2) {
    bts.slice(0, 40).forEach(bt => {
      const [x, y] = hashToXY(bt.id || "1", w, h);
      drawSparks(x, y, bt.strength || 0, t);
    });
  }

  requestAnimationFrame(render);
}
requestAnimationFrame(render);

function setMode(m) {
  mode = ((m % 3) + 3) % 3;
  const label = mode === 0 ? "AP fog" : mode === 1 ? "BT sparks" : "Both";
  statusEl.textContent = `mode: ${label} | AP:${state?.wifi?.aps?.length || 0} BT:${state?.bt?.devices?.length || 0}`;
}

btnMode.onclick = () => {
  // local immediate + inform backend so GPIO stays consistent
  const next = (mode + 1) % 3;
  wsSend({ type: "set_mode", mode: next });
};

btnSnap.onclick = () => {
  // request snapshot (also used by GPIO)
  wsSend({ type: "snapshot_request" });
};

function captureSnapshotDataURL() {
  // Create an offscreen canvas that combines camera feed + overlay
  const c = document.createElement("canvas");
  c.width = overlay.width;
  c.height = overlay.height;
  const cctx = c.getContext("2d");

  // draw current camera frame (img is same-origin so this is allowed)
  cctx.drawImage(feed, 0, 0, c.width, c.height);
  cctx.drawImage(overlay, 0, 0, c.width, c.height);

  return c.toDataURL("image/png");
}

async function uploadSnapshot() {
  try {
    const data_url = captureSnapshotDataURL();
    await fetch("/api/upload_snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data_url })
    });
  } catch (e) {
    console.error("snapshot upload failed:", e);
  }
}

let ws;

function wsSend(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function connect() {
  ws = new WebSocket(`ws://${location.host}/ws`);

  ws.onopen = () => { statusEl.textContent = "connected"; };
  ws.onclose = () => { statusEl.textContent = "disconnected (retrying)"; setTimeout(connect, 800); };

  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "state") {
      state = msg.state;
      setMode(mode);
    }
    if (msg.type === "mode") {
      setMode(msg.mode);
    }
    if (msg.type === "snapshot") {
      await uploadSnapshot();
    }
  };
}
connect();
