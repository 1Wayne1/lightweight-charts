import type { StreamObserver } from '@terminal/domain';

export type MarketSocket = Pick<WebSocket, 'onopen' | 'onmessage' | 'onclose' | 'onerror' | 'close'> & {
	send?: (data: string) => void;
};
export type SocketFactory = (url: string) => MarketSocket;
export type StreamUrlSource = string | (() => Promise<string>);

export interface StreamOptions {
	onConnect?: (socket: MarketSocket) => void;
	unwrapData?: boolean;
}

/** Owns reconnect/backoff/watchdog; stopping invalidates callbacks before closing. */
export function connectStream(
	urlSource: StreamUrlSource,
	observer: StreamObserver<unknown>,
	factory: SocketFactory = target => new WebSocket(target),
	timing = { retry: 1000, watchdog: 35000 },
	options: StreamOptions = {},
): () => void {
	let stopped = false;
	let socket: MarketSocket | undefined;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let watchdog: ReturnType<typeof setTimeout> | undefined;
	let attempt = 0;
	const unwrapData = options.unwrapData !== false;
	const detach = (): void => {
		clearTimeout(watchdog);
		if (socket) {
			socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
			socket.close();
			socket = undefined;
		}
	};
	const reconnect = (message = '实时连接中断，正在重连'): void => {
		if (stopped) return;
		detach();
		observer.onState('reconnecting', message);
		clearTimeout(retry);
		retry = setTimeout(connect, Math.min(30000, timing.retry * 2 ** Math.min(attempt++, 5)));
	};
	const arm = (): void => {
		clearTimeout(watchdog);
		watchdog = setTimeout(() => reconnect(), timing.watchdog);
	};
	const openSocket = (resolvedUrl: string): void => {
		if (stopped) return;
		try {
			const current = factory(resolvedUrl);
			socket = current;
			const valid = (): boolean => !stopped && socket === current;
			current.onopen = () => {
				if (!valid()) return;
				arm();
				try {
					options.onConnect?.(current);
				} catch {
					reconnect();
					return;
				}
				observer.onOpen();
			};
			current.onmessage = event => {
				if (!valid() || typeof event.data !== 'string') return;
				try {
					const payload: unknown = JSON.parse(event.data);
					const data = unwrapData && payload && typeof payload === 'object' && 'data' in payload
						? (payload as { data: unknown }).data
						: payload;
					observer.onData(data);
					attempt = 0;
					arm();
				} catch { reconnect(); }
			};
			current.onclose = current.onerror = () => { if (valid()) reconnect(); };
			arm();
		} catch { reconnect(); }
	};
	function connect(): void {
		if (stopped) return;
		observer.onState(attempt ? 'reconnecting' : 'connecting');
		if (typeof urlSource === 'string') {
			openSocket(urlSource);
			return;
		}
		void urlSource().then(
			resolvedUrl => openSocket(resolvedUrl),
			error => {
				if (stopped) return;
				const msg = error instanceof Error && error.message ? error.message : '实时连接鉴权或票据获取失败';
				reconnect(msg);
			},
		);
	}
	connect();
	return () => { stopped = true; clearTimeout(retry); detach(); };
}
