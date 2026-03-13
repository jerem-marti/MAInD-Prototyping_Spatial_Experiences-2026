/**
 * GHOST SIGNAL INSTRUMENT — Shadow Creatures
 * Bootstrap module: WebSocket connection, module initialization, snapshot flow.
 *
 * Connects to the backend WebSocket at /ws, receives ghost_state updates,
 * and feeds them into the telemetry system. Handles mode switching and
 * snapshot capture/upload.
 */

"use strict";

/* -- Global WebSocket State -- */
let _ws = null;

/**
 * Send a JSON message to the backend WebSocket.
 * @param {Object} obj - Message to send
 */
function wsSend(obj) {
    if (_ws && _ws.readyState === WebSocket.OPEN) {
        _ws.send(JSON.stringify(obj));
    }
}

/* -- Snapshot Flow -- */

let _snapFeedbackTimer = null;

function _showSnapshotFeedback(state, text) {
    const el = document.getElementById('snapshot-feedback');
    if (!el) return;
    const textEl = el.querySelector('.snapshot-feedback-text');

    clearTimeout(_snapFeedbackTimer);

    // Reset classes
    el.classList.remove('hidden', 'visible', 'success', 'error');
    if (textEl) textEl.textContent = text;

    if (state === 'loading') {
        // Show with spinner
        void el.offsetWidth; // force reflow
        el.classList.add('visible');
    } else if (state === 'success') {
        el.classList.add('visible', 'success');
        _snapFeedbackTimer = setTimeout(() => _hideSnapshotFeedback(), 1500);
    } else if (state === 'error') {
        el.classList.add('visible', 'error');
        _snapFeedbackTimer = setTimeout(() => _hideSnapshotFeedback(), 2500);
    }
}

function _hideSnapshotFeedback() {
    const el = document.getElementById('snapshot-feedback');
    if (!el) return;
    el.classList.remove('visible');
    // After fade-out transition, hide completely
    setTimeout(() => {
        el.classList.add('hidden');
        el.classList.remove('success', 'error');
    }, 350);
}

function captureSnapshotDataURL() {
    const exportCanvas = Renderer.capture();
    return exportCanvas.toDataURL('image/png');
}

