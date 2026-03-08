/**
 * GHOST SIGNAL INSTRUMENT — vAtom Fluid
 * Layer classes: decoupled rendering abstractions.
 *
 * Open/Closed: extend by adding new Layer subclasses without modifying existing ones.
 * Liskov: SignalLayer and DataLayer are substitutable for Layer.
 */

class Layer {
    constructor(name, type) {
        this.id = Math.random().toString(36).substr(2, 9);
        this.name = name;
        this.type = type;
        this.enabled = true;
        this.opacity = 1.0;
        this.dirty = true;
    }
    render(ctx, canvas) { }
}

class SignalLayer extends Layer {
    constructor() {
        super("Signal Layer", "signal");
        this.signals = [];
    }
    render(ctx, canvas) { }
}

class DataLayer extends Layer {
    constructor() {
        super("Data Layer", "data");
        this.params = {
            fontSize: 10,
            color: '#FEFDFB',
            opacity: 0.6
        };
    }
    render(ctx, canvas, signals) {
        if (!signals) return;
        ctx.save();
        ctx.font = `${this.params.fontSize}px 'Space Grotesk'`;
        const cW = canvas.width, cH = canvas.height;
        signals.forEach(s => {
            if (!s.params.dataVisible) return;
            const opacity = this.params.opacity;
            const line = `ID: ${s.getDisplayId()}`;

            // Measure text for box clamping
            const metrics = ctx.measureText(line);
            const boxW = metrics.width + 8;
            const boxH = this.params.fontSize + 6;

            // Tracking toggle: relative to blob or absolute position
            let lx, ly;
            if (s.params.tracking === 1) {
                lx = s.x + (s.params.dataOffsetX || 20);
                ly = s.y + (s.params.dataOffsetY || 20);
            } else {
                lx = s.params.dataAbsX || 100;
                ly = s.params.dataAbsY || 100;
            }

            // Clamp to canvas bounds
            lx = Math.max(6, Math.min(cW - boxW - 6, lx));
            ly = Math.max(boxH + 2, Math.min(cH - 6, ly));

            ctx.shadowBlur = 4;
            ctx.shadowColor = this.params.color;
            ctx.globalAlpha = opacity;
            ctx.fillStyle = this.params.color;
            ctx.fillText(line, lx, ly);
            ctx.shadowBlur = 0;
        });
        ctx.restore();
    }
}
