'use strict';

// Tick scheduler + runtime loop.
// Keeps timing and error-policy in one place, away from main.js.

const itemManager = require('./itemManager');
const snapshotService = require('./snapshot');
const evaluator = require('./evaluator');
const { getItemOutputId } = require('./itemIds');
const stateRegistry = require('./stateRegistry');

function getTickIntervalMs(adapter) {
	const fallbackSeconds = 5;
	const cfgSecondsRaw = adapter.config && adapter.config.pollIntervalSeconds !== undefined
		? adapter.config.pollIntervalSeconds
		: fallbackSeconds;
	const cfgSeconds = Number(cfgSecondsRaw);

	// Keep it sane; Admin enforces min/max but we also guard here.
	const seconds = Number.isFinite(cfgSeconds) && cfgSeconds > 0 ? cfgSeconds : fallbackSeconds;
	return Math.round(seconds * 1000);
}

function getTickTimeBudgetMs(adapter) {
	const interval = getTickIntervalMs(adapter);
	const ratioRaw = Number(adapter.TICK_TIME_BUDGET_RATIO);
	const ratio = Number.isFinite(ratioRaw) && ratioRaw > 0 && ratioRaw <= 1 ? ratioRaw : 0.8;
	return Math.max(0, Math.floor(interval * ratio));
}

function getErrorRetriesBeforeZero(adapter) {
	const raw = adapter.config && adapter.config.errorRetriesBeforeZero !== undefined
		? adapter.config.errorRetriesBeforeZero
		: 3;
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0) return 3;
	return Math.min(100, Math.round(n));
}

