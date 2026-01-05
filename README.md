# ECharts Raw Card (Lovelace)

A Home Assistant Lovelace custom card that renders **raw Apache ECharts** `option` configs.

## Install (HACS)

1. HACS → Frontend → **Custom repositories**
2. Add this repo URL, category **Lovelace**
3. Install
4. Add the resource:
   - Settings → Dashboards → Resources → Add
   - URL: `/hacsfiles/lovelace-echarts-raw-card/echarts-raw-card.js`
   - Type: `JavaScript Module`

> Note: The `/hacsfiles/...` folder name depends on the repository name.

## Usage

```yaml
type: custom:echarts-raw-card
title: Demo
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

## License

MIT
Copyright (c) 2026 Robin Ridler