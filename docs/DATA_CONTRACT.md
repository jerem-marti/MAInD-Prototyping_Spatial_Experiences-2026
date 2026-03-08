# Data Contract

## ghost_state.json

This file is the single source of truth exchanged between the Reducer and the Backend/Frontend. It is written atomically (~1 Hz) by `reducer.py` and watched by `server.py`.

### Actual schema (from `reducer.py`)

```json
{
  "ts": 1709568600.123,
  "window_s": 60,
  "views": {
    "wifi": "phydot11_accesspoints",
    "bt": "phybluetooth"
  },
  "wifi": {
    "aps": [
      {
        "id": "a3f1...hex64",
        "name": "MyNetwork",
        "last_seen": 1709568590,
        "channel": 6,
        "signal_dbm": -45,
        "strength": 0.75
      }
    ]
  },
  "bt": {
    "devices": [
      {
        "id": "b4e2...hex64",
        "name": "(bt)",
        "last_seen": 1709568585,
        "signal_dbm": -70,
        "strength": 0.33
      }
    ]
  },
  "telemetry": {
    "wifi_count": 12,
    "bt_count": 5,
    "total_count": 17,
    "wifi_mean_rssi": -52.3,
    "wifi_rssi_variance": 8.7,
    "ble_ratio": 0.2941
  }
}
```

### Top-level fields

| Field | Type | Description |
|---|---|---|
| `ts` | float | Unix epoch (seconds) when this state was generated |
| `window_s` | int | Kismet time window in seconds (default 60) |
| `views` | object | Which Kismet view name was used for each category (`null` if unavailable) |
| `wifi` | object | Contains `aps` array |
| `bt` | object | Contains `devices` array |
| `telemetry` | object | Aggregate telemetry stats for the visual effect engine |

### Wi-Fi AP object (`wifi.aps[]`)

| Field | Type | Description |
|---|---|---|
| `id` | string | SHA-256 hash of salted MAC address (64 hex chars) |
| `name` | string | SSID or common name (max 64 chars, `"(unknown)"` if absent) |
| `last_seen` | float | Unix epoch of last detection by Kismet |
| `channel` | int/null | Wi-Fi channel |
| `signal_dbm` | int/null | Raw signal strength in dBm |
| `strength` | float 0-1 | Normalized: `clamp((dBm + 90) / 60, 0, 1)` |

### Bluetooth device object (`bt.devices[]`)

| Field | Type | Description |
|---|---|---|
| `id` | string | SHA-256 hash of salted MAC address (64 hex chars) |
| `name` | string | Device name (max 64 chars, `"(bt)"` if absent) |
| `last_seen` | float | Unix epoch of last detection by Kismet |
| `signal_dbm` | int/null | Raw signal strength in dBm |
| `strength` | float 0-1 | Normalized: `clamp((dBm + 90) / 60, 0, 1)` |

### Telemetry object (`telemetry`)

| Field | Type | Description |
|---|---|---|
| `wifi_count` | int | Number of Wi-Fi APs detected in this window |
| `bt_count` | int | Number of Bluetooth devices detected in this window |
| `total_count` | int | `wifi_count + bt_count` |
| `wifi_mean_rssi` | float | Mean RSSI in dBm across all Wi-Fi APs (default -80 if no APs) |
| `wifi_rssi_variance` | float | Standard deviation of Wi-Fi RSSI values in dB |
| `ble_ratio` | float 0-1 | Ratio of BT devices to total devices |

### Notes

- Arrays are sorted by `strength` descending (strongest first)
- The reducer tries multiple Kismet view names for compatibility: `phy80211_accesspoints` then `phydot11_accesspoints` for Wi-Fi; `phybluetooth`, `phybluetooth_le`, `linuxbluetooth` for BT
- Ghost IDs are stable across updates (same device = same hash, salted with a per-install random salt stored in `state/salt.txt`)
- The file is written atomically via `.tmp` + `os.replace()` to avoid partial reads
- The frontend reads `state.wifi.aps` and `state.bt.devices` (see `app.js` lines 68-69)

### How the frontend uses it

The backend (`server.py`) watches this file every 0.2 s and pushes it over WebSocket as:

```json
{ "type": "state", "state": { /* full ghost_state content */ } }
```

The frontend (`app.js` + `telemetry.js`) then:
- Ingests the state via `Telemetry.ingestState(msg.state)`
- Uses `telemetry.*` aggregate stats to drive visual parameters (smoke density, radius, speed, etc.) via `TelemetryMapper`
- Hashes each `wifi.aps[].id` to azimuth/elevation for 360-degree globe positioning
- Top N devices (default 15, configurable) sorted by RSSI are projected through a view frustum as `SignalAnchor` instances
- Each anchor emits colored fluid splats into a shared WebGL Navier-Stokes solver (`AtomFluidEngine`)
- The fluid sim is composited over the MJPEG camera feed at `/mjpeg`
