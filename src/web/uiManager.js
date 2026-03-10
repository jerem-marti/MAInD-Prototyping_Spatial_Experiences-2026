/**
 * GHOST SIGNAL INSTRUMENT — Shadow Creatures
 * UIManager: DOM element cache, event bindings, sidebar overlay, and all UI management.
 *
 * Adapted from v18: removed upload/camera buttons, added sidebar toggle,
 * integrated with backend WebSocket for mode switching and snapshot.
 */

/* -- DOM ELEMENT CACHE -- */

const UI = {
    canvas: document.getElementById('main-canvas'),
    ctx: document.getElementById('main-canvas').getContext('2d'),
    btnDeformMode: document.getElementById('btn-deform-mode'),
    btnCapture: document.getElementById('btn-capture'),
    placementIndicator: document.getElementById('placement-indicator'),
    layerList: document.getElementById('layer-list'),
    signalList: document.getElementById('signal-list'),
    paramsBody: document.getElementById('params-body'),
    paramsTitle: document.getElementById('params-title'),
    signalCount: document.getElementById('signal-count'),
    sidebar: document.getElementById('sidebar'),
    sidebarToggle: document.getElementById('btn-sidebar-toggle'),
    status: {
        res: document.getElementById('status-resolution'),
        layers: document.getElementById('status-layers'),
        signals: document.getElementById('status-signals'),
        fps: document.getElementById('status-fps')
    }
};

/* -- UI MANAGER -- */

