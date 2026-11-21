import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../src/app.mjs';

test('scaffold reports liveness without claiming working sync or accepting user data', async t => {
	const app = createApp();
	t.after(() => new Promise((resolve, reject) => app.close(error => error ? reject(error) : resolve())));
	app.listen(0, '127.0.0.1');
	await once(app, 'listening');
	const baseUrl = `http://127.0.0.1:${app.address().port}`;
	const health = await fetch(`${baseUrl}/health/live`);
	assert.equal(health.status, 200);
	assert.equal((await health.json()).stage, 'scaffold');
	const capabilities = await fetch(`${baseUrl}/v1/capabilities`);
	assert.deepEqual(await capabilities.json(), { apiVersion: 1, authentication: false, sync: false, storage: false });
	assert.equal((await fetch(`${baseUrl}/v1/sync`, { method: 'POST', body: '{}' })).status, 405);
	assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 404);
});