function _blobToBase64(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

async function uploadSnapshot() {
    try {
        _showSnapshotFeedback('loading', 'REGISTERING SNAPSHOT');

        // Yield to browser so the feedback overlay is actually painted
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        // 1. Trigger Live Photo post-capture recording (collects 1.5s more)
        const livePromise = LivePhotoCapture.trigger();

        // 2. Capture still frame immediately
        const data_url = captureSnapshotDataURL();

        // 3. Wait for Live Photo video to finish
        const liveBlob = await livePromise;

        // 4. Build payload
        const payload = { data_url };
        if (liveBlob) {
            payload.live_webm = await _blobToBase64(liveBlob);
        }

        // 5. Upload
        await fetch('/api/upload_snapshot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        _showSnapshotFeedback('success', 'SNAPSHOT SAVED');
        console.log('[App] Snapshot uploaded' + (liveBlob ? ' (with Live Photo)' : ''));
    } catch (e) {
        _showSnapshotFeedback('error', 'SNAPSHOT FAILED');
        console.error('[App] Snapshot upload failed:', e);
    }
}

/* -- Mode Management -- */

function setMode(m) {
    State.mode = ((m % 3) + 3) % 3;
    const label = State.mode === 0 ? 'AP FOG' : State.mode === 1 ? 'BT SPARKS' : 'BOTH';
    const btnMode = document.getElementById('btn-mode');
    if (btnMode) btnMode.textContent = `MODE: ${label}`;
}

/* -- Gallery Management -- */

let _galleryFrame = null;
let _lastBatterySoc = null;

function openGallery() {
    if (State.galleryOpen) return;
    State.galleryOpen = true;
    pauseInstrument();

    _galleryFrame = document.createElement('iframe');
    _galleryFrame.id = 'gallery-frame';
    _galleryFrame.src = '/gallery/';
    _galleryFrame.style.cssText =
        'position:fixed;inset:0;width:100vw;height:100vh;border:none;z-index:1000;background:#000;';

    document.body.appendChild(_galleryFrame);

    const btn = document.getElementById('btn-gallery');
    if (btn) btn.classList.add('active');
}

function closeGallery() {
    if (!State.galleryOpen) return;
    State.galleryOpen = false;

    if (_galleryFrame) {
        _galleryFrame.remove();
        _galleryFrame = null;
    }

    resumeInstrument();

    const btn = document.getElementById('btn-gallery');
    if (btn) btn.classList.remove('active');
}

function toggleGallery() {
    if (State.galleryOpen) closeGallery();
    else openGallery();
}

function pauseInstrument() {
    State.paused = true;
}

function resumeInstrument() {
    State.paused = false;
}

// Listen for close messages from gallery iframe
window.addEventListener('message', function(ev) {
    if (ev.data && ev.data.type === 'gallery_close') {
        closeGallery();
    }
});

/* -- Splash Screen -- */

const _splashStart = Date.now();
const _splashMinMs = 5000;

function dismissSplash() {
    const splash = document.getElementById('splash');
    if (!splash || splash.classList.contains('hidden')) return;

    const elapsed = Date.now() - _splashStart;
    if (elapsed < _splashMinMs) {
        setTimeout(dismissSplash, _splashMinMs - elapsed);
        return;
    }

    splash.classList.add('hidden');
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
}

/* -- Battery Indicator -- */

function _updateBattery(soc) {
    _lastBatterySoc = soc;

    const el = document.getElementById('battery-indicator');
    const fill = document.getElementById('battery-fill');
    const pctEl = document.getElementById('battery-pct');
    if (!el || !fill || !pctEl) return;

    const pct = Math.max(0, Math.min(100, Math.round(soc)));
    pctEl.textContent = pct + '%';

    // Scale fill bar width: 0% -> 0, 100% -> 17 (full inner rect)
    fill.setAttribute('width', String((pct / 100) * 17));

    // Color class based on level
    el.classList.remove('bat-low', 'bat-mid', 'bat-ok');
    if (pct <= 15) el.classList.add('bat-low');
    else if (pct <= 35) el.classList.add('bat-mid');
    else el.classList.add('bat-ok');

    el.classList.add('visible');
}

/* -- WebSocket Connection -- */

function connectWebSocket() {
    const wsUrl = `ws://${location.host}/ws`;
    _ws = new WebSocket(wsUrl);

    const wsStatus = document.getElementById('ws-status');

    _ws.onopen = () => {
        if (wsStatus) wsStatus.textContent = 'CONNECTED';
        console.log('[App] WebSocket connected');
        dismissSplash();
    };

    _ws.onclose = () => {
        if (wsStatus) wsStatus.textContent = 'DISCONNECTED (retrying...)';
        console.log('[App] WebSocket disconnected, reconnecting...');
        setTimeout(connectWebSocket, 800);
    };

    _ws.onerror = () => {
        // onclose will handle reconnection
    };

    _ws.onmessage = async (ev) => {
        try {
            const msg = JSON.parse(ev.data);

            if (msg.type === 'gallery_toggle') {
                toggleGallery();
                return;
            }

            if (msg.type === 'debug_toggle') {
                window.ELEN_DEBUG = !window.ELEN_DEBUG;
                document.body.classList.toggle('no-debug', !window.ELEN_DEBUG);
                console.log('[App] Debug mode ' + (window.ELEN_DEBUG ? 'ON' : 'OFF'));
                return;
            }

            if (msg.type === 'state') {
                if (!State.paused) Telemetry.ingestState(msg.state);
            }

            if (msg.type === 'mode') {
                setMode(msg.mode);
            }

            if (msg.type === 'snapshot') {
                if (!State.paused) await uploadSnapshot();
            }

            if (msg.type === 'leds') {
                // LED status — not used in projector mode
            }
        } catch (e) {
            console.error('[App] WebSocket message error:', e);
        }
    };
}

/* -- Initialization -- */

function initApp() {
    // Apply no-debug mode (hides all UI chrome except battery indicator)
    if (!window.ELEN_DEBUG) {
        document.body.classList.add('no-debug');
    }

    console.log('[App] Shadow Creatures — Ghost Signal Instrument vAtom');
    console.log('[App] Initializing modules...');

    // Connect WebSocket first — also dismisses splash on connect.
    // Must run before heavy inits so a WebGL / camera error can't block it.
    const splashStatus = document.querySelector('.splash-status');
    if (splashStatus) splashStatus.innerHTML = '<span class="splash-dot"></span>Connecting';
    connectWebSocket();

    // Fallback: dismiss splash after 10s even if WebSocket hasn't connected yet
    setTimeout(dismissSplash, 10000);

    try {
        // Init telemetry (with synthetic fallback data)
        Telemetry.init();

        // Init UI bindings and default layers
        UIManager.init();

        // Init renderer and start render loop (projector mode — no camera)
        Renderer.init();
        requestAnimationFrame((t) => Renderer.loop(t));

        // Init Live Photo capture (rolling video buffer from main canvas)
        LivePhotoCapture.init(UI.canvas);
    } catch (e) {
        console.error('[App] Module init error:', e);
    }

    console.log('[App] All modules initialized');
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
