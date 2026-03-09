/**
 * GHOST SIGNAL INSTRUMENT — Shadow Creatures
 * LivePhotoCapture: records a short post-snapshot video clip
 * (like iPhone Live Photos) using an offscreen mirror canvas.
 *
 * LAZY STRATEGY: captureStream and MediaRecorder are NOT started
 * during init.  They activate only when trigger() is called and
 * are torn down once the clip is captured.  This avoids a known
 * Chromium bug on low-end GPUs (RPi VideoCore) where an active
 * captureStream — even on a separate mirror canvas — causes
 * ctx.drawImage(webglCanvas) to produce black frames during
 * normal rendering.
 *
 * On trigger the module:
 *   1. Creates a captureStream on the mirror canvas
 *   2. Starts MediaRecorder
 *   3. Copies frames from the main canvas for RECORD_MS
 *   4. Stops everything and returns the WebM blob
 */

const LivePhotoCapture = {
    _mirror: null,
    _mirrorCtx: null,
    _stream: null,
    _track: null,
    _recorder: null,
    _chunks: [],
    _ready: false,
    _capturing: false,
    _mimeType: '',
    _sourceCanvas: null,

    RECORD_MS: 3000,        // total recording duration after trigger

    init(canvas) {
        if (!canvas || typeof canvas.captureStream !== 'function') {
            console.warn('[LivePhoto] captureStream not supported — Live Photo disabled');
            return;
        }

        if (typeof MediaRecorder === 'undefined') {
            console.warn('[LivePhoto] MediaRecorder not available — Live Photo disabled');
            return;
        }

        // Find a supported MIME type
        const mimeTypes = [
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
        ];
        let mimeType = '';
        for (const mt of mimeTypes) {
            if (MediaRecorder.isTypeSupported(mt)) {
                mimeType = mt;
                break;
            }
        }
        if (!mimeType) {
            console.warn('[LivePhoto] No supported WebM MIME type — Live Photo disabled');
            return;
        }

        this._sourceCanvas = canvas;
        this._mimeType = mimeType;

        // Pre-create the mirror canvas (cheap, no stream yet)
        this._mirror = document.createElement('canvas');
        this._mirror.width = canvas.width || 1280;
        this._mirror.height = canvas.height || 720;
        this._mirrorCtx = this._mirror.getContext('2d');

        this._ready = true;
        console.log(`[LivePhoto] Ready (${mimeType}, lazy capture)`);
    },

    /**
     * Copy the current main canvas frame to the mirror and push it
     * into the capture stream.  Only active while recording.
     */
    requestFrame() {
        if (!this._capturing || !this._mirrorCtx || !this._sourceCanvas) return;

        // Resize mirror if main canvas changed
        const sw = this._sourceCanvas.width;
        const sh = this._sourceCanvas.height;
        if (this._mirror.width !== sw || this._mirror.height !== sh) {
            this._mirror.width = sw;
            this._mirror.height = sh;
        }

        // Copy completed frame to mirror
        this._mirrorCtx.drawImage(this._sourceCanvas, 0, 0);

        // Push frame into the capture stream
        if (this._track && typeof this._track.requestFrame === 'function') {
            this._track.requestFrame();
        }
    },

    /**
     * Start captureStream + MediaRecorder on the mirror canvas.
     */
    _startRecording() {
        try {
            this._stream = this._mirror.captureStream(0);
        } catch (e) {
            console.warn('[LivePhoto] Failed to capture stream:', e);
            return false;
        }

        const tracks = this._stream.getVideoTracks();
        this._track = tracks.length > 0 ? tracks[0] : null;

        this._chunks = [];
        try {
            this._recorder = new MediaRecorder(this._stream, {
                mimeType: this._mimeType,
                videoBitsPerSecond: 2500000
            });
        } catch (e) {
            console.warn('[LivePhoto] Failed to create MediaRecorder:', e);
            this._teardownStream();
            return false;
        }

        this._recorder.ondataavailable = (e) => {
            if (e.data && e.data.size) this._chunks.push(e.data);
        };

        this._recorder.start();
        return true;
    },

    /**
     * Stop stream and release resources.
     */
    _teardownStream() {
        if (this._stream) {
            this._stream.getTracks().forEach(t => t.stop());
            this._stream = null;
        }
        this._track = null;
        this._recorder = null;
    },

    /**
     * Trigger a Live Photo capture.
     *
     * Starts captureStream + MediaRecorder, records for RECORD_MS,
     * then stops everything and returns the WebM blob.
     *
     * @returns {Promise<Blob|null>} WebM blob, or null if unavailable.
     */
    trigger() {
        if (!this._ready || this._capturing) {
            return Promise.resolve(null);
        }

        this._capturing = true;

        if (!this._startRecording()) {
            this._capturing = false;
            return Promise.resolve(null);
        }

        return new Promise((resolve) => {
            setTimeout(() => {
                if (!this._recorder || this._recorder.state !== 'recording') {
                    this._capturing = false;
                    this._teardownStream();
                    resolve(null);
                    return;
                }

                this._recorder.onstop = () => {
                    const blob = new Blob(this._chunks, { type: this._mimeType });
                    this._teardownStream();
                    this._capturing = false;
                    resolve(blob);
                };
                this._recorder.stop();
            }, this.RECORD_MS);
        });
    }
};
