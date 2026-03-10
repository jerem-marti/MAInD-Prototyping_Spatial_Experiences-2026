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

        // Re-upload current camera frame to ImageDeformPass every tick so
        // the deformation pass always uses the latest image (prevents freeze)
        if (Camera.active && State.image && ImageDeformPass._ready) {
            ImageDeformPass.uploadImage(State.image);
        }

        // 360 Globe: project devices through view frustum
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

    _updateDeviceSignals() {
        if (!State.image || State.imageRect.w === 0 || State.devices.length === 0) return;

        const canvas = UI.canvas;
        const fovH = State.cameraFov.h;
        const fovV = State.cameraFov.v;
        const halfH = fovH / 2;
        const halfV = fovV / 2;
        const map = State.deviceSignalMap;

        const visibleMacs = new Set();

        if (!State.layers.find(l => l.type === 'signal')) {
            UIManager.addLayer('signal');
        }
        const signalLayer = State.layers.find(l => l.type === 'signal');

        for (const device of State.devices) {
            const deltaYaw = this._wrapAngle(device.azimuth - State.viewYaw);
            const deltaPitch = this._wrapAngle(device.elevation - State.viewPitch);

            if (Math.abs(deltaYaw) > halfH || Math.abs(deltaPitch) > halfV) {
                continue;
            }

            visibleMacs.add(device.mac);

            const screenX = canvas.width / 2 + (deltaYaw / halfH) * (canvas.width / 2);
            const screenY = canvas.height / 2 - (deltaPitch / halfV) * (canvas.height / 2);

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

                // Sample image color at the projected position
                if (State.imageRect.w > 0) {
                    const sampled = ImageDeformPass.sampleColor(screenX, screenY, State.imageRect);
                    if (sampled) {
                        anchor.color = { r: sampled.r / 255, g: sampled.g / 255, b: sampled.b / 255 };
                        const hsl = _rgbToHSL(sampled.r, sampled.g, sampled.b);
                        anchor.params.hue = hsl.h;
                        anchor.params.saturation = hsl.s;
                        anchor.params.brightness = hsl.l;
                        anchor._buildGradient();
                    }
                }

                State.signals.push(anchor);
                if (signalLayer) signalLayer.signals.push(anchor);
                map.set(device.mac, anchor);
            }
        }

        // Remove anchors for devices no longer visible
        for (const [mac, anchor] of map) {
            if (!visibleMacs.has(mac)) {
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

        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#0a0a0c';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw source (/mjpeg feed)
        const source = State.image;
        if (source) {
            const sw = Camera.active ? Camera.getWidth() : (source.naturalWidth || source.width || 0);
            const sh = Camera.active ? Camera.getHeight() : (source.naturalHeight || source.height || 0);
            if (sw > 0 && sh > 0) {
                const aspect = sw / sh;
                let dw = canvas.width, dh = dw / aspect;
                if (dh > canvas.height) { dh = canvas.height; dw = dh * aspect; }
                const dx = (canvas.width - dw) / 2;
                const dy = (canvas.height - dh) / 2;
                State.imageRect = { x: dx, y: dy, w: dw, h: dh };

                let imgSource = source;
                if (DeformEngine.hasEdits && DeformEngine.buffer) {
                    imgSource = DeformEngine.buffer;
                }

                // Apply localized deformation at signal anchors
                if (State.signals.length > 0 && ImageDeformPass._ready && ImageDeformPass._imageTex) {
                    const deformed = ImageDeformPass.render(State.signals, State.imageRect, canvas.width, canvas.height);
                    if (deformed) {
                        ctx.drawImage(deformed, dx, dy, dw, dh);
                    } else {
                        ctx.drawImage(imgSource, dx, dy, dw, dh);
                    }
                } else {
                    ctx.drawImage(imgSource, dx, dy, dw, dh);
                }
            }
        } else {
            State.imageRect = { x: 0, y: 0, w: 0, h: 0 };
        }

        // Draw layers
        State.layers.forEach(layer => {
            if (!layer.enabled) return;
            ctx.save();

            if (layer.type === 'signal') {
                if (State.image && State.imageRect.w > 0) {
                    ctx.beginPath();
                    ctx.rect(State.imageRect.x, State.imageRect.y, State.imageRect.w, State.imageRect.h);
                    ctx.clip();
                }
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

        // Update 360 View status
        const viewStatus = document.getElementById('view-status');
        if (viewStatus) {
            const src = typeof OrientationManager !== 'undefined' ? OrientationManager._source : 'N/A';
            viewStatus.textContent = `YAW: ${State.viewYaw.toFixed(0)}\u00B0 | PITCH: ${State.viewPitch.toFixed(0)}\u00B0 | SOURCE: ${src}`;
        }

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
