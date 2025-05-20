import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec, execSync } from 'child_process';
import metax from './metax_lib.mjs';

/* ───────── configuration ───────── */

const METAX_HOST          = 'instigate.academy:542';
const KEY_FILE            = '/builds/erp_runner/certs/private_key.pem';
const CERT_FILE           = '/builds/erp_runner/certs/silva_certificate.pem';
const hostname = os.hostname();

const PROJECT_BRANCH_UUID = '47a08f3f-55c0-45ad-89b4-aeae906c104f-48081be1-44e6-4c83-b035-1c43a589990f';
const RESULT_ELEMENT_TYPE = '3e628e66-aff8-4d32-8b77-1c6a46626be3-fc918307-36ac-45d7-9ec6-c7894084b62d';

/* ───────── helpers: time + shell ───────── */

function armenianTime(d = new Date()) {
	return d.toLocaleString('hy-AM', {
		timeZone: 'Asia/Yerevan',
		year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit', second: '2-digit'
	});
}

function run(cmd, label = '') {
	return new Promise((resolve, reject) => {
		console.log(`\n--- ${label} ---\n${cmd}\n`);
		exec(cmd, { shell: '/bin/bash', maxBuffer: 10 * 1024 * 1024 },
				(err, stdout, stderr) => {
					if (stderr) console.error(stderr);
					if (stdout) console.log(stdout);
					err ? reject(err) : resolve(stdout);
				});
	});
}

function runCapture(cmd, label = '') {
	return new Promise((resolve, reject) => {
		console.log(`\n--- ${label} ---\n${cmd}\n`);
		exec(cmd, { shell: '/bin/bash', maxBuffer: 10 * 1024 * 1024 },
				(err, stdout, stderr) => {
					if (stderr) console.error(stderr);
					err ? reject(err) : resolve(stdout);
				});
	});
}

/* ───────── resilient metax.update ───────── */

async function updateResilient(uuid, jsonString) {
	try {
		await metax.update(uuid, jsonString, 'application/json');
	} catch (e) {
		if (e.code !== 'ERR_HTTP2_INVALID_SESSION') throw e;
		console.warn('Session died, retrying update in helper process');
		const helper = path.join(os.tmpdir(), `metax_updater_${Date.now()}.mjs`);
		fs.writeFileSync(helper, `
				import fs from 'fs';
				import metax from '${path.resolve('./metax_lib.mjs').replace(/\\/g,'\\\\')}';
				await metax.connect(
					'${METAX_HOST}',
					fs.readFileSync('${KEY_FILE}'),
					fs.readFileSync('${CERT_FILE}'),
					''
					);
				await metax.update('${uuid}', ${JSON.stringify(jsonString)}, 'application/json');
				process.exit(0);
				`, { mode: 0o600 });
		try {
			execSync(`node ${helper}`, { stdio: 'inherit' });
		} finally {
			fs.unlinkSync(helper);
		}
	}
}

/* ───────── result and state ───────── */

let resultObj       = null;
let projectRev      = 'unknown';
let stopped         = false;
let checkoutDirPath = null;
let projectId       = null;

/* ───────── create initial Metax result ───────── */

async function createInitialResult(startTime) {
	const obj = {
		name            : `${projectId}`,
		status          : 'running',
		host            : hostname,
		time_start      : armenianTime(startTime),
		time_finish     : '',
		test_result	: '',
		type            : RESULT_ELEMENT_TYPE,
		uuid            : '',
		project_revision: projectRev
	};
	resultObj = obj;

	obj.uuid = await metax.save(JSON.stringify(obj), 'application/json');
	await updateResilient(obj.uuid, JSON.stringify(obj));

	const branch = JSON.parse(await metax.get(PROJECT_BRANCH_UUID));
	branch.result_representation = branch.result_representation || [];
	branch.result_representation.push(obj.uuid);
	await updateResilient(PROJECT_BRANCH_UUID, JSON.stringify(branch));
}

/* ───────── finalize and update Metax ───────── */

async function finalize(status, exitCode) {
	//copyNewItemsToWork(checkoutDirPath);

	if (!resultObj) process.exit(exitCode);

	resultObj.status           = status;
	resultObj.time_finish      = armenianTime();
	resultObj.project_revision = projectRev;
	resultObj.host             = hostname;

	await updateResilient(resultObj.uuid, JSON.stringify(resultObj));
	process.exit(exitCode);
}

async function failAndExit(msg)    { await finalize(msg, 1); }
async function successAndExit()    { await finalize('success', 0); }

/* ───────── signal handlers ───────── */

process.on('SIGINT',  () => { if (!stopped) { stopped = true; failAndExit('failed (manual stop)'); }});
process.on('SIGTERM', () => { if (!stopped) { stopped = true; failAndExit('failed (manual stop)'); }});

/* ───────── SVN revision helper ───────── */

