import type { StreamObserver } from '@terminal/domain';

export type MarketSocket = Pick<WebSocket, 'onopen' | 'onmessage' | 'onclose' | 'onerror' | 'close'>;
export type SocketFactory = (url: string) => MarketSocket;

/** Owns reconnect/backoff/watchdog; stopping invalidates callbacks before closing. */
export function connectStream(url: string, observer: StreamObserver<unknown>, factory: SocketFactory = url => new WebSocket(url), timing = { retry: 1000, watchdog: 35000 }): () => void {
	let stopped = false;
	let socket: MarketSocket | undefined;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let watchdog: ReturnType<typeof setTimeout> | undefined;
	let attempt = 0;
	const detach = (): void => {
		clearTimeout(watchdog);
		if (socket) {
			socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
			socket.close();
			socket = undefined;
		}
	};
	const reconnect = (): void => {
		if (stopped) return;
		detach();
		observer.onState('reconnecting', '实时连接中断，正在重连');
		clearTimeout(retry);
		retry = setTimeout(connect, Math.min(30000, timing.retry * 2 ** Math.min(attempt++, 5)));
	};
	const arm = (): void => {
		clearTimeout(watchdog);
		watchdog = setTimeout(reconnect, timing.watchdog);
	};
	function connect(): void {
		if (stopped) return;
		observer.onState(attempt ? 'reconnecting' : 'connecting');
		try {
			const current = factory(url);
			socket = current;
			const valid = (): boolean => !stopped && socket === current;
			current.onopen = () => { if (valid()) { arm(); observer.onOpen(); } };
			current.onmessage = event => {
				if (!valid() || typeof event.data !== 'string') return;
				try {
					const payload: unknown = JSON.parse(event.data);
					const data = payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload;
					observer.onData(data);
					attempt = 0;
					arm();
				} catch { reconnect(); }
			};
			current.onclose = current.onerror = () => { if (valid()) reconnect(); };
			arm();
		} catch { reconnect(); }
	}
	connect();
	return () => { stopped = true; clearTimeout(retry); detach(); };
}
