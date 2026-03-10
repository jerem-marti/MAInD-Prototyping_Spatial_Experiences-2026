/**
 * GHOST SIGNAL INSTRUMENT — vAtom Fluid
 * Maps normalized telemetry data to atom fluid signal parameters.
 *
 * Single Responsibility: telemetry → visual param mapping.
 *
 * Mapping table (calibrated from real Kismet dump data):
 * ┌────────────────┬───────────────────────────┬──────────────┐
 * │ Visual Param   │ Telemetry Source           │ Output Range │
 * ├────────────────┼───────────────────────────┼──────────────┤
 * │ radiusLimit    │ WiFi mean RSSI             │ 40–250 px    │
 * │ size           │ Derived from radiusLimit   │ 0.0006–0.004 │
 * │ density        │ Total device count         │ 0.15–1.1     │
 * │ speed          │ Packet activity (minute_vec)│ 0.2–5.0     │
 * │ curlRadius     │ Event: new device spike    │ 0–80 (decay) │
 * │ emissionRate   │ BLE-to-total ratio         │ 2–12         │
 * │ anchorJitter   │ WiFi RSSI std deviation    │ 5–60 px      │
 * │ saturation     │ WiFi RSSI strength         │ 30–100       │
 * │ opacity        │ Burst rate delta (freshness)│ 0.3–1.0     │
 * └────────────────┴───────────────────────────┴──────────────┘
 * Hue is NOT mapped from telemetry — it's environment-driven
 * (sampled from background image at anchor position).
 */

const TelemetryMapper = {
    /** Per-signal state for stateful params (curl decay, opacity smoothing) */
    _state: new WeakMap(),

    /** Get or create per-signal state */
    _getState(signal) {
        if (!this._state.has(signal)) {
            this._state.set(signal, {
                curlRadius: 0,
                smoothedOpacity: 0.56,
                prevDeviceCount: -1
            });
        }
        return this._state.get(signal);
    },

    /** Apply telemetry to atom fluid anchor params */
    apply(signal, ts) {
        if (!ts || !ts.norm) return;
        const n = ts.norm;
        const st = this._getState(signal);

        // --- radiusLimit: RSSI → proximity → spread ---
        // Strong signal = nearby = larger blob
        const viewportShort = Math.min(
            State.resolution.w || 800,
            State.resolution.h || 600
        );
        const maxRadius = Math.min(viewportShort * 0.35, 250);
        signal.params.radiusLimit = 40 + n.wifiMeanRssi * (maxRadius - 40);

        // --- size: derived from radiusLimit (locked ratio) ---
        signal.params.size = signal.params.radiusLimit / 65000;

        // --- density: total device count (RF crowding) ---
        signal.params.density = 0.30 + n.totalDeviceCount * 0.80;

        // --- speed: packet activity rate ---
        signal.params.speed = 0.50 + n.wifiBurstRate * 3.5;

        // --- curlRadius: event-triggered spike + decay ---
        // Spike when device count changes (new device detected)
        // if (n.deviceCountDelta > 0.5) {
        //     st.curlRadius = 80;
        // }
        // Exponential decay each frame (~2s to near-zero at 60fps)
        st.curlRadius *= 0.96;
        if (st.curlRadius < 0.5) st.curlRadius = 0;
        signal.params.curlRadius = st.curlRadius;

        // --- emissionRate: BLE-to-total ratio ---
        signal.params.emissionRate = 2 + Math.floor(n.bleRatio * 10);

        // --- anchorJitter: RSSI variance (spatial uncertainty) ---
        signal.params.anchorJitter = 5 + n.wifiRssiVariance * 55;

        // --- saturation: RSSI strength ---
        // Weak signal = desaturated (fades toward background), strong = vivid
        signal.params.saturation = 40 + n.wifiMeanRssi * 60;

        // --- opacity: burst rate delta (temporal freshness) ---
        // Smooth towards target to avoid flicker
        const targetOpacity = 0.35 + Math.min(1, n.burstRateDelta + n.wifiBurstRate * 0.6) * 0.45;
        st.smoothedOpacity += (targetOpacity - st.smoothedOpacity) * 0.08;
        signal.params.opacity = st.smoothedOpacity;

        // --- hue: NOT mapped from telemetry ---
        // Hue is environment-driven (sampled from background image at anchor position).
        // We leave hue untouched so camera-sampled color is preserved.

        // --- Type-based size override ---
        // Scale radiusLimit and size per device type for visual differentiation
        if (signal._deviceType && State.typeSizes && State.typeSizes[signal._deviceType] !== undefined) {
            const scale = State.typeSizes[signal._deviceType];
            signal.params.radiusLimit *= scale;
            signal.params.size = signal.params.radiusLimit / 65000;
        }
    }
};
