function wrapIndex(index: number, count: number): number {
	return ((index % count) + count) % count;
}

/** Gesture state is independent of DOM, so cancellation and release can be tested. */
export class HoldSwitcher {
	private pointer: number | null = null;
	private originX = 0;
	private originY = 0;
	private anchorY = 0;
	private rawIndex = 0;
	private index = 0;
	private count = 0;
	private activated = false;
	private fractional = 0;

	begin(pointer: number, x: number, y: number, index: number, count: number): boolean {
		if (this.pointer !== null || count === 0) return false;
		this.pointer = pointer;
		this.originX = x;
		this.originY = this.anchorY = y;
		this.count = count;
		this.index = wrapIndex(index, count);
		this.rawIndex = this.index;
		this.fractional = this.rawIndex;
		this.activated = false;
		return true;
	}

	activate(pointer: number): number | null {
		if (this.pointer !== pointer) return null;
		this.activated = true;
		this.rawIndex = this.index;
		this.fractional = this.rawIndex;
		return this.index;
	}

	isTracking(pointer: number): boolean {
		return this.pointer === pointer;
	}

	/** Continuous unbounded wheel position for seamless circular scrolling. */
	position(): number {
		return this.fractional;
	}

	move(pointer: number, x: number, y: number): number | null {
		if (pointer !== this.pointer) return null;
		if (!this.activated) {
			const dx = Math.abs(x - this.originX);
			const dy = Math.abs(y - this.originY);
			// Immediate vertical drag activates the wheel without waiting for a hold delay.
			if (dy >= 8 && dy >= dx) {
				this.activated = true;
				this.anchorY = y;
				this.rawIndex = this.index;
				this.fractional = this.rawIndex;
				return this.index;
			}
			if (dx > 12) this.cancel();
			return null;
		}
		this.fractional = this.rawIndex + (this.anchorY - y) / 36;
		this.index = wrapIndex(Math.round(this.fractional), this.count);
		return this.index;
	}

	end(pointer: number): number | null {
		if (pointer !== this.pointer) return null;
		const result = this.activated ? this.index : null;
		this.cancel();
		return result;
	}

	cancel(): void {
		this.pointer = null;
		this.activated = false;
	}
}
