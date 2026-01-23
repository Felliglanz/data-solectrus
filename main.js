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
		const displayId = this.getItemDisplayId(item);
		const name = (item && item.name) ? String(item.name) : (displayId || 'Item');
		return `${enabled ? '🟢 ' : '⚪ '}${name}`;
	}

	getItemDisplayId(item) {
		const group = item && item.group ? String(item.group).trim() : '';
		const targetId = item && item.targetId ? String(item.targetId).trim() : '';
		if (group && targetId) return `${group}.${targetId}`;
		return targetId || group;
	}

	ensureTitle(item) {
		return { ...(item || {}), _title: this.calcTitle(item || {}) };
	}

	async ensureItemTitlesInInstanceConfig() {
		try {
			const objId = `system.adapter.${this.namespace}`;
			const obj = await this.getForeignObjectAsync(objId);
			if (!obj || !obj.native) {
				return;
			}

			const items = Array.isArray(obj.native.items) ? obj.native.items : [];
			const itemsEditor = Array.isArray(obj.native.itemsEditor) ? obj.native.itemsEditor : [];
			const active = items.length ? items : itemsEditor;
			if (!Array.isArray(active)) {
				return;
			}

			let changed = false;
			active.forEach(it => {
				if (!it || typeof it !== 'object') return;
				const expectedTitle = this.calcTitle(it);
				if (it._title !== expectedTitle) {
					it._title = expectedTitle;
					changed = true;
				}
			});

			// If Admin stored items under `itemsEditor`, migrate them back into `items`
			// so the runtime + fallback table see the same config.
			if (items.length === 0 && itemsEditor.length > 0) {
				obj.native.items = itemsEditor;
				changed = true;
			}

			if (changed) {
				await this.setForeignObjectAsync(objId, obj);
			}
		} catch (e) {
			this.log.debug(`Cannot migrate item titles: ${e}`);
		}
	}

	async createInfoStates() {
		await this.setObjectNotExistsAsync('info.status', {
			type: 'state',
			common: {
				name: 'Status',
				type: 'string',
				role: 'text',
				read: true,
				write: false,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync('info.itemsConfigured', {
			type: 'state',
			common: {
				name: 'Configured items',
				type: 'number',
				role: 'value',
				read: true,
				write: false,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync('info.itemsEnabled', {
			type: 'state',
			common: {
				name: 'Enabled items',
				type: 'number',
				role: 'value',
				read: true,
				write: false,
			},
			native: {},
		});

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

		await this.setStateAsync('info.status', 'starting', true);
		await this.setStateAsync('info.itemsConfigured', 0, true);
		await this.setStateAsync('info.itemsEnabled', 0, true);
		await this.setStateAsync('info.lastError', '', true);
		await this.setStateAsync('info.lastRun', '', true);
		await this.setStateAsync('info.evalTimeMs', 0, true);
	}

	async onReady() {
		this.isUnloading = false;
		await this.createInfoStates();

		// Config compatibility: some Admin/jsonConfig schema versions may store custom-control data
		// under the control name (e.g. itemsEditor). Always prefer native.items but fall back.
		const items = Array.isArray(this.config.items) ? this.config.items : [];
		const itemsEditor = Array.isArray(this.config.itemsEditor) ? this.config.itemsEditor : [];
		this.config.items = items.length ? items : itemsEditor;

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

	isValidRelativeId(id) {
		if (!id) return false;
		const raw = String(id).trim();
		if (!raw) return false;
		// No absolute IDs; must be relative within this adapter
		if (raw.includes('..') || raw.startsWith('.') || raw.endsWith('.')) return false;
		// Keep it conservative: segments of [a-zA-Z0-9_-] separated by dots
		return /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(raw);
	}

	getItemTargetId(item) {
		const raw = item && item.targetId ? String(item.targetId).trim() : '';
		if (!raw) return '';
		return this.isValidRelativeId(raw) ? raw : '';
	}

	getItemGroupId(item) {
		const raw = item && item.group ? String(item.group).trim() : '';
		if (!raw) return '';
		return this.isValidRelativeId(raw) ? raw : '';
	}

	getItemOutputId(item) {
		const group = this.getItemGroupId(item);
		const targetId = this.getItemTargetId(item);
		if (!targetId) return '';
		return group ? `${group}.${targetId}` : targetId;
	}

	async ensureChannelPath(id) {
		const raw = id ? String(id).trim() : '';
		if (!raw) return;
		const parts = raw.split('.').filter(Boolean);
		if (parts.length <= 1) return;

		let prefix = '';
		for (let i = 0; i < parts.length - 1; i++) {
			prefix = prefix ? `${prefix}.${parts[i]}` : parts[i];
			await this.setObjectNotExistsAsync(prefix, {
				type: 'channel',
				common: {
					name: parts[i],
				},
				native: {},
			});
		}
	}

	async ensureOutputState(item) {
		const id = this.getItemOutputId(item);
		if (!id) return;

		await this.ensureChannelPath(id);

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
		const validItems = items.filter(it => it && typeof it === 'object');
		const enabledItems = validItems.filter(it => !!it.enabled);

		await this.setStateAsync('info.itemsConfigured', validItems.length, true);
		await this.setStateAsync('info.itemsEnabled', enabledItems.length, true);

		for (const item of validItems) {
			await this.ensureOutputState(item);
		}

		const sourceIds = new Set();
		for (const item of validItems) {
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

		if (enabledItems.length === 0) {
			const msg = 'No item is enabled. Please enable at least one item in the adapter configuration.';
			this.log.warn(msg);
			await this.setStateAsync('info.status', 'no_items_enabled', true);
		} else {
			await this.setStateAsync('info.status', 'ok', true);
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

		const toOptionalNumber = val => {
			if (val === undefined || val === null) return NaN;
			if (typeof val === 'string' && val.trim() === '') return NaN;
			const n = Number(val);
			return Number.isFinite(n) ? n : NaN;
		};

		if (item && item.noNegative && v < 0) {
			v = 0;
		}

		if (item && item.clamp) {
			const min = toOptionalNumber(item.min);
			const max = toOptionalNumber(item.max);
			if (Number.isFinite(min) && v < min) v = min;
			if (Number.isFinite(max) && v > max) v = max;
		}

		return v;
	}

	async runTick() {
		const start = Date.now();
		const items = Array.isArray(this.config.items) ? this.config.items : [];
		const enabledItems = items.filter(it => it && typeof it === 'object' && it.enabled);

		// Keep status in sync even if config changes without a restart
		await this.setStateAsync('info.itemsConfigured', items.filter(it => it && typeof it === 'object').length, true);
		await this.setStateAsync('info.itemsEnabled', enabledItems.length, true);
		await this.setStateAsync('info.status', enabledItems.length ? 'ok' : 'no_items_enabled', true);

		for (const item of enabledItems) {
			const targetId = this.getItemOutputId(item);
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
