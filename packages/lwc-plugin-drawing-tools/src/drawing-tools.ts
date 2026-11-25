export {
	ANCHOR_HIT_RADIUS,
	applyCanvasLineStyle,
	BaseDrawing,
	DrawingAxisLabelView,
	drawAnchorHandles,
	LINE_HIT_TOLERANCE,
} from './base-drawing';
export type { AxisLabelSpec, BodyHitResult } from './base-drawing';

export {
	anchorToScreen,
	anchorToX,
	anchorToY,
	formatDuration,
	formatPrice,
	formatTime,
	screenToAnchor,
	screenToAnchorWithSnap,
	shiftAnchor,
	timeToEpochSeconds,
} from './coordinates';
export type { SnappedAnchorResult } from './coordinates';

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
	FibChannelDrawing,
	FibExtensionDrawing,
	FibRetracementDrawing,
	getToolDefinition,
	getToolStepHint,
	HorizontalLineDrawing,
	isElliottTool,
	ParallelChannelDrawing,
	PatternDrawing,
	PositionDrawing,
	PriceDateRangeDrawing,
	RayDrawing,
	RectangleDrawing,
	TextAnnotationDrawing,
	TOOL_DEFINITIONS,
	TrendFibTimeDrawing,
	TrendLineDrawing,
	VerticalLineDrawing,
} from './tools/index';

export {
	buildPositionDefaultAnchors,
	flipPosition,
} from './tools/position';

export {
	formatWaveLabels,
	vertexLabelDirection,
} from './tools/patterns';

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
	EditHandle,
	FibLevelConfig,
	HitPart,
	MagnetMode,
	ScreenPoint,
	SerializedDrawing,
	ToolCapabilities,
	ToolDefinition,
	WaveDegree,
} from './types';

export { DrawingToolbar } from './ui/toolbar';
export type { DrawingToolbarOptions } from './ui/toolbar';

export { FloatingPropertiesBar } from './ui/properties-bar';
export type { FloatingPropertiesBarOptions } from './ui/properties-bar';

export { createDrawingTools } from './ui/studio';
export type { CreateDrawingToolsOptions, DrawingToolsStudio } from './ui/studio';

export { EXTENDED_TOOLS } from './tools/catalog';
export type { ExtendedToolType } from './tools/catalog';
export type { DrawingBar } from './tools/extended-geometry';

export { attachedTextKind } from './attached-text';
export type { AttachedTextTarget } from './attached-text';
