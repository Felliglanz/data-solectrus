'use strict';

const utils = require('@iobroker/adapter-core');
const {
	parseExpression,
	normalizeFormulaExpression: normalizeFormulaExpressionImpl,
	analyzeAst: analyzeAstImpl,
	evalFormulaAst: evalFormulaAstImpl,
} = require('./lib/formula');
const {
	applyJsonPath: applyJsonPathImpl,
	getNumericFromJsonPath: getNumericFromJsonPathImpl,
	getValueFromJsonPath: getValueFromJsonPathImpl,
} = require('./lib/jsonpath');

const stateRegistry = require('./lib/services/stateRegistry');
const itemManager = require('./lib/services/itemManager');
const tickRunner = require('./lib/services/tickRunner');
const evaluator = require('./lib/services/evaluator');

class DataSolectrus extends utils.Adapter {
	constructor(options) {
		super({
			...options,
			name: 'data-solectrus',
		});

		// Hard limits to keep formula evaluation predictable even with hostile/mistyped configs.
		this.MAX_FORMULA_LENGTH = 8000;
		this.MAX_AST_NODES = 2000;
		this.MAX_AST_DEPTH = 60;
		this.MAX_DISCOVERED_STATE_IDS_PER_ITEM = 250;
		// Global caps to keep runtime behavior predictable even with huge configs.
		this.MAX_TOTAL_SOURCE_IDS = 5000;
		this.TICK_TIME_BUDGET_RATIO = 0.8;

		this.cache = new Map();
		this.cacheTs = new Map();
		// Precompiled per-item cache to keep tick evaluation fast and robust.
		/** @type {Map<string, {ok:boolean, error?:string, item:any, outputId:string, mode:string, sourceIds:Set<string>, normalizedExpr?:string, ast?:any, constantValue?:any}>} */
		this.compiledItems = new Map();
		this.itemsConfigSignature = '';
		this.subscribedIds = new Set();
		this.lastGoodValue = new Map();
		this.lastGoodTs = new Map();
		this.consecutiveErrorCounts = new Map();

		this.currentSnapshot = null;
		this.tickTimer = null;
		this.isUnloading = false;
		this.jsonPathWarned = new Set();
		this.debugOnceKeys = new Set();

		// Formula helpers are intentionally small and deterministic.
		// They can read from the tick snapshot (preferred) or the event cache.
		this.formulaFunctions = evaluator.createFormulaFunctions(this);

		this.on('ready', this.onReady.bind(this));
		this.on('unload', this.onUnload.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
	}

	safeNum(val, fallback = 0) {
		const n = Number(val);
		return Number.isFinite(n) ? n : fallback;
	}

	warnOnce(key, msg) {
		const k = String(key);
		if (this.jsonPathWarned.size > 500) this.jsonPathWarned.clear();
		if (this.jsonPathWarned.has(k)) return;
		this.jsonPathWarned.add(k);
		this.log.warn(msg);
	}

	debugOnce(key, msg) {
		const k = String(key);
		if (this.debugOnceKeys.size > 500) this.debugOnceKeys.clear();
		if (this.debugOnceKeys.has(k)) return;
		this.debugOnceKeys.add(k);
		this.log.debug(msg);
	}

	/**
	 * Minimal JSONPath subset evaluator for typical IoT payloads.
	 * Supported examples:
	 * - $.apower
	 * - $.aenergy.by_minute[2]
	 * - $['temperature']['tC']
	 *
	 * Not supported: filters, wildcards, unions, recursive descent, functions.
	 */
	applyJsonPath(obj, path) {
		return applyJsonPathImpl(obj, path);
	}

	analyzeAst(ast) {
		return analyzeAstImpl(ast, { maxNodes: this.MAX_AST_NODES, maxDepth: this.MAX_AST_DEPTH });
	}

	getNumericFromJsonPath(rawValue, jsonPath, warnKeyPrefix = '') {
		return getNumericFromJsonPathImpl(rawValue, jsonPath, {
			safeNum: this.safeNum.bind(this),
			warnOnce: this.warnOnce.bind(this),
			debugOnce: this.debugOnce.bind(this),
			warnKeyPrefix,
		});
	}

	getValueFromJsonPath(rawValue, jsonPath, warnKeyPrefix = '') {
		return getValueFromJsonPathImpl(rawValue, jsonPath, {
			warnOnce: this.warnOnce.bind(this),
			warnKeyPrefix,
		});
	}

	/**
	 * Normalizes some common non-JS formula syntax into the JS-like operators that `jsep` understands.
	 * - AND/OR/NOT (case-insensitive) -> && / || / !
	 * - single '=' (outside strings) -> '=='
	 *
	 * This is intentionally conservative and only runs outside quoted strings.
	 */
	normalizeFormulaExpression(expr) {
		return normalizeFormulaExpressionImpl(expr);
	}

	evalFormula(expr, vars) {
		const normalized = this.normalizeFormulaExpression(expr);
		if (normalized && normalized.length > this.MAX_FORMULA_LENGTH) {
			throw new Error(`Formula too long (>${this.MAX_FORMULA_LENGTH} chars)`);
		}
		const ast = parseExpression(String(normalized));
		this.analyzeAst(ast);
		return this.evalFormulaAst(ast, vars);
	}

	evalFormulaAst(ast, vars) {
		return evalFormulaAstImpl(ast, vars, this.formulaFunctions);
	}

	async onReady() {
		this.isUnloading = false;
		await stateRegistry.createInfoStates(this);

		// Config compatibility: some Admin/jsonConfig schema versions may store custom-control data
		// under the control name (e.g. itemsEditor). Always prefer native.items but fall back.
		const items = Array.isArray(this.config.items) ? this.config.items : [];
		const itemsEditor = Array.isArray(this.config.itemsEditor) ? this.config.itemsEditor : [];
		this.config.items = items.length ? items : itemsEditor;

		await itemManager.ensureItemTitlesInInstanceConfig(this);
		await itemManager.prepareItems(this);

		this.log.info('Adapter started successfully');
		tickRunner.scheduleNextTick(this);
	}

	onStateChange(id, state) {
		if (!state) return;
		if (id && String(id).startsWith(`${this.namespace}.`)) {
			return;
		}
		this.cache.set(id, state.val);
		this.cacheTs.set(id, typeof state.ts === 'number' ? state.ts : Date.now());
	}

	onUnload(callback) {
		try {
			this.isUnloading = true;
			if (this.tickTimer) {
				clearTimeout(this.tickTimer);
				this.tickTimer = null;
			}
			callback();
		} catch {
			callback();
		}
	}
}

if (require.main !== module) {
	module.exports = options => new DataSolectrus(options);
} else {
	(() => new DataSolectrus())();
}
