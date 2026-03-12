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

/* -- Snapshot Flow -- (Gallery & capture disabled in exhibition mode) */

/* -- Mode Management -- */

function setMode(m) {
    State.mode = ((m % 3) + 3) % 3;
    const label = State.mode === 0 ? 'AP FOG' : State.mode === 1 ? 'BT SPARKS' : 'BOTH';
    const btnMode = document.getElementById('btn-mode');
    if (btnMode) btnMode.textContent = `MODE: ${label}`;
}

/* -- Gallery Management -- (Disabled in exhibition mode) */

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

/* -- Battery Indicator -- (Removed in exhibition mode no power gauge needed) */

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

            // Snapshot, LED, IMU, and battery messages ignored in exhibition mode
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

        // Init renderer and start render loop
        Renderer.init();
        requestAnimationFrame((t) => Renderer.loop(t));
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