async function getSvnRevision(svnCmd) {
	return new Promise(resolve => {
		const args = svnCmd.trim().split(/\s+/).filter(p => !p.startsWith('-'));
		if (args.length < 2) return resolve('unknown');
		const last = args[args.length - 1];
		const wc   = /^[a-z]+:\/\//i.test(last)
			? path.basename(last.replace(/@[\d]+$/, '').replace(/\/+$/, ''))
			: last;
		const cwd  = path.resolve(wc);

		const fallback = () =>
			exec('svn info', { cwd, shell: '/bin/bash' }, (e, out) => {
				if (e) return resolve('unknown');
				const line = out.split('\n').find(l => l.startsWith('Revision:'));
				resolve(line ? line.split(':')[1].trim() : 'unknown');
			});

		exec('svn info --show-item revision', { cwd, shell: '/bin/bash' },
				(err, out) => {
					if (err) return fallback();
					const rev = out.toString().trim();
					rev ? resolve(rev) : fallback();
				});
	});
}

/* ───────── main driver ───────── */

(async () => {
	const CONFIG_ID = process.env.CONFIG_ID || 'your-default-config-uuid';
	const startTime = new Date();

	// initial connect
	await metax.connect(
			METAX_HOST,
			fs.readFileSync(KEY_FILE),
			fs.readFileSync(CERT_FILE),
			''
			);

	const cfg = JSON.parse(await metax.get(CONFIG_ID));
	const steps = [
	{ label: 'Repository Checkout', command: cfg.repository_path },
	{ label: 'Setup Command',       command: cfg.setup_cmd },
	{ label: 'Pre make',            command: cfg.pre_make },
		{ label: 'Build Command',       command: cfg.build_cmd },
		{ label: 'Test',                command: cfg.tst_cmd }
	];

	for (const step of steps) {
		if (!step.command || !step.command.trim()) {
			console.log(`Skipping ${step.label} — no command`);
			continue;
		}

		try {
			switch (step.label) {

				case 'Repository Checkout':
					await run(step.command, step.label);

					{
						const parts = step.command.trim().split(/\s+/).filter(p => !p.startsWith('-'));
						const last  = parts[parts.length - 1];
						const dir   = /^[a-z]+:\/\//i.test(last)
							? path.basename(last.replace(/@[\d]+$/, '').replace(/\/+$/, ''))
							: last;
						checkoutDirPath = path.resolve(dir);
						projectId       = dir;
					}

					projectRev = await getSvnRevision(step.command);
					await createInitialResult(startTime);
					break;

				case 'Setup Command':
					try {
						await run(`cd "${checkoutDirPath}" && ${step.command}`, step.label);
					} catch (e) {
						console.error(`${step.label} failed: ${e.message}`);
						await failAndExit('Setup failed');
					}
					break;

				case 'Pre make':
					try {
						await run(`cd "${checkoutDirPath}" && ${step.command}`, step.label);
					} catch (e) {
						console.error(`${step.label} failed: ${e.message}`);
						await failAndExit('Pre-make failed');
					}
					break;

				case 'Build Command':
					try {
						await run(`cd "${checkoutDirPath}" && ${step.command}`, step.label);
					} catch (e) {
						console.error(`${step.label} failed: ${e.message}`);
						await failAndExit('Build failed');
					}
					break;


				case 'Test': {
					try {
						// 1) Run your test command (single-threaded)
						const serialCmd = step.command.replace(/-j\d+/, '-j1');
						const raw = await runCapture(
								`cd "${checkoutDirPath}" && ${serialCmd}`,
								step.label
								);

						// 2) Parse failures
						const clean = raw.replace(/\x1b\[[0-9;]*m/g, '');
						const m = clean.match(/Failed\s*[-–]\s*(\d+)/i);
						const fails = m ? parseInt(m[1], 10) : 0;

						// 3) If the timing HTML was generated, save & attach it
						const timingFile = path.join(checkoutDirPath, 'test_maintenance.html');
						if (fs.existsSync(timingFile)) {
							const blob     = fs.readFileSync(timingFile);
							const fileUuid = await metax.save(blob, 'text/html');
							const fileLink = `https://${METAX_HOST}/db/get?id=${fileUuid}`;
							resultObj.test_result = fileLink;
							await updateResilient(resultObj.uuid, JSON.stringify(resultObj));
							console.log(`Attached timing HTML → ${fileLink}`);
						} else {
							console.warn('No test_maintenance.html found, skipping attachment.');
						}

						// 4) Bail out on failures
						if (fails > 0) {
							return await failAndExit(`Testing failed (${fails})`);
						}
						console.log('All tests passed.');
					} catch (err) {
						return await failAndExit(`Test step error: ${err.message}`);
					}
				}





				default:
					     console.warn(`Unknown step "${step.label}"`);
			}
		} catch (e) {
			console.error(`${step.label} failed: ${e.message}`);
			await failAndExit(`${step.label} failed`);
		}
	}

	await successAndExit();
})().catch(async e => {
	console.error('Unhandled error:', e);
	await failAndExit('unexpected failure');
});

