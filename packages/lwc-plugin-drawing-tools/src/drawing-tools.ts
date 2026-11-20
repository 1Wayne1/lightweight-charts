export {
	ANCHOR_HIT_RADIUS,
	applyCanvasLineStyle,
	BaseDrawing,
	DrawingAxisLabelView,
	drawAnchorHandles,
	LINE_HIT_TOLERANCE,
} from './base-drawing';
export type { BodyHitResult } from './base-drawing';

export {
	anchorToScreen,
	anchorToX,
	anchorToY,
	formatDuration,
	formatPrice,
	formatTime,
	screenToAnchor,
	shiftAnchor,
	timeToEpochSeconds,
} from './coordinates';

export {
	clipLineToViewport,
	colorWithAlpha,
	computeParallelChannel,
	distancePointToInfiniteLine,
	distancePointToPoint,
	distancePointToRay,
	distancePointToSegment,
	distanceToRectBorder,
	pointInPolygon,
	pointInRect,
	snapAngle45,
} from './geometry';
export type { ParallelChannelGeometry } from './geometry';

export { DrawingHistory } from './history';

export { DrawingManager } from './manager';
export type { DrawingManagerOptions, DrawingManagerState } from './manager';

export {
	createDrawingInstance,
	FibRetracementDrawing,
	getToolDefinition,
	HorizontalLineDrawing,
	ParallelChannelDrawing,
	PriceDateRangeDrawing,
	RayDrawing,
	RectangleDrawing,
	TextAnnotationDrawing,
	TOOL_DEFINITIONS,
	TrendLineDrawing,
	VerticalLineDrawing,
} from './tools/index';

export {
	BASE_DRAWING_OPTIONS,
	decodeExternalId,
	DEFAULT_FIB_LEVELS,
	encodeExternalId,
} from './types';
export type {
	AnchorPoint,
	DrawingSnapshot,
	DrawingStyleOptions,
	DrawingTheme,
	DrawingToolType,
	FibLevelConfig,
	HitPart,
	MagnetMode,
	ScreenPoint,
	SerializedDrawing,
	ToolCapabilities,
	ToolDefinition,
} from './types';

export { DrawingToolbar } from './ui/toolbar';
export type { DrawingToolbarOptions } from './ui/toolbar';

export { FloatingPropertiesBar } from './ui/properties-bar';
export type { FloatingPropertiesBarOptions } from './ui/properties-bar';

export { createDrawingTools } from './ui/studio';
export type { CreateDrawingToolsOptions, DrawingToolsStudio } from './ui/studio';
