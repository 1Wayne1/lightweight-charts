/** Gesture state is independent of DOM, so cancellation and release can be tested. */
export class HoldSwitcher {
	private pointer: number | null = null;
	private originX = 0;
	private originY = 0;
	private anchorY = 0;
	private index = 0;
	private count = 0;
	private activated = false;

	begin(pointer: number, x: number, y: number, index: number, count: number): boolean {
		if (this.pointer !== null || count === 0) return false;
		this.pointer = pointer;
		this.originX = x;
		this.originY = this.anchorY = y;
		this.count = count;
		this.index = Math.max(0, Math.min(count - 1, index));
		this.activated = false;
		return true;
	}

	activate(pointer: number): number | null {
		if (this.pointer !== pointer) return null;
		this.activated = true;
		return this.index;
	}

	isTracking(pointer: number): boolean {
		return this.pointer === pointer;
	}

	move(pointer: number, x: number, y: number): number | null {
		if (pointer !== this.pointer) return null;
		if (!this.activated) {
			if (Math.hypot(x - this.originX, y - this.originY) > 10) this.cancel();
			return null;
		}
		const steps = Math.trunc((this.anchorY - y) / 36);
		if (steps !== 0) {
			this.index = Math.max(0, Math.min(this.count - 1, this.index + steps));
			// Rebase even at a boundary so reversing direction responds immediately.
			this.anchorY = y;
		}
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
