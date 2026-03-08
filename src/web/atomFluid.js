/**
 * @file ATOM FLUID ENGINE -- vNext Global WebGL Navier-Stokes
 *
 * ONE global fluid sim canvas (full viewport size).
 * Multiple SignalAnchors inject splats into the shared field.
 * No per-signal canvases -> no square edge artifacts -> signals mix.
 *
 * Each anchor has N micro-emitters orbiting with mixed CW/CCW
 * for atomic, multi-directional motion (not a single vortex).
 */

"use strict";

/* ══════════════════════════════════════════════════════════
   SignalAnchor — lightweight per-signal data holder
   ══════════════════════════════════════════════════════════ */

/**
 * @class SignalAnchor
 * @classdesc Lightweight per-signal data holder that stores position, visual
 *   parameters, simulated device metadata, a five-stop HSL colour gradient,
 *   and an array of micro-emitters used to inject splats into the shared
 *   {@link AtomFluidEngine} fluid field.
 *
 * @param {number} x - Initial horizontal position in pixels.
 * @param {number} y - Initial vertical position in pixels.
 * @param {string|number} id - Unique identifier for this anchor.
 */
class SignalAnchor {
    constructor(x, y, id) {
        this.id = id;

        /** @type {number} Horizontal position in pixels. */
        this.x = x;

        /** @type {number} Vertical position in pixels. */
        this.y = y;

        // Per-signal tunable params
        /**
         * Per-signal tunable parameter bag.
         * @type {Object}
         */
        this.params = {
            size: 0.003,            // splat radius in UV space
            density: 0.55,          // injection intensity
            speed: 3.4,             // scales injection force + emitter motion (NOT solver dt)
            radiusLimit: 195,       // max spread from anchor (px)
            curlRadius: 0,          // curl/vorticity strength
            emissionRate: 6,        // splats per second per micro-emitter
            anchorJitter: 51,       // coherent noise offset radius (px)
            hue: Math.random() * 360,
            saturation: 70,
            brightness: 80,
            opacity: 0.56,
            blendMode: 'screen',
            dataVisible: true,
            tracking: 1,            // 1=label follows blob, 0=label at fixed absolute position
            dataOffsetX: 100,
            dataOffsetY: 20,
            dataAbsX: 100,          // absolute label X (used when tracking=0)
            dataAbsY: 100,          // absolute label Y (used when tracking=0)
            deviceIdText: ''        // editable per-cloud ID text (empty = use generated)
        };

        /** @type {?{r:number, g:number, b:number}} Sampled colour override (v16 Baseline: modification 1). */
        this.color = null;          // v16 Baseline: modification 1

        // Simulated device data
        const names = [
            "Anna's iPhone", "Dad's Laptop", "Kitchen Tablet", "Leo's AirPods",
            "Reception iMac", "Unknown Android", "Maria's Watch", "Office Printer",
            "Smart TV Living Room", "Visitor Device", "Security Camera 02",
            "Router Upstairs", "Grandma's iPad", "Studio MacBook"
        ];

        /**
         * Simulated device metadata displayed in the label.
         * @type {Object}
         * @property {string} deviceName - Human-readable device name.
         * @property {string} deviceId   - Generated device ID (e.g. "DEV-A1B2C3").
         * @property {string} network    - Simulated network name.
         * @property {string} strength   - Signal strength string (e.g. "-42.7 dBm").
         * @property {string} hash       - Short hex hash (e.g. "0xF3A1").
         */
        this.data = {
            deviceName: names[Math.floor(Math.random() * names.length)],
            deviceId: "DEV-" + Math.random().toString(36).substr(2, 6).toUpperCase(),
            network: ["ERR_VOID", "GHOST_NET", "FIELD_0X4", "NULL_SIG"][Math.floor(Math.random() * 4)],
            strength: (Math.random() * -100).toFixed(1) + " dBm",
            hash: "0x" + Math.random().toString(16).substr(2, 4).toUpperCase()
        };

        /** @type {boolean} Dirty flag; true when parameters have changed and visuals need refreshing. */
        this.dirty = true;

        /** @type {number} Accumulated local time for this anchor (seconds, speed-scaled). */
        this._time = 0;

        /** @type {number} Running count of splats emitted by this anchor. */
        this._splatCount = 0;

        // Per-anchor gradient palette (5 stops, HSL for rich mixing)
        this._buildGradient();

        // Create micro-emitters (3–7) with mixed CW/CCW
        /**
         * Array of micro-emitter descriptors orbiting the anchor.
         * @type {Array<{radius:number, omega:number, phase:number, radialBias:number, noisePhase:number, colorOffset:number}>}
         */
        this.microEmitters = [];
        const n = 3 + Math.floor(Math.random() * 5);
        for (let i = 0; i < n; i++) {
            const cw = i % 2 === 0 ? 1 : -1;
            this.microEmitters.push({
                radius: 15 + Math.random() * 35,
                omega: cw * (0.03 + Math.random() * 0.12),
                phase: Math.random() * Math.PI * 2,
                radialBias: (Math.random() - 0.5) * 0.3,
                noisePhase: Math.random() * 100,
                colorOffset: Math.random() * 60 - 30
            });
        }
    }

    /**
     * Rebuild the five-stop HSL colour gradient from the current
     * {@link SignalAnchor#params}.hue value.
     * @private
     * @returns {void}
     */
    _buildGradient() {
        const h = this.params.hue;
        /**
         * Five-stop HSL colour gradient derived from the anchor's hue.
         * @type {Array<{h:number, s:number, l:number}>}
         */
        this.colorGradient = [
            { h: h - 30, s: 60, l: 25 },
            { h: h - 10, s: 75, l: 40 },
            { h: h, s: 85, l: 55 },
            { h: h + 15, s: 70, l: 45 },
            { h: h + 30, s: 55, l: 65 }
        ];
    }

    /**
     * Return the user-facing display ID for this anchor.
     * Falls back to the auto-generated {@link SignalAnchor#data}.deviceId
     * when {@link SignalAnchor#params}.deviceIdText is empty.
     * @returns {string} The display identifier string.
     */
    getDisplayId() {
        return this.params.deviceIdText || this.data.deviceId;
    }

    /**
     * Return the running count of splats emitted by this anchor.
     * @returns {number} Cumulative splat count.
     */
    getParticleCount() { return this._splatCount; }
}

/* ══════════════════════════════════════════════════════════
   AtomFluidEngine — singleton global fluid sim
   ══════════════════════════════════════════════════════════ */

