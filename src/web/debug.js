/**
 * @file Debug Mode
 * @description On-screen HUD overlay showing telemetry values, performance
 * counters, and atom fluid parameters. Toggle via the sidebar checkbox or
 * the D key. Does not appear in exported captures by default.
 *
 * @requires Telemetry (telemetry.js)
 * @requires AtomFluidEngine (atomFluid.js)
 */

/**
 * @namespace DebugMode
 * @description Singleton debug overlay controller. Tracks FPS via frame-time
 * averaging and renders a semi-transparent HUD with telemetry, performance,
 * and fluid simulation data on the main canvas.
 */
const DebugMode = {
    /** @type {boolean} Whether the debug HUD is currently visible */
    enabled: false,
    /** @type {boolean} Whether to include the HUD in exported PNG captures */
    includeInExport: false,
    /** @type {boolean} Whether hyper-visible blob debug mode is active (B key) */
    debugBlobMode: false,

    /* -- Performance Tracking --------------------------- */

    /** @type {number} Calculated frames per second (rolling average) */
    _fps: 60,
    /** @type {number[]} Ring buffer of recent frame delta times (ms) */
    _frameTimes: [],
    /** @type {number} DOMHighResTimeStamp of the previous frame */
    _lastFrameTime: 0,

    /**
     * Toggle debug HUD on/off and sync the sidebar checkbox state.
     * @returns {void}
     */
    toggle() {
        this.enabled = !this.enabled;
        const cb = document.getElementById('debug-toggle');
        if (cb) cb.checked = this.enabled;
    },

    /**
     * Record a frame timestamp and recalculate FPS from a rolling
     * 30-frame average of inter-frame deltas.
     * @param {number} timestamp - DOMHighResTimeStamp from requestAnimationFrame
     * @returns {void}
     */
    trackFrame(timestamp) {
        if (this._lastFrameTime > 0) {
            const dt = timestamp - this._lastFrameTime;
            this._frameTimes.push(dt);
            if (this._frameTimes.length > 30) this._frameTimes.shift();
            const avg = this._frameTimes.reduce((a, b) => a + b, 0) / this._frameTimes.length;
            this._fps = Math.round(1000 / avg);
        }
        this._lastFrameTime = timestamp;
    },

    /**
     * Sum the particle (splat) count across all active signal anchors.
     * @param {SignalAnchor[]} signals - Array of active signal anchors
     * @returns {number} Total cumulative particle count
     */
    getTotalParticles(signals) {
        let total = 0;
        signals.forEach(s => {
            if (s.getParticleCount) total += s.getParticleCount();
        });
        return total;
    },

    /**
     * Toggle hyper-visible blob debug mode on/off.
     * @returns {void}
     */
    toggleBlobDebug() {
        this.debugBlobMode = !this.debugBlobMode;
        const cb = document.getElementById('blob-debug-toggle');
        if (cb) cb.checked = this.debugBlobMode;
        console.log('[Debug] Blob debug mode:', this.debugBlobMode ? 'ON' : 'OFF');
    },

    /**
     * Override all signal anchor params with extreme values so blobs are
     * unmistakably visible regardless of telemetry-derived settings.
     * Disables camera-colour override (anchor.color = null) and forces a
     * bright red HSL gradient.  Must be called every frame while active.
     * @param {SignalAnchor[]} signals - Array of active signal anchors
     * @returns {void}
     */
    applyBlobDebugParams(signals) {
        signals.forEach(s => {
            if (!s.params) return;
            s.params.size        = 0.05;
            s.params.density     = 8.0;
            s.params.opacity     = 2.0;
            s.params.hue         = 0;
            s.params.saturation  = 100;
            s.params.brightness  = 100;
            s.params.radiusLimit = 800;
            s.params.emissionRate = 50;
            s.color = null;                      // disable camera-colour override
            if (s._buildGradient) s._buildGradient();
        });
    },

    /**
     * Draws a semi-transparent background panel in the top-left corner
     * with three sections: TELEMETRY, PERFORMANCE, and ATOM FLUID params.
     * Only renders when {@link DebugMode.enabled} is true.
     * @param {CanvasRenderingContext2D} ctx - The main canvas 2D context
     * @param {HTMLCanvasElement} canvas - The main canvas element
     * @param {SignalAnchor[]} signals - Array of active signal anchors
     * @returns {void}
     */
    renderHUD(ctx, canvas, signals) {
        if (!this.enabled) return;

        const ts = Telemetry.telemetryState;
        if (!ts) return;

        const lines = [];

        // Telemetry section
        lines.push('── TELEMETRY ──');
        lines.push(`Source: ${ts.source}`);
        lines.push(`Total Devices: ${ts.raw.totalDeviceCount} (${ts.norm.totalDeviceCount.toFixed(2)})`);
        lines.push(`WiFi AP: ${ts.raw.wifiApCount}  CLI: ${ts.raw.wifiClientCount}  BT: ${ts.raw.btleCount}`);
        lines.push(`BLE Ratio: ${(ts.raw.bleRatio * 100).toFixed(0)}% (${ts.norm.bleRatio.toFixed(2)})`);
        lines.push(`WiFi RSSI: ${ts.raw.wifiMeanRssi.toFixed(1)} dBm (${ts.norm.wifiMeanRssi.toFixed(2)})`);
        lines.push(`RSSI Var: ${ts.raw.wifiRssiVariance.toFixed(1)} (${ts.norm.wifiRssiVariance.toFixed(2)})`);
        lines.push(`Burst Rate: ${ts.raw.wifiBurstRate.toFixed(0)} pkt/m (${ts.norm.wifiBurstRate.toFixed(2)})`);
        lines.push(`Δ Devices: ${ts.norm.deviceCountDelta.toFixed(2)}  Δ Burst: ${ts.norm.burstRateDelta.toFixed(2)}`);
        lines.push(`Freeze: ${Telemetry.freeze ? '● ON' : '○ OFF'}  Jitter: ${Telemetry.jitter ? '● ON' : '○ OFF'}`);

        // 360° View section
        lines.push('');
        lines.push('── 360° VIEW ──');
        lines.push(`Yaw: ${State.viewYaw.toFixed(1)}°  Pitch: ${State.viewPitch.toFixed(1)}°`);
        lines.push(`FOV: ${State.cameraFov.h}° × ${State.cameraFov.v}°`);
        lines.push(`Devices: ${State.signals.length}/${State.devices.length} visible (target ${State.targetVisibleSignals}, pool ${State.maxSignals})`);
        const apCount = State.devices.filter(d => d.type === 'Wi-Fi AP').length;
        const cliCount = State.devices.filter(d => d.type === 'Wi-Fi Client').length;
        const btCount = State.devices.filter(d => d.type === 'Bluetooth').length;
        lines.push(`AP:${apCount} CLI:${cliCount} BT:${btCount}`);
        if (typeof OrientationManager !== 'undefined') {
            lines.push(`Input: ${OrientationManager.getSourceName()}`);
        }

        lines.push('');
        lines.push('── PERFORMANCE ──');
        lines.push(`FPS: ${this._fps}`);

        let totalP = 0;
        signals.forEach((s, i) => {
            const pc = s.getParticleCount ? s.getParticleCount() : 0;
            totalP += pc;
            lines.push(`Cloud ${i}: ${pc} particles`);
        });
        lines.push(`Total particles: ${totalP}`);

        if (signals.length > 0 && signals[0].params) {
            const bs = signals[0].params.bufferScale || 0.33;
            lines.push(`Buffer scale: ${bs.toFixed(2)}`);
        }
        lines.push(`Resolution: ${canvas.width}×${canvas.height}`);

        // Atom fluid params
        if (signals.length > 0) {
            const p = signals[0].params;
            lines.push('');
            lines.push('── ATOM FLUID ──');
            lines.push(`anchors: ${signals.length}`);
            lines.push(`size: ${p.size.toFixed(4)}  radius: ${p.radiusLimit.toFixed(0)}`);
            lines.push(`curl: ${p.curlRadius.toFixed(1)}`);
            lines.push(`density: ${p.density.toFixed(2)}`);
            lines.push(`emission: ${p.emissionRate}`);
            lines.push(`speed: ${p.speed.toFixed(2)}`);
            lines.push(`hue: ${p.hue.toFixed(0)}  sat: ${p.saturation.toFixed(0)}  bri: ${p.brightness}`);
            lines.push(`opacity: ${p.opacity.toFixed(2)}  jitter: ${p.anchorJitter.toFixed(0)}`);
            lines.push(`total splats: ${AtomFluidEngine.getTotalSplats()}`);
        }

        // Draw HUD background
        const padding = 10;
        const lineH = 14;
        const hudW = 340;
        const hudH = lines.length * lineH + padding * 2;

        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.beginPath();
        ctx.roundRect(padding, padding, hudW, hudH, 6);
        ctx.fill();

        ctx.globalAlpha = 1;
        ctx.font = '11px "Space Grotesk", sans-serif';
        ctx.fillStyle = '#FEFDFB';
        ctx.textBaseline = 'top';

        lines.forEach((line, i) => {
            if (line.startsWith('──')) {
                ctx.fillStyle = '#FF6103';
            } else {
                ctx.fillStyle = '#FEFDFB';
            }
            ctx.fillText(line, padding + 8, padding + 6 + i * lineH);
        });

        ctx.restore();

        // WebGL diagnostics in a separate top-right panel — always fully visible
        this._drawWebGLPanel(ctx, canvas);
    },

    /**
     * Draw the WebGL fluid diagnostic panel in the top-right corner.
     * Separate from the main HUD so it is never cropped regardless of
     * how many signal lines the main panel contains.
     * @param {CanvasRenderingContext2D} ctx
     * @param {HTMLCanvasElement} canvas
     */
    _drawWebGLPanel(ctx, canvas) {
        const wglLines = ['── WEBGL FLUID ──'];

        if (this.debugBlobMode) {
            wglLines.push('⚠ BLOB DEBUG ON — params overridden');
        }

        if (AtomFluidEngine._noGL) {
            wglLines.push('STATUS: NO WEBGL CONTEXT');
        } else if (!AtomFluidEngine.diag) {
            wglLines.push('STATUS: not yet initialised');
        } else {
            const d = AtomFluidEngine.diag;
            wglLines.push(`ctx: ${d.wglVer}  fmt: ${d.texType}`);
            wglLines.push(`drawBuf: ${d.bufSize}  texFBO: ${d.texSize}`);
            wglLines.push(`linear: ${d.linear}  fboWrite: ${d.fboWrite}`);
            wglLines.push(`density@center: ${d.densitySample || '(not sampled yet)'}`);
            wglLines.push(`totalSplats: ${AtomFluidEngine.getTotalSplats()}`);
            const fc = AtomFluidEngine.canvas;
            wglLines.push(`fluidCanvas: ${fc ? fc.width + 'x' + fc.height : 'null'}`);
        }

        const padding = 10;
        const lineH = 14;
        const panW = 340;
        const panH = wglLines.length * lineH + padding * 2;
        const panX = canvas.width - panW - padding;
        const panY = padding;

        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.beginPath();
        ctx.roundRect(panX, panY, panW, panH, 6);
        ctx.fill();

        ctx.globalAlpha = 1;
        ctx.font = '11px "Space Grotesk", sans-serif';
        ctx.textBaseline = 'top';

        wglLines.forEach((line, i) => {
            ctx.fillStyle = line.startsWith('──') ? '#FF6103' : '#FEFDFB';
            ctx.fillText(line, panX + padding - 2, panY + 6 + i * lineH);
        });

        ctx.restore();
    }
};
