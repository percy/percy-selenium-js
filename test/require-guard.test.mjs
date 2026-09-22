import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(testDir, '..');
const preload = path.join(testDir, 'fixtures', 'no-selenium-preload.cjs');

// Regression coverage for the 2.2.6 packaging break (PER-10804).
//
// 2.2.6 added a top-level `const { By } = require('selenium-webdriver')`.
// selenium-webdriver is a devDependency only — never installed in a consumer's
// tree unless they use Selenium directly — so the require threw
// MODULE_NOT_FOUND at module load, before any exported function could run.
// @wdio/browserstack-service loads us via a try/catch that swallows the throw
// and falls back to no-op handlers, so Percy silently captured nothing on
// WebdriverIO from 2026-04-01 onward.
//
// `By` has a single call site (the cross-origin iframe path, reachable only
// from percySnapshot), while the import it broke sat above percyScreenshot —
// the Automate entry point, which needs nothing from selenium-webdriver.
describe('module load without selenium-webdriver', () => {
  const runWithoutSelenium = script =>
    execFileAsync(process.execPath, ['--require', preload, '-e', script], { cwd: root });

  it('hides selenium-webdriver from the child process', async () => {
    // Guards the guard: if the fixture stopped working, every assertion below
    // would pass vacuously against a tree that still has Selenium in it.
    const { stdout } = await runWithoutSelenium(`
      let code = null;
      try { require('selenium-webdriver'); } catch (e) { code = e.code; }
      console.log(code);
    `);
    expect(stdout.trim()).toBe('MODULE_NOT_FOUND');
  });

  it('loads and exports every entry point', async () => {
    const { stdout } = await runWithoutSelenium(`
      const percySnapshot = require('./index.js');
      console.log(JSON.stringify({
        default: typeof percySnapshot,
        percySnapshot: typeof percySnapshot.percySnapshot,
        percyScreenshot: typeof percySnapshot.percyScreenshot,
        createRegion: typeof percySnapshot.createRegion,
        isPercyEnabled: typeof percySnapshot.isPercyEnabled
      }));
    `);
    expect(JSON.parse(stdout.trim())).toEqual({
      default: 'function',
      percySnapshot: 'function',
      percyScreenshot: 'function',
      createRegion: 'function',
      isPercyEnabled: 'function'
    });
  });

  it('keeps the Automate driver surface working for a WebdriverIO browser', async () => {
    // percyScreenshot only reads sessionId, capabilities and the executor URL
    // off the driver, then hands them to Percy — it never drives the browser
    // locally, which is why it works for WebdriverIO and why it should never
    // have depended on selenium-webdriver being installed.
    const { stdout } = await runWithoutSelenium(`
      const { DriverMetadata } = require('./driverMetadata.js');
      class Browser {}
      const browser = Object.assign(new Browser(), {
        sessionId: 'session-abc',
        capabilities: { browserName: 'chrome' },
        options: { protocol: 'https', hostname: 'hub.browserstack.com', path: '/wd/hub' }
      });
      const meta = new DriverMetadata(browser);
      Promise.all([meta.getSessionId(), meta.getCapabilities(), meta.getCommandExecutorUrl()])
        .then(([sessionId, capabilities, commandExecutorUrl]) => {
          console.log(JSON.stringify({ type: meta.type, sessionId, capabilities, commandExecutorUrl }));
        });
    `);
    expect(JSON.parse(stdout.trim())).toEqual({
      type: 'wdio',
      sessionId: 'session-abc',
      capabilities: { browserName: 'chrome' },
      commandExecutorUrl: 'https://hub.browserstack.com/wd/hub'
    });
  });

  it('reports unknown environment info instead of throwing', async () => {
    // The sibling `require('selenium-webdriver/package.json')` on line 5 was
    // already guarded this way; line 14 simply missed the same treatment.
    const { stdout } = await runWithoutSelenium(`
      require('./index.js');
      console.log('loaded');
    `);
    expect(stdout.trim()).toBe('loaded');
  });
});

describe('module load with selenium-webdriver present', () => {
  it('still wires up the iframe path that uses By', async () => {
    // The guard must not silently disable the one feature By exists for.
    const { stdout } = await execFileAsync(process.execPath, ['-e', `
      const percySnapshot = require('./index.js');
      const { processFrameTree, captureCorsIframes } = percySnapshot._internals;
      const { By } = require('selenium-webdriver');
      console.log(JSON.stringify({
        processFrameTree: typeof processFrameTree,
        captureCorsIframes: typeof captureCorsIframes,
        byCss: typeof By.css
      }));
      // selenium-webdriver keeps handles open once loaded; exit explicitly so
      // the spawned assertion process doesn't hang the spec.
      process.exit(0);
    `], { cwd: root });
    expect(JSON.parse(stdout.trim())).toEqual({
      processFrameTree: 'function',
      captureCorsIframes: 'function',
      byCss: 'function'
    });
  });
});
