/**
 * GHOST SIGNAL INSTRUMENT — Shadow Creatures
 * Camera module: loads MJPEG stream from the Pi backend.
 *
 * Uses the backend's /mjpeg endpoint as a continuous image source.
 * The <img> element receives MJPEG frames automatically.
 */

const Camera = {
    img: null,
    active: false,
    /** Offscreen canvas holding the 90 CCW rotated frame */
    _rotatedCanvas: null,
    _rotatedCtx: null,

    /**
     * Start loading the MJPEG feed from /mjpeg.
     * Sets State.image once the first frame arrives.
     */
    start() {
        this.img = document.getElementById('feed');
        if (!this.img) {
            this.img = document.createElement('img');
            this.img.id = 'feed';
            this.img.style.display = 'none';
            document.body.appendChild(this.img);
        }

        this.img.crossOrigin = 'anonymous';

        // Create offscreen canvas for 90 CCW rotation
        if (!this._rotatedCanvas) {
            this._rotatedCanvas = document.createElement('canvas');
            this._rotatedCtx = this._rotatedCanvas.getContext('2d');
        }

        this.img.onload = () => {
            if (!this.active) {
                this.active = true;
                State.cameraActive = true;
                // Rotate frame 90 CCW and set as State.image
                this._updateRotated();
                State.image = this._rotatedCanvas;
                // Upload rotated image for color sampling
                if (typeof ImageDeformPass !== 'undefined' && ImageDeformPass.uploadImage) {
                    ImageDeformPass.uploadImage(this._rotatedCanvas);
                }
            }
        };

        this.img.onerror = () => {
            // MJPEG stream not available — will retry on reconnect
            console.warn('[Camera] MJPEG stream not available');
        };

        // Start the MJPEG stream
        this.img.src = '/mjpeg';
    },

    /** Draw current MJPEG frame rotated 90 CCW into the offscreen canvas */
    _updateRotated() {
        if (!this.img) return;
        const sw = this.img.naturalWidth || 1280;
        const sh = this.img.naturalHeight || 720;
        // After 90 CCW rotation, dimensions are swapped
        if (this._rotatedCanvas.width !== sh || this._rotatedCanvas.height !== sw) {
            this._rotatedCanvas.width = sh;
            this._rotatedCanvas.height = sw;
        }
        const ctx = this._rotatedCtx;
        ctx.save();
        ctx.clearRect(0, 0, sh, sw);
        // 90 CCW: translate to (0, sw) then rotate -90deg
        ctx.translate(0, sw);
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(this.img, 0, 0, sw, sh);
        ctx.restore();
    },

    stop() {
        if (this.img) {
            this.img.src = '';
        }
        this.active = false;
        State.cameraActive = false;
    },

    toggle() {
        if (this.active) this.stop();
        else this.start();
    },

    /** Width after 90 CCW rotation (original height) */
    getWidth() {
        return this.img ? this.img.naturalHeight || 720 : 720;
    },

    /** Height after 90 CCW rotation (original width) */
    getHeight() {
        return this.img ? this.img.naturalWidth || 1280 : 1280;
    }
};
