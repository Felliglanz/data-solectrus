'use strict';

// Runtime smoke test for the refactored service wiring.
// This does NOT start an ioBroker adapter instance.
// Instead it mocks the adapter surface that the services need and runs:
// - createInfoStates()
// - prepareItems()
// - runTick() once

const {
	parseExpression,
	normalizeFormulaExpression,
	analyzeAst,
	evalFormulaAst,
} = require('../lib/formula');

const {
	applyJsonPath,
	getNumericFromJsonPath,
	getValueFromJsonPath,
} = require('../lib/jsonpath');

const stateRegistry = require('../lib/services/stateRegistry');
const itemManager = require('../lib/services/itemManager');
const tickRunner = require('../lib/services/tickRunner');
const evaluator = require('../lib/services/evaluator');

function createMockAdapter() {
	/** @type {any} */
	const adapter = {
		namespace: 'data-solectrus.0',
		config: {
			pollIntervalSeconds: 5,
			snapshotInputs: true,
			snapshotDelayMs: 0,
			errorRetriesBeforeZero: 2,
			items: [
				{
					enabled: true,
					group: 'demo',
					targetId: 'sum',
					name: 'Sum',
					type: 'number',
					role: 'value',
					unit: 'W',
					mode: 'formula',
					noNegative: true,
					clamp: true,
					min: 0,
					max: 10000,
					inputs: [
						{ key: 'a', sourceState: 'mqtt.0.demo.a' },
						{ key: 'b', sourceState: 'mqtt.0.demo.b' },
					],
					formula: 'a + b',
				},
				{
					enabled: true,
					group: 'demo',
					targetId: 'fromJson',
					name: 'From JSON',
					type: 'number',
					mode: 'source',
					sourceState: 'mqtt.0.demo.payload',
					jsonPath: '$.value',
				},
				{
					enabled: true,
					group: 'demo',
					targetId: 'viaS',
					name: 'Via s()',
					type: 'number',
					mode: 'formula',
					inputs: [],
					formula: 's("mqtt.0.demo.a") * 2',
				},
				{
					enabled: true,
					group: 'demo',
					targetId: 'viaJP',
					name: 'Via jp()',
					type: 'number',
					mode: 'formula',
					inputs: [],
					formula: 'jp("mqtt.0.demo.payload", "$.value") + 1',
				},
			],
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
			info: msg => console.log(`[info] ${msg}`),
			warn: msg => console.log(`[warn] ${msg}`),
			error: msg => console.log(`[error] ${msg}`),
			debug: msg => console.log(`[debug] ${msg}`),
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
				throw new Error(`Formula too long (>${this.MAX_FORMULA_LENGTH} chars)`);
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

		async getForeignObjectAsync(_id) {
			return { _id: _id, type: 'state', common: {}, native: {} };
		},

		async setForeignObjectAsync(_id, _obj) {
			// no-op in smoke
		},

		async getForeignStateAsync(id) {
			// Provide deterministic demo values.
			if (id === 'mqtt.0.demo.a') return { val: 10, ts: Date.now() };
			if (id === 'mqtt.0.demo.b') return { val: 5, ts: Date.now() };
			if (id === 'mqtt.0.demo.payload') return { val: '{"value":41}', ts: Date.now() };
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

async function main() {
	const adapter = createMockAdapter();

	// Phase 1: create global info states
	await stateRegistry.createInfoStates(adapter);

	// Phase 2: prepare/compile items, create output + per-item info objects, subscribe + initial read
	await itemManager.prepareItems(adapter);

	// Phase 3: run one tick
	await tickRunner.runTick(adapter);

	const out = {
		objectsCreated: adapter._objectStore.size,
		statesWritten: adapter._stateStore.size,
		subscribedIds: adapter.subscribedIds.size,
		outputs: {},
	};

	for (const [id, st] of adapter._stateStore.entries()) {
		if (id.startsWith('demo.')) out.outputs[id] = st.val;
	}

	console.log('\n[smoke-runtime] OK');
	console.log(JSON.stringify(out, null, 2));
}

main().catch(err => {
	console.error('\n[smoke-runtime] FAILED');
	console.error(err && err.stack ? err.stack : String(err));
	process.exitCode = 1;
});
