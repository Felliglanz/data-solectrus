'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function listJsFiles(dirPath) {
	const entries = fs.readdirSync(dirPath, { withFileTypes: true });
	return entries
		.filter(e => e.isFile() && e.name.endsWith('.js'))
		.map(e => path.join(dirPath, e.name));
}

function checkFile(filePath) {
	const res = spawnSync(process.execPath, ['-c', filePath], { stdio: 'inherit' });
	if (res.status !== 0) {
		throw new Error(`Syntax check failed: ${filePath}`);
	}
}

function main() {
	const root = path.resolve(__dirname, '..');
	const files = [
		path.join(root, 'main.js'),
		path.join(root, 'lib', 'formula.js'),
		path.join(root, 'lib', 'jsonpath.js'),
		...listJsFiles(path.join(root, 'lib', 'services')),
		path.join(root, 'scripts', 'lint-syntax.js'),
		path.join(root, 'scripts', 'smoke-runtime.js'),
	];

	for (const f of files) {
		checkFile(f);
	}
}

try {
	main();
} catch (e) {
	console.error(e && e.message ? e.message : String(e));
	process.exitCode = 1;
}
