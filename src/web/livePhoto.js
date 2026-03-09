/**
 * GHOST SIGNAL INSTRUMENT — Shadow Creatures
 * LivePhotoCapture: records a rolling video from the main canvas
 * to produce iPhone-like Live Photos (short video clip + still).
 *
 * Strategy: record in continuous ~1.5 second segments using
 * MediaRecorder start()/stop() cycles. Each segment produces a
 * complete, valid WebM file (no cluster splicing needed).
 *
 * Uses captureStream(0) — manual frame mode — so frames are only
 * captured when requestFrame() is called by the render loop.
 * This avoids interference with WebGL→2D canvas drawImage compositing.
 *
 * On snapshot trigger, the current segment keeps recording for an
 * extra POST_MS (1.5s), then stops. The resulting blob is the
 * Live Photo video covering up to ~3 seconds of footage.
 */

const LivePhotoCapture = {
    _stream: null,
    _track: null,
    _recorder: null,
    _chunks: [],            // data chunks for the current segment
    _ready: false,
    _capturing: false,
    _cycleTimer: null,
    _mimeType: '',

    CYCLE_MS: 1500,         // restart recording every 1.5 seconds
    POST_MS: 1500,          // record 1.5 seconds after trigger

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
            // Use captureStream(0) — manual frame mode.
            // Frames are only captured when requestFrame() is called,
            // preventing captureStream from reading the canvas mid-compositing.
            this._stream = canvas.captureStream(0);
        } catch (e) {
            console.warn('[LivePhoto] Failed to capture stream:', e);
            return;
        }

        // Get the video track for manual frame requests
        const tracks = this._stream.getVideoTracks();
        this._track = tracks.length > 0 ? tracks[0] : null;

        this._mimeType = mimeType;
        this._beginSegment();
        this._ready = true;
        console.log(`[LivePhoto] Started (${mimeType}, manual frame mode, ${this.CYCLE_MS}ms segments)`);
    },

    /**
     * Request a new frame be captured into the stream.
     * Call this at the end of each render loop iteration,
     * after all compositing (including WebGL drawImage) is complete.
     */
    requestFrame() {
        if (!this._track || !this._ready) return;
        if (typeof this._track.requestFrame === 'function') {
            this._track.requestFrame();
        }
    },

    /**
     * Start a new recording segment. Each segment is a complete
     * WebM file from start() to stop() — no splicing needed.
     */
    _beginSegment() {
        this._chunks = [];

        try {
            this._recorder = new MediaRecorder(this._stream, {
                mimeType: this._mimeType,
                videoBitsPerSecond: 2500000  // 2.5 Mbps
            });
        } catch (e) {
            console.warn('[LivePhoto] Failed to create MediaRecorder:', e);
            return;
        }

        this._recorder.ondataavailable = (e) => {
            if (e.data && e.data.size) this._chunks.push(e.data);
        };

        this._recorder.start();
        this._scheduleCycle();
    },

    /**
     * Schedule the next segment restart.
     */
    _scheduleCycle() {
        this._cycleTimer = setTimeout(() => this._restartSegment(), this.CYCLE_MS);
    },

    /**
     * Stop current segment and immediately begin a new one.
     * Keeps memory bounded by discarding old footage.
     */
    _restartSegment() {
        if (this._capturing) return;
        if (!this._recorder || this._recorder.state !== 'recording') return;

        const oldRecorder = this._recorder;
        oldRecorder.onstop = () => {
            // Old segment discarded — we only care about the current one at trigger time
            this._beginSegment();
        };
        oldRecorder.stop();
    },

    /**
     * Trigger a Live Photo capture.
     *
     * Keeps the current recording running for POST_MS more seconds,
     * then stops and returns the complete WebM blob.
     *
     * The resulting video covers: (time since last segment restart) + POST_MS.
     * Typical duration: 2–3 seconds depending on timing.
     *
     * @returns {Promise<Blob|null>} WebM blob, or null if unavailable.
     */
    trigger() {
        if (!this._ready || this._capturing) {
            return Promise.resolve(null);
        }
        if (!this._recorder || this._recorder.state !== 'recording') {
            return Promise.resolve(null);
        }

        this._capturing = true;
        clearTimeout(this._cycleTimer);

        return new Promise((resolve) => {
            // Keep recording for POST_MS, then stop to finalize the WebM
            setTimeout(() => {
                if (!this._recorder || this._recorder.state !== 'recording') {
                    this._capturing = false;
                    this._beginSegment();
                    resolve(null);
                    return;
                }

                this._recorder.onstop = () => {
                    const blob = new Blob(this._chunks, { type: this._mimeType });
                    this._capturing = false;
                    // Restart segment cycle for next capture
                    this._beginSegment();
                    resolve(blob);
                };
                this._recorder.stop();
            }, this.POST_MS);
        });
    }
};
