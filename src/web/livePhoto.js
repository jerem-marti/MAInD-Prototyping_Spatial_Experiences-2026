/**
 * GHOST SIGNAL INSTRUMENT — Shadow Creatures
 * LivePhotoCapture: records a rolling video buffer from the main canvas
 * to produce iPhone-like Live Photos (short video clip + still).
 *
 * Uses MediaRecorder + canvas.captureStream() to maintain a ring buffer
 * of recent video chunks. On snapshot trigger, it collects additional
 * post-capture frames and assembles the full ~3 second WebM clip.
 */

const LivePhotoCapture = {
    _stream: null,
    _recorder: null,
    _headerChunk: null,     // WebM initialization segment (first chunk from MediaRecorder)
    _ring: [],              // circular buffer of recent media data chunks
    _ringTimestamps: [],    // timestamp for each chunk in ring
    _capturing: false,
    _afterChunks: [],       // chunks collected after trigger
    _captureStartTime: 0,
    _captureResolve: null,
    _safetyTimer: null,
    _ready: false,

    PRE_MS: 2000,           // keep 2 seconds of pre-capture buffer
    POST_MS: 1500,          // record 1.5 seconds after trigger
    SLICE_MS: 200,          // chunk interval (200ms = 5 chunks/sec)
    FPS: 30,                // capture stream frame rate

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

        try {
            this._stream = canvas.captureStream(this.FPS);
            this._recorder = new MediaRecorder(this._stream, {
                mimeType,
                videoBitsPerSecond: 2500000  // 2.5 Mbps
            });
        } catch (e) {
            console.warn('[LivePhoto] Failed to create MediaRecorder:', e);
            return;
        }

        this._recorder.ondataavailable = (e) => {
            if (!e.data || !e.data.size) return;
            const now = Date.now();

            // First chunk contains the WebM header / initialization segment
            if (!this._headerChunk) {
                this._headerChunk = e.data;
                return;
            }

            // Post-capture mode: collect after-chunks until POST_MS elapsed
            if (this._capturing) {
                this._afterChunks.push(e.data);
                if (now - this._captureStartTime >= this.POST_MS) {
                    this._finalize();
                }
                return;
            }

            // Normal mode: push to ring buffer
            this._ring.push(e.data);
            this._ringTimestamps.push(now);

            // Trim chunks older than PRE_MS
            const cutoff = now - this.PRE_MS;
            while (this._ringTimestamps.length > 0 && this._ringTimestamps[0] < cutoff) {
                this._ring.shift();
                this._ringTimestamps.shift();
            }
        };

        this._recorder.start(this.SLICE_MS);
        this._ready = true;
        console.log(`[LivePhoto] Recording started (${mimeType}, ${this.FPS}fps, ${this.SLICE_MS}ms slices)`);
    },

    /**
     * Trigger a Live Photo capture.
     * Returns a Promise that resolves with a WebM Blob (~3 seconds),
     * or null if Live Photo is not available.
     */
    trigger() {
        if (!this._ready || !this._recorder || this._capturing) {
            return Promise.resolve(null);
        }

        return new Promise((resolve) => {
            this._capturing = true;
            this._captureStartTime = Date.now();
            this._afterChunks = [];
            this._captureResolve = resolve;

            // Safety timeout in case ondataavailable stops firing
            this._safetyTimer = setTimeout(() => {
                if (this._capturing) {
                    this._finalize();
                }
            }, this.POST_MS + 500);
        });
    },

    _finalize() {
        this._capturing = false;

        if (this._safetyTimer) {
            clearTimeout(this._safetyTimer);
            this._safetyTimer = null;
        }

        if (!this._headerChunk) {
            if (this._captureResolve) {
                this._captureResolve(null);
                this._captureResolve = null;
            }
            return;
        }

        // Assemble: header + pre-capture ring buffer + post-capture chunks
        const allChunks = [this._headerChunk, ...this._ring, ...this._afterChunks];
        const blob = new Blob(allChunks, { type: this._recorder.mimeType });

        if (this._captureResolve) {
            this._captureResolve(blob);
            this._captureResolve = null;
        }

        // Clear ring buffer so the next Live Photo starts fresh
        this._ring = [];
        this._ringTimestamps = [];
        this._afterChunks = [];
    }
};
