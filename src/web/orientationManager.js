/**
 * @file OrientationManager
 * @description Provides view orientation (yaw/pitch) from multiple sources:
 *   1. IMU data from backend (LSM6DS via main /ws WebSocket)
 *   2. DeviceOrientation API (mobile browsers with built-in gyroscope)
 *   3. Mouse/touch drag (desktop debug fallback)
 *
 * The user can toggle between mouse and gyro via a sidebar button.
 * Writes to State.viewYaw and State.viewPitch each frame/event.
 */
const OrientationManager = {
    /** @type {'mouse'|'imu'|'deviceorientation'} Active input source */
    _source: 'imu',
    /** @type {'mouse'|'gyro'} User-selected preferred source */
    _preferred: 'gyro',
    /** @type {boolean} True when IMU data has been received at least once */
    _imuAvailable: false,

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
        this._initDeviceOrientation();
        this.setPreferred(this._preferred);
        console.log('[OrientationManager] Initialized, source:', this._source);
    },

    /**
     * Called from app.js when a WebSocket message of type "imu" arrives.
     * @param {{yaw:number, pitch:number, roll:number}} data
     */
    onIMUData(data) {
        this._imuAvailable = true;
        if (this._preferred !== 'gyro') return;

        this._source = 'imu';
        if (typeof data.yaw === 'number' && typeof data.pitch === 'number') {
            State.viewYaw = ((data.yaw - this._yawOffset) % 360 + 360) % 360;
            State.viewPitch = Math.max(-90, Math.min(90, data.pitch));
        }
    },

    /**
     * Set the preferred orientation source.
     * @param {'mouse'|'gyro'} pref
     */
    setPreferred(pref) {
        this._preferred = pref;
        if (pref === 'mouse') {
            this._source = 'mouse';
        } else if (pref === 'gyro') {
            if (this._imuAvailable) {
                this._source = 'imu';
            } else if (this._hasDeviceOrientation) {
                this._source = 'deviceorientation';
            } else {
                // Gyro requested but no source yet — will switch when data arrives
                this._source = 'mouse';
            }
        }
        console.log('[OrientationManager] Preferred:', pref, '-> active:', this._source);
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
            // If gyro-based source is active, mouse drag is suppressed
            if (this._preferred === 'gyro' && (this._source === 'imu' || this._source === 'deviceorientation')) return;

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
            if (this._preferred === 'gyro' && (this._source === 'imu' || this._source === 'deviceorientation')) return;

            const dx = e.touches[0].clientX - this._lastX;
            const dy = e.touches[0].clientY - this._lastY;

            State.viewYaw = ((State.viewYaw - dx * sensitivity) % 360 + 360) % 360;
            State.viewPitch = Math.max(-90, Math.min(90, State.viewPitch + dy * sensitivity));

            this._lastX = e.touches[0].clientX;
            this._lastY = e.touches[0].clientY;
            e.preventDefault();
        }, { passive: false });

        canvas.addEventListener('touchend', () => { this._dragActive = false; });
        canvas.addEventListener('touchcancel', () => { this._dragActive = false; });
    },

    /**
     * Set up DeviceOrientation API for mobile browsers with built-in gyroscope.
     */
    _initDeviceOrientation() {
        if (!('DeviceOrientationEvent' in window)) return;

        // iOS 13+ requires permission
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            this._setupOrientationListener();
        } else {
            this._setupOrientationListener();
        }
    },

    _setupOrientationListener() {
        window.addEventListener('deviceorientation', (e) => {
            if (e.alpha === null) return;

            this._hasDeviceOrientation = true;

            // Only use DeviceOrientation if preferred=gyro and no IMU
            if (this._preferred !== 'gyro') return;
            if (this._source === 'imu') return;

            this._source = 'deviceorientation';

            // alpha = compass heading (0-360), beta = front-back tilt (-180 to 180)
            State.viewYaw = ((e.alpha - this._yawOffset) % 360 + 360) % 360;
            State.viewPitch = Math.max(-90, Math.min(90, (e.beta || 0) - 90));
        });
    },

    /**
     * Request DeviceOrientation permission on iOS.
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
     * Reset yaw to 0 at the current heading (compensates for gyro drift).
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
        return this._source + (this._imuAvailable ? ' (imu ok)' : '');
    }
};
