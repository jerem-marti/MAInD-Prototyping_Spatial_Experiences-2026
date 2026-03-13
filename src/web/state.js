/**
 * GHOST SIGNAL INSTRUMENT — Shadow Creatures
 * Application state: single source of truth.
 */

const State = {
    image: null,
    imageRect: { x: 0, y: 0, w: 0, h: 0 },
    layers: [],
    signals: [],
    selectedSignalId: null,
    selectedLayerId: null,
    isPlacingSignal: false,
    isDeforming: false,
    resolution: { w: 0, h: 0 },
    cameraActive: false,
    useManualParams: false,  // When true, telemetry mapping is skipped
    mode: 2,                 // 0=AP fog, 1=BT sparks, 2=both

    // Gallery
    galleryOpen: false,      // true when gallery iframe is active
    paused: false,           // true = render loop and telemetry ingestion paused

    // View orientation — fixed at 0 (no IMU in projector mode)
    viewYaw: 0,
    viewPitch: 0,

    // Type-based size multipliers for visual differentiation
    // (1.0 = default size from TelemetryMapper; >1 = larger, <1 = smaller)
    typeSizes: {
        'Wi-Fi AP':     1.6,   // large fog blobs
        'Wi-Fi Client': 1.0,   // standard
        'Bluetooth':    0.5,   // small compact sparks
    },

    // Minimum RSSI threshold — signals weaker than this are filtered out
    minRssiThreshold: -85,

    // Per-device data from current state (populated by Telemetry.ingestState)
    devices: [],             // Array of { mac, azimuth, elevation, rssi, name, manuf, ... }

    // Map of mac -> SignalAnchor for dynamically managed signals
    deviceSignalMap: new Map()
};
