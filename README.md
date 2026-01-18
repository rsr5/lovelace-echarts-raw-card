# ECharts Raw Card (Lovelace)

A **power-user Home Assistant Lovelace card** that renders **raw Apache ECharts options**, with **native Home Assistant entity binding**, **history queries**, **transforms**, and **automatic dark-mode support**.

Unlike most chart cards, this one does **not** invent a DSL for charts — you write **real ECharts `option` objects**, and this card resolves Home Assistant data into them.

---

## Features

- ✅ Full **Apache ECharts** `option` support (no abstraction layer)
- ✅ Live entity binding via `$entity` tokens
- ✅ Bulk entity extraction via `$data`
- ✅ Historical data via `$history`
- ✅ Built-in transforms (log, scale, clamp, round, etc.)
- ✅ Efficient caching + throttling for history queries
- ✅ Automatic dark/light mode switching (uses ECharts `dark` theme)
- ✅ Canvas or SVG renderer
- ✅ Zero external dependencies beyond ECharts

---

## Installation (HACS)

1. HACS → **Frontend** → **Custom repositories**
2. Add this repository  
   - Category: **Lovelace**
3. Install
4. Add the resource:
   - **Settings → Dashboards → Resources**
   - URL:  
     ```
     /hacsfiles/lovelace-echarts-raw-card/echarts-raw-card.js
     ```
   - Type: **JavaScript Module**

> ℹ️ The `/hacsfiles/...` path depends on the repository name.

---

## Examples

This repo includes a demo dashboard you can paste into Home Assistant:

- `examples/dashboard-demo.yaml`

### Using the dashboard example

1. In Home Assistant, go to **Settings → Dashboards → Add Dashboard**.
2. Choose **New dashboard from YAML**.
3. Paste the contents of `examples/dashboard-demo.yaml`.

### Pointing HA at your local dev build

Home Assistant **Resources** must reference a JavaScript module file (not the dev server root).

- Dev server URL (fast iteration):
  - `http://YOUR_MAC_LAN_IP:5173/src/index.ts`
- Built file (copy into `/config/www/`):
  - `/local/echarts-raw-card.js`

---

## Basic Usage

```yaml
type: custom:echarts-raw-card
title: Weekly Example
height: 320px
option:
  tooltip: {}
  xAxis:
    type: category
    data: [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
  yAxis:
    type: value
  series:
    - type: line
      data: [150, 230, 224, 218, 135, 147, 260]
```

---

## Debugging

Add `debug` at the **top level of the card config** (a sibling of `option`, not inside it).

### Quick enable

```yaml
type: custom:echarts-raw-card
debug: true
option:
  ...
```

### Fine-grained debug

```yaml
type: custom:echarts-raw-card
debug:
  show_resolved_option: true
  log_resolved_option: true
  max_chars: 20000
option:
  ...
```

### Where the output goes

- **In-card panel**: when `show_resolved_option` is enabled, the card shows an expandable
  "Debug: resolved ECharts option" section.
- **Browser console**: when `log_resolved_option` is enabled, the card logs the resolved
  option with `console.debug`.

Notes:

- Some browsers hide `console.debug(...)` unless the console log level includes **Verbose**.
- The card only produces "resolved option" debug after it can render (the container must have
  a non-zero size). During Lovelace layout/view transitions the card can temporarily be 0×0, in
  which case option application (and debug) is deferred.

---

## Entity Tokens (`$entity`)

You can bind **any Home Assistant entity** directly into the chart.

```yaml
option:
  series:
    - type: gauge
      min: 0
      max: 100
      data:
        - value:
            $entity: sensor.living_room_humidity
            $coerce: number
            $round: 1
```

### Token fields

| Field | Purpose |
|------|---------|
| `$entity` | Entity ID |
| `$attr` | Attribute instead of state |
| `$coerce` | `auto` \| `number` \| `string` \| `bool` |
| `$default` | Fallback if unavailable |
| `$abs` | Absolute value |
| `$scale` | Multiply |
| `$offset` | Add |
| `$min` / `$max` | Clamp bounds |
| `$clamp` | `[min, max]` |
| `$round` | Decimal places |
| `$map` | `log`, `sqrt`, or `pow` |

---

## `$data`: Bulk Entity Extraction

Use `$data` when you want **multiple entities turned into chart data automatically**.

```yaml
option:
  series:
    - type: pie
      radius: 60%
      data:
        $data:
          entities:
            - sensor.power_kitchen
            - sensor.power_living_room
            - sensor.power_office
          mode: pairs
          name_from: friendly_name
          coerce: number
          exclude_zero: true
          sort: desc
```

### `$data` modes

| Mode | Output |
|------|--------|
| `pairs` | `{ name, value }[]` |
| `names` | `string[]` |
| `values` | `unknown[]` (use `coerce: number` to ensure numeric output) |

### `$data` notes

- Unavailable/unknown entities are **excluded by default** (`exclude_unavailable: true`).
- `include_unavailable` exists for backwards compatibility, but `exclude_unavailable` is the preferred flag.

---

## `$history`: Historical Data

Fetch Home Assistant history **directly into ECharts**.

### Single-entity history

```yaml
option:
  xAxis:
    type: time
  yAxis:
    type: value
  series:
    - type: line
      showSymbol: false
      data:
        $history:
          entities:
            - sensor.outdoor_temperature
          hours: 24
          coerce: number
```

---

### Multi-entity history → series

```yaml
option:
  xAxis:
    type: time
  yAxis:
    type: value
  series:
    $history:
      entities:
        - sensor.power_kitchen
        - sensor.power_living_room
      hours: 12
      mode: series
      series_type: line
      show_symbol: false

> If `mode` is omitted, it defaults to:
> - `values` when one entity is requested
> - `series` when multiple entities are requested

> If `coerce` is omitted for `$history`, it behaves as `number`.
```

---

### Downsampling

```yaml
$history:
  entities:
    - sensor.energy_usage
  hours: 48
  sample:
    max_points: 300
    method: mean
```

---

### Per-series overrides

```yaml
$history:
  entities:
    - sensor.solar_power
    - sensor.grid_power
  series_overrides:
    Solar:
      areaStyle: {}
      smooth: true
```

Overrides may target **friendly name or entity ID**.

---

## Caching & Performance

- History requests are cached (`cache_seconds`, default 30s)
- Card throttles re-fetches automatically
- HA state churn does **not** spam history queries
- Multiple `$history` blocks use the **minimum cache window**

```yaml
$history:
  entities: [sensor.foo]
  cache_seconds: 120
```

---

## Dark Mode

The card automatically switches ECharts theme based on Home Assistant UI mode:

- Light → default
- Dark → `dark` theme

No config required.

---

## Renderer

```yaml
renderer: canvas   # default
# or
renderer: svg

---

## Debugging

You can enable debug output to help diagnose token resolution and the final ECharts option sent to the chart.

```yaml
debug: true
```

Or use the object form to control behavior:

```yaml
debug:
  show_resolved_option: true   # show the resolved option JSON in the card UI
  log_resolved_option: true    # print the resolved option JSON to the browser console
  max_chars: 50000             # safety limit for the resolved JSON text
```
```

---

## Error Handling

- Errors are rendered inline
- Chart is safely cleared
- Resize/update loops are prevented

---

## License

MIT  
Copyright © 2026 Robin Ridler
