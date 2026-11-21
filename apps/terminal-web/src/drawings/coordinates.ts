import type { AnchorPoint } from '@tradingview/lwc-plugin-drawing-tools';
import type { Logical, UTCTimestamp } from 'lightweight-charts';

/** Piecewise interpolation within loaded bars; interval extrapolation outside them. */
export class DrawingTimeScale {
	constructor(readonly times: readonly number[], readonly interval: number) {
		if (!times.length || interval <= 0 || times.some((t, i) => !Number.isFinite(t) || (i > 0 && t <= times[i - 1]))) throw new Error('Invalid drawing time scale');
	}
	toTime(logical: number): number {
		if (logical <= 0) return this.times[0] + logical * this.interval;
		const last = this.times.length - 1;
		if (logical >= last) return this.times[last] + (logical - last) * this.interval;
		const lower = Math.floor(logical);
		return this.times[lower] + (this.times[lower + 1] - this.times[lower]) * (logical - lower);
	}
	toLogical(time: number): Logical {
		const last = this.times.length - 1;
		if (time <= this.times[0]) return ((time - this.times[0]) / this.interval) as Logical;
		if (time >= this.times[last]) return (last + (time - this.times[last]) / this.interval) as Logical;
		let low = 0; let high = last;
		while (high - low > 1) { const mid = Math.floor((low + high) / 2); if (this.times[mid] <= time) low = mid; else high = mid; }
		return (low + (time - this.times[low]) / (this.times[high] - this.times[low])) as Logical;
	}
	canonical(point: AnchorPoint): AnchorPoint {
		// Do not use the plugin's nearest-bar time: fractional positions must remain fractional.
		return { logicalIsExact: true, logical: point.logical, time: this.toTime(point.logical) as UTCTimestamp, price: point.price };
	}
	project(point: { time: number; price: number }): AnchorPoint {
		return { logicalIsExact: true, logical: this.toLogical(point.time), time: point.time as UTCTimestamp, price: point.price };
	}
}
