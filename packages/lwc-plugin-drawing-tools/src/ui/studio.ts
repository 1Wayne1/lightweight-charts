import { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import { DrawingManager, DrawingManagerOptions } from '../manager';
import { DrawingTheme } from '../types';
import { FloatingPropertiesBar } from './properties-bar';
import { DrawingToolbar } from './toolbar';

export interface CreateDrawingToolsOptions extends DrawingManagerOptions {
	/** Container for the left vertical drawing toolbar. */
	toolbarContainer?: HTMLElement;
	/** Overlay container for the floating properties bar (defaults to chart container parent or chartElement). */
	overlayContainer?: HTMLElement;
	/** Initial UI theme ('dark' | 'light'). Defaults to 'dark'. */
	theme?: DrawingTheme;
	/** Whether to show JSON Export/Import buttons in the toolbar. Defaults to true. */
	showSerializationButtons?: boolean;
	/** Optional callback overriding default JSON file download on export. */
	onExportJson?: (json: string) => void;
}

export interface DrawingToolsStudio {
	readonly manager: DrawingManager;
	readonly toolbar: DrawingToolbar | null;
	readonly propertiesBar: FloatingPropertiesBar | null;
	setTheme(theme: DrawingTheme): void;
	destroy(): void;
}

/**
 * One-call helper that attaches DrawingManager, optional left DrawingToolbar,
 * and FloatingPropertiesBar to an existing Lightweight Charts instance.
 */
export function createDrawingTools(
	chart: IChartApi,
	series: ISeriesApi<SeriesType>,
	options: CreateDrawingToolsOptions = {}
): DrawingToolsStudio {
	const theme = options.theme ?? 'dark';
	const manager = new DrawingManager(chart, series, options);

	const toolbar = options.toolbarContainer
		? new DrawingToolbar(manager, options.toolbarContainer, {
				theme,
				showSerializationButtons: options.showSerializationButtons,
				onExportJson: options.onExportJson,
			})
		: null;

	const overlayHost =
		options.overlayContainer ??
		chart.chartElement().parentElement ??
		chart.chartElement();

	const propertiesBar = overlayHost
		? new FloatingPropertiesBar(manager, overlayHost, { theme })
		: null;

	return {
		manager,
		toolbar,
		propertiesBar,
		setTheme(nextTheme: DrawingTheme) {
			toolbar?.setTheme(nextTheme);
			propertiesBar?.setTheme(nextTheme);
		},
		destroy() {
			propertiesBar?.destroy();
			toolbar?.destroy();
			manager.destroy();
		},
	};
}
