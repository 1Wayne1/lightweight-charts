import { AnchorPoint, DrawingStyleOptions, DrawingToolType } from '../types';
import { TrendLineDrawing } from './trend-line';

export class RayDrawing extends TrendLineDrawing {
	public override readonly type: DrawingToolType = 'ray';

	public constructor(
		id: string,
		points: AnchorPoint[],
		options: Partial<DrawingStyleOptions> = {}
	) {
		super(id, points, {
			extendLeft: false,
			extendRight: true,
			...options,
		});
	}
}
