/**
 * @file OrientationManager
 * @description Provides view orientation (yaw/pitch) from multiple sources:
 *   1. WebSocket (IMU server on RPi via Grove 6-axis I2C)
 *   2. DeviceOrientation API (mobile browsers with built-in gyroscope)
 *   3. Mouse/touch drag (desktop debug fallback)
 *
 * Priority: WebSocket > DeviceOrientation > Mouse drag.
 * Writes to State.viewYaw and State.viewPitch each frame/event.
 */
const OrientationManager = {
    /** @type {'mouse'|'websocket'|'deviceorientation'} Active input source */
    _source: 'mouse',
    /** @type {WebSocket|null} */
    _ws: null,
    /** @type {boolean} */
    _wsConnected: false,
    /** @type {number} Reconnect timer handle */
    _wsReconnectTimer: null,
    /** @type {string} WebSocket server URL */
    _wsUrl: 'ws://localhost:8765',

    // Mouse drag state
    _dragActive: false,
    _lastX: 0,
    _lastY: 0,

    // Yaw offset for "reset north" (compensates for gyro drift)
    _yawOffset: 0,

    // DeviceOrientation state
    _hasDeviceOrientation: false,

    /**
     * Initialize all orientation input sources.
     */
    init() {
        this._initMouseDrag();
        this._initWebSocket();
        this._initDeviceOrientation();
        console.log('[OrientationManager] Initialized, source:', this._source);
    },

    /**
     * Set up mouse/touch drag on the canvas for desktop debug.
     */
    _initMouseDrag() {
        const canvas = document.getElementById('main-canvas');
        if (!canvas) return;

        const sensitivity = 0.3; // degrees per pixel

        canvas.addEventListener('mousedown', (e) => {
            // Don't capture drag if placing signals or deforming
            if (State.isPlacingSignal || State.isDeforming) return;
            // Only drag with left button
            if (e.button !== 0) return;
            this._dragActive = true;
            this._lastX = e.clientX;
            this._lastY = e.clientY;
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!this._dragActive) return;
            // If WebSocket or DeviceOrientation is active, mouse drag is suppressed
            if (this._source === 'websocket' || this._source === 'deviceorientation') return;

            const dx = e.clientX - this._lastX;
            const dy = e.clientY - this._lastY;

            State.viewYaw = ((State.viewYaw - dx * sensitivity) % 360 + 360) % 360;
            State.viewPitch = Math.max(-90, Math.min(90, State.viewPitch + dy * sensitivity));

            this._lastX = e.clientX;
            this._lastY = e.clientY;
        });

        canvas.addEventListener('mouseup', () => { this._dragActive = false; });
        canvas.addEventListener('mouseleave', () => { this._dragActive = false; });

        // Touch support
        canvas.addEventListener('touchstart', (e) => {
            if (State.isPlacingSignal || State.isDeforming) return;
            this._dragActive = true;
            this._lastX = e.touches[0].clientX;
            this._lastY = e.touches[0].clientY;
        }, { passive: true });

        canvas.addEventListener('touchmove', (e) => {
            if (!this._dragActive) return;
            if (this._source === 'websocket' || this._source === 'deviceorientation') return;

            const dx = e.touches[0].clientX - this._lastX;
            const dy = e.touches[0].clientY - this._lastY;

            State.viewYaw = ((State.viewYaw - dx * sensitivity) % 360 + 360) % 360;
            State.viewPitch = Math.max(-90, Math.min(90, State.viewPitch + dy * sensitivity));

            this._lastX = e.touches[0].clientX;
            this._lastY = e.touches[0].clientY;
            e.preventDefault();
        }, { passive: false });

        canvas.addEventListener('touchend', () => { this._dragActive = false; });
    },

    /**
     * Connect to the IMU WebSocket server (RPi Grove 6-axis via I2C).
     * Expects JSON messages: { yaw: number, pitch: number, roll: number }
     */
    _initWebSocket() {
        this._connectWebSocket();
    },

    _connectWebSocket() {
        try {
            this._ws = new WebSocket(this._wsUrl);

            this._ws.onopen = () => {
                this._wsConnected = true;
                this._source = 'websocket';
                console.log('[OrientationManager] WebSocket connected to IMU server');
            };

            this._ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (typeof data.yaw === 'number' && typeof data.pitch === 'number') {
                        State.viewYaw = ((data.yaw - this._yawOffset) % 360 + 360) % 360;
                        State.viewPitch = Math.max(-90, Math.min(90, data.pitch));
                    }
                } catch (e) {
                    // Silently ignore malformed messages
                }
            };

            this._ws.onclose = () => {
                this._wsConnected = false;
                if (this._source === 'websocket') {
                    this._source = this._hasDeviceOrientation ? 'deviceorientation' : 'mouse';
                }
                // Reconnect after 3 seconds
                this._wsReconnectTimer = setTimeout(() => this._connectWebSocket(), 3000);
            };

            this._ws.onerror = () => {
                // Suppress console error — onclose will handle reconnection
                this._ws.close();
            };
        } catch (e) {
            // WebSocket constructor failed (e.g. invalid URL) — stay on fallback
            console.log('[OrientationManager] WebSocket not available, using', this._source);
        }
    },

    /**
     * Set up DeviceOrientation API for mobile browsers with built-in gyroscope.
     */
    _initDeviceOrientation() {
        if (!('DeviceOrientationEvent' in window)) return;

        // iOS 13+ requires permission
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            // Permission will be requested on a user gesture (e.g. button click)
            // For now, just register the handler — it will fire once permission is granted
            this._setupOrientationListener();
        } else {
            this._setupOrientationListener();
        }
    },

    _setupOrientationListener() {
        window.addEventListener('deviceorientation', (e) => {
            if (e.alpha === null) return;

            this._hasDeviceOrientation = true;

            // Only use DeviceOrientation if WebSocket is not active
            if (this._source === 'websocket') return;

            this._source = 'deviceorientation';

            // alpha = compass heading (0-360), beta = front-back tilt (-180 to 180)
            // When phone is held upright (beta~90), alpha gives horizontal heading
            State.viewYaw = ((e.alpha - this._yawOffset) % 360 + 360) % 360;
            State.viewPitch = Math.max(-90, Math.min(90, (e.beta || 0) - 90));
        });
    },

    /**
     * Request DeviceOrientation permission on iOS.
     * Must be called from a user gesture (button click).
     * @returns {Promise<boolean>} true if permission granted
     */
    async requestPermission() {
        if (typeof DeviceOrientationEvent.requestPermission !== 'function') return true;
        try {
            const result = await DeviceOrientationEvent.requestPermission();
            return result === 'granted';
        } catch (e) {
            return false;
        }
    },

    /**
     * Reset yaw to 0° at the current heading (compensates for gyro drift).
     */
    resetNorth() {
        this._yawOffset = State.viewYaw + this._yawOffset;
        State.viewYaw = 0;
        console.log('[OrientationManager] North reset, offset:', this._yawOffset);
    },

    /**
     * Get the current active source name for display.
     * @returns {string}
     */
    getSourceName() {
        return this._source + (this._wsConnected ? ' (connected)' : '');
    }
};
