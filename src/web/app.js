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

        console.log('[App] Snapshot uploaded' + (liveBlob ? ' (with Live Photo)' : ''));
    } catch (e) {
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

/* -- WebSocket Connection -- */

function connectWebSocket() {
    const wsUrl = `ws://${location.host}/ws`;
    _ws = new WebSocket(wsUrl);

    const wsStatus = document.getElementById('ws-status');

    _ws.onopen = () => {
        if (wsStatus) wsStatus.textContent = 'CONNECTED';
        console.log('[App] WebSocket connected');
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

            if (msg.type === 'state') {
                Telemetry.ingestState(msg.state);
            }

            if (msg.type === 'mode') {
                setMode(msg.mode);
            }

            if (msg.type === 'snapshot') {
                await uploadSnapshot();
            }

            if (msg.type === 'leds') {
                // LED status — could be shown in UI if needed
            }

            if (msg.type === 'imu') {
                // Forward IMU orientation data to OrientationManager
                OrientationManager.onIMUData(msg);
            }
        } catch (e) {
            console.error('[App] WebSocket message error:', e);
        }
    };
}

/* -- Initialization -- */

function initApp() {
    console.log('[App] Shadow Creatures — Ghost Signal Instrument vAtom');
    console.log('[App] Initializing modules...');

    // Init telemetry (with synthetic fallback data)
    Telemetry.init();

    // Init ImageDeformPass (separate WebGL context for color sampling)
    ImageDeformPass.init();

    // Init UI bindings and default layers
    UIManager.init();

    // Init 360 orientation (IMU WebSocket + mouse drag)
    OrientationManager.init();

    // Start MJPEG camera feed
    Camera.start();

    // Init renderer and start render loop
    Renderer.init();
    requestAnimationFrame((t) => Renderer.loop(t));

    // Init Live Photo capture (rolling video buffer from main canvas)
    LivePhotoCapture.init(UI.canvas);

    // Connect to backend WebSocket
    connectWebSocket();

    console.log('[App] All modules initialized');
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
