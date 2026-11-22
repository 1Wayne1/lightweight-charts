import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasInWatchlist, moveWatchlistItemToEdge, parseWatchlistStore, removeFromWatchlist, reorderWatchlist, toggleWatchlistItem } from '../src/data/watchlist';

const btcSpot = { venue: 'binance', market: 'spot', symbol: 'BTC-USDT' };
const btcPerp = { venue: 'binance', market: 'perpetual', symbol: 'BTC-USDT' };
const ethSpot = { venue: 'binance', market: 'spot', symbol: 'ETH-USDT' };

test('watchlist toggles membership cleanly and isolates spot from perpetual', () => {
	let list = [btcSpot];
	assert.equal(hasInWatchlist(list, btcSpot), true);
	assert.equal(hasInWatchlist(list, btcPerp), false);

	const addedPerp = toggleWatchlistItem(list, btcPerp);
	assert.equal(addedPerp.added, true);
	list = addedPerp.items;
	assert.equal(list.length, 2);
	assert.equal(hasInWatchlist(list, btcPerp), true);

	const removedSpot = toggleWatchlistItem(list, btcSpot);
	assert.equal(removedSpot.added, false);
	list = removedSpot.items;
	assert.equal(list.length, 1);
	assert.equal(hasInWatchlist(list, btcSpot), false);
	assert.equal(hasInWatchlist(list, btcPerp), true);

	assert.equal(removeFromWatchlist(list, btcPerp).length, 0);
});

test('parseWatchlistStore deduplicates valid entries and rejects malformed payloads', () => {
	const parsed = parseWatchlistStore({
		schemaVersion: 1,
		items: [btcSpot, btcSpot, 'binance:spot:ETH-USDT', btcPerp],
	});
	assert.deepEqual(parsed.items, [btcSpot, ethSpot, btcPerp]);
	assert.throws(() => parseWatchlistStore({ schemaVersion: 2, items: [] }));
	assert.throws(() => parseWatchlistStore({ schemaVersion: 1, items: [{ venue: 'binance', market: 'delivery', symbol: 'BTC-USDT' }] }));
	assert.throws(() => parseWatchlistStore({ schemaVersion: 1, items: ['BTCUSDT'] }));
});

test('reorderWatchlist and moveWatchlistItemToEdge preserve items and guard invalid indices', () => {
	const list = [btcSpot, ethSpot, btcPerp];
	assert.deepEqual(reorderWatchlist(list, 0, 2), [ethSpot, btcPerp, btcSpot]);
	assert.deepEqual(reorderWatchlist(list, 2, 0), [btcPerp, btcSpot, ethSpot]);
	assert.deepEqual(reorderWatchlist(list, 1, 1), list);
	assert.deepEqual(reorderWatchlist(list, -1, 2), list);
	assert.deepEqual(reorderWatchlist(list, 0, 9), list);
	assert.deepEqual(moveWatchlistItemToEdge(list, btcPerp, 'top'), [btcPerp, btcSpot, ethSpot]);
	assert.deepEqual(moveWatchlistItemToEdge(list, btcSpot, 'bottom'), [ethSpot, btcPerp, btcSpot]);
});
