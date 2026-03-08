/**
 * GHOST SIGNAL INSTRUMENT — vAtom Fluid
 * Non-destructive image deformation engine with brush warping.
 *
 * Single Responsibility: CPU-based pixel-pushing deformation with brush tools.
 */

const DeformEngine = {
    name: 'DEFORM SETTINGS',
    params: {
        brushSize: 120,
        strength: 1.2,
        softness: 0.5,
        stabilize: 0.15
    },
    // Camera deformation: snapshot buffer for live camera warp
    cameraSnapshot: null,
    cameraSnapshotCtx: null,
    buffer: null,
    ctx: null,
    hasEdits: false,
    isDragging: false,
    lastPt: null,

    initBuffer(w, h) {
        if (!this.buffer || this.buffer.width !== w || this.buffer.height !== h) {
            this.buffer = document.createElement('canvas');
            this.buffer.width = w;
            this.buffer.height = h;
            this.ctx = this.buffer.getContext('2d', { willReadFrequently: true });
        }
        this.reset();
    },

    reset() {
        if (!this.ctx) return;
        if (Camera.active && Camera.img) {
            // For camera mode, snapshot current frame
            this.ctx.clearRect(0, 0, this.buffer.width, this.buffer.height);
            this.ctx.drawImage(Camera.img, 0, 0, this.buffer.width, this.buffer.height);
        } else if (State.image) {
            this.ctx.clearRect(0, 0, this.buffer.width, this.buffer.height);
            this.ctx.drawImage(State.image, 0, 0, this.buffer.width, this.buffer.height);
        }
        this.hasEdits = false;
    },

    /** Snapshot current camera frame for deformation */
    snapshotCamera() {
        if (!Camera.active || !Camera.img) return;
        const vw = Camera.getWidth();
        const vh = Camera.getHeight();
        if (vw <= 0 || vh <= 0) return;
        if (!this.buffer || this.buffer.width !== vw || this.buffer.height !== vh) {
            this.initBuffer(vw, vh);
        }
        this.ctx.clearRect(0, 0, vw, vh);
        this.ctx.drawImage(Camera.img, 0, 0, vw, vh);
    },

    applyDeform(x, y, dx, dy) {
        if (!this.ctx || !this.buffer) return;
        const ir = State.imageRect;
        if (!ir || ir.w === 0) return;

        const bx = ((x - ir.x) / ir.w) * this.buffer.width;
        const by = ((y - ir.y) / ir.h) * this.buffer.height;
        const bdx = (dx / ir.w) * this.buffer.width;
        const bdy = (dy / ir.h) * this.buffer.height;
        const r = this.params.brushSize * (this.buffer.width / UI.canvas.width);
        const str = this.params.strength * 2.0;

        const sx = Math.max(0, Math.floor(bx - r));
        const sy = Math.max(0, Math.floor(by - r));
        const ew = Math.min(this.buffer.width - sx, Math.ceil(r * 2));
        const eh = Math.min(this.buffer.height - sy, Math.ceil(r * 2));
        if (ew <= 0 || eh <= 0) return;

        const imgData = this.ctx.getImageData(sx, sy, ew, eh);
        const data = imgData.data;
        const srcData = new Uint8ClampedArray(data);
        let edited = false;

        for (let py = 0; py < eh; py++) {
            for (let px = 0; px < ew; px++) {
                const cx = px + sx, cy = py + sy;
                const distX = cx - bx, distY = cy - by;
                const distSq = distX * distX + distY * distY;
                const rSq = r * r;

                if (distSq < rSq) {
                    const dist = Math.sqrt(distSq);
                    const falloff = Math.pow(1 - (dist / r), 1.0 + (1.0 - this.params.softness));
                    const pullX = cx - bdx * str * falloff;
                    const pullY = cy - bdy * str * falloff;
                    const lx = pullX - sx, ly = pullY - sy;

                    if (lx >= 0 && lx < ew - 1 && ly >= 0 && ly < eh - 1) {
                        const x0 = Math.floor(lx), y0 = Math.floor(ly);
                        const x1 = x0 + 1, y1 = y0 + 1;
                        const fx = lx - x0, fy = ly - y0;
                        const i00 = (y0 * ew + x0) * 4;
                        const i10 = (y0 * ew + x1) * 4;
                        const i01 = (y1 * ew + x0) * 4;
                        const i11 = (y1 * ew + x1) * 4;

                        for (let c = 0; c < 4; c++) {
                            const val = srcData[i00 + c] * (1 - fx) * (1 - fy)
                                + srcData[i10 + c] * fx * (1 - fy)
                                + srcData[i01 + c] * (1 - fx) * fy
                                + srcData[i11 + c] * fx * fy;
                            data[(py * ew + px) * 4 + c] = val;
                        }
                        edited = true;
                    }
                }
            }
        }

        if (edited) {
            this.ctx.putImageData(imgData, sx, sy);
            this.hasEdits = true;
        }
    }
};
