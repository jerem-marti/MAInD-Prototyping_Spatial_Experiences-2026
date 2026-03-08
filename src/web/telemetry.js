/**
 * @file Telemetry Module — Shadow Creatures
 * @description Receives ghost_state data via WebSocket, normalizes telemetry,
 * and provides combined state each frame for consumption by TelemetryMapper.
 *
 * Replaces the v18 dump-file-based telemetry with live WebSocket data
 * from the reducer's ghost_state.json.
 */

const Telemetry = {
    source: 'FORCED',
    forcedMode: true,
    freeze: false,
    jitter: false,
    _seed: 42,
    _rng: null,
    _lastLogTime: 0,

    raw: {
        wifiDeviceCount: 0,
        wifiMeanRssi: -65,
        wifiRssiVariance: 0,
        wifiChannelSpread: 0,
        wifiBurstRate: 0,
        btleCount: 0,
        btClassicCount: 0,
        totalDeviceCount: 0,
        bleRatio: 0,
        timestamp: 0
    },

    _prev: {
        totalDeviceCount: 0,
        wifiBurstRate: 0
    },

    // Adaptive normalization windows so low-traffic deployments (Pi) still
    // get expressive visual ranges without hardcoding desktop-only maxima.
    _liveScale: {
        totalDeviceCountMax: 80,
        wifiBurstRateMax: 3000,
        wifiRssiVarianceMax: 10
    },

    normalized: {
        wifiDeviceCount: 0,
        wifiMeanRssi: 0,
        wifiRssiVariance: 0,
        wifiChannelSpread: 0,
        wifiBurstRate: 0,
        btleCount: 0,
        btClassicCount: 0,
        totalDeviceCount: 0,
        bleRatio: 0,
        deviceCountDelta: 0,
        burstRateDelta: 0
    },

    telemetryState: null,

    init() {
        this._rng = this._createRng(this._seed);
        this._generateForced();
        this._updateState();
    },

    _createRng(seed) {
        return () => {
            let t = seed += 0x6D2B79F5;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    },

    _generateForced() {
        const r = this._rng;
        this.raw.wifiDeviceCount = Math.floor(60 + r() * 100);
        this.raw.wifiMeanRssi = -(16 + r() * 61);
        this.raw.wifiRssiVariance = 4 + r() * 12;
        this.raw.wifiChannelSpread = 1;
        this.raw.wifiBurstRate = 1000 + r() * 9000;
        this.raw.btleCount = Math.floor(200 + r() * 120);
        this.raw.btClassicCount = Math.floor(r() * 10);
        this.raw.totalDeviceCount = this.raw.wifiDeviceCount + this.raw.btleCount + this.raw.btClassicCount;
        this.raw.bleRatio = this.raw.btleCount / Math.max(1, this.raw.totalDeviceCount);
        this.raw.timestamp = Date.now();
    },

    /**
     * Hash a device ID string to a stable angle in [0, 360).
     * Uses the SHA-256 hex hash ID from the reducer.
     */
    _hashIdToAngle(id) {
        let hash = 0;
        for (let i = 0; i < id.length; i++) {
            hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
        }
        return ((hash % 360) + 360) % 360;
    },

    /**
     * Hash a device ID to an elevation in [-90, 90] degrees.
     */
    _hashIdToElevation(id) {
        let hash = 0;
        for (let i = id.length - 1; i >= 0; i--) {
            hash = ((hash << 7) - hash + id.charCodeAt(i)) | 0;
        }
        return ((hash % 180) + 180) % 180 - 90;
    },

    /**
     * Ingest a ghost_state object received via WebSocket.
     * Extracts aggregate telemetry and per-device data.
     * @param {Object} ghostState - The ghost_state.json content
     */
    ingestState(ghostState) {
        if (!ghostState) return;

        try {
            // Snapshot previous values for delta detection
            this._prev.totalDeviceCount = this.raw.totalDeviceCount;
            this._prev.wifiBurstRate = this.raw.wifiBurstRate;

            const tel = ghostState.telemetry || {};
            const wifiAps = (ghostState.wifi && ghostState.wifi.aps) || [];
            const btDevices = (ghostState.bt && ghostState.bt.devices) || [];

            // Use pre-computed aggregate telemetry from reducer
            this.raw.wifiDeviceCount = tel.wifi_count ?? wifiAps.length;
            this.raw.wifiMeanRssi = tel.wifi_mean_rssi ?? -65;
            this.raw.wifiRssiVariance = tel.wifi_rssi_variance ?? 0;
            this.raw.wifiChannelSpread = 1; // not available from reducer
            this.raw.btleCount = tel.bt_count ?? btDevices.length;
            this.raw.btClassicCount = 0; // reducer combines all BT
            this.raw.totalDeviceCount = tel.total_count ?? (this.raw.wifiDeviceCount + this.raw.btleCount);
            this.raw.bleRatio = tel.ble_ratio ?? 0;

            // Real burst rate from reducer (sum of Kismet minute_vec across all WiFi APs)
            this.raw.wifiBurstRate = tel.wifi_burst_rate ?? 0;

            this.raw.timestamp = (ghostState.ts || Date.now() / 1000) * 1000;

            // Build per-device records for globe positioning from WiFi APs
            const wifiDevices = [];
            wifiAps.forEach(ap => {
                const id = ap.id || '';
                const rssi = ap.signal_dbm || -70;
                const strength = ap.strength || 0;
                if (id) {
                    wifiDevices.push({
                        mac: id, // using hashed ID as identifier
                        rssi: rssi,
                        rssiMin: rssi,
                        rssiMax: rssi,
                        name: ap.name || id.slice(0, 8),
                        manuf: 'Unknown',
                        type: 'Wi-Fi AP',
                        packets: 0,
                        burstRate: 0,
                        azimuth: this._hashIdToAngle(id),
                        elevation: this._hashIdToElevation(id)
                    });
                }
            });

            // Sort by RSSI strength (strongest first)
            wifiDevices.sort((a, b) => b.rssi - a.rssi);
            State.devices = wifiDevices.slice(0, State.maxSignals);

            this.forcedMode = false;
            this.source = 'LIVE';

            console.log('[Telemetry] State ingested:', {
                wifi: this.raw.wifiDeviceCount,
                bt: this.raw.btleCount,
                total: this.raw.totalDeviceCount,
                rssi: this.raw.wifiMeanRssi.toFixed(1) + ' dBm',
                topDevices: State.devices.length + '/' + wifiAps.length
            });
        } catch (err) {
            this._throttledLog('Telemetry ingest error: ' + err.message);
        }

        this._normalize();
        this._updateState();
    },

    _normalize() {
        const n = this.normalized;
        const r = this.raw;
        const clamp01 = (v) => Math.min(1, Math.max(0, v));

        // Track rolling maxima with slow decay so normalization self-calibrates
        // to the current environment while remaining stable over time.
        const decay = 0.995;
        this._liveScale.totalDeviceCountMax = Math.max(
            40,
            this._liveScale.totalDeviceCountMax * decay,
            r.totalDeviceCount * 1.1
        );
        this._liveScale.wifiBurstRateMax = Math.max(
            800,
            this._liveScale.wifiBurstRateMax * decay,
            r.wifiBurstRate * 1.1
        );
        this._liveScale.wifiRssiVarianceMax = Math.max(
            4,
            this._liveScale.wifiRssiVarianceMax * decay,
            r.wifiRssiVariance * 1.1
        );

        n.wifiDeviceCount   = clamp01(r.wifiDeviceCount / Math.max(20, this._liveScale.totalDeviceCountMax * 0.5));
        n.wifiMeanRssi      = clamp01((r.wifiMeanRssi + 90) / 55);
        n.wifiRssiVariance  = clamp01(r.wifiRssiVariance / this._liveScale.wifiRssiVarianceMax);
        n.wifiChannelSpread = clamp01(r.wifiChannelSpread / 12);
        n.wifiBurstRate     = clamp01(r.wifiBurstRate / this._liveScale.wifiBurstRateMax);
        n.btleCount         = clamp01(r.btleCount / 400);
        n.btClassicCount    = clamp01(r.btClassicCount / 10);
        n.totalDeviceCount  = clamp01(r.totalDeviceCount / this._liveScale.totalDeviceCountMax);
        n.bleRatio          = clamp01(r.bleRatio);

        n.deviceCountDelta = clamp01(
            Math.abs(r.totalDeviceCount - this._prev.totalDeviceCount) / 50
        );
        n.burstRateDelta = clamp01(
            Math.abs(r.wifiBurstRate - this._prev.wifiBurstRate) / 3000
        );
    },

    _updateState() {
        this._normalize();
        this.telemetryState = {
            raw: { ...this.raw },
            norm: { ...this.normalized },
            source: this.source
        };
    },

    update() {
        if (this.freeze) return;

        const r = this._rng;

        if (this.jitter) {
            this.raw.wifiMeanRssi += (r() - 0.5) * 8.0;
            this.raw.wifiRssiVariance = Math.max(1, this.raw.wifiRssiVariance + (r() - 0.5) * 4.0);
            this.raw.wifiBurstRate = Math.max(0, this.raw.wifiBurstRate + (r() - 0.5) * 800.0);
        }

        if (this.forcedMode) {
            if (r() < 0.015) {
                this._prev.totalDeviceCount = this.raw.totalDeviceCount;
                this._prev.wifiBurstRate = this.raw.wifiBurstRate;
                this.raw.wifiDeviceCount = Math.max(50, Math.min(200, this.raw.wifiDeviceCount + Math.floor((r() - 0.5) * 20)));
                this.raw.wifiMeanRssi = Math.max(-77, Math.min(-16, this.raw.wifiMeanRssi + (r() - 0.5) * 6));
                this.raw.wifiBurstRate = Math.max(500, Math.min(10000, this.raw.wifiBurstRate + (r() - 0.5) * 1000));
                this.raw.btleCount = Math.max(150, Math.min(400, this.raw.btleCount + Math.floor((r() - 0.5) * 20)));
                this.raw.totalDeviceCount = this.raw.wifiDeviceCount + this.raw.btleCount + this.raw.btClassicCount;
                this.raw.bleRatio = this.raw.btleCount / Math.max(1, this.raw.totalDeviceCount);
            }
        }

        this._updateState();
    },

    _throttledLog(msg) {
        const now = Date.now();
        if (now - this._lastLogTime > 1000) {
            console.warn('[Telemetry]', msg);
            this._lastLogTime = now;
        }
    }
};
