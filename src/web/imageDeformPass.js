/**
 * GHOST SIGNAL INSTRUMENT — vAtom Fluid
 * ImageDeformPass — standalone WebGL deformation + color sampling.
 * Separate GL context; does NOT touch AtomFluidEngine state.
 *
 * Single Responsibility: GPU-accelerated localized image deformation at anchor positions.
 */

const ImageDeformPass = {
    canvas: null,
    gl: null,
    _ready: false,
    _program: null,
    _imageTex: null,
    _imageW: 0,
    _imageH: 0,
    _vbo: null,
    _ibo: null,
    // 1x1 FBO for color sampling
    _sampleFBO: null,
    _sampleTex: null,

    init() {
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'deform-pass-canvas';
        // Use offscreen positioning instead of display:none to ensure
        // drawingBufferWidth/Height are non-zero in all browsers
        this.canvas.style.position = 'fixed';
        this.canvas.style.width = '1px';
        this.canvas.style.height = '1px';
        this.canvas.style.opacity = '0';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.zIndex = '-1';
        document.body.appendChild(this.canvas);

        const params = {
            alpha: true, depth: false, stencil: false,
            antialias: false, premultipliedAlpha: false,
            preserveDrawingBuffer: true
        };
        const gl = this.canvas.getContext('webgl', params) ||
            this.canvas.getContext('experimental-webgl', params);
        if (!gl) { console.warn('ImageDeformPass: no WebGL'); return; }
        this.gl = gl;

        // Detect GPU process crash / context loss and reload the page
        this.canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            console.error('[ImageDeformPass] WebGL context lost — reloading page');
            this._ready = false;
            setTimeout(() => location.reload(), 1500);
        });

        // Compile shaders
        const vs = this._compile(gl.VERTEX_SHADER, `
            precision highp float;
            attribute vec2 aPosition;
            varying vec2 vUv;
            void main() {
                vUv = aPosition * 0.5 + 0.5;
                gl_Position = vec4(aPosition.x, -aPosition.y, 0.0, 1.0);
            }
        `);
        const fs = this._compile(gl.FRAGMENT_SHADER, `
            precision highp float;
            uniform sampler2D uImage;
            uniform int uAnchorCount;
            uniform vec3 uAnchors[64];
            uniform float uStrength;
            varying vec2 vUv;
            void main() {
                vec2 uv = vUv;
                for (int i = 0; i < 64; i++) {
                    if (i >= uAnchorCount) break;
                    vec2 anchor = uAnchors[i].xy;
                    float radius = uAnchors[i].z;
                    vec2 diff = uv - anchor;
                    float dist = length(diff);
                    float falloff = exp(-dist * dist / (radius * radius * 0.5));
                    uv -= diff * falloff * uStrength;
                }
                gl_FragColor = texture2D(uImage, uv);
            }
        `);
        if (!vs || !fs) return;

        const prog = gl.createProgram();
        gl.attachShader(prog, vs); gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error('ImageDeformPass link:', gl.getProgramInfoLog(prog)); return;
        }
        this._program = {
            program: prog,
            aPosition: gl.getAttribLocation(prog, 'aPosition'),
            uImage: gl.getUniformLocation(prog, 'uImage'),
            uAnchorCount: gl.getUniformLocation(prog, 'uAnchorCount'),
            uAnchors: [],
            uStrength: gl.getUniformLocation(prog, 'uStrength')
        };
        for (let i = 0; i < 64; i++) {
            this._program.uAnchors[i] = gl.getUniformLocation(prog, `uAnchors[${i}]`);
        }

        // Fullscreen quad
        this._vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
        this._ibo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

        // 1x1 FBO for sampleColor
        this._sampleTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this._sampleTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this._sampleFBO = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._sampleFBO);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._sampleTex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        this._ready = true;
    },

    _compile(type, src) {
        const gl = this.gl;
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error('ImageDeformPass shader:', gl.getShaderInfoLog(s)); return null;
        }
        return s;
    },

    /** Upload source image as texture (call once on image load, not per frame) */
    uploadImage(img) {
        if (!this._ready || !img) return;
        const gl = this.gl;
        if (!this._imageTex) this._imageTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this._imageTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        this._imageW = img.width || img.videoWidth || 0;
        this._imageH = img.height || img.videoHeight || 0;
    },

    /** Render deformed image. anchors = SignalAnchor[], imageRect = {x,y,w,h}, cW/cH = canvas size */
    render(anchors, imageRect, cW, cH) {
        if (!this._ready || !this._imageTex || !anchors || anchors.length === 0) return null;
        const gl = this.gl;

        // Size output canvas to match display rect
        const dw = Math.round(imageRect.w) || cW;
        const dh = Math.round(imageRect.h) || cH;
        if (this.canvas.width !== dw || this.canvas.height !== dh) {
            this.canvas.width = dw;
            this.canvas.height = dh;
        }

        gl.viewport(0, 0, dw, dh);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this._program.program);

        // Bind image texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._imageTex);
        gl.uniform1i(this._program.uImage, 0);

        // Anchor data: convert canvas px to normalized UV within the image rect
        const count = Math.min(anchors.length, 64);
        gl.uniform1i(this._program.uAnchorCount, count);
        for (let i = 0; i < 64; i++) {
            if (i < count) {
                const a = anchors[i];
                const nx = (a.x - imageRect.x) / imageRect.w;
                const ny = 1.0 - (a.y - imageRect.y) / imageRect.h; // flip Y
                const nr = (a.params.radiusLimit / imageRect.w) * 1.5; // radius in UV space
                gl.uniform3f(this._program.uAnchors[i], nx, ny, Math.max(0.01, nr));
            } else {
                gl.uniform3f(this._program.uAnchors[i], 0, 0, 0);
            }
        }

        // Subtle strength — gravitational indentation feel
        gl.uniform1f(this._program.uStrength, 0.012);

        // Draw quad
        gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._ibo);
        gl.enableVertexAttribArray(this._program.aPosition);
        gl.vertexAttribPointer(this._program.aPosition, 2, gl.FLOAT, false, 0, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

        return this.canvas;
    },

    /** Sample image color at canvas position. Returns null in exhibition mode (no camera). */
    sampleColor(_canvasX, _canvasY, _imageRect) {
        return null;
    },

    /** Internal: sample pixel via a tiny offscreen 2D canvas (called once per anchor, not per frame) */
    _sampleViaCanvas(canvasX, canvasY, imageRect) {
        const img = State.image;
        if (!img) return null;

        const u = (canvasX - imageRect.x) / imageRect.w;
        const v = (canvasY - imageRect.y) / imageRect.h;
        if (u < 0 || u > 1 || v < 0 || v > 1) return null;

        const sw = img.width || img.videoWidth || 0;
        const sh = img.height || img.videoHeight || 0;
        if (sw === 0 || sh === 0) return null;

        const px = Math.floor(u * sw);
        const py = Math.floor(v * sh);

        // Tiny offscreen canvas — draw 1 pixel region
        if (!this._sampleCanvas) {
            this._sampleCanvas = document.createElement('canvas');
            this._sampleCanvas.width = 1;
            this._sampleCanvas.height = 1;
            this._sampleCtx = this._sampleCanvas.getContext('2d', { willReadFrequently: true });
        }
        this._sampleCtx.clearRect(0, 0, 1, 1);
        this._sampleCtx.drawImage(img, px, py, 1, 1, 0, 0, 1, 1);
        const data = this._sampleCtx.getImageData(0, 0, 1, 1).data;

        // Clamp to avoid pure white/black
        const r = Math.max(30, Math.min(225, data[0]));
        const g = Math.max(30, Math.min(225, data[1]));
        const b = Math.max(30, Math.min(225, data[2]));

        return { r, g, b };
    }
};