const UIManager = {

    init() {
        this.initBindings();
        this.addLayer('signal');
        this.addLayer('data');
        if (State.layers.length > 0) this.selectLayer(State.layers[0].id);
    },

    /* -- Layer / Signal Management -- */

    addLayer(type) {
        let layer;
        switch (type) {
            case 'signal': layer = new SignalLayer(); break;
            case 'data': layer = new DataLayer(); break;
        }
        if (layer) {
            State.layers.push(layer);
            this.updateLayerList();
        }
    },

    addSignal(x, y) {
        const signal = new SignalAnchor(x, y, Date.now());

        if (State.imageRect && State.imageRect.w > 0) {
            const sampled = ImageDeformPass.sampleColor(x, y, State.imageRect);
            if (sampled) {
                signal.color = { r: sampled.r / 255, g: sampled.g / 255, b: sampled.b / 255 };
                const hsl = _rgbToHSL(sampled.r, sampled.g, sampled.b);
                signal.params.hue = hsl.h;
                signal.params.saturation = hsl.s;
                signal.params.brightness = hsl.l;
                signal._buildGradient();
            }
        }

        State.signals.push(signal);

        if (!State.layers.find(l => l.type === 'signal')) {
            this.addLayer('signal');
        }
        const signalLayer = State.layers.find(l => l.type === 'signal');
        signalLayer.signals.push(signal);

        this.updateSignalList();
        this.selectSignal(signal.id);
    },

    updateLayerList() {
        UI.layerList.innerHTML = '';
        State.layers.forEach(layer => {
            const li = document.createElement('li');
            li.className = `layer-item ${State.selectedLayerId === layer.id ? 'selected' : ''}`;
            li.innerHTML = `
                <button class="layer-toggle ${layer.enabled ? 'active' : ''}">\u{1F441}</button>
                <span class="layer-name">${layer.name}</span>
                <div class="layer-order-btns">
                    <button class="layer-order-btn top-btn">\u2191</button>
                    <button class="layer-order-btn bot-btn">\u2193</button>
                </div>
            `;
            li.querySelector('.layer-toggle').onclick = (e) => {
                e.stopPropagation();
                layer.enabled = !layer.enabled;
                UIManager.updateLayerList();
            };
            li.onclick = () => UIManager.selectLayer(layer.id);
            UI.layerList.appendChild(li);
        });
    },

    updateSignalList() {
        UI.signalList.innerHTML = '';
        State.signals.forEach(s => {
            const li = document.createElement('li');
            li.className = `signal-item ${State.selectedSignalId === s.id ? 'selected' : ''}`;
            li.innerHTML = `
                <span class="layer-name">CLOUD_${s.data.hash}</span>
                <button class="signal-delete">\u00D7</button>
            `;
            li.onclick = () => UIManager.selectSignal(s.id);
            li.querySelector('.signal-delete').onclick = (e) => {
                e.stopPropagation();
                UIManager.removeSignal(s.id);
            };
            UI.signalList.appendChild(li);
        });
    },

    selectLayer(id) {
        State.selectedLayerId = id;
        State.selectedSignalId = null;
        this.updateLayerList();
        this.updateSignalList();
        const layer = State.layers.find(l => l.id === id);
        if (layer) this.renderParamsPanel(layer);
    },

    selectSignal(id) {
        State.selectedSignalId = id;
        State.selectedLayerId = null;
        this.updateSignalList();
        this.updateLayerList();
        const signal = State.signals.find(s => s.id === id);
        if (signal) this.renderParamsPanel(signal);
    },

    removeSignal(id) {
        State.signals = State.signals.filter(s => s.id !== id);
        State.layers.forEach(l => {
            if (l.type === 'signal') l.signals = l.signals.filter(s => s.id !== id);
        });
        if (State.selectedSignalId === id) {
            State.selectedSignalId = null;
            UI.paramsBody.innerHTML = '<p class="placeholder-text">Select a signal cloud or layer to edit parameters.</p>';
        }
        this.updateSignalList();
    },

    /* -- Parameter Panel -- */

    renderParamsPanel(target) {
        UI.paramsTitle.textContent = target.name || `CLOUD_${target.data.hash}`;
        UI.paramsBody.innerHTML = '';

        const params = target.params;
        if (!params) return;

        Object.keys(params).forEach(key => {
            if (target.params.tracking === 1 && (key === 'dataAbsX' || key === 'dataAbsY')) return;
            if (target.params.tracking === 0 && (key === 'dataOffsetX' || key === 'dataOffsetY')) return;

            const val = params[key];
            const row = document.createElement('div');
            row.className = 'param-row';

            const label = document.createElement('span');
            label.className = 'param-label';
            label.textContent = key.replace(/([A-Z])/g, ' $1').toLowerCase();

            if (typeof val === 'number') {
                const slider = document.createElement('input');
                slider.type = 'range';
                slider.className = 'param-slider';

                let min = 0, max = 1, step = 0.01;
                if (key === 'size') { min = 0.00025; max = 0.03; step = 0.00025; }
                if (key === 'density') { min = 0.1; max = 3.0; step = 0.05; }
                if (key === 'speed') { min = 0.1; max = 5.0; step = 0.05; }
                if (key === 'radiusLimit') { min = 5; max = 200; step = 1; }
                if (key === 'curlRadius') { min = 0; max = 100; step = 1; }
                if (key === 'emissionRate') { min = 0.5; max = 20; step = 0.5; }
                if (key === 'anchorJitter') { min = 0; max = 80; step = 1; }
                if (key === 'hue') { min = 0; max = 360; step = 1; }
                if (key === 'saturation') { min = 0; max = 100; step = 1; }
                if (key === 'brightness') { min = 0; max = 100; step = 1; }
                if (key === 'opacity') { min = 0; max = 2.0; step = 0.01; }
                if (key === 'dataOffsetX') { min = -200; max = 200; step = 1; }
                if (key === 'dataOffsetY') { min = -200; max = 200; step = 1; }
                if (key === 'dataAbsX') { min = 0; max = 800; step = 1; }
                if (key === 'dataAbsY') { min = 0; max = 480; step = 1; }
                if (key === 'brushSize') { min = 10; max = 500; step = 1; }
                if (key === 'strength') { min = 0.1; max = 5.0; step = 0.05; }
                if (key === 'stabilize') { min = 0; max = 0.95; step = 0.01; }
                if (key === 'softness') { min = 0; max = 1; step = 0.01; }
                if (key === 'fontSize') { min = 6; max = 24; step = 1; }

                slider.min = min; slider.max = max; slider.step = step;
                slider.value = val;

                const valueDisplay = document.createElement('span');
                valueDisplay.className = 'param-value';
                valueDisplay.textContent = val;

                slider.oninput = (e) => {
                    target.params[key] = parseFloat(e.target.value);
                    valueDisplay.textContent = e.target.value;
                    if (target instanceof SignalAnchor) {
                        target.dirty = true;
                        State.useManualParams = true;
                        const mt = document.getElementById('manual-params-toggle');
                        if (mt) mt.checked = true;
                    }
                };

                row.appendChild(label);
                row.appendChild(slider);
                row.appendChild(valueDisplay);
            } else if (typeof val === 'boolean') {
                row.className = 'param-toggle-row';
                const toggle = document.createElement('div');
                toggle.className = `param-toggle ${val ? 'active' : ''}`;
                toggle.onclick = () => {
                    target.params[key] = !target.params[key];
                    toggle.classList.toggle('active');
                    if (target instanceof SignalAnchor) target.dirty = true;
                };
                row.appendChild(label);
                row.appendChild(toggle);
            } else if (key === 'deviceIdText') {
                const textInput = document.createElement('input');
                textInput.type = 'text';
                textInput.className = 'param-text';
                textInput.placeholder = target.data ? target.data.deviceId : 'ID...';
                textInput.value = val || '';
                textInput.oninput = (e) => {
                    target.params[key] = e.target.value;
                    if (target instanceof SignalAnchor) target.dirty = true;
                };
                row.appendChild(label);
                row.appendChild(textInput);
            } else if (key === 'tracking') {
                row.className = 'param-toggle-row';
                const toggle = document.createElement('div');
                toggle.className = `param-toggle ${val === 1 ? 'active' : ''}`;
                toggle.onclick = () => {
                    target.params[key] = target.params[key] === 1 ? 0 : 1;
                    toggle.classList.toggle('active');
                    if (target instanceof SignalAnchor) target.dirty = true;
                    UIManager.renderParamsPanel(target);
                };
                row.appendChild(label);
                row.appendChild(toggle);
            } else if (key === 'blendMode') {
                const select = document.createElement('select');
                select.className = 'param-select';
                ['embedded', 'screen', 'add', 'soft-light', 'overlay', 'multiply', 'color-dodge'].forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m;
                    opt.textContent = m.toUpperCase();
                    if (m === val) opt.selected = true;
                    select.appendChild(opt);
                });
                select.onchange = (e) => {
                    target.params[key] = e.target.value;
                };
                row.appendChild(label);
                row.appendChild(select);
            } else if (key === 'color') {
                const colorInput = document.createElement('input');
                colorInput.type = 'color';
                colorInput.className = 'param-color-input';
                colorInput.value = val;
                colorInput.oninput = (e) => {
                    target.params[key] = e.target.value;
                };
                row.appendChild(label);
                row.appendChild(colorInput);
            }

            UI.paramsBody.appendChild(row);
        });
    },

    /* -- Event Bindings -- */

    initBindings() {
        // Sidebar toggle
        if (UI.sidebarToggle) {
            UI.sidebarToggle.addEventListener('click', () => {
                UI.sidebar.classList.toggle('sidebar-open');
                UI.sidebarToggle.classList.toggle('active');
            });
        }

        // Sidebar close button (X)
        const sidebarClose = document.getElementById('btn-sidebar-close');
        if (sidebarClose) {
            sidebarClose.addEventListener('click', () => {
                UI.sidebar.classList.remove('sidebar-open');
                UI.sidebarToggle.classList.remove('active');
            });
        }

        // Capture button — uses backend snapshot flow
        if (UI.btnCapture) {
            UI.btnCapture.addEventListener('click', () => {
                if (typeof wsSend === 'function') {
                    wsSend({ type: 'snapshot_request' });
                }
            });
        }

        // Gallery toggle button (long-press 5s toggles debug mode)
        const btnGallery = document.getElementById('btn-gallery');
        if (btnGallery) {
            let _galleryPressTimer = null;
            let _galleryDidLongPress = false;

            const _startGalleryPress = () => {
                _galleryDidLongPress = false;
                _galleryPressTimer = setTimeout(() => {
                    _galleryDidLongPress = true;
                    window.ELEN_DEBUG = !window.ELEN_DEBUG;
                    document.body.classList.toggle('no-debug', !window.ELEN_DEBUG);
                    console.log('[UI] Debug mode ' + (window.ELEN_DEBUG ? 'ON' : 'OFF'));
                }, 5000);
            };

            const _endGalleryPress = () => {
                if (_galleryPressTimer) {
                    clearTimeout(_galleryPressTimer);
                    _galleryPressTimer = null;
                }
            };

            btnGallery.addEventListener('mousedown', _startGalleryPress);
            btnGallery.addEventListener('touchstart', _startGalleryPress, { passive: true });

            btnGallery.addEventListener('mouseup', _endGalleryPress);
            btnGallery.addEventListener('mouseleave', _endGalleryPress);
            btnGallery.addEventListener('touchend', _endGalleryPress);
            btnGallery.addEventListener('touchcancel', _endGalleryPress);

            btnGallery.addEventListener('click', () => {
                if (_galleryDidLongPress) return;
                if (typeof toggleGallery === 'function') {
                    toggleGallery();
                }
            });
        }

        // Mode switch button
        const btnMode = document.getElementById('btn-mode');
        if (btnMode) {
            btnMode.addEventListener('click', () => {
                const nextMode = ((State.mode || 0) + 1) % 3;
                if (typeof wsSend === 'function') {
                    wsSend({ type: 'set_mode', mode: nextMode });
                }
            });
        }

        // Add Signal button
        const btnAddSignal = document.getElementById('btn-add-signal');
        if (btnAddSignal) {
            btnAddSignal.addEventListener('click', () => {
                State.isPlacingSignal = !State.isPlacingSignal;
                if (State.isPlacingSignal) {
                    State.isDeforming = false;
                    if (UI.btnDeformMode) {
                        UI.btnDeformMode.classList.remove('active');
                        UI.btnDeformMode.textContent = 'DEFORM MODE: OFF';
                    }
                }
                btnAddSignal.classList.toggle('active', State.isPlacingSignal);
                if (UI.placementIndicator) UI.placementIndicator.classList.toggle('hidden', !State.isPlacingSignal);
                UI.canvas.parentElement.classList.toggle('placing', State.isPlacingSignal);
            });
        }

        // Deform Mode
        if (UI.btnDeformMode) {
            UI.btnDeformMode.addEventListener('click', () => {
                State.isDeforming = !State.isDeforming;
                if (State.isDeforming) {
                    State.isPlacingSignal = false;
                    const btnAS = document.getElementById('btn-add-signal');
                    if (btnAS) btnAS.classList.remove('active');
                    if (UI.placementIndicator) UI.placementIndicator.classList.add('hidden');
                }
                UI.btnDeformMode.classList.toggle('active', State.isDeforming);
                UI.btnDeformMode.textContent = `DEFORM MODE: ${State.isDeforming ? 'ON' : 'OFF'}`;
                if (State.isDeforming) {
                    UI.canvas.parentElement.classList.add('deforming');
                    UI.canvas.parentElement.classList.remove('placing');
                    UIManager.renderParamsPanel(DeformEngine);
                    const resetBtn = document.createElement('button');
                    resetBtn.className = 'btn btn-action';
                    resetBtn.textContent = 'RESET DEFORMATIONS';
                    resetBtn.style.marginTop = '12px';
                    resetBtn.onclick = () => DeformEngine.reset();
                    UI.paramsBody.appendChild(resetBtn);
                } else {
                    UI.canvas.parentElement.classList.remove('deforming');
                    UI.paramsBody.innerHTML = '<p class="placeholder-text">Select a signal cloud or layer to edit parameters.</p>';
                    UI.paramsTitle.textContent = "PARAMETERS";
                    DeformEngine.isDragging = false;
                }
            });
        }

        // Deform mouse events
        UI.canvas.addEventListener('mousedown', (e) => {
            if (State.isDeforming) {
                const rect = UI.canvas.getBoundingClientRect();
                DeformEngine.lastPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                DeformEngine.isDragging = true;
            }
        });

        window.addEventListener('mouseup', () => {
            if (State.isDeforming) {
                DeformEngine.isDragging = false;
                DeformEngine.lastPt = null;
            }
        });

        UI.canvas.addEventListener('mousemove', (e) => {
            if (State.isDeforming && DeformEngine.isDragging && DeformEngine.lastPt) {
                const rect = UI.canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const dx = x - DeformEngine.lastPt.x;
                const dy = y - DeformEngine.lastPt.y;
                const stab = DeformEngine.params.stabilize;
                DeformEngine.lastPt.x += dx * (1.0 - stab);
                DeformEngine.lastPt.y += dy * (1.0 - stab);
                DeformEngine.applyDeform(x, y, dx, dy);
            }
        });

        // Place signal on canvas click
        UI.canvas.addEventListener('click', (e) => {
            if (!State.isPlacingSignal) return;
            const rect = UI.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            UIManager.addSignal(x, y);
            State.isPlacingSignal = false;
            const btnAS = document.getElementById('btn-add-signal');
            if (btnAS) btnAS.classList.remove('active');
            if (UI.placementIndicator) UI.placementIndicator.classList.add('hidden');
            UI.canvas.parentElement.classList.remove('placing');
        });

        // Layer menu
        const btnAddLayer = document.getElementById('btn-add-layer');
        if (btnAddLayer) {
            btnAddLayer.addEventListener('click', () => {
                document.getElementById('layer-menu').classList.toggle('hidden');
            });
        }

        document.querySelectorAll('.layer-menu-item').forEach(item => {
            item.addEventListener('click', () => {
                const type = item.dataset.layer;
                UIManager.addLayer(type);
                document.getElementById('layer-menu').classList.add('hidden');
            });
        });

        // Debug toggle
        const debugToggle = document.getElementById('debug-toggle');
        if (debugToggle) {
            debugToggle.addEventListener('change', (e) => {
                DebugMode.enabled = e.target.checked;
            });
        }

        const blobDebugToggle = document.getElementById('blob-debug-toggle');
        if (blobDebugToggle) {
            blobDebugToggle.addEventListener('change', (e) => {
                DebugMode.debugBlobMode = e.target.checked;
            });
        }

        const debugExport = document.getElementById('debug-export-toggle');
        if (debugExport) {
            debugExport.addEventListener('change', (e) => {
                DebugMode.includeInExport = e.target.checked;
            });
        }

        // Freeze / Jitter toggles
        const freezeToggle = document.getElementById('telemetry-freeze');
        if (freezeToggle) {
            freezeToggle.addEventListener('change', (e) => { Telemetry.freeze = e.target.checked; });
        }
        const jitterToggle = document.getElementById('telemetry-jitter');
        if (jitterToggle) {
            jitterToggle.addEventListener('change', (e) => { Telemetry.jitter = e.target.checked; });
        }

        // Manual params toggle
        const manualToggle = document.getElementById('manual-params-toggle');
        if (manualToggle) {
            manualToggle.addEventListener('change', (e) => { State.useManualParams = e.target.checked; });
        }

        // (max signals control removed — all devices pass through now)

        // Reset North button
        const resetNorthBtn = document.getElementById('btn-reset-north');
        if (resetNorthBtn) {
            resetNorthBtn.addEventListener('click', () => {
                if (typeof OrientationManager !== 'undefined') {
                    OrientationManager.resetNorth();
                }
            });
        }

        // Orientation input toggle (mouse <-> gyro)
        const btnOrientToggle = document.getElementById('btn-orientation-toggle');
        if (btnOrientToggle) {
            btnOrientToggle.addEventListener('click', () => {
                if (typeof OrientationManager === 'undefined') return;
                const current = OrientationManager._preferred;
                const next = current === 'mouse' ? 'gyro' : 'mouse';
                OrientationManager.setPreferred(next);
                btnOrientToggle.textContent = `INPUT: ${next.toUpperCase()}`;
                btnOrientToggle.classList.toggle('active', next === 'gyro');
            });
        }

        // D key for debug, B key for blob debug
        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
            if (e.key === 'd' || e.key === 'D') {
                DebugMode.toggle();
            } else if (e.key === 'b' || e.key === 'B') {
                DebugMode.toggleBlobDebug();
            }
        });
    }
};