/**
 * @namespace AtomFluidEngine
 * @description Singleton global WebGL Navier-Stokes fluid simulation engine.
 *
 * Maintains a single full-viewport canvas with velocity, density, pressure,
 * divergence, and curl framebuffer objects. Multiple {@link SignalAnchor}
 * instances inject colour splats into the shared field each frame via
 * orbiting micro-emitters. The solver runs advection, vorticity confinement,
 * pressure projection, and gradient subtraction every tick.
 */
const AtomFluidEngine = {
    /** @type {?HTMLCanvasElement} The offscreen simulation canvas. */
    canvas: null,

    /** @type {?WebGLRenderingContext|WebGL2RenderingContext} Active GL context. */
    gl: null,

    /** @type {boolean} True when no usable WebGL context could be obtained. */
    _noGL: false,

    /** @type {boolean} True when the context is WebGL 2. */
    _isWebGL2: false,

    /** @type {boolean} True when linear filtering of half-float textures is supported. */
    _supportLinear: false,

    /**
     * Cached format constants derived from the active GL context.
     * @type {?{internalFormat:GLenum, internalFormatRG:GLenum, formatRG:GLenum, texType:GLenum}}
     * @private
     */
    _ext: null,

    /** @type {Object|null} Populated by _runDiagnostics() after init */
    diag: null,

    /**
     * Map of compiled GL program wrappers keyed by pass name.
     * @type {?Object<string, {program:WebGLProgram, uniforms:Object<string,WebGLUniformLocation>, bind:Function}>}
     * @private
     */
    _programs: null,

    /**
     * Map of compiled WebGL shaders keyed by name (e.g. "baseVertex", "splat").
     * @type {?Object<string, WebGLShader>}
     * @private
     */
    _shaders: null,

    /** @type {number} Current simulation texture width (after downsample). @private */
    _texW: 0,

    /** @type {number} Current simulation texture height (after downsample). @private */
    _texH: 0,

    /** @type {?Object} Double-buffered density FBO pair. @private */
    _density: null,

    /** @type {?Object} Double-buffered velocity FBO pair. @private */
    _velocity: null,

    /** @type {?Array} Single divergence FBO. @private */
    _divergenceFBO: null,

    /** @type {?Array} Single curl FBO. @private */
    _curlFBO: null,

    /** @type {?Object} Double-buffered pressure FBO pair. @private */
    _pressure: null,

    /** @type {number} Accumulated global simulation time in seconds. @private */
    _time: 0,

    /** @type {number} Running total of all splats emitted across all anchors. @private */
    _totalSplats: 0,

    // Global sim config (defaults, can be overridden by first anchor or globally)
    /**
     * Global simulation configuration. Values are used by the Navier-Stokes
     * solver each frame and may be overridden externally.
     * @type {Object}
     * @property {number} TEXTURE_DOWNSAMPLE  - Power-of-two downsample shift for sim textures (default 1).
     * @property {number} DENSITY_DISSIPATION  - Per-step density fade factor (default 0.975).
     * @property {number} VELOCITY_DISSIPATION - Per-step velocity fade factor (default 0.985).
     * @property {number} PRESSURE_DISSIPATION - Per-step pressure fade factor (default 0.8).
     * @property {number} PRESSURE_ITERATIONS  - Jacobi iterations for pressure solve (default 20).
     * @property {number} CURL                 - Default curl/vorticity strength (default 30).
     * @property {number} BUOYANCY             - Subtle upward bias, candle-like (default 0.15).
     */
    config: {
        TEXTURE_DOWNSAMPLE: 1,
        DENSITY_DISSIPATION: 0.975,
        VELOCITY_DISSIPATION: 0.985,
        PRESSURE_DISSIPATION: 0.8,
        PRESSURE_ITERATIONS: 20,
        CURL: 30,
        BUOYANCY: 0.15   // subtle upward bias (candle-like)
    },

    /* ── Init ──────────────────────────────────────────── */

    /**
     * Initialise the fluid engine: create the offscreen canvas, obtain a
     * WebGL context, compile all shaders, link programs, and allocate
     * framebuffer objects at the given viewport size.
     *
     * @param {number} containerW - Viewport width in pixels.
     * @param {number} containerH - Viewport height in pixels.
     * @returns {void}
     */
    init(containerW, containerH) {
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'atom-fluid-canvas';
        // Use offscreen positioning instead of display:none to ensure
        // drawingBufferWidth/Height are non-zero in all browsers
        this.canvas.style.position = 'fixed';
        this.canvas.style.left = '0';
        this.canvas.style.top = '0';
        this.canvas.style.width = '1px';
        this.canvas.style.height = '1px';
        this.canvas.style.opacity = '0';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.zIndex = '-1';
        document.body.appendChild(this.canvas);

        this.canvas.width = containerW;
        this.canvas.height = containerH;

        const params = {
            alpha: true,
            depth: false,
            stencil: false,
            antialias: false,
            premultipliedAlpha: false,
            preserveDrawingBuffer: true
        };

        let gl = this.canvas.getContext("webgl2", params);
        this._isWebGL2 = !!gl;
        if (!this._isWebGL2) {
            gl = this.canvas.getContext("webgl", params) ||
                this.canvas.getContext("experimental-webgl", params);
        }
        if (!gl) { this._noGL = true; console.error("AtomFluidEngine: no WebGL"); return; }

        this.gl = gl;
        console.log('[AtomFluidEngine] WebGL' + (this._isWebGL2 ? '2' : '1') + ' context acquired, canvas:', containerW, 'x', containerH);

        const isWGL2 = this._isWebGL2;

        if (isWGL2) {
            // WebGL2: prefer 16-bit float. Enable float colour buffers and query
            // linear filtering. The FBO write probe runs *after* shader/blit init
            // (below) so it can use an actual draw call — gl.clear alone is not
            // sufficient because on Pi VC6 gl.clear works on RGBA16F FBOs while
            // fragment-shader writes (gl.drawElements) silently fail.
            gl.getExtension("EXT_color_buffer_float");
            const linearExt = gl.getExtension("OES_texture_float_linear");
            this._supportLinear = !!linearExt;
            this._ext = {
                internalFormat:   gl.RGBA16F,
                internalFormatRG: gl.RG16F,
                formatRG:         gl.RG,
                texType:          gl.HALF_FLOAT
            };
        } else {
            // WebGL1 (e.g. Raspberry Pi VideoCore): UNSIGNED_BYTE RGBA is the
            // ONLY texture format the spec guarantees is renderable as an FBO.
            // Half-float and float variants may advertise OES extensions and even
            // return FRAMEBUFFER_COMPLETE, but writes are silently discarded on
            // many embedded GPUs — making all blobs invisible.  Skip extensions
            // entirely and go straight to the safe fallback.
            this._supportLinear = true;   // linear filtering is free for UNSIGNED_BYTE
            this._ext = {
                internalFormat:   gl.RGBA,
                internalFormatRG: gl.RGBA,
                formatRG:         gl.RGBA,
                texType:          gl.UNSIGNED_BYTE
            };
        }

        gl.clearColor(0.0, 0.0, 0.0, 0.0);

        this._compileShaders();
        this._createPrograms();
        this._initBlit();
        // WebGL2 only: probe must run after programs+blit are ready so that the
        // test can use a real shader draw call (gl.drawElements) rather than
        // gl.clear, which takes a different GPU fast-path and can pass on broken
        // drivers even when fragment-shader writes silently fail.
        if (isWGL2) this._probeFBOSupport();
        this._initFramebuffers();
        this._runDiagnostics();
    },

    /**
     * Resize the simulation canvas and re-allocate all framebuffer objects.
     * No-op when WebGL is unavailable or dimensions are unchanged.
     *
     * @param {number} w - New width in pixels.
     * @param {number} h - New height in pixels.
     * @returns {void}
     */
    resize(w, h) {
        if (this._noGL) return;
        if (this.canvas.width === w && this.canvas.height === h) return;
        this.canvas.width = w;
        this.canvas.height = h;
        this._initFramebuffers();
    },

    /**
     * Run one-shot diagnostics after init: record WebGL version, texture format,
     * drawing-buffer size, and perform an actual write + read-back test on the
     * density FBO so problems are visible in the debug HUD even without DevTools.
     * Results stored in `this.diag` and printed to console.
     * @private
     */
    _runDiagnostics() {
        const gl = this.gl;
        const e = this._ext;

        // Friendly name for the active texel type
        const UB = gl.UNSIGNED_BYTE, FL = gl.FLOAT;
        const HF_WGL2 = gl.HALF_FLOAT;          // 0x140B in WebGL2
        const HF_OES  = 0x8D61;                 // HALF_FLOAT_OES in WebGL1
        const texTypeNames = {};
        texTypeNames[UB]    = 'UNSIGNED_BYTE';
        texTypeNames[FL]    = 'FLOAT';
        texTypeNames[HF_WGL2] = 'HALF_FLOAT(wgl2)';
        texTypeNames[HF_OES]  = 'HALF_FLOAT_OES';
        const texTypeName = texTypeNames[e.texType] || ('0x' + e.texType.toString(16));

        // ── FBO write + read-back test ────────────────────────────────────────
        // Bind density FBO, clear to a known non-zero colour, read one pixel.
        // For UNSIGNED_BYTE FBOs the read-back with gl.RGBA/UNSIGNED_BYTE is
        // spec-guaranteed.  For float FBOs we use the implementation-provided
        // preferred format (IMPLEMENTATION_COLOR_READ_FORMAT/TYPE).
        let fboWrite = 'skipped';
        let densityR = 0;
        try {
            gl.bindFramebuffer(gl.FRAMEBUFFER, this._density.first[1]);
            gl.viewport(0, 0, this._texW || 1, this._texH || 1);

            // Query the implementation's preferred read-back format for this FBO
            const readFmt  = this._isWebGL2
                ? gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT)
                : gl.RGBA;
            const readType = this._isWebGL2
                ? gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE)
                : gl.UNSIGNED_BYTE;

            // Write a test value (r≈0.5) into the FBO
            gl.clearColor(0.502, 0.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            // Read it back
            const isFloat = (readType === gl.FLOAT ||
                             readType === 0x8D61 /* HALF_FLOAT_OES */ ||
                             readType === gl.HALF_FLOAT);
            const buf = isFloat ? new Float32Array(4) : new Uint8Array(4);
            gl.readPixels(0, 0, 1, 1, readFmt, readType, buf);
            const err = gl.getError();

            const threshold = isFloat ? 0.1 : 50;
            densityR = buf[0];
            if (err !== gl.NO_ERROR) {
                fboWrite = `READBACK_ERR(0x${err.toString(16)})`;
            } else if (buf[0] >= threshold) {
                fboWrite = `PASS(r=${isFloat ? buf[0].toFixed(2) : buf[0]})`;
            } else {
                fboWrite = `FAIL(r=${isFloat ? buf[0].toFixed(2) : buf[0]},` +
                           `fmt=0x${readFmt.toString(16)},` +
                           `type=0x${readType.toString(16)})`;
            }

            // Clear the test value so the simulation starts from zero
            gl.clearColor(0.0, 0.0, 0.0, 0.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        } catch (ex) {
            fboWrite = 'EXCEPTION:' + ex.message;
        }

        this.diag = {
            wglVer:    this._isWebGL2 ? 'WebGL2' : 'WebGL1',
            texType:   texTypeName,
            bufSize:   `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`,
            texSize:   `${this._texW}x${this._texH}`,
            fboWrite,
            linear:    this._supportLinear,
            initDensityR: densityR,
        };

        console.log('[AtomFluid] Diagnostics:', JSON.stringify(this.diag));
    },

    /**
     * Test whether the current `_ext` format can actually be used as an FBO
     * render target by performing two checks:
     *   1. gl.checkFramebufferStatus() — driver-level completeness.
     *   2. A real shader DRAW CALL (gl.drawElements via the 'clear' program)
     *      followed by gl.readPixels(FLOAT) — actual GPU write verification.
     *
     * Why a draw call and not gl.clear:
     *   On Raspberry Pi VideoCore VI, RGBA16F FBOs report FRAMEBUFFER_COMPLETE
     *   and gl.clear writes are readable.  But fragment-shader writes
     *   (gl.drawElements) are silently discarded — all blobs invisible.
     *   Only testing with an actual draw call catches this driver bug.
     *
     * Must be called AFTER _createPrograms() and _initBlit() so that
     * this._programs.clear and the quad buffers are available.
     *
     * Falls back to UNSIGNED_BYTE RGBA on any failure.
     * @private
     */
    _probeFBOSupport() {
        const gl = this.gl;
        const e = this._ext;

        // ── Step 1: create a 1×1 test FBO with the candidate format ──────────
        const testTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, testTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, e.internalFormat, 1, 1, 0, gl.RGBA, e.texType, null);
        gl.bindTexture(gl.TEXTURE_2D, null);

        const testFBO = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, testFBO);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                                gl.TEXTURE_2D, testTex, 0);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // ── Step 2: real shader draw call into the test FBO ───────────────────
        // gl.clear alone is not sufficient — it uses a different GPU fast-path.
        // We use the 'clear' program:  gl_FragColor = value * texture2D(uTexture)
        // Source: 1×1 red RGBA/UNSIGNED_BYTE texture  →  r=1.0 in shader output
        // With value=1.0 the draw writes r=1.0 into the FBO.
        let writeOK = false;
        if (status === gl.FRAMEBUFFER_COMPLETE) {
            // Create a tiny source texture (always UNSIGNED_BYTE — always valid)
            const srcTex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, srcTex);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                          new Uint8Array([255, 0, 0, 255]));  // r=1.0 when sampled

            // Clear destination to zero so we can detect a silent write failure
            gl.bindFramebuffer(gl.FRAMEBUFFER, testFBO);
            gl.viewport(0, 0, 1, 1);
            gl.clearColor(0.0, 0.0, 0.0, 0.0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            // Draw with the clear program: output = 1.0 * red_texture = (1,0,0,1)
            const cp = this._programs.clear;
            cp.bind();
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, srcTex);
            gl.uniform1i(cp.uniforms.uTexture, 0);
            gl.uniform1f(cp.uniforms.value,    1.0);
            this._blit(testFBO);   // binds testFBO and calls drawElements

            // Read back with FLOAT (correct format for RGBA16F FBOs in WebGL2)
            const buf = new Float32Array(4);
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, buf);
            const err = gl.getError();
            writeOK = (err === gl.NO_ERROR) && (buf[0] > 0.5);

            if (!writeOK) {
                const detail = err
                    ? ('readPixels err 0x' + err.toString(16))
                    : ('r=' + buf[0].toFixed(3) + ' (expected >0.5)');
                console.warn('[AtomFluidEngine] Shader write probe FAILED on RGBA16F FBO: ' +
                    detail + ' — fragment-shader writes are silently discarded on this GPU.');
            }

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.deleteTexture(srcTex);
        }

        // ── Cleanup ───────────────────────────────────────────────────────────
        gl.deleteFramebuffer(testFBO);
        gl.deleteTexture(testTex);
        gl.getError(); // flush any residual error

        // ── Decide ────────────────────────────────────────────────────────────
        const needsFallback = (status !== gl.FRAMEBUFFER_COMPLETE) || !writeOK;
        if (needsFallback) {
            const reason = status !== gl.FRAMEBUFFER_COMPLETE
                ? 'FBO incomplete (0x' + status.toString(16) + ')'
                : 'shader draw call produced no output (GPU silently discards writes)';
            console.warn('[AtomFluidEngine] Falling back to UNSIGNED_BYTE: ' + reason);
            this._ext = {
                internalFormat:   gl.RGBA,
                internalFormatRG: gl.RGBA,
                formatRG:         gl.RGBA,
                texType:          gl.UNSIGNED_BYTE
            };
            this._supportLinear = true;
        } else {
            console.log('[AtomFluidEngine] FBO shader-write probe passed ' +
                '(texType=0x' + e.texType.toString(16) + ').');
        }
    },

    /**
     * Compile a single GLSL shader of the given type.
     *
     * @private
     * @param {GLenum} type   - `gl.VERTEX_SHADER` or `gl.FRAGMENT_SHADER`.
     * @param {string} source - GLSL source code.
     * @returns {?WebGLShader} The compiled shader, or `null` on failure.
     */
    _compileShader(type, source) {
        const gl = this.gl;
        const s = gl.createShader(type);
        gl.shaderSource(s, source);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error("Shader:", gl.getShaderInfoLog(s));
            return null;
        }
        return s;
    },

    /**
     * Compile all GLSL shaders required by the fluid solver and store them
     * in {@link AtomFluidEngine._shaders}.
     *
     * @private
     * @returns {void}
     */
    _compileShaders() {
        const gl = this.gl;
        this._shaders = {};

        this._shaders.baseVertex = this._compileShader(gl.VERTEX_SHADER,
            `precision highp float; precision mediump sampler2D;
             attribute vec2 aPosition;
             varying vec2 vUv, vL, vR, vT, vB;
             uniform vec2 texelSize;
             void main () {
                 vUv = aPosition * 0.5 + 0.5;
                 vL = vUv - vec2(texelSize.x, 0.0);
                 vR = vUv + vec2(texelSize.x, 0.0);
                 vT = vUv + vec2(0.0, texelSize.y);
                 vB = vUv - vec2(0.0, texelSize.y);
                 gl_Position = vec4(aPosition, 0.0, 1.0);
             }`);

        this._shaders.clear = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float; precision mediump sampler2D;
             varying vec2 vUv; uniform sampler2D uTexture; uniform float value;
             void main () { gl_FragColor = value * texture2D(uTexture, vUv); }`);

        this._shaders.display = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float; precision mediump sampler2D;
             varying vec2 vUv; uniform sampler2D uTexture;
             void main () {
                 vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
                 vec4 c = texture2D(uTexture, uv);
                 float a = length(c.rgb);
                 gl_FragColor = vec4(c.rgb, smoothstep(0.0, 0.05, a));
             }`);

        this._shaders.splat = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float; precision mediump sampler2D;
             varying vec2 vUv; uniform sampler2D uTarget;
             uniform float aspectRatio; uniform vec3 color;
             uniform vec2 point; uniform float radius;
             void main () {
                 vec2 p = vUv - point.xy; p.x *= aspectRatio;
                 vec3 splat = exp(-dot(p, p) / radius) * color;
                 vec3 base = texture2D(uTarget, vUv).xyz;
                 gl_FragColor = vec4(base + splat, 1.0);
             }`);

        this._shaders.advectionManual = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float; precision mediump sampler2D;
             varying vec2 vUv; uniform sampler2D uVelocity, uSource;
             uniform vec2 texelSize; uniform float dt, dissipation;
             vec4 bilerp(in sampler2D sam, in vec2 p) {
                 vec4 st; st.xy = floor(p - 0.5) + 0.5; st.zw = st.xy + 1.0;
                 vec4 uv = st * texelSize.xyxy;
                 vec4 a = texture2D(sam, uv.xy), b = texture2D(sam, uv.zy);
                 vec4 c = texture2D(sam, uv.xw), d = texture2D(sam, uv.zw);
                 vec2 f = p - st.xy;
                 return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
             }
             void main () {
                 vec2 coord = gl_FragCoord.xy - dt * texture2D(uVelocity, vUv).xy;
                 gl_FragColor = dissipation * bilerp(uSource, coord);
                 gl_FragColor.a = 1.0;
             }`);

        this._shaders.advection = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float; precision mediump sampler2D;
             varying vec2 vUv; uniform sampler2D uVelocity, uSource;
             uniform vec2 texelSize; uniform float dt, dissipation;
             void main () {
                 vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
                 gl_FragColor = dissipation * texture2D(uSource, coord);
             }`);

        this._shaders.divergence = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float; precision mediump sampler2D;
             varying vec2 vUv, vL, vR, vT, vB; uniform sampler2D uVelocity;
             vec2 sampleV(in vec2 uv) {
                 vec2 m = vec2(1.0);
                 if (uv.x < 0.0) { uv.x = 0.0; m.x = -1.0; }
                 if (uv.x > 1.0) { uv.x = 1.0; m.x = -1.0; }
                 if (uv.y < 0.0) { uv.y = 0.0; m.y = -1.0; }
                 if (uv.y > 1.0) { uv.y = 1.0; m.y = -1.0; }
                 return m * texture2D(uVelocity, uv).xy;
             }
             void main () {
                 float L = sampleV(vL).x, R = sampleV(vR).x;
                 float T = sampleV(vT).y, B = sampleV(vB).y;
                 gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
             }`);

        this._shaders.curl = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float; precision mediump sampler2D;
             varying vec2 vUv, vL, vR, vT, vB; uniform sampler2D uVelocity;
             void main () {
                 float L = texture2D(uVelocity, vL).y, R = texture2D(uVelocity, vR).y;
                 float T = texture2D(uVelocity, vT).x, B = texture2D(uVelocity, vB).x;
                 gl_FragColor = vec4(R - L - T + B, 0.0, 0.0, 1.0);
             }`);

        this._shaders.vorticity = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float; precision mediump sampler2D;
             varying vec2 vUv, vL, vR, vT, vB;
             uniform sampler2D uVelocity, uCurl; uniform float curl, dt;
             void main () {
                 float L = texture2D(uCurl, vL).y, R = texture2D(uCurl, vR).y;
                 float T = texture2D(uCurl, vT).x, B = texture2D(uCurl, vB).x;
                 float C = texture2D(uCurl, vUv).x;
                 vec2 force = vec2(abs(T) - abs(B), abs(R) - abs(L));
                 force *= 1.0 / length(force + 0.00001) * curl * C;
                 vec2 vel = texture2D(uVelocity, vUv).xy;
                 gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
             }`);

        this._shaders.pressure = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float; precision mediump sampler2D;
             varying vec2 vUv, vL, vR, vT, vB;
             uniform sampler2D uPressure, uDivergence;
             vec2 bnd(in vec2 uv) { return min(max(uv, 0.0), 1.0); }
             void main () {
                 float L = texture2D(uPressure, bnd(vL)).x;
                 float R = texture2D(uPressure, bnd(vR)).x;
                 float T = texture2D(uPressure, bnd(vT)).x;
                 float B = texture2D(uPressure, bnd(vB)).x;
                 float div = texture2D(uDivergence, vUv).x;
                 gl_FragColor = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
             }`);

        this._shaders.gradientSubtract = this._compileShader(gl.FRAGMENT_SHADER,
            `precision highp float; precision mediump sampler2D;
             varying vec2 vUv, vL, vR, vT, vB;
             uniform sampler2D uPressure, uVelocity;
             vec2 bnd(in vec2 uv) { return min(max(uv, 0.0), 1.0); }
             void main () {
                 float L = texture2D(uPressure, bnd(vL)).x;
                 float R = texture2D(uPressure, bnd(vR)).x;
                 float T = texture2D(uPressure, bnd(vT)).x;
                 float B = texture2D(uPressure, bnd(vB)).x;
                 vec2 vel = texture2D(uVelocity, vUv).xy;
                 vel -= vec2(R - L, T - B);
                 gl_FragColor = vec4(vel, 0.0, 1.0);
             }`);
    },

    /**
     * Link a vertex shader and fragment shader into a GL program,
     * extract all active uniform locations, and return a wrapper object.
     *
     * @private
     * @param {WebGLShader} vs - Compiled vertex shader.
     * @param {WebGLShader} fs - Compiled fragment shader.
     * @returns {?{program:WebGLProgram, uniforms:Object<string,WebGLUniformLocation>, bind:Function}}
     *   The linked program wrapper, or `null` on link failure.
     */
    _createGLProgram(vs, fs) {
        const gl = this.gl;
        const p = gl.createProgram();
        gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
            console.error("Link:", gl.getProgramInfoLog(p)); return null;
        }
        const uniforms = {};
        const cnt = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < cnt; i++) {
            const nm = gl.getActiveUniform(p, i).name;
            uniforms[nm] = gl.getUniformLocation(p, nm);
        }
        return { program: p, uniforms, bind() { gl.useProgram(p); } };
    },

    /**
     * Create all GPU programs used by the fluid solver (clear, display,
     * splat, advection, divergence, curl, vorticity, pressure,
     * gradientSubtract) and store them in {@link AtomFluidEngine._programs}.
     *
     * @private
     * @returns {void}
     */
    _createPrograms() {
        const s = this._shaders;
        const advFS = this._supportLinear ? s.advection : s.advectionManual;
        this._programs = {
            clear: this._createGLProgram(s.baseVertex, s.clear),
            display: this._createGLProgram(s.baseVertex, s.display),
            splat: this._createGLProgram(s.baseVertex, s.splat),
            advection: this._createGLProgram(s.baseVertex, advFS),
            divergence: this._createGLProgram(s.baseVertex, s.divergence),
            curl: this._createGLProgram(s.baseVertex, s.curl),
            vorticity: this._createGLProgram(s.baseVertex, s.vorticity),
            pressure: this._createGLProgram(s.baseVertex, s.pressure),
            gradientSubtract: this._createGLProgram(s.baseVertex, s.gradientSubtract)
        };
    },

    /**
     * Set up the full-screen quad vertex and index buffers used by
     * {@link AtomFluidEngine._blit} to draw all shader passes.
     *
     * @private
     * @returns {void}
     */
    _initBlit() {
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(0);
    },

    /**
     * Draw the full-screen quad into the given framebuffer (or the default
     * framebuffer when `dest` is `null`).
     *
     * @private
     * @param {?WebGLFramebuffer} dest - Target framebuffer, or `null` for the
     *   default (on-screen) framebuffer.
     * @returns {void}
     */
    _blit(dest) {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, dest);
        this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);
    },

    /* ── FBO Management ────────────────────────────────── */

    /**
     * Create a single framebuffer object backed by a half-float texture.
     *
     * @private
     * @param {number} texId  - Texture unit index to bind to.
     * @param {number} w      - Texture width in texels.
     * @param {number} h      - Texture height in texels.
     * @param {GLenum} intFmt - Internal format (e.g. `gl.RGBA16F`).
     * @param {GLenum} fmt    - Pixel format (e.g. `gl.RGBA`).
     * @param {GLenum} type   - Pixel type (e.g. `gl.HALF_FLOAT`).
     * @param {GLenum} filter - Texture filtering mode (`gl.LINEAR` or `gl.NEAREST`).
     * @returns {Array} Tuple `[WebGLTexture, WebGLFramebuffer, texId]`.
     */
    _createFBO(texId, w, h, intFmt, fmt, type, filter) {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0 + texId);
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, intFmt, w, h, 0, fmt, type, null);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.viewport(0, 0, w, h);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return [tex, fbo, texId];
    },

    /**
     * Create a ping-pong pair of FBOs for double-buffered simulation passes.
     *
     * @private
     * @param {number} texId  - Base texture unit index (uses texId and texId+1).
     * @param {number} w      - Texture width in texels.
     * @param {number} h      - Texture height in texels.
     * @param {GLenum} intFmt - Internal format.
     * @param {GLenum} fmt    - Pixel format.
     * @param {GLenum} type   - Pixel type.
     * @param {GLenum} filter - Texture filtering mode.
     * @returns {{first: Array, second: Array, swap: Function}} Double FBO with swap capability.
     */
    _createDoubleFBO(texId, w, h, intFmt, fmt, type, filter) {
        let a = this._createFBO(texId, w, h, intFmt, fmt, type, filter);
        let b = this._createFBO(texId + 1, w, h, intFmt, fmt, type, filter);
        return {
            get first() { return a; }, get second() { return b; },
            swap() { const t = a; a = b; b = t; }
        };
    },

    /**
     * (Re-)allocate all simulation framebuffer objects (density, velocity,
     * divergence, curl, pressure) at the current canvas size divided by
     * {@link AtomFluidEngine.config}.TEXTURE_DOWNSAMPLE.
     *
     * @private
     * @returns {void}
     */
    _initFramebuffers() {
        const gl = this.gl, e = this._ext;
        const ds = this.config.TEXTURE_DOWNSAMPLE;
        this._texW = gl.drawingBufferWidth >> ds;
        this._texH = gl.drawingBufferHeight >> ds;
        const w = this._texW, h = this._texH;
        const filt = this._supportLinear ? gl.LINEAR : gl.NEAREST;
        this._density = this._createDoubleFBO(0, w, h, e.internalFormat, gl.RGBA, e.texType, filt);
        this._velocity = this._createDoubleFBO(2, w, h, e.internalFormatRG, e.formatRG, e.texType, filt);
        this._divergenceFBO = this._createFBO(4, w, h, e.internalFormatRG, e.formatRG, e.texType, gl.NEAREST);
        this._curlFBO = this._createFBO(5, w, h, e.internalFormatRG, e.formatRG, e.texType, gl.NEAREST);
        this._pressure = this._createDoubleFBO(6, w, h, e.internalFormatRG, e.formatRG, e.texType, gl.NEAREST);
    },

    /* ── Splat ──────────────────────────────────────────── */

    /**
     * Inject a single Gaussian splat into both the velocity and density
     * fields at the given canvas-space position.
     *
     * @private
     * @param {number} x      - Horizontal position in canvas pixels.
     * @param {number} y      - Vertical position in canvas pixels.
     * @param {number} dx     - Horizontal velocity impulse.
     * @param {number} dy     - Vertical velocity impulse.
     * @param {number[]} color - RGB colour triplet (each 0-1+, pre-multiplied by intensity).
     * @param {number} radius - Splat radius in UV-squared space.
     * @returns {void}
     */
    _splat(x, y, dx, dy, color, radius) {
        const gl = this.gl, c = this.canvas, p = this._programs.splat;
        p.bind();
        gl.uniform1i(p.uniforms.uTarget, this._velocity.first[2]);
        gl.uniform1f(p.uniforms.aspectRatio, c.width / c.height);
        gl.uniform2f(p.uniforms.point, x / c.width, y / c.height);
        gl.uniform3f(p.uniforms.color, dx, dy, 1.0);
        gl.uniform1f(p.uniforms.radius, radius);
        this._blit(this._velocity.second[1]);
        this._velocity.swap();

        gl.uniform1i(p.uniforms.uTarget, this._density.first[2]);
        gl.uniform3f(p.uniforms.color, color[0], color[1], color[2]);
        this._blit(this._density.second[1]);
        this._density.swap();
    },

    /* ── HSL → RGB helper ──────────────────────────────── */

    /**
     * Convert an HSL colour to an RGB triplet with components in the 0-1 range.
     *
     * @private
     * @param {number} h - Hue in degrees (any value; wrapped to 0-360).
     * @param {number} s - Saturation 0-100.
     * @param {number} l - Lightness 0-100.
     * @returns {number[]} RGB array `[r, g, b]` each in 0-1.
     */
    _hslToRGB(h, s, l) {
        h = ((h % 360) + 360) % 360;
        s /= 100; l /= 100;
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = l - c / 2;
        let r = 0, g = 0, bl = 0;
        if (h < 60) { r = c; g = x; }
        else if (h < 120) { r = x; g = c; }
        else if (h < 180) { g = c; bl = x; }
        else if (h < 240) { g = x; bl = c; }
        else if (h < 300) { r = x; bl = c; }
        else { r = c; bl = x; }
        return [r + m, g + m, bl + m];
    },

    /**
     * Linearly interpolate between gradient stops, using the signal's own
     * saturation parameter instead of the gradient's hard-coded value.
     *
     * @private
     * @param {Array<{h:number, s:number, l:number}>} gradient - Five-stop HSL gradient.
     * @param {number} t - Interpolation factor in 0-1.
     * @param {number} emitterColorOffset - Per-emitter hue offset in degrees.
     * @param {number} paramSaturation - Signal saturation (0-100) from anchor params.
     * @returns {number[]} RGB array `[r, g, b]` each in 0-1.
     */
    _lerpGradientRGB(gradient, t, emitterColorOffset, paramSaturation) {
        const n = gradient.length - 1;
        const seg = Math.min(Math.floor(t * n), n - 1);
        const f = (t * n) - seg;
        const a = gradient[seg], b = gradient[seg + 1];
        const h = a.h + (b.h - a.h) * f + emitterColorOffset;
        // Use the signal's saturation param instead of gradient's hardcoded s
        const satClamped = Math.max(0, Math.min(100, paramSaturation));
        const l = a.l + (b.l - a.l) * f;
        return this._hslToRGB(h, satClamped, l);
    },

    /**
     * Blend sampled image color with HSL target so hue controls remain effective
     * even when camera sampling is active.
     *
     * @private
     * @param {number[]} sampledRgb - Sampled RGB [0-1].
     * @param {number[]} hslRgb - HSL-derived RGB [0-1].
     * @param {number} mixAmount - Blend factor in [0-1].
     * @returns {number[]} Blended RGB [0-1].
     */
    _mixRgb(sampledRgb, hslRgb, mixAmount) {
        const t = Math.max(0, Math.min(1, mixAmount));
        return [
            sampledRgb[0] * (1 - t) + hslRgb[0] * t,
            sampledRgb[1] * (1 - t) + hslRgb[1] * t,
            sampledRgb[2] * (1 - t) + hslRgb[2] * t
        ];
    },

    /* ── Simple noise for wobble ────────────────────────── */

    /**
     * Simple deterministic pseudo-noise function composed of three sine
     * harmonics, used for emitter wobble and jitter.
     *
     * @private
     * @param {number} t - Time or phase input.
     * @returns {number} Noise value roughly in -0.6 to +0.6.
     */
    _noise(t) {
        return Math.sin(t * 1.7) * 0.3 + Math.sin(t * 3.1) * 0.2 + Math.sin(t * 5.3) * 0.1;
    },

    /* ── Emit splats from all anchors ──────────────────── */

    /**
     * Iterate over all anchors and their micro-emitters, computing orbital
     * positions, velocity impulses, and gradient colours, then injecting
     * splats into the shared fluid field.
     *
     * @private
     * @param {SignalAnchor[]} anchors - Array of active signal anchors.
     * @param {number} dt - Stable solver time-step in seconds.
     * @returns {void}
     */
    _emitFromAnchors(anchors, dt) {
        anchors.forEach(anchor => {
            const p = anchor.params;
            // Speed scales emitter motion + injection force, NOT dt
            const speedScale = Math.max(0.05, p.speed); // floor: always alive

            // Advance emitter time by speed-scaled dt
            anchor._time += dt * speedScale;

            // Rebuild gradient if hue changed
            if (anchor._lastGradHue !== p.hue) {
                anchor._buildGradient();
                anchor._lastGradHue = p.hue;
            }

            // D: emissionRate controls splat count per frame
            const splatsPerFrame = p.emissionRate * dt;
            const wholeSplats = Math.floor(splatsPerFrame);
            const fractional = splatsPerFrame - wholeSplats;
            const totalSplats = Math.max(1, wholeSplats + (Math.random() < fractional ? 1 : 0));

            // C: radiusLimit clamp
            const rLimit = Math.max(5, p.radiusLimit);

            // G: brightness factor (0-100 → 0.0-2.0 multiplier)
            const brightnessFactor = (p.brightness / 100) * 2.0;

            anchor.microEmitters.forEach((em) => {
                for (let si = 0; si < totalSplats; si++) {
                    // C: clamp orbit radius to radiusLimit
                    const orbitR = Math.min(em.radius, rLimit);
                    const angle = em.omega * anchor._time + em.phase;
                    const emitterTime = anchor._time + em.noisePhase * 0.01;

                    // E: coherent noise jitter, clamped to radiusLimit
                    const jitterScale = Math.min(p.anchorJitter, rLimit);
                    const wobbleX = this._noise(emitterTime * 0.7 + em.noisePhase) * jitterScale;
                    const wobbleY = this._noise(emitterTime * 0.9 + em.noisePhase + 50) * jitterScale;

                    // Emitter position (clamped distance from anchor)
                    let offX = Math.cos(angle) * orbitR + wobbleX;
                    let offY = Math.sin(angle) * orbitR + wobbleY;
                    const dist = Math.sqrt(offX * offX + offY * offY);
                    if (dist > rLimit) {
                        const scale = rLimit / dist;
                        offX *= scale;
                        offY *= scale;
                    }
                    const ex = anchor.x + offX;
                    const ey = anchor.y + offY;

                    // B: gentle force — reduced ~10× (was 40-100, now 5-15)
                    const rDirX = Math.cos(angle);
                    const rDirY = Math.sin(angle);
                    const noiseX = this._noise(emitterTime * 1.3 + em.noisePhase * 2) * 0.3;
                    const noiseY = this._noise(emitterTime * 1.1 + em.noisePhase * 3) * 0.3;
                    const forceMag = 5 + (rLimit / 200) * 10; // gentle, scales slightly with radius
                    const dx = (rDirX * em.radialBias + noiseX) * forceMag * speedScale;
                    const dy = (rDirY * em.radialBias + noiseY) * forceMag * speedScale;

                    // Gradient palette colour with per-emitter offset + signal saturation
                    const t = Math.random();
                    // D: constant per-splat intensity (not inversely scaled)
                    // G: brightness multiplies final RGB
                    const intensity = p.density * 0.15 * brightnessFactor;

                    let color;
                    if (anchor.color) {
                        // Keep camera-sampled chroma, but allow H/S/B to tint it.
                        const rVar = (Math.random() - 0.5) * 0.05;
                        const gVar = (Math.random() - 0.5) * 0.05;
                        const bVar = (Math.random() - 0.5) * 0.05;
                        const sampled = [
                            Math.max(0, Math.min(1, anchor.color.r + rVar)),
                            Math.max(0, Math.min(1, anchor.color.g + gVar)),
                            Math.max(0, Math.min(1, anchor.color.b + bVar))
                        ];
                        const hslTone = this._hslToRGB(p.hue + em.colorOffset * 0.5, p.saturation, p.brightness);
                        const satMix = Math.max(0.15, Math.min(0.85, p.saturation / 100));
                        const blended = this._mixRgb(sampled, hslTone, satMix);
                        color = [
                            blended[0] * intensity,
                            blended[1] * intensity,
                            blended[2] * intensity
                        ];
                    } else {
                        const rgb = this._lerpGradientRGB(anchor.colorGradient, t, em.colorOffset, p.saturation);
                        color = [rgb[0] * intensity, rgb[1] * intensity, rgb[2] * intensity];
                    }

                    this._splat(ex, ey, dx, dy, color, p.size);
                    anchor._splatCount++;
                    this._totalSplats++;
                }
            });
        });
    },

    /* ── Simulation Step ───────────────────────────────── */

    /**
     * Run one full Navier-Stokes simulation tick: advect velocity and
     * density, emit splats from all anchors, compute curl and vorticity
     * confinement, solve pressure via Jacobi iteration, and subtract
     * the pressure gradient from velocity.
     *
     * @param {number} dt - Frame delta time in **milliseconds**.
     * @param {SignalAnchor[]} anchors - Array of active signal anchors to emit from.
     * @returns {void}
     */
    update(dt, anchors) {
        if (this._noGL || !anchors || anchors.length === 0) return;

        const gl = this.gl;
        // A: stable solver dt — NEVER multiply by speed
        const dSec = Math.max(0.001, Math.min(dt / 1000, 0.016));
        this._time += dSec;

        // Curl from first anchor or global default
        const avgCurl = anchors.length > 0 ? anchors[0].params.curlRadius : this.config.CURL;

        const tw = this._texW, th = this._texH;
        gl.viewport(0, 0, tw, th);

        // Advect velocity
        const advP = this._programs.advection;
        advP.bind();
        gl.uniform2f(advP.uniforms.texelSize, 1.0 / tw, 1.0 / th);
        gl.uniform1i(advP.uniforms.uVelocity, this._velocity.first[2]);
        gl.uniform1i(advP.uniforms.uSource, this._velocity.first[2]);
        gl.uniform1f(advP.uniforms.dt, dSec);
        gl.uniform1f(advP.uniforms.dissipation, this.config.VELOCITY_DISSIPATION);
        this._blit(this._velocity.second[1]);
        this._velocity.swap();

        // Advect density
        gl.uniform1i(advP.uniforms.uVelocity, this._velocity.first[2]);
        gl.uniform1i(advP.uniforms.uSource, this._density.first[2]);
        gl.uniform1f(advP.uniforms.dissipation, this.config.DENSITY_DISSIPATION);
        this._blit(this._density.second[1]);
        this._density.swap();

        // Emit from all anchors (using same stable dt)
        this._emitFromAnchors(anchors, dSec);

        // Curl
        const curlP = this._programs.curl;
        curlP.bind();
        gl.uniform2f(curlP.uniforms.texelSize, 1.0 / tw, 1.0 / th);
        gl.uniform1i(curlP.uniforms.uVelocity, this._velocity.first[2]);
        this._blit(this._curlFBO[1]);

        // Vorticity
        const vortP = this._programs.vorticity;
        vortP.bind();
        gl.uniform2f(vortP.uniforms.texelSize, 1.0 / tw, 1.0 / th);
        gl.uniform1i(vortP.uniforms.uVelocity, this._velocity.first[2]);
        gl.uniform1i(vortP.uniforms.uCurl, this._curlFBO[2]);
        gl.uniform1f(vortP.uniforms.curl, avgCurl);
        gl.uniform1f(vortP.uniforms.dt, dSec);
        this._blit(this._velocity.second[1]);
        this._velocity.swap();

        // Divergence
        const divP = this._programs.divergence;
        divP.bind();
        gl.uniform2f(divP.uniforms.texelSize, 1.0 / tw, 1.0 / th);
        gl.uniform1i(divP.uniforms.uVelocity, this._velocity.first[2]);
        this._blit(this._divergenceFBO[1]);

        // Pressure clear
        const clrP = this._programs.clear;
        clrP.bind();
        const pTex = this._pressure.first[2];
        gl.activeTexture(gl.TEXTURE0 + pTex);
        gl.bindTexture(gl.TEXTURE_2D, this._pressure.first[0]);
        gl.uniform1i(clrP.uniforms.uTexture, pTex);
        gl.uniform1f(clrP.uniforms.value, this.config.PRESSURE_DISSIPATION);
        this._blit(this._pressure.second[1]);
        this._pressure.swap();

        // Pressure solve
        const prP = this._programs.pressure;
        prP.bind();
        gl.uniform2f(prP.uniforms.texelSize, 1.0 / tw, 1.0 / th);
        gl.uniform1i(prP.uniforms.uDivergence, this._divergenceFBO[2]);
        const prTex = this._pressure.first[2];
        gl.activeTexture(gl.TEXTURE0 + prTex);
        for (let i = 0; i < this.config.PRESSURE_ITERATIONS; i++) {
            gl.bindTexture(gl.TEXTURE_2D, this._pressure.first[0]);
            gl.uniform1i(prP.uniforms.uPressure, prTex);
            this._blit(this._pressure.second[1]);
            this._pressure.swap();
        }

        // Gradient subtract
        const gsP = this._programs.gradientSubtract;
        gsP.bind();
        gl.uniform2f(gsP.uniforms.texelSize, 1.0 / tw, 1.0 / th);
        gl.uniform1i(gsP.uniforms.uPressure, this._pressure.first[2]);
        gl.uniform1i(gsP.uniforms.uVelocity, this._velocity.first[2]);
        this._blit(this._velocity.second[1]);
        this._velocity.swap();
    },

    /* ── Render density to canvas ──────────────────────── */

    /**
     * Render the current density field to the simulation canvas using the
     * display shader. The alpha channel is derived from the RGB magnitude
     * via smoothstep for soft edges.
     *
     * @returns {void}
     */
    render() {
        if (this._noGL) return;
        const gl = this.gl;
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        const dp = this._programs.display;
        dp.bind();
        gl.uniform1i(dp.uniforms.uTexture, this._density.first[2]);
        this._blit(null);

        // ── Periodic density sample for debug HUD (every 60 frames) ──────────
        // Reads one pixel from the center of the density FBO. Non-zero means
        // splats are actually accumulating; zero means writes are broken.
        // Only safe for UNSIGNED_BYTE FBOs — readPixels with UNSIGNED_BYTE on a
        // float/half-float FBO generates GL_INVALID_OPERATION and spams logs.
        this._renderCount = (this._renderCount || 0) + 1;
        if (this._renderCount % 60 === 1 && this.diag &&
                this._ext && this._ext.texType === gl.UNSIGNED_BYTE) {
            try {
                gl.bindFramebuffer(gl.FRAMEBUFFER, this._density.first[1]);
                const cx = Math.max(1, Math.floor((this._texW || 2) / 2));
                const cy = Math.max(1, Math.floor((this._texH || 2) / 2));
                const pix = new Uint8Array(4);
                gl.readPixels(cx, cy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pix);
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                if (gl.getError() === gl.NO_ERROR) {
                    this.diag.densitySample = `rgba(${pix[0]},${pix[1]},${pix[2]},${pix[3]})`;
                }
            } catch (_) { /* don't interrupt rendering */ }
        }
    },

    /**
     * Return the cumulative number of splats emitted across all anchors
     * since initialisation.
     *
     * @returns {number} Total splat count.
     */
    getTotalSplats() { return this._totalSplats; }
};
