'use strict';

// Small regression/simulation test.
// Runs 6 ticks (30s @ 5s interval) with deterministic synthetic PV/grid values and
// validates the expected house consumption math.
//
// This does NOT start an ioBroker instance.

const stateRegistry = require('../lib/services/stateRegistry');
const itemManager = require('../lib/services/itemManager');
const tickRunner = require('../lib/services/tickRunner');
const evaluator = require('../lib/services/evaluator');

const { parseExpression, normalizeFormulaExpression, analyzeAst, evalFormulaAst } = require('../lib/formula');
const { applyJsonPath, getNumericFromJsonPath, getValueFromJsonPath } = require('../lib/jsonpath');

function assertEqual(actual, expected, label) {
	if (Number.isNaN(expected)) {
		if (!Number.isNaN(actual)) throw new Error(`${label}: expected NaN, got ${actual}`);
		return;
	}
	if (actual !== expected) {
		throw new Error(`${label}: expected ${expected}, got ${actual}`);
	}
}

function createMockAdapter() {
	/** @type {any} */
	const adapter = {
		namespace: 'data-solectrus.0',
		config: {
			pollIntervalSeconds: 5,
			snapshotInputs: true,
			snapshotDelayMs: 0,
			errorRetriesBeforeZero: 0,
			items: [],
		},

		MAX_FORMULA_LENGTH: 8000,
		MAX_AST_NODES: 2000,
		MAX_AST_DEPTH: 60,
		MAX_DISCOVERED_STATE_IDS_PER_ITEM: 250,
		MAX_TOTAL_SOURCE_IDS: 5000,
		TICK_TIME_BUDGET_RATIO: 0.8,

		cache: new Map(),
		cacheTs: new Map(),
		compiledItems: new Map(),
		itemsConfigSignature: '',
		subscribedIds: new Set(),
		lastGoodValue: new Map(),
		lastGoodTs: new Map(),
		consecutiveErrorCounts: new Map(),
		currentSnapshot: null,
		isUnloading: false,
		tickTimer: null,

		_warnOnceKeys: new Set(),
		_debugOnceKeys: new Set(),

		log: {
			info: () => {},
			warn: () => {},
			error: msg => console.error(`[error] ${msg}`),
			debug: () => {},
		},

		safeNum(val, fallback = 0) {
			const n = Number(val);
			return Number.isFinite(n) ? n : fallback;
		},

		warnOnce(key, msg) {
			const k = String(key);
			if (this._warnOnceKeys.has(k)) return;
			this._warnOnceKeys.add(k);
			this.log.warn(msg);
		},

		debugOnce(key, msg) {
			const k = String(key);
			if (this._debugOnceKeys.has(k)) return;
			this._debugOnceKeys.add(k);
			this.log.debug(msg);
		},

		applyJsonPath(obj, path) {
			return applyJsonPath(obj, path);
		},

		analyzeAst(ast) {
			return analyzeAst(ast, { maxNodes: this.MAX_AST_NODES, maxDepth: this.MAX_AST_DEPTH });
		},

		getNumericFromJsonPath(rawValue, jsonPath, warnKeyPrefix = '') {
			return getNumericFromJsonPath(rawValue, jsonPath, {
				safeNum: this.safeNum.bind(this),
				warnOnce: this.warnOnce.bind(this),
				debugOnce: this.debugOnce.bind(this),
				warnKeyPrefix,
			});
		},

		getValueFromJsonPath(rawValue, jsonPath, warnKeyPrefix = '') {
			return getValueFromJsonPath(rawValue, jsonPath, {
				warnOnce: this.warnOnce.bind(this),
				warnKeyPrefix,
			});
		},

		normalizeFormulaExpression(expr) {
			return normalizeFormulaExpression(expr);
		},

		evalFormula(expr, vars) {
			const normalized = this.normalizeFormulaExpression(expr);
			if (normalized && normalized.length > this.MAX_FORMULA_LENGTH) {
				throw new Error(`Formula too long (> ${this.MAX_FORMULA_LENGTH} chars)`);
			}
			const ast = parseExpression(String(normalized));
			this.analyzeAst(ast);
			return this.evalFormulaAst(ast, vars);
		},

		evalFormulaAst(ast, vars) {
			return evalFormulaAst(ast, vars, this.formulaFunctions);
		},

		// ioBroker-ish APIs (mocked)
		_objectStore: new Map(),
		_stateStore: new Map(),

		async setObjectNotExistsAsync(id, obj) {
			if (!this._objectStore.has(id)) this._objectStore.set(id, obj);
		},

		async setObjectAsync(id, obj) {
			this._objectStore.set(id, obj);
		},

		async extendObjectAsync(id, obj) {
			const prev = this._objectStore.get(id) || {};
			this._objectStore.set(id, { ...prev, ...obj, common: { ...(prev.common || {}), ...(obj.common || {}) } });
		},

		async getObjectAsync(id) {
			return this._objectStore.get(id) || null;
		},

		async setStateAsync(id, val, ack) {
			this._stateStore.set(id, { val, ack: !!ack, ts: Date.now() });
		},

		setState(id, val, ack) {
			this._stateStore.set(id, { val, ack: !!ack, ts: Date.now() });
		},

		async getForeignObjectAsync(id) {
			return { _id: id, type: 'state', common: {}, native: {} };
		},

		async setForeignObjectAsync() {
			// no-op
		},

		// getForeignStateAsync is injected per simulation run
		async getForeignStateAsync() {
			return { val: 0, ts: Date.now() };
		},

		subscribeForeignStates(id) {
			this.subscribedIds.add(String(id));
		},

		unsubscribeForeignStates(id) {
			this.subscribedIds.delete(String(id));
		},
	};

	adapter.formulaFunctions = evaluator.createFormulaFunctions(adapter);
	return adapter;
}

