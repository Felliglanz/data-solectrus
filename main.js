'use strict';

const utils = require('@iobroker/adapter-core');
const jsep = require('jsep');

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

		this.cache = new Map();
		this.cacheTs = new Map();
		this.currentSnapshot = null;
		this.tickTimer = null;
		this.isUnloading = false;
		this.jsonPathWarned = new Set();
		this.debugOnceKeys = new Set();

		this.formulaFunctions = {
			min: Math.min,
			max: Math.max,
			pow: Math.pow,
			abs: Math.abs,
			round: Math.round,
			floor: Math.floor,
			ceil: Math.ceil,
			// IF(condition, valueIfTrue, valueIfFalse)
			IF: (condition, valueIfTrue, valueIfFalse) => (condition ? valueIfTrue : valueIfFalse),
			if: (condition, valueIfTrue, valueIfFalse) => (condition ? valueIfTrue : valueIfFalse),
			clamp: (value, min, max) => {
				const v = Number(value);
				const lo = Number(min);
				const hi = Number(max);
				if (!Number.isFinite(v)) return 0;
				if (Number.isFinite(lo) && v < lo) return lo;
				if (Number.isFinite(hi) && v > hi) return hi;
				return v;
			},
			// Read a foreign state value by id from cache/snapshot (raw, but restricted to primitives).
			// This keeps formulas deterministic and avoids accidentally dragging large objects into evaluation.
			v: id => {
				const key = String(id);
				const val = (this.currentSnapshot && typeof this.currentSnapshot.get === 'function')
					? this.currentSnapshot.get(key)
					: this.cache.get(key);
				if (val === null || val === undefined) return val;
				const t = typeof val;
				if (t === 'string' || t === 'number' || t === 'boolean') return val;
				// Best-effort for Date-like values; everything else becomes empty string.
				if (val instanceof Date && typeof val.toISOString === 'function') return val.toISOString();
				this.debugOnce(`v_non_primitive|${key}`, `v("${key}") returned non-primitive (${t}); treating as empty string`);
				return '';
			},
			// Read a foreign state value by id from cache (sync, safe).
			s: id => {
				const key = String(id);
				if (this.currentSnapshot && typeof this.currentSnapshot.get === 'function') {
					return this.safeNum(this.currentSnapshot.get(key));
				}
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
		if (!path) return undefined;
		let p = String(path).trim();
		if (!p) return undefined;

		// Accept both "$.x" and ".x" as a convenience.
		if (p.startsWith('.')) {
			p = `$${p}`;
		}
		if (!p.startsWith('$')) {
			return undefined;
		}

		let cur = obj;
		let i = 1; // skip '$'
		const len = p.length;
		const isDangerousKey = k => k === '__proto__' || k === 'prototype' || k === 'constructor';
		while (i < len) {
			const ch = p[i];
			if (ch === '.') {
				i++;
				let start = i;
				while (i < len && /[A-Za-z0-9_]/.test(p[i])) i++;
				const key = p.slice(start, i);
				if (!key) return undefined;
				if (isDangerousKey(key)) return undefined;
				if (cur === null || cur === undefined) return undefined;
				cur = cur[key];
				continue;
			}
			if (ch === '[') {
				i++;
				while (i < len && /\s/.test(p[i])) i++;
				if (i >= len) return undefined;
				const quote = p[i] === '"' || p[i] === "'" ? p[i] : null;
				if (quote) {
					i++;
					let str = '';
					while (i < len) {
						const c = p[i];
						if (c === '\\') {
							if (i + 1 < len) {
								str += p[i + 1];
								i += 2;
								continue;
							}
							return undefined;
						}
						if (c === quote) {
							i++;
							break;
						}
						str += c;
						i++;
					}
					while (i < len && /\s/.test(p[i])) i++;
					if (p[i] !== ']') return undefined;
					i++;
					if (isDangerousKey(str)) return undefined;
					if (cur === null || cur === undefined) return undefined;
					cur = cur[str];
					continue;
				}

				// array index
				let start = i;
				while (i < len && /[0-9]/.test(p[i])) i++;
				const numStr = p.slice(start, i);
				while (i < len && /\s/.test(p[i])) i++;
				if (p[i] !== ']') return undefined;
				i++;
				const idx = Number(numStr);
				if (!Number.isInteger(idx)) return undefined;
				if (!Array.isArray(cur)) return undefined;
				cur = cur[idx];
				continue;
			}

			// Unknown token
			return undefined;
		}
		return cur;
	}

	analyzeAst(ast) {
		const maxNodes = this.MAX_AST_NODES;
		const maxDepth = this.MAX_AST_DEPTH;
		let nodes = 0;
		let depthMax = 0;
		/** @type {{node:any, depth:number}[]} */
		const stack = [{ node: ast, depth: 1 }];
		while (stack.length) {
			const entry = stack.pop();
			const node = entry && entry.node;
			const depth = entry && entry.depth ? entry.depth : 1;
			if (!node || typeof node !== 'object') continue;
			nodes++;
			if (depth > depthMax) depthMax = depth;
			if (nodes > maxNodes) {
				throw new Error(`Expression too complex (>${maxNodes} nodes)`);
			}
			if (depthMax > maxDepth) {
				throw new Error(`Expression too deeply nested (>${maxDepth})`);
			}

			switch (node.type) {
				case 'BinaryExpression':
				case 'LogicalExpression':
					stack.push({ node: node.right, depth: depth + 1 });
					stack.push({ node: node.left, depth: depth + 1 });
					break;
				case 'UnaryExpression':
					stack.push({ node: node.argument, depth: depth + 1 });
					break;
				case 'ConditionalExpression':
					stack.push({ node: node.alternate, depth: depth + 1 });
					stack.push({ node: node.consequent, depth: depth + 1 });
					stack.push({ node: node.test, depth: depth + 1 });
					break;
				case 'CallExpression': {
					const args = Array.isArray(node.arguments) ? node.arguments : [];
					for (let i = args.length - 1; i >= 0; i--) {
						stack.push({ node: args[i], depth: depth + 1 });
					}
					// callee is an Identifier in allowed expressions; no need to traverse.
					break;
				}
				default:
					break;
			}
		}
		return { nodes, depth: depthMax };
	}

	getNumericFromJsonPath(rawValue, jsonPath, warnKeyPrefix = '') {
		const jp = jsonPath !== undefined && jsonPath !== null ? String(jsonPath).trim() : '';
		if (!jp) {
			return this.safeNum(rawValue);
		}

		// Be forgiving: if the value is already numeric-ish, just use it.
		// This allows mixed setups where a state sometimes is numeric and sometimes JSON-string.
		if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
			this.debugOnce(
				`jsonpath_skipped_numeric|${warnKeyPrefix || ''}`,
				`JSONPath '${jp}' skipped because source value is already ${typeof rawValue} (${warnKeyPrefix || 'no-prefix'})`
			);
			return this.safeNum(rawValue);
		}

		let obj = null;
		if (rawValue && typeof rawValue === 'object') {
			obj = rawValue;
		} else if (typeof rawValue === 'string') {
			const s = rawValue.trim();
			if (!s) {
				this.warnOnce(`${warnKeyPrefix}|empty`, `JSONPath configured but source value is empty (${jp})`);
				return 0;
			}
			try {
				obj = JSON.parse(s);
			} catch (e) {
				this.warnOnce(
					`${warnKeyPrefix}|parse`,
					`Cannot parse JSON for JSONPath ${jp}: ${e && e.message ? e.message : e}`
				);
				return 0;
			}
		} else {
			this.warnOnce(`${warnKeyPrefix}|type`, `JSONPath configured but source value is not JSON (${typeof rawValue}) (${jp})`);
			return 0;
		}

		const extracted = this.applyJsonPath(obj, jp);
		if (extracted === undefined) {
			this.warnOnce(`${warnKeyPrefix}|path`, `JSONPath did not match any value: ${jp}`);
			return 0;
		}
		return this.safeNum(extracted);
	}

	/**
	 * Normalizes some common non-JS formula syntax into the JS-like operators that `jsep` understands.
	 * - AND/OR/NOT (case-insensitive) -> && / || / !
	 * - single '=' (outside strings) -> '=='
	 *
	 * This is intentionally conservative and only runs outside quoted strings.
	 */
	normalizeFormulaExpression(expr) {
		let s = String(expr);
		if (!s) return s;

		let out = '';
		let inSingle = false;
		let inDouble = false;
		let escaped = false;

		const isWordChar = c => /[A-Za-z0-9_]/.test(c);
		const at = i => (i >= 0 && i < s.length ? s[i] : '');
		const matchWordAt = (i, word) => {
			// assumes already outside quotes
			const w = String(word);
			if (s.substr(i, w.length).toUpperCase() !== w.toUpperCase()) return false;
			const prev = at(i - 1);
			const next = at(i + w.length);
			if (prev && isWordChar(prev)) return false;
			if (next && isWordChar(next)) return false;
			return true;
		};

		for (let i = 0; i < s.length; i++) {
			const ch = s[i];

			if (escaped) {
				out += ch;
				escaped = false;
				continue;
			}
			if (ch === '\\') {
				out += ch;
				escaped = true;
				continue;
			}

			if (!inDouble && ch === "'") {
				inSingle = !inSingle;
				out += ch;
				continue;
			}
			if (!inSingle && ch === '"') {
				inDouble = !inDouble;
				out += ch;
				continue;
			}

			if (inSingle || inDouble) {
				out += ch;
				continue;
			}

			// AND/OR/NOT keywords
			if (matchWordAt(i, 'AND')) {
				out += '&&';
				i += 2;
				continue;
			}
			if (matchWordAt(i, 'OR')) {
				out += '||';
				i += 1;
				continue;
			}
			if (matchWordAt(i, 'NOT')) {
				out += '!';
				i += 2;
				continue;
			}

			// single '=' -> '==' (but keep ==, ===, !=, <=, >=)
			if (ch === '=') {
				const prev = at(i - 1);
				const next = at(i + 1);
				const prevIsGuard = prev === '=' || prev === '!' || prev === '<' || prev === '>';
				if (!prevIsGuard && next !== '=') {
					out += '==';
					continue;
				}
			}

			out += ch;
		}

		return out;
	}

	evalFormula(expr, vars) {
		const normalized = this.normalizeFormulaExpression(expr);
		if (normalized && normalized.length > this.MAX_FORMULA_LENGTH) {
			throw new Error(`Formula too long (>${this.MAX_FORMULA_LENGTH} chars)`);
		}
		const ast = jsep(String(normalized));
		this.analyzeAst(ast);
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
						case '&&':
							return left && right;
						case '||':
							return left || right;
						case '==':
							// loose equality intentionally supported for compatibility with other formula engines
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
		this.cacheTs.set(id, typeof state.ts === 'number' ? state.ts : Date.now());
	}

	getUseSnapshotReads() {
		return !!(this.config && this.config.snapshotInputs);
	}

	getSnapshotDelayMs() {
		const raw = this.config && this.config.snapshotDelayMs !== undefined ? this.config.snapshotDelayMs : 0;
		const ms = Number(raw);
		return Number.isFinite(ms) && ms >= 0 && ms <= 5000 ? Math.round(ms) : 0;
	}

	async buildSnapshotForTick(items) {
		const validItems = Array.isArray(items) ? items.filter(it => it && typeof it === 'object') : [];
		const sourceIds = new Set();
		for (const item of validItems) {
			for (const id of this.collectSourceStatesFromItem(item)) {
				sourceIds.add(id);
			}
		}

		if (this.getUseSnapshotReads()) {
			const delay = this.getSnapshotDelayMs();
			if (delay) {
				await new Promise(resolve => setTimeout(resolve, delay));
			}
			await Promise.all(
				Array.from(sourceIds).map(async id => {
					try {
						const st = await this.getForeignStateAsync(id);
						if (st) {
							this.cache.set(id, st.val);
							this.cacheTs.set(id, typeof st.ts === 'number' ? st.ts : Date.now());
						}
					} catch {
						// ignore per-id read errors
					}
				})
			);
		}

		/** @type {Map<string, any>} */
		const snapshot = new Map();
		for (const id of sourceIds) {
			snapshot.set(id, this.cache.get(id));
		}
		return snapshot;
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
			// Also allow s("...") / v("...") in formula; discover these ids so snapshot/subscriptions can include them.
			const expr = item.formula ? String(item.formula) : '';
			if (expr) {
				const max = this.MAX_DISCOVERED_STATE_IDS_PER_ITEM;
				let added = 0;
				const re = /\b(?:s|v)\(\s*(['"])([^'"\n\r]+)\1\s*\)/g;
				let m;
				while ((m = re.exec(expr)) !== null) {
					const sid = (m[2] || '').trim();
					if (!sid) continue;
					ids.push(sid);
					added++;
					if (added >= max) {
						const itemId = this.getItemDisplayId(item) || (item && item.name ? String(item.name) : 'item');
						this.warnOnce(
							`discover_ids_limit|${itemId}`,
							`Formula contains many s()/v() state reads; limiting discovered ids to ${max} for '${itemId}'`
						);
						break;
					}
				}
			}
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

	async computeItemValue(item, snapshot) {
		const mode = item.mode || 'formula';
		if (mode === 'source') {
			const id = item.sourceState ? String(item.sourceState) : '';
			const raw = snapshot ? snapshot.get(id) : this.cache.get(id);
			let v = this.getNumericFromJsonPath(raw, item && item.jsonPath, `item|${id}|${item && item.targetId ? item.targetId : ''}`);
			// Apply noNegative already at input/source time as well
			if (item && item.noNegative && v < 0) {
				v = 0;
			}
			return v;
		}

		const inputs = Array.isArray(item.inputs) ? item.inputs : [];
		/** @type {Record<string, number>} */
		const vars = Object.create(null);

		for (const inp of inputs) {
			if (!inp || typeof inp !== 'object') continue;
			const keyRaw = inp.key ? String(inp.key).trim() : '';
			const key = keyRaw.replace(/[^a-zA-Z0-9_]/g, '_');
			if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
				const itemId = this.getItemDisplayId(item) || (item && item.name ? String(item.name) : '');
				this.debugOnce(
					`blocked_input_key|${itemId}|${key}`,
					`Blocked dangerous input key '${keyRaw}' (sanitized to '${key}') for item '${itemId}'`
				);
				continue;
			}
			if (!key) continue;
			const id = inp.sourceState ? String(inp.sourceState) : '';
			const raw = snapshot ? snapshot.get(id) : this.cache.get(id);
			let v = this.getNumericFromJsonPath(raw, inp && inp.jsonPath, `input|${id}|${key}`);
			// Clamp negative inputs BEFORE formula evaluation.
			// - item.noNegative: global for this item
			// - inp.noNegative: only this input
			if (((item && item.noNegative) || (inp && inp.noNegative)) && v < 0) {
				v = 0;
			}
			vars[key] = v;
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

	castValueForItemType(item, value) {
		const t = item && item.type ? String(item.type) : '';
		if (t === 'boolean') {
			// ioBroker boolean states should receive real booleans.
			const n = this.safeNum(value);
			return n !== 0;
		}
		if (t === 'string') {
			// Always write a real string.
			if (value === undefined || value === null) return '';
			return String(value);
		}
		// number/mixed (and default)
		return value;
	}

	async runTick() {
		const start = Date.now();
		const items = Array.isArray(this.config.items) ? this.config.items : [];
		const enabledItems = items.filter(it => it && typeof it === 'object' && it.enabled);

		// Keep status in sync even if config changes without a restart
		await this.setStateAsync('info.itemsConfigured', items.filter(it => it && typeof it === 'object').length, true);
		await this.setStateAsync('info.itemsEnabled', enabledItems.length, true);
		await this.setStateAsync('info.status', enabledItems.length ? 'ok' : 'no_items_enabled', true);

		const snapshot = await this.buildSnapshotForTick(items);
		this.currentSnapshot = snapshot;

		for (const item of enabledItems) {
			const targetId = this.getItemOutputId(item);
			if (!targetId) {
				continue;
			}

			try {
				const raw = await this.computeItemValue(item, snapshot);
				const valueNum = this.applyResultRules(item, raw);
				const value = this.castValueForItemType(item, valueNum);
				await this.setStateAsync(targetId, value, true);
			} catch (e) {
				const name = item.name || targetId;
				const msg = `${name}: ${e && e.message ? e.message : e}`;
				this.log.warn(`Compute failed: ${msg}`);
				await this.setStateAsync('info.lastError', msg, true);
			}
		}

		this.currentSnapshot = null;

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
