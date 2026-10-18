/**
 * Records a real, isolated synthetic PARALLAX session in a local production app.
 * Usage: PARALLAX_DEMO_URL=http://127.0.0.1:3001 node demo/record.mjs
 * The recording overlays only title cards, a cursor, and truthful capture labels.
 * All investigations, decisions, task evidence, verification and navigation use
 * the actual product UI. No product result is substituted or fabricated.
 * An installed Playwright runtime and @sparticuz/chromium are required.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import chromium from '@sparticuz/chromium';

const run = promisify(execFile);
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = path.join(projectDir, 'demo', 'raw');
const captureDir = path.join(rawDir, 'capture');
const framesDir = path.join(rawDir, `frames-${Date.now()}`);
const baseURL = process.env.PARALLAX_DEMO_URL || 'http://127.0.0.1:3001';
const runtime = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium: playwright } = await import(runtime);
const mode = process.argv.includes('--preview-cards') ? 'preview' : process.argv.includes('--rehearse') ? 'rehearse' : 'record';
await fs.mkdir(captureDir, { recursive: true });
await fs.mkdir(framesDir, { recursive: true });
const cards = await fs.readFile(path.join(projectDir, 'demo', 'cards.html'), 'utf8');
const style = cards.match(/<style>([\s\S]*?)<\/style>/)[1];
const markup = cards.match(/<body>([\s\S]*?)<\/body>/)[1];
const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1,
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [];
const requests = [];
const chapters = [];
const screenshots = [];
let filmStart;
let cdp;
let frameNumber = 0;
const frameRecords = [];
const pendingFrames = new Set();
let initialFrame;

async function storeFrame(data, receivedAt, initial = false) {
  const number = frameNumber++;
  const file = path.join(framesDir, `${String(number).padStart(6, '0')}.jpg`);
  frameRecords.push({ file, receivedAt, initial });
  await fs.writeFile(file, Buffer.from(data, 'base64'));
  return file;
}
async function beginFrameCapture() {
  cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', event => {
    const receivedAt = performance.now();
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
    const pending = storeFrame(event.data, receivedAt);
    pendingFrames.add(pending);
    pending.finally(() => pendingFrames.delete(pending));
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1600, maxHeight: 900, everyNthFrame: 1 });
  // Establish a real rendered opening frame before the narration clock begins.
  const opening = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, fromSurface: true, captureBeyondViewport: false });
  initialFrame = await storeFrame(opening.data, performance.now(), true);
}
async function endFrameCapture(duration, basename) {
  await cdp.send('Page.stopScreencast');
  await Promise.all([...pendingFrames]);
  const records = [{ file: initialFrame, time: 0 }, ...frameRecords
    .filter(item => !item.initial && item.receivedAt >= filmStart && item.receivedAt < filmStart + duration * 1000)
    .map(item => ({ file: item.file, time: (item.receivedAt - filmStart) / 1000 }))]
    .sort((a, b) => a.time - b.time);
  // JPEG inputs have a 1/25 time base in the concat demuxer. Quantize against
  // the narration clock first; sub-frame durations otherwise accumulate drift.
  const sampled = [];
  let sourceIndex = 0;
  for (let index = 0; index < Math.ceil(duration * 25); index++) {
    const time = index / 25;
    while (sourceIndex + 1 < records.length && records[sourceIndex + 1].time <= time) sourceIndex++;
    const file = records[sourceIndex].file;
    if (sampled.at(-1)?.file === file) sampled.at(-1).count++;
    else sampled.push({ file, count: 1 });
  }
  const manifest = ['ffconcat version 1.0'];
  for (const item of sampled) manifest.push(`file '${item.file}'`, `duration ${(item.count / 25).toFixed(2)}`);
  manifest.push(`file '${sampled.at(-1).file}'`);
  const manifestPath = path.join(rawDir, `${basename}.ffconcat`);
  await fs.writeFile(manifestPath, manifest.join('\n') + '\n');
  const output = path.join(rawDir, `${basename}.mp4`);
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', manifestPath, '-t', String(duration), '-r', '25', '-fps_mode', 'cfr', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output], { maxBuffer: 4 * 1024 * 1024 });
  const probe = async () => JSON.parse((await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,nb_frames:format=duration,size', '-of', 'json', output])).stdout);
  let encoded = await probe();
  // The concat demuxer can omit the last still's hold at the -t boundary.
  // Pad the encoded real closing frame, which has a continuous 25 fps timeline.
  if (Number(encoded.format.duration) < duration - 0.041) {
    const padded = path.join(rawDir, `${basename}-padded.mp4`);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', output, '-vf', `tpad=stop_mode=clone:stop_duration=${duration - Number(encoded.format.duration) + 0.1}`, '-t', String(duration), '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', padded], { maxBuffer: 4 * 1024 * 1024 });
    await fs.rename(padded, output);
    encoded = await probe();
  }
  const actualDuration = Number(encoded.format.duration);
  const stream = encoded.streams[0];
  if (Math.abs(actualDuration - duration) > 0.041 || stream.width !== 1600 || stream.height !== 900 || stream.r_frame_rate !== '25/1') {
    throw new Error(`Encoded recording failed duration or format verification: ${JSON.stringify(encoded)}`);
  }
  await run('ffmpeg', ['-v', 'error', '-i', output, '-f', 'null', '-'], { maxBuffer: 4 * 1024 * 1024 });
  return { output, frameCount: records.length, duration: actualDuration, encoded, captureMethod: 'Real Chromium CDP JPEG frames, timestamped on receipt against the narration clock' };
}
page.on('pageerror', error => errors.push(error.message));
page.on('response', async response => {
  const u = new URL(response.url());
  if (!u.pathname.startsWith('/api/')) return;
  if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${u.pathname}`);
  if (response.request().method() === 'POST') {
    requests.push({ path: u.pathname.replace(/case_[^/]+/g, ':case').replace(/decision_[^/]+_task_\d+/g, ':task'), status: response.status(), time: filmStart ? +(performance.now() - filmStart).toFixed(0) / 1000 : null });
  }
});

function mark(name) {
  const time = +(Math.max(0, performance.now() - filmStart) / 1000).toFixed(3);
  chapters.push({ name, time });
  console.log(JSON.stringify({ chapter: name, time }));
}
async function at(seconds) {
  if (mode === 'rehearse') return page.waitForTimeout(150);
  const remaining = seconds * 1000 - (performance.now() - filmStart);
  if (remaining < -2000) throw new Error(`Recording action exceeded its timing by ${Math.round(-remaining)}ms before ${seconds}s`);
  // Each wait stays below sixty seconds so the caller can continue communicating.
  if (remaining > 0) await page.waitForTimeout(remaining);
}
async function scene(name, step = '') {
  await page.evaluate(({ name, step }) => {
    const stage = document.getElementById('film-stage');
    stage.dataset.scene = name;
    stage.dataset.step = step;
    stage.classList.toggle('is-visible', !!name);
    document.getElementById('film-cursor').style.opacity = name ? '0' : '1';
  }, { name, step });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function shot(name) {
  if (mode === 'preview') return page.screenshot({ path: path.join(rawDir, `${name}.png`) });
  // Extract stills from the completed recording. CDP screenshots can stall a
  // browser's screencast, which would introduce a timing artifact in the film.
  screenshots.push({ name, time: +(Math.max(0, performance.now() - filmStart) / 1000).toFixed(3) });
}
async function scrollTo(target, offset = 95) {
  await target.evaluate((element, top) => window.scrollTo({ top: Math.max(0, window.scrollY + element.getBoundingClientRect().top - top), behavior: 'smooth' }), offset);
  await page.waitForTimeout(620);
}
async function moveTo(target, options = {}) {
  const box = await target.boundingBox();
  if (!box) throw new Error('The target is not visible');
  if (box.y < 68 || box.y + box.height > 835) await scrollTo(target, options.offset || 330);
  const b = await target.boundingBox();
  await page.mouse.move(b.x + b.width * .55, b.y + b.height * .52, { steps: 24 });
  return b;
}
async function click(target, options = {}) {
  await target.waitFor({ state: 'visible' });
  await moveTo(target, options);
  await page.waitForTimeout(100);
  await target.click();
}
async function park() { await page.mouse.move(1536, 796, { steps: 22 }); }
const nav = name => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true });

try {
  if (mode === 'preview') {
    await page.setContent(cards);
    await page.waitForTimeout(300);
    for (const name of ['problem', 'workflow', 'closing']) {
      await scene(name, 'meaning');
      await page.waitForTimeout(650);
      await shot(`card-${name}`);
    }
    await context.close(); await browser.close();
    console.log('Title cards rendered.');
    process.exit(0);
  }

  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Agreement needs evidence.', exact: true }).waitFor({ timeout: 45000 });
  const boot = await page.evaluate(async () => (await (await fetch('/api/bootstrap')).json()).data);
  if (boot.connection?.status !== 'connected') throw new Error('FalkorDB is not connected');
  if (boot.counts?.openCases !== 0 || boot.counts?.pendingTasks !== 0) throw new Error('Recording session must begin in its own fresh graph');
  // Reject any mismatch with the visible guided-mode label.
  if (/model|gateway/i.test(JSON.stringify(boot.agentMode || boot.mode || 'guided'))) throw new Error('This recording script is labelled Guided MCP; adjust the label before recording another mode.');
  // Software-rendered headless Chromium can queue seconds of obsolete pixels
  // behind a full-viewport backdrop blur. Keep real dimming and modal contents,
  // and remove only that cosmetic filter from the recording presentation.
  await page.addStyleTag({ content: `${style}\n.modal-backdrop,.topbar{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}` });
  await page.evaluate(html => {
    const fragment = document.createElement('div'); fragment.innerHTML = html;
    document.body.append(...fragment.childNodes);
    document.addEventListener('mousemove', event => {
      const cursor = document.getElementById('film-cursor');
      cursor.style.left = `${event.clientX}px`; cursor.style.top = `${event.clientY}px`;
    });
    document.addEventListener('mousedown', event => {
      const cue = document.getElementById('film-click');
      cue.style.left = `${event.clientX}px`; cue.style.top = `${event.clientY}px`;
      cue.classList.remove('pulse'); void cue.offsetWidth; cue.classList.add('pulse');
    });
  }, markup);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await beginFrameCapture();
  filmStart = performance.now();
  mark('Problem: the two trial clocks');
  await scene('problem', 'intro');
  await at(15.7); await scene('problem', 'gap');
  await at(21.7); await scene('problem', 'meaning'); await shot('01-problem');

  await at(25.6); await scene(''); mark('Real workspace overview'); await park();
  await at(27.8); await shot('02-overview');
  await at(29.0); await click(nav('Knowledge graph'));
  await page.locator('.graph-canvas .graph-node').first().waitFor();
  mark('Inspect the actual FalkorDB knowledge graph');
  await at(31.0); await click(page.getByRole('button', { name: /^Obligation:/ }).first()); await park();
  await at(34.0); await shot('02b-knowledge-graph');
  await at(36.2); await scene('workflow'); mark('FalkorDB workflow diagram');
  await at(47.7); await shot('03-falkordb-workflow');
  await at(52.2); await nav('Overview').click();
  await page.getByRole('heading', { name: 'Agreement needs evidence.', exact: true }).waitFor();
  await at(54.2); await scene(''); mark('Investigate a real handoff');
  await at(57.7); await click(page.getByRole('button', { name: 'Investigate the trial handoff', exact: true }));
  await page.getByRole('button', { name: 'Run investigation', exact: true }).waitFor();
  await at(60.8); await scrollTo(page.locator('.evidence-grid'), 300); await park();
  await at(63.3); await click(page.getByRole('button', { name: 'Run investigation', exact: true }));
  await page.getByRole('button', { name: 'Review clarification', exact: true }).waitFor({ timeout: 12000 });
  // Actual UI automatically scrolls to the stored result. Briefly expose the MCP receipts.
  await page.waitForTimeout(850);
  const receiptPanel = page.locator('.tool-evidence');
  await at(66.0); await scrollTo(receiptPanel, 165); await park();
  await at(71.7); await scrollTo(page.locator('#verification-result')); mark('Concrete counterexample: 14 versus 21'); await park();
  await at(77.8); await shot('04-counterexample');
  await at(83.0); await click(page.getByText('Inspect bounds, source versions, and evaluation trace', { exact: true }));
  await scrollTo(page.locator('#verification-result details'), 220); await park();
  await at(86.4); await shot('05-bounds-and-trace');
  await at(89.1); await click(page.getByText('Inspect bounds, source versions, and evaluation trace', { exact: true }));

  await at(91.0); await click(page.getByRole('button', { name: 'Review clarification', exact: true }));
  mark('One case, an accountable human decision');
  await page.getByRole('heading', { name: 'What should the handoff mean?', exact: true }).waitFor();
  await at(94.6); await scrollTo(page.locator('.decision-panel'), 170); await park();
  await at(98.9); await click(page.locator('.decision-choice').first());
  const rationale = page.getByPlaceholder('Why does this meaning honor the shared promise? Record the scope and anything the owners should know.');
  await click(rationale);
  await rationale.pressSequentially('Synthetic demo decision: preserve 14 full days after first use in this trial scope.', { delay: 12 });
  await at(102.3); await shot('06-human-decision');
  await at(103.6); await click(page.getByRole('button', { name: 'Approve clarification', exact: true }));
  await page.getByRole('button', { name: 'Complete task', exact: true }).first().waitFor();
  await at(105.6); await scrollTo(page.locator('.case-task-panel'), 230); await park();
  await at(107.7); await shot('07-implementation-pending');

  await at(108.5); mark('Synthetic evidence for three human tasks');
  const evidence = [
    'Synthetic demo fixture: first-use event mapping reviewed for this trial scope.',
    'Synthetic demo fixture: billing anchor checked against first use plus 14 days.',
    'Synthetic demo fixture: delayed first use checked; day 7 now charges on day 21.',
  ];
  for (let i = 0; i < 3; i++) {
    await click(page.getByRole('button', { name: 'Complete task', exact: true }).first());
    const field = page.getByPlaceholder('Describe the completed work. Add a commit, review, test result, or other reference the next owner can inspect.');
    await field.waitFor();
    await click(field);
    await field.fill(evidence[i]);
    await page.waitForTimeout(650);
    await click(page.getByRole('button', { name: 'Save evidence & complete', exact: true }));
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    // The modal closes before the refreshed list arrives. Wait for actual state.
    await page.waitForFunction(n => [...document.querySelectorAll('.case-task button')].filter(button => button.textContent === 'Complete task').length === n, 2 - i);
  }
  await at(120.1); await click(page.getByRole('button', { name: 'Verify adopted mapping', exact: true }));
  await page.getByRole('button', { name: 'Verified & resolved', exact: true }).waitFor();
  mark('Fresh full-domain check resolves the case');
  await scrollTo(page.locator('.case-detail-header')); await park();
  await at(124.2); await shot('08-resolved');
  await at(126.0); await scrollTo(page.locator('.case-history'), 175); await park();

  await at(129.5); await click(nav('Shared memory')); mark('Persistent episodic, semantic and procedural memory');
  await page.getByRole('heading', { name: 'What happened', exact: true }).waitFor();
  await park();
  await at(132.1); await click(page.locator('.segmented-control').getByRole('button', { name: /^episodic$/i })); await park();
  await at(135.1); await click(page.locator('.segmented-control').getByRole('button', { name: /^semantic$/i })); await park();
  await at(137.4); await shot('09-semantic-memory');
  await at(138.3); await click(page.locator('.segmented-control').getByRole('button', { name: /^procedural$/i })); await park();
  await at(143.1); await click(page.locator('.segmented-control').getByRole('button', { name: /^all memory$/i })); await park();

  await at(148.4); mark('Switch company: separate tenant graph');
  await moveTo(page.getByRole('combobox', { name: 'Select company workspace' }));
  await page.getByRole('combobox', { name: 'Select company workspace' }).selectOption('nova');
  await page.getByRole('heading', { name: 'Agreement needs evidence.', exact: true }).waitFor();
  await page.locator('.workspace-card').getByText('Nova Labs', { exact: true }).waitFor();
  await park();
  const nova = await page.evaluate(async () => (await (await fetch('/api/bootstrap')).json()).data);
  if (nova.counts?.openCases !== 0 || nova.counts?.pendingTasks !== 0) throw new Error('Nova graph is not isolated from Acme workflow');
  await at(151.7); await shot('10-isolated-nova');
  await at(152.7); await click(nav('Verification & audit'));
  await page.getByRole('button', { name: 'Run verification suite', exact: true }).waitFor();
  await click(page.getByRole('button', { name: 'Run verification suite', exact: true }));
  mark('Measure the real FalkorDB coordination workload');
  await page.locator('.concurrency-panel').waitFor({ timeout: 10000 });
  await at(157.7); await scrollTo(page.locator('.verification-checks'), 95); await park();
  await at(160.5); await scrollTo(page.locator('.concurrency-panel'), 230); await park();
  const labText = await page.locator('.concurrency-panel').innerText();
  await at(164.0); await shot('11-measured-concurrency');
  const lab = await page.evaluate(async () => (await (await fetch('/api/verification')).json()).data);

  await at(166.6); await scene('closing'); mark('Both Graph Hacks tracks');
  await at(176.0); await shot('12-closing');
  await at(180.0); mark('End of three-minute demonstration');
  await at(181.0);
  if (mode === 'rehearse') {
    const rehearsalDuration = (performance.now() - filmStart) / 1000;
    const capture = await endFrameCapture(rehearsalDuration, 'rehearsal');
    await context.close(); await browser.close();
    await fs.writeFile(path.join(rawDir, 'rehearsal.json'), JSON.stringify({ ...capture, chapters, screenshots, requests, browserErrors: errors, verificationStatus: lab?.status, concurrency: lab?.concurrency }, null, 2));
    if (errors.length || lab?.checks?.some(check => !check.passed)) throw new Error('Rehearsal validation failed');
    console.log(JSON.stringify({ rehearsal: 'passed', browserErrors: errors.length, verificationStatus: lab?.status }));
    process.exit(0);
  }
  const capture = await endFrameCapture(180, 'walkthrough-silent');
  await context.close();
  await browser.close();
  const silentVideo = capture.output;
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', silentVideo, '-vf', 'fps=1/15,scale=400:-1,tile=4x3', '-frames:v', '1', path.join(rawDir, 'contact-sheet.jpg')]);
  for (const item of screenshots) await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(item.time), '-i', silentVideo, '-frames:v', '1', path.join(rawDir, `${item.name}.png`)]);
  const metadata = {
    title: 'PARALLAX real browser walkthrough', duration: 180, viewport: { width: 1600, height: 900 },
    mode: 'Synthetic company data; real FalkorDB; guided MCP; local production recording',
    ...capture, chapters, screenshots, requests, browserErrors: errors,
    verificationStatus: lab?.status, verificationChecks: lab?.checks?.map(({ name, passed }) => ({ name, passed })),
    concurrency: lab?.concurrency, displayedConcurrency: labText,
  };
  await fs.writeFile(path.join(rawDir, 'recording-metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
  if (errors.length) throw new Error(`Recording contains ${errors.length} browser/API errors; inspect metadata before using it`);
  if (lab?.checks?.some(check => !check.passed)) throw new Error('A measured verification check failed');
  console.log(JSON.stringify({ video: silentVideo, duration: 180, browserErrors: errors.length, verificationStatus: lab?.status, contactSheet: path.join(rawDir, 'contact-sheet.jpg') }));
} catch (error) {
  await page.screenshot({ path: path.join(rawDir, 'recording-error.png') }).catch(() => {});
  await fs.writeFile(path.join(rawDir, 'recording-error.json'), JSON.stringify({ error: error.message, chapters, requests, browserErrors: errors }, null, 2));
  await context.close().catch(() => {}); await browser.close().catch(() => {});
  throw error;
}