function buildStateSeries() {
	// 6 ticks for 30s simulation. Values in watts.
	// gridSigned: import positive, export negative.
	return [
		{ enpal: 3000, zendure: 1200, bkw: 439, gridSigned: -2514 }, // expect house=2125
		{ enpal: 3100, zendure: 900, bkw: 500, gridSigned: -2500 }, // house=2000
		{ enpal: 2000, zendure: 0, bkw: 0, gridSigned: 500 }, // house=2500
		{ enpal: -30, zendure: 0, bkw: 0, gridSigned: -200 }, // enpal neg artifact -> clamp input, PV=0, house=0 after output clamp
		{ enpal: 0, zendure: 0, bkw: 0, gridSigned: -1000 }, // export with no PV -> house negative -> output clamp => 0
		{ enpal: 50, zendure: 0, bkw: 0, gridSigned: 0 }, // small PV, no grid -> house=50
	];
}

async function main() {
	const adapter = createMockAdapter();

	// Build a mini config resembling the real use-case.
	adapter.config.items = [
		{
			enabled: true,
			name: 'PV-Gesamt',
			group: 'pv',
			targetId: 'power',
			mode: 'formula',
			inputs: [
				{ key: 'Enpal', sourceState: 'src.enpal', noNegative: true },
				{ key: 'Zendure', sourceState: 'src.zendure' },
				{ key: 'BKW', sourceState: 'src.bkw' },
			],
			formula: 'Enpal + Zendure + BKW',
			type: 'number',
			role: 'value.power',
			unit: 'W',
			noNegative: true,
			clamp: false,
		},
		{
			enabled: true,
			name: 'Hausverbrauch',
			group: 'house',
			targetId: 'power',
			mode: 'formula',
			inputs: [
				{ key: 'Enpal', sourceState: 'src.enpal', noNegative: true },
				{ key: 'Zendure', sourceState: 'src.zendure' },
				{ key: 'BKW', sourceState: 'src.bkw' },
				{ key: 'Lesekopf', sourceState: 'src.gridSigned' },
			],
			formula: 'Enpal + Zendure + BKW + Lesekopf',
			type: 'number',
			role: 'value.power',
			unit: 'W',
			// This is the key bit: output should never be negative,
			// but signed grid input must remain signed.
			noNegative: true,
			clamp: true,
			min: 0,
			max: 20000,
		},
	];

	// Phase 1/2 like smoke-runtime
	await stateRegistry.createInfoStates(adapter);
	await itemManager.prepareItems(adapter);

	const series = buildStateSeries();
	const expectedHouse = [2125, 2000, 2500, 0, 0, 50];

	for (let tickIndex = 0; tickIndex < series.length; tickIndex++) {
		const cur = series[tickIndex];
		adapter.getForeignStateAsync = async id => {
			switch (String(id)) {
				case 'src.enpal':
					return { val: cur.enpal, ts: Date.now() };
				case 'src.zendure':
					return { val: cur.zendure, ts: Date.now() };
				case 'src.bkw':
					return { val: cur.bkw, ts: Date.now() };
				case 'src.gridSigned':
					return { val: cur.gridSigned, ts: Date.now() };
				default:
					return { val: 0, ts: Date.now() };
			}
		};

		await tickRunner.runTick(adapter);

		const house = adapter._stateStore.get('house.power')?.val;
		assertEqual(house, expectedHouse[tickIndex], `tick ${tickIndex} house.power`);
	}

	console.log('[check-simulate-30s] OK');
}

main().catch(e => {
	console.error(e && e.stack ? e.stack : e);
	process.exitCode = 1;
});
