import { createServer } from 'node:http';

/** Infrastructure scaffold. No user data is accepted until authenticated sync exists. */
export function createApp() {
	return createServer((request, response) => {
		response.setHeader('Content-Type', 'application/json; charset=utf-8');
		response.setHeader('Cache-Control', 'no-store');
		response.setHeader('X-Content-Type-Options', 'nosniff');
		if (request.method !== 'GET') {
			response.writeHead(405, { Allow: 'GET' });
			response.end(JSON.stringify({ error: 'method_not_allowed' }));
			return;
		}
		const path = request.url?.split('?')[0];
		if (path === '/health/live') {
			response.end(JSON.stringify({ status: 'ok', service: 'terminal-sync', stage: 'scaffold' }));
			return;
		}
		if (path === '/v1/capabilities') {
			response.end(JSON.stringify({ apiVersion: 1, authentication: false, sync: false, storage: false }));
			return;
		}
		response.writeHead(404);
		response.end(JSON.stringify({ error: 'not_found' }));
	});
}
