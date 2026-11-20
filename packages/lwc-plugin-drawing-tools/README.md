# `@tradingview/lwc-plugin-drawing-tools`

TradingView 风格的 Lightweight Charts v5 绘图工具插件（纯插件层实现，基于 `ISeriesPrimitive`，不侵入核心源码）。

## 包含的核心绘图工具（9 种）

1. **趋势线 (`trend-line`)** — 两点线段，支持左/右无限延伸
2. **射线 (`ray`)** — 两点射线，默认向右无限延伸
3. **水平线 (`horizontal-line`)** — 单点全宽水平线 + 价格轴实时标签
4. **垂直线 (`vertical-line`)** — 单点全高垂直线 + 时间轴实时标签
5. **矩形 (`rectangle`)** — 填充与边框 + 选中时价格轴/时间轴范围投影
6. **平行通道 (`parallel-channel`)** — 三点平行通道 + 填充 + 可选虚线中线 + 左右延伸
7. **斐波那契回撤 (`fib-retracement`)** — 经典比例线（0 / 0.236 / 0.382 / 0.5 / 0.618 / 0.786 / 1）、分带填充与价格标签
8. **价格时间测量尺 (`price-date-range`)** — 涨跌额、涨跌幅、K 线根数与时间跨度标注
9. **文本标注 (`text`)** — 支持多行文本、双击或通过属性条内联编辑

## 核心交互与 UI 能力

- **支持未来空白区绘图**：锚点以 `logical` 逻辑坐标为主、`time` 为辅，拖入最后一根 K 线右侧空白区不丢失、不回弹。
- **TradingView 手感交互**：点击创建 + 实时预览、选中高亮、锚点拖拽（锚点命中优先于线段/区域）、主体整体平移（拖拽期间自动挂起图表平移缩放）、`Shift` 45° 约束。
- **OHLC 磁吸模式**：关 / 弱磁吸 / 强磁吸，自动吸附 K 线开高低收价格。
- **快捷键与撤销重做**：`Esc` 取消/退出、`Delete`/`Backspace` 删除、`Cmd/Ctrl+Z` 撤销、`Cmd/Ctrl+Shift+Z` 重做。
- **JSON 序列化**：`manager.exportState()` / `manager.importState()`。
- **内置 UI**：左侧绘图工具栏 (`DrawingToolbar`) + 可拖拽浮动属性配置条 (`FloatingPropertiesBar`)，支持深色/浅色主题切换。

## 快速上手

```ts
import { CandlestickSeries, createChart } from 'lightweight-charts';
import { createDrawingTools } from '@tradingview/lwc-plugin-drawing-tools';

const chart = createChart(chartContainer, { autoSize: true });
const series = chart.addSeries(CandlestickSeries);
series.setData(candles);

const studio = createDrawingTools(chart, series, {
  toolbarContainer: document.getElementById('toolbar-host')!,
  overlayContainer: document.getElementById('chart-stage')!,
  theme: 'dark',
});
```

## 开发与构建

```bash
# 1. 在仓库根目录安装依赖并构建主库与 toolkit
pnpm install
pnpm run build
pnpm --filter @tradingview/lwc-toolkit build

# 2. 启动交互演示页
pnpm --filter @tradingview/lwc-plugin-drawing-tools dev

# 3. 类型检查 / 打包构建 / 单元测试
pnpm --filter @tradingview/lwc-plugin-drawing-tools typecheck
pnpm --filter @tradingview/lwc-plugin-drawing-tools build
pnpm --filter @tradingview/lwc-plugin-drawing-tools test
```