async function runTick(adapter) {
	const start = Date.now();
	const items = Array.isArray(adapter.config.items) ? adapter.config.items : [];
	const enabledItems = items.filter(it => it && typeof it === 'object' && it.enabled);
	const retriesBeforeZero = getErrorRetriesBeforeZero(adapter);
	const timeBudgetMs = getTickTimeBudgetMs(adapter);
	let skippedItems = 0;

	// If config changed (without restart), rebuild compiled cache + subscriptions.
	try {
		await itemManager.ensureCompiledForCurrentConfig(adapter, items);
	} catch (e) {
		const msg = e && e.message ? e.message : String(e);
		adapter.log.warn(`Prepare items failed: ${msg}`);
		try {
			await adapter.setStateAsync('info.lastError', msg, true);
		} catch {
			// ignore
		}
	}

	// Keep status in sync even if config changes without a restart
	try {
		await adapter.setStateAsync('info.itemsConfigured', items.filter(it => it && typeof it === 'object').length, true);
		await adapter.setStateAsync('info.itemsEnabled', enabledItems.length, true);
		await adapter.setStateAsync('info.status', enabledItems.length ? 'ok' : 'no_items_enabled', true);
		await adapter.setStateAsync('info.timeBudgetMs', timeBudgetMs, true);
		await adapter.setStateAsync('info.skippedItems', 0, true);
	} catch {
		// ignore
	}

	let snapshot = null;
	try {
		snapshot = await snapshotService.buildSnapshotForTick(adapter, items);
	} catch (e) {
		const msg = e && e.message ? e.message : String(e);
		adapter.log.warn(`Snapshot build failed: ${msg}`);
		try {
			await adapter.setStateAsync('info.lastError', msg, true);
		} catch {
			// ignore
		}
		snapshot = new Map();
	}
	adapter.currentSnapshot = snapshot;

	for (let idx = 0; idx < enabledItems.length; idx++) {
		const item = enabledItems[idx];
		if (timeBudgetMs > 0 && (Date.now() - start) > timeBudgetMs) {
			skippedItems = enabledItems.length - idx;
			adapter.warnOnce(
				`tick_budget_exceeded|${Math.floor(Date.now() / 60000)}`,
				`Tick time budget exceeded (${timeBudgetMs}ms). Skipping ${skippedItems} remaining item(s) this tick.`
			);
			break;
		}

		const targetId = getItemOutputId(item);
		if (!targetId) continue;
		const itemStart = Date.now();
		const itemInfoBase = stateRegistry.getItemInfoBaseId(targetId);

		try {
			const raw = await evaluator.computeItemValue(adapter, item, snapshot);
			const shaped = evaluator.isNumericOutputItem(item)
				? evaluator.applyResultRules(adapter, item, raw)
				: raw;
			const value = evaluator.castValueForItemType(adapter, item, shaped);

			await adapter.setStateAsync(targetId, value, true);
			adapter.lastGoodValue.set(targetId, value);
			adapter.lastGoodTs.set(targetId, Date.now());
			adapter.consecutiveErrorCounts.set(targetId, 0);

			// Per-item info states (best-effort; must never break tick)
			try {
				await adapter.setStateAsync(`${itemInfoBase}.lastOkTs`, new Date().toISOString(), true);
				await adapter.setStateAsync(`${itemInfoBase}.lastEvalMs`, Date.now() - itemStart, true);
				await adapter.setStateAsync(`${itemInfoBase}.lastError`, '', true);
				await adapter.setStateAsync(`${itemInfoBase}.consecutiveErrors`, 0, true);
			} catch {
				// ignore
			}
		} catch (e) {
			const name = item.name || targetId;
			const errMsg = e && e.message ? e.message : String(e);
			const msg = `${name}: ${errMsg}`;
			adapter.warnOnce(`compute_failed|${targetId}`, `Compute failed (will retry/keep last): ${msg}`);
			try {
				await adapter.setStateAsync('info.lastError', msg, true);
			} catch {
				// ignore
			}

			const prev = adapter.consecutiveErrorCounts.get(targetId) || 0;
			const next = prev + 1;
			adapter.consecutiveErrorCounts.set(targetId, next);
			try {
				await adapter.setStateAsync(`${itemInfoBase}.lastError`, errMsg, true);
				await adapter.setStateAsync(`${itemInfoBase}.lastEvalMs`, Date.now() - itemStart, true);
				await adapter.setStateAsync(`${itemInfoBase}.consecutiveErrors`, next, true);
			} catch {
				// ignore
			}

			// Policy: keep last good value for N retries, then set to 0.
			if (adapter.lastGoodValue.has(targetId) && next <= retriesBeforeZero) {
				try {
					await adapter.setStateAsync(targetId, adapter.lastGoodValue.get(targetId), true);
				} catch {
					// ignore write errors
				}
			} else if (next > retriesBeforeZero) {
				try {
					await adapter.setStateAsync(targetId, evaluator.getZeroValueForItem(item), true);
				} catch {
					// ignore write errors
				}
			}
		}
	}

	adapter.currentSnapshot = null;

	try {
		await adapter.setStateAsync('info.skippedItems', skippedItems, true);
		await adapter.setStateAsync('info.lastRun', new Date().toISOString(), true);
		await adapter.setStateAsync('info.evalTimeMs', Date.now() - start, true);
	} catch {
		// ignore
	}
}

function scheduleNextTick(adapter) {
	if (adapter.isUnloading) return;
	const interval = getTickIntervalMs(adapter);
	const now = Date.now();
	const delay = interval - (now % interval);

	if (adapter.tickTimer) {
		clearTimeout(adapter.tickTimer);
		adapter.tickTimer = null;
	}

	adapter.tickTimer = setTimeout(() => {
		runTick(adapter)
			.catch(e => {
				const msg = e && e.message ? e.message : String(e);
				adapter.log.error(`Tick failed: ${msg}`);
				adapter.setState('info.lastError', msg, true);
			})
			.finally(() => scheduleNextTick(adapter));
	}, delay);
}

module.exports = {
	scheduleNextTick,
	runTick,
	getTickIntervalMs,
	getTickTimeBudgetMs,
};
