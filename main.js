'use strict';

const utils = require('@iobroker/adapter-core');
const jsep = require('jsep');

// Add exponent operator support if needed (optional).
try {
	jsep.addBinaryOp('**', 11);
} catch {
	// ignore if already added
}

class DataSolectrus extends utils.Adapter {
	constructor(options) {
		super({
			...options,
			name: 'data-solectrus',
		});

		this.cache = new Map();
		this.tickTimer = null;
		this.isUnloading = false;

		this.formulaFunctions = {
			min: Math.min,
			max: Math.max,
			abs: Math.abs,
			round: Math.round,
			floor: Math.floor,
			ceil: Math.ceil,
			clamp: (value, min, max) => {
				const v = Number(value);
				const lo = Number(min);
				const hi = Number(max);
				if (!Number.isFinite(v)) return 0;
				if (Number.isFinite(lo) && v < lo) return lo;
				if (Number.isFinite(hi) && v > hi) return hi;
				return v;
			},
			// Read a foreign state value by id from cache (sync, safe).
			s: id => {
				const key = String(id);
				return this.safeNum(this.cache.get(key));
			},
		};

		this.on('ready', this.onReady.bind(this));
		this.on('unload', this.onUnload.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
	}

	safeNum(val, fallback = 0) {
		const n = Number(val);
		return Number.isFinite(n) ? n : fallback;
	}

	evalFormula(expr, vars) {
		const ast = jsep(String(expr));
		const funcs = this.formulaFunctions;

		const evalNode = node => {
			if (!node || typeof node !== 'object') {
				throw new Error('Invalid expression');
			}

			switch (node.type) {
				case 'Literal':
					return node.value;
				case 'Identifier':
					return Object.prototype.hasOwnProperty.call(vars, node.name) ? vars[node.name] : 0;
				case 'UnaryExpression': {
					const arg = evalNode(node.argument);
					switch (node.operator) {
						case '+':
							return Number(arg);
						case '-':
							return -Number(arg);
						case '!':
							return !arg;
						default:
							throw new Error(`Operator not allowed: ${node.operator}`);
					}
				}
				case 'BinaryExpression':
				case 'LogicalExpression': {
					const left = evalNode(node.left);
					const right = evalNode(node.right);
					switch (node.operator) {
						case '+':
							return Number(left) + Number(right);
						case '-':
							return Number(left) - Number(right);
						case '*':
							return Number(left) * Number(right);
						case '/':
							return Number(left) / Number(right);
						case '%':
							return Number(left) % Number(right);
						case '**':
							return Number(left) ** Number(right);
						case '&&':
							return left && right;
						case '||':
							return left || right;
						case '==':
							return left == right;
						case '!=':
							return left != right;
						case '===':
							return left === right;
						case '!==':
							return left !== right;
						case '<':
							return Number(left) < Number(right);
						case '<=':
							return Number(left) <= Number(right);
						case '>':
							return Number(left) > Number(right);
						case '>=':
							return Number(left) >= Number(right);
						default:
							throw new Error(`Operator not allowed: ${node.operator}`);
					}
				}
				case 'ConditionalExpression': {
					const test = evalNode(node.test);
					return test ? evalNode(node.consequent) : evalNode(node.alternate);
				}
				case 'CallExpression': {
					if (!node.callee || node.callee.type !== 'Identifier') {
						throw new Error('Only simple function calls are allowed');
					}
					const fnName = node.callee.name;
					const fn = funcs[fnName];
					if (typeof fn !== 'function') {
						throw new Error(`Function not allowed: ${fnName}`);
					}
					const args = Array.isArray(node.arguments) ? node.arguments.map(evalNode) : [];
					return fn.apply(null, args);
				}
				default:
					// Blocks MemberExpression, ThisExpression, NewExpression, etc.
					throw new Error(`Expression type not allowed: ${node.type}`);
			}
		};

		return evalNode(ast);
	}

	getTickIntervalMs() {
		const fallbackSeconds = 5;
		const cfgSecondsRaw = this.config && this.config.pollIntervalSeconds !== undefined ? this.config.pollIntervalSeconds : fallbackSeconds;
		const cfgSeconds = Number(cfgSecondsRaw);

		// Keep it sane; Admin enforces min/max but we also guard here.
		const seconds = Number.isFinite(cfgSeconds) && cfgSeconds > 0 ? cfgSeconds : fallbackSeconds;
		return Math.round(seconds * 1000);
	}

	calcTitle(item) {
		const enabled = !!(item && item.enabled);
		const name = (item && (item.name || item.targetId)) ? String(item.name || item.targetId) : 'Item';
		return `${enabled ? '🟢 ' : '⚪ '}${name}`;
	}

	ensureTitle(item) {
		return { ...(item || {}), _title: this.calcTitle(item || {}) };
	}

	async ensureItemTitlesInInstanceConfig() {
		try {
			const objId = `system.adapter.${this.namespace}`;
			const obj = await this.getForeignObjectAsync(objId);
			if (!obj || !obj.native || !Array.isArray(obj.native.items)) {
				return;
			}

			let changed = false;
			obj.native.items.forEach(it => {
				if (!it || typeof it !== 'object') return;
				const expectedTitle = this.calcTitle(it);
				if (it._title !== expectedTitle) {
					it._title = expectedTitle;
					changed = true;
				}
			});

			if (changed) {
				await this.setForeignObjectAsync(objId, obj);
			}
		} catch (e) {
			this.log.debug(`Cannot migrate item titles: ${e}`);
		}
	}

	async createInfoStates() {
		await this.setObjectNotExistsAsync('info.lastError', {
			type: 'state',
			common: {
				name: 'Last Error',
				type: 'string',
				role: 'text',
				read: true,
				write: false,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync('info.lastRun', {
			type: 'state',
			common: {
				name: 'Last Run',
				type: 'string',
				role: 'date',
				read: true,
				write: false,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync('info.evalTimeMs', {
			type: 'state',
			common: {
				name: 'Evaluation time (ms)',
				type: 'number',
				role: 'value',
				read: true,
				write: false,
			},
			native: {},
		});

		await this.setStateAsync('info.lastError', '', true);
		await this.setStateAsync('info.lastRun', '', true);
		await this.setStateAsync('info.evalTimeMs', 0, true);
	}

	async onReady() {
		this.isUnloading = false;
		await this.createInfoStates();

		if (!Array.isArray(this.config.items)) {
			this.config.items = [];
		}

		await this.ensureItemTitlesInInstanceConfig();
		await this.prepareItems();

		this.log.info('Adapter started successfully');
		this.scheduleNextTick();
	}

	onStateChange(id, state) {
		if (!state) return;
		if (id && String(id).startsWith(`${this.namespace}.`)) {
			return;
		}
		this.cache.set(id, state.val);
	}

	collectSourceStatesFromItem(item) {
		const ids = [];
		if (!item || typeof item !== 'object') return ids;

		if ((item.mode || 'formula') === 'source') {
			if (item.sourceState) ids.push(String(item.sourceState));
		} else {
			if (Array.isArray(item.inputs)) {
				for (const inp of item.inputs) {
					if (inp && inp.sourceState) ids.push(String(inp.sourceState));
				}
			}
			// also allow s("...") in formula; those states are not discoverable automatically
		}
		return ids;
	}

	getItemTargetId(item) {
		const raw = item && item.targetId ? String(item.targetId).trim() : '';
		if (!raw) return '';
		// No absolute IDs; target must be relative within this adapter
		if (raw.includes('..') || raw.startsWith('.')) return '';
		return raw;
	}

	async ensureOutputState(item) {
		const id = this.getItemTargetId(item);
		if (!id) return;

		const typeMap = {
			number: 'number',
			boolean: 'boolean',
			string: 'string',
			mixed: 'mixed',
		};
		const commonType = typeMap[item.type] || 'number';

		/** @type {ioBroker.SettableStateObject} */
		const obj = {
			type: 'state',
			common: {
				name: item.name || id,
				type: commonType,
				role: item.role || 'value',
				unit: item.unit || undefined,
				read: true,
				write: false,
			},
			native: {
				mode: item.mode || 'formula',
			},
		};

		const existing = await this.getObjectAsync(id);
		if (!existing) {
			await this.setObjectAsync(id, obj);
		} else {
			await this.extendObjectAsync(id, obj);
		}
	}

	async prepareItems() {
		const items = Array.isArray(this.config.items) ? this.config.items : [];
		const enabledItems = items.filter(it => it && typeof it === 'object');

		for (const item of enabledItems) {
			await this.ensureOutputState(item);
		}

		const sourceIds = new Set();
		for (const item of enabledItems) {
			for (const id of this.collectSourceStatesFromItem(item)) {
				sourceIds.add(id);
			}
		}

		for (const id of sourceIds) {
			try {
				const obj = await this.getForeignObjectAsync(id);
				if (!obj) {
					this.log.warn(`Source state not found: ${id}`);
					continue;
				}

				const state = await this.getForeignStateAsync(id);
				if (state) {
					this.cache.set(id, state.val);
				}

				this.subscribeForeignStates(id);
			} catch (e) {
				this.log.warn(`Cannot subscribe/read ${id}: ${e && e.message ? e.message : e}`);
			}
		}

		if (!enabledItems.some(it => !!it.enabled)) {
			const msg = 'No item is enabled. Please enable at least one item in the adapter configuration.';
			this.log.warn(msg);
			await this.setStateAsync('info.lastError', msg, true);
		}
	}

	scheduleNextTick() {
		if (this.isUnloading) return;
		const interval = this.getTickIntervalMs();
		const now = Date.now();
		const delay = interval - (now % interval);

		if (this.tickTimer) {
			clearTimeout(this.tickTimer);
			this.tickTimer = null;
		}

		this.tickTimer = setTimeout(() => {
			this.runTick()
				.catch(e => {
					const msg = e && e.message ? e.message : String(e);
					this.log.error(`Tick failed: ${msg}`);
					this.setState('info.lastError', msg, true);
				})
				.finally(() => this.scheduleNextTick());
		}, delay);
	}

	async computeItemValue(item) {
		const mode = item.mode || 'formula';
		if (mode === 'source') {
			const id = item.sourceState ? String(item.sourceState) : '';
			return this.safeNum(this.cache.get(id));
		}

		const inputs = Array.isArray(item.inputs) ? item.inputs : [];
		/** @type {Record<string, number>} */
		const vars = {};

		for (const inp of inputs) {
			if (!inp || typeof inp !== 'object') continue;
			const keyRaw = inp.key ? String(inp.key).trim() : '';
			const key = keyRaw.replace(/[^a-zA-Z0-9_]/g, '_');
			if (!key) continue;
			const id = inp.sourceState ? String(inp.sourceState) : '';
			vars[key] = this.safeNum(this.cache.get(id));
		}

		const expr = item.formula ? String(item.formula).trim() : '';
		if (!expr) {
			return 0;
		}

		const result = this.evalFormula(expr, vars);
		return this.safeNum(result);
	}

	applyResultRules(item, value) {
		let v = this.safeNum(value);

		if (item && item.clamp) {
			const min = item.min !== undefined && item.min !== null ? Number(item.min) : NaN;
			const max = item.max !== undefined && item.max !== null ? Number(item.max) : NaN;
			if (Number.isFinite(min) && v < min) v = min;
			if (Number.isFinite(max) && v > max) v = max;
		}

		return v;
	}

	async runTick() {
		const start = Date.now();
		const items = Array.isArray(this.config.items) ? this.config.items : [];
		const enabledItems = items.filter(it => it && typeof it === 'object' && it.enabled);

		for (const item of enabledItems) {
			const targetId = this.getItemTargetId(item);
			if (!targetId) {
				continue;
			}

			try {
				const raw = await this.computeItemValue(item);
				const value = this.applyResultRules(item, raw);
				await this.setStateAsync(targetId, value, true);
			} catch (e) {
				const name = item.name || targetId;
				const msg = `${name}: ${e && e.message ? e.message : e}`;
				this.log.warn(`Compute failed: ${msg}`);
				await this.setStateAsync('info.lastError', msg, true);
			}
		}

		await this.setStateAsync('info.lastRun', new Date().toISOString(), true);
		await this.setStateAsync('info.evalTimeMs', Date.now() - start, true);
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
