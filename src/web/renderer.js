/**
 * GHOST SIGNAL INSTRUMENT — Shadow Creatures
 * Renderer: main continuous render loop and canvas compositing.
 *
 * Adapted from v18: uses /mjpeg feed as image source.
 */

const Renderer = {
    _lastTime: 0,

    init() {
        try {
            const container = UI.canvas.parentElement;
            AtomFluidEngine.init(container.clientWidth, container.clientHeight);
        } catch (e) {
            console.error('AtomFluidEngine init failed:', e);
        }
        window.addEventListener('resize', () => this.resize());
        this.resize();
    },

    resize() {
        const container = UI.canvas.parentElement;
        UI.canvas.width = container.clientWidth;
        UI.canvas.height = container.clientHeight;
        State.resolution = { w: UI.canvas.width, h: UI.canvas.height };
        UI.status.res.textContent = `${UI.canvas.width}\u00D7${UI.canvas.height}`;
        AtomFluidEngine.resize(UI.canvas.width, UI.canvas.height);
    },

    loop(timestamp) {
        requestAnimationFrame((t) => this.loop(t));

        if (State.paused) return;

        const dt = this._lastTime > 0 ? timestamp - this._lastTime : 16;
        this._lastTime = timestamp;

        DebugMode.trackFrame(timestamp);
        Telemetry.update();

        // Projector mode: distribute devices directly on screen
        this._updateDeviceSignals();

        // Map telemetry to atom fluid anchor params
        if (!State.useManualParams) {
            State.signals.forEach(s => {
                TelemetryMapper.apply(s, Telemetry.telemetryState);
            });
        }

        // Override params with hyper-visible debug values when blob debug is active
        if (DebugMode.debugBlobMode) {
            DebugMode.applyBlobDebugParams(State.signals);
        }

        // Update global fluid engine with all anchors
        if (State.signals.length > 0) {
            AtomFluidEngine.update(dt, State.signals);
            AtomFluidEngine.render();
        }

        this.render(timestamp, dt);
    },

    _wrapAngle(angle) {
        while (angle > 180) angle -= 360;
        while (angle < -180) angle += 360;
        return angle;
    },

    /**
     * Projector mode: distribute devices directly on the screen using
     * their hashed azimuth/elevation as stable x/y positions (no IMU,
     * no 360 frustum culling — all devices are always visible).
     */
    _updateDeviceSignals() {
        if (State.devices.length === 0) return;

        const canvas = UI.canvas;
        const map = State.deviceSignalMap;
        const currentMacs = new Set();

        if (!State.layers.find(l => l.type === 'signal')) {
            UIManager.addLayer('signal');
        }
        const signalLayer = State.layers.find(l => l.type === 'signal');

        const margin = 0.08; // 8% margin from edges

        for (const device of State.devices) {
            currentMacs.add(device.mac);

            // Map azimuth [0,360) -> x across canvas, elevation [-90,90] -> y
            const nx = (device.azimuth / 360);
            const ny = ((device.elevation + 90) / 180);
            const screenX = canvas.width  * (margin + nx * (1 - 2 * margin));
            const screenY = canvas.height * (margin + (1 - ny) * (1 - 2 * margin));

            if (map.has(device.mac)) {
                const anchor = map.get(device.mac);
                anchor.x = screenX;
                anchor.y = screenY;
                anchor.dirty = true;
                anchor._deviceRssi = device.rssi;
                anchor._deviceName = device.name;
                anchor._deviceManuf = device.manuf;
            } else {
                const anchor = new SignalAnchor(screenX, screenY, device.mac);
                anchor.params.deviceIdText = device.name || device.mac;
                anchor._deviceRssi = device.rssi;
                anchor._deviceName = device.name;
                anchor._deviceManuf = device.manuf;
                anchor._deviceType = device.type;

                // Assign a hue based on device type instead of sampling camera
                // hue: degrees (0-360), saturation: 0-100, brightness: 0-100
                if (device.type === 'Wi-Fi AP') {
                    anchor.params.hue = 25;          // warm orange
                    anchor.params.saturation = 80;
                    anchor.params.brightness = 55;
                } else if (device.type === 'Bluetooth') {
                    anchor.params.hue = 220;         // blue
                    anchor.params.saturation = 75;
                    anchor.params.brightness = 50;
                } else {
                    anchor.params.hue = 160;         // cyan-green
                    anchor.params.saturation = 70;
                    anchor.params.brightness = 50;
                }
                anchor._buildGradient();

                State.signals.push(anchor);
                if (signalLayer) signalLayer.signals.push(anchor);
                map.set(device.mac, anchor);
            }
        }

        // Remove anchors for devices no longer present
        for (const [mac, anchor] of map) {
            if (!currentMacs.has(mac)) {
                State.signals = State.signals.filter(s => s.id !== anchor.id);
                if (signalLayer) {
                    signalLayer.signals = signalLayer.signals.filter(s => s.id !== anchor.id);
                }
                map.delete(mac);
            }
        }

        if (this._lastSignalCount !== State.signals.length) {
            UIManager.updateSignalList();
            this._lastSignalCount = State.signals.length;
        }
    },

    _lastSignalCount: 0,

    render(timestamp, dt) {
        const canvas = UI.canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Black background (projector mode — no camera feed)
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        State.imageRect = { x: 0, y: 0, w: canvas.width, h: canvas.height };

        // Draw layers
        State.layers.forEach(layer => {
            if (!layer.enabled) return;
            ctx.save();

            if (layer.type === 'signal') {
                // No clipping — full canvas is the render area in projector mode
            }

            ctx.globalAlpha = layer.opacity || 1.0;

            if (layer.type === 'signal') {
                if (State.signals.length > 0 && AtomFluidEngine.canvas) {
                    const bMode = State.signals[0].params.blendMode || 'screen';
                    const avgOp = Math.min(2.0, State.signals[0].params.opacity || 0.85);
                    const layOp = layer.opacity || 1.0;

                    if (bMode === 'embedded') {
                        ctx.globalCompositeOperation = 'soft-light';
                        ctx.globalAlpha = layOp * avgOp * 0.9;
                        ctx.drawImage(AtomFluidEngine.canvas, 0, 0);
                        ctx.globalCompositeOperation = 'overlay';
                        ctx.globalAlpha = layOp * avgOp * 0.6;
                        ctx.drawImage(AtomFluidEngine.canvas, 0, 0);
                        ctx.globalCompositeOperation = 'screen';
                        ctx.globalAlpha = layOp * avgOp * 0.35;
                        ctx.drawImage(AtomFluidEngine.canvas, 0, 0);
                        ctx.globalCompositeOperation = 'source-over';
                        ctx.globalAlpha = layOp * avgOp * 0.2;
                        ctx.drawImage(AtomFluidEngine.canvas, 0, 0);
                    } else if (bMode === 'add') {
                        ctx.globalCompositeOperation = 'lighter';
                        ctx.globalAlpha = layOp * avgOp;
                        ctx.drawImage(AtomFluidEngine.canvas, 0, 0);
                    } else {
                        ctx.globalCompositeOperation = bMode;
                        ctx.globalAlpha = layOp * avgOp;
                        ctx.drawImage(AtomFluidEngine.canvas, 0, 0);
                    }
                }
            } else if (layer.type === 'data') {
                layer.render(ctx, canvas, State.signals);
            } else {
                layer.render(ctx, canvas);
            }
            ctx.restore();
        });

        // Status bar
        UI.status.layers.textContent = `${State.layers.length} layers`;
        UI.status.signals.textContent = `${State.signals.length} signals`;
        UI.signalCount.textContent = State.signals.length;
        UI.status.fps.textContent = `${DebugMode._fps} fps`;

        // Debug HUD
        DebugMode.renderHUD(ctx, canvas, State.signals);

        // Notify LivePhotoCapture that a complete frame is ready.
        // Must be called after all compositing (including WebGL drawImage).
        LivePhotoCapture.requestFrame();
    },

    capture() {
        const canvas = UI.canvas;
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = canvas.width;
        exportCanvas.height = canvas.height;
        const ectx = exportCanvas.getContext('2d');

        const debugWasOn = DebugMode.enabled;
        if (!DebugMode.includeInExport) {
            DebugMode.enabled = false;
        }

        this.render(performance.now(), 16);
        ectx.drawImage(canvas, 0, 0);
        DebugMode.enabled = debugWasOn;
        this.render(performance.now(), 16);

        return exportCanvas;
    }
};
