import { createApp } from './app.mjs';

const port = Number(process.env.PORT ?? '8080');
if (!Number.isInteger(port) || port < 1 || port > 65535) {
	throw new Error('PORT must be an integer between 1 and 65535');
}
const host = process.env.HOST ?? '127.0.0.1';
const app = createApp();
app.listen(port, host, () => {
	console.log(`Sync scaffold listening on ${host}:${port}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
	process.once(signal, () => {
		app.close(error => process.exit(error ? 1 : 0));
		setTimeout(() => process.exit(1), 5000).unref();
	});
}
