import {
	CandlestickData,
	CandlestickSeries,
	ColorType,
	createChart,
	CrosshairMode,
	Logical,
	Time,
} from 'lightweight-charts';
import {
	createDrawingTools,
	DrawingTheme,
	getToolDefinition,
} from '../drawing-tools';

function generateCandlestickData(count: number): CandlestickData<Time>[] {
	const result: CandlestickData<Time>[] = [];
	const startDate = new Date(Date.UTC(2025, 4, 1));
	let price = 64000;
	let seed = 42;
	const rand = () => {
		seed = (seed * 1664525 + 1013904223) % 4294967296;
		return seed / 4294967296;
	};

	for (let i = 0; i < count; i++) {
		const date = new Date(startDate.getTime() + i * 86400 * 1000);
		const time = date.toISOString().slice(0, 10) as Time;

		const wave = Math.sin(i / 14) * 420 + Math.cos(i / 31) * 280;
		const delta = (rand() - 0.47) * 1400 + wave * 0.15;
		const open = price;
		const close = Math.max(25000, open + delta);
		const high = Math.max(open, close) + rand() * 850;
		const low = Math.min(open, close) - rand() * 850;

		result.push({
			time,
			open: Number(open.toFixed(2)),
			high: Number(high.toFixed(2)),
			low: Number(low.toFixed(2)),
			close: Number(close.toFixed(2)),
		});
		price = close;
	}
	return result;
}

const DARK_CHART_OPTIONS = {
	layout: {
		background: { type: ColorType.Solid, color: '#131722' },
		textColor: '#D1D4DC',
	},
	grid: {
		vertLines: { color: 'rgba(42, 46, 57, 0.55)' },
		horzLines: { color: 'rgba(42, 46, 57, 0.55)' },
	},
	rightPriceScale: {
		borderColor: '#2A2E39',
	},
	timeScale: {
		borderColor: '#2A2E39',
		rightOffset: 24,
	},
};

const LIGHT_CHART_OPTIONS = {
	layout: {
		background: { type: ColorType.Solid, color: '#FFFFFF' },
		textColor: '#131722',
	},
	grid: {
		vertLines: { color: 'rgba(224, 227, 235, 0.7)' },
		horzLines: { color: 'rgba(224, 227, 235, 0.7)' },
	},
	rightPriceScale: {
		borderColor: '#E0E3EB',
	},
	timeScale: {
		borderColor: '#E0E3EB',
		rightOffset: 24,
	},
};

const chartEl = document.getElementById('chart') as HTMLElement;
const toolbarHost = document.getElementById('toolbar-host') as HTMLElement;
const chartStage = document.getElementById('chart-stage') as HTMLElement;
const statusText = document.getElementById('status-text') as HTMLElement;
const btnTheme = document.getElementById('btn-theme') as HTMLButtonElement;
const btnSamples = document.getElementById('btn-samples') as HTMLButtonElement;

const chart = createChart(chartEl, {
	autoSize: true,
	crosshair: {
		mode: CrosshairMode.Normal,
	},
	...DARK_CHART_OPTIONS,
});

const series = chart.addSeries(CandlestickSeries, {
	upColor: '#089981',
	downColor: '#F23645',
	borderUpColor: '#089981',
	borderDownColor: '#F23645',
	wickUpColor: '#089981',
	wickDownColor: '#F23645',
});

const candles = generateCandlestickData(180);
series.setData(candles);
chart.timeScale().fitContent();

let theme: DrawingTheme = 'dark';

const studio = createDrawingTools(chart, series, {
	toolbarContainer: toolbarHost,
	overlayContainer: chartStage,
	theme,
});

function loadSampleDrawings(): void {
	studio.manager.clearAll(false);

	// 1. Trend Line
	studio.manager.addDrawing(
		'trend-line',
		[
			{ logical: 45 as Logical, time: candles[45].time, price: candles[45].low },
			{ logical: 110 as Logical, time: candles[110].time, price: candles[110].low },
		],
		{ color: '#2962FF', lineWidth: 2, extendRight: true },
		false
	);

	// 2. Fib Retracement
	let highIdx = 60;
	let lowIdx = 95;
	for (let i = 55; i <= 85; i++) {
		if (candles[i].high > candles[highIdx].high) highIdx = i;
	}
	for (let i = 86; i <= 120; i++) {
		if (candles[i].low < candles[lowIdx].low) lowIdx = i;
	}
	studio.manager.addDrawing(
		'fib-retracement',
		[
			{ logical: highIdx as Logical, time: candles[highIdx].time, price: candles[highIdx].high },
			{ logical: lowIdx as Logical, time: candles[lowIdx].time, price: candles[lowIdx].low },
		],
		{},
		false
	);

	// 3. Support Zone Rectangle
	studio.manager.addDrawing(
		'rectangle',
		[
			{ logical: 125 as Logical, time: candles[125].time, price: candles[125].low * 0.99 },
			{ logical: 160 as Logical, time: candles[160].time, price: candles[125].high * 1.01 },
		],
		{ color: '#089981', fillColor: '#089981', fillOpacity: 0.16 },
		false
	);

	// 4. Text Annotation
	studio.manager.addDrawing(
		'text',
		[
			{
				logical: 130 as Logical,
				time: candles[130].time,
				price: candles[130].high * 1.045,
			},
		],
		{ text: '突破观察区\n双击编辑文本', color: '#2962FF' },
		false
	);
}

loadSampleDrawings();

studio.manager.subscribeStateChange(state => {
	const magnetLabel =
		state.magnetMode === 'off'
			? ''
			: state.magnetMode === 'weak'
				? ' · 弱磁吸'
				: ' · 强磁吸';
	if (state.activeTool) {
		const def = getToolDefinition(state.activeTool);
		statusText.textContent = `绘制中：${def.shortLabel}（点击放置 ${def.pointCount} 个锚点，按住 Shift 对齐 45°，Esc 取消）${magnetLabel}`;
	} else if (state.selectedDrawing) {
		const def = getToolDefinition(state.selectedDrawing.type);
		statusText.textContent = `已选中：${def.shortLabel}（拖动锚点或主体调整，Delete 删除，Cmd/Ctrl+Z 撤销）${magnetLabel}`;
	} else {
		statusText.textContent = `光标模式 · 共 ${state.count} 个绘图${magnetLabel}`;
	}
});

btnSamples.addEventListener('click', () => loadSampleDrawings());

btnTheme.addEventListener('click', () => {
	theme = theme === 'dark' ? 'light' : 'dark';
	document.body.classList.toggle('theme-light', theme === 'light');
	chart.applyOptions(theme === 'dark' ? DARK_CHART_OPTIONS : LIGHT_CHART_OPTIONS);
	studio.setTheme(theme);
	btnTheme.textContent = theme === 'dark' ? '切换浅色主题' : '切换深色主题';
});

(window as unknown as { drawingStudio: typeof studio }).drawingStudio = studio;
