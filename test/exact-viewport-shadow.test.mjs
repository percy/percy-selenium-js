import helpers from '@percy/sdk-utils/test/helpers';
import utils from '@percy/sdk-utils';
import percySnapshot from '../index.js';
import { Cache } from '../cache.js';

const {
  bidiModules,
  getBidiBrowsingContext,
  getCdpInvoker,
  isLocalDriver,
  isExactResponsiveWidth,
  createViewportResizer,
  setResponsiveViewport,
  restoreResponsiveViewport,
  exposeClosedShadowRoots,
  exposeClosedShadowRootsViaBidi,
  exposeClosedShadowRootsViaClassic
} = percySnapshot._internals;

const SHADOW_KEY = 'shadow-6066-11e4-a52e-4f735466cecf';

function capsOf(values) {
  return { get: (key) => values[key] };
}

// innerWidths are returned in order for each `return window.innerWidth`; the
// last value repeats. driver.wait polls the condition a few times like the
// real implementation and rejects when it never becomes true.
function fakeDriver({ caps = capsOf({ browserName: 'chrome' }), innerWidths = [], ...extra } = {}) {
  const widths = [...innerWidths];
  const windowManager = {
    setRect: jasmine.createSpy('setRect').and.resolveTo(),
    getRect: jasmine.createSpy('getRect').and.resolveTo({ width: 1024, height: 768 })
  };
  return {
    getCapabilities: jasmine.createSpy('getCapabilities').and.resolveTo(caps),
    getWindowHandle: jasmine.createSpy('getWindowHandle').and.resolveTo('ctx-1'),
    manage: () => ({ window: () => windowManager }),
    executeScript: jasmine.createSpy('executeScript').and.callFake(async (script) => {
      if (script === 'return window.innerWidth') return widths.length > 1 ? widths.shift() : widths[0];
    }),
    wait: jasmine.createSpy('wait').and.callFake(async (condition) => {
      for (let i = 0; i < 3; i++) if (await condition()) return true;
      throw new Error('Wait timed out');
    }),
    windowManager,
    ...extra
  };
}

function fakeBidiFactory(send, { setViewport = jasmine.createSpy('setViewport').and.resolveTo() } = {}) {
  const factory = jasmine.createSpy('browsingContext').and.callFake(async () => ({
    setViewport,
    bidi: { send }
  }));
  spyOn(bidiModules, 'browsingContext').and.returnValue(factory);
  return { factory, setViewport };
}

function seedExecutorUrl(sessionId, url) {
  Cache.cache[Cache.commandExecutorUrl] = Cache.cache[Cache.commandExecutorUrl] || {};
  Cache.cache[Cache.commandExecutorUrl][sessionId] = { success: true, val: url, time: Date.now() };
}

function sessionOf(id) {
  return { getSession: async () => ({ getId: () => id }) };
}

describe('exact responsive width', () => {
  beforeEach(async () => {
    await helpers.setupTest();
    utils.percy.config = {};
    delete process.env.PERCY_DISABLE_CDP_RESIZE;
  });

  afterEach(() => {
    delete process.env.PERCY_DISABLE_CDP_RESIZE;
  });

  describe('isExactResponsiveWidth', () => {
    it('defaults to true', () => {
      expect(isExactResponsiveWidth({})).toBe(true);
      expect(isExactResponsiveWidth()).toBe(true);
    });

    it('prefers the per-snapshot option over config and env', () => {
      utils.percy.config = { snapshot: { exactResponsiveWidth: true } };
      expect(isExactResponsiveWidth({ exactResponsiveWidth: false })).toBe(false);
    });

    it('prefers config over the legacy env', () => {
      process.env.PERCY_DISABLE_CDP_RESIZE = 'true';
      utils.percy.config = { snapshot: { exactResponsiveWidth: true } };
      expect(isExactResponsiveWidth({})).toBe(true);
    });

    it('treats PERCY_DISABLE_CDP_RESIZE=true as false', () => {
      process.env.PERCY_DISABLE_CDP_RESIZE = 'true';
      expect(isExactResponsiveWidth({})).toBe(false);
    });
  });

  describe('getCdpInvoker', () => {
    it('returns null for Firefox and Safari even when CDP helpers exist', () => {
      const driver = { sendDevToolsCommand: () => {} };
      expect(getCdpInvoker(driver, 'firefox')).toBeNull();
      expect(getCdpInvoker(driver, 'safari')).toBeNull();
    });

    it('treats a driver exposing CDP as Chromium when the browser name is unknown', async () => {
      const driver = { sendAndGetDevToolsCommand: jasmine.createSpy().and.resolveTo('ok') };
      await expectAsync(getCdpInvoker(driver, '')('X.y', {})).toBeResolvedTo('ok');
    });

    it('orders the helpers by preferResult', async () => {
      const driver = {
        sendDevToolsCommand: jasmine.createSpy('send').and.resolveTo('send'),
        sendAndGetDevToolsCommand: jasmine.createSpy('sendAndGet').and.resolveTo('sendAndGet')
      };
      await expectAsync(getCdpInvoker(driver, 'chrome')('X.y', {})).toBeResolvedTo('send');
      await expectAsync(getCdpInvoker(driver, 'chrome', true)('X.y', {})).toBeResolvedTo('sendAndGet');
    });

    for (const [browserName, vendor] of [['microsoftedge', 'ms'], ['msedge', 'ms'], ['chrome', 'goog']]) {
      it(`defines a ${vendor}/cdp/execute command for a plain remote ${browserName} WebDriver`, async () => {
        const executor = { defineCommand: jasmine.createSpy('defineCommand') };
        const driver = {
          getExecutor: () => executor,
          execute: jasmine.createSpy('execute').and.resolveTo({ result: 1 })
        };
        const cdp = getCdpInvoker(driver, browserName);
        await expectAsync(cdp('Emulation.clearDeviceMetricsOverride', {})).toBeResolvedTo({ result: 1 });
        expect(executor.defineCommand).toHaveBeenCalledWith(
          'percy:cdpExecute', 'POST', `/session/:sessionId/${vendor}/cdp/execute`);
        const command = driver.execute.calls.argsFor(0)[0];
        expect(command.getName()).toBe('percy:cdpExecute');
        expect(command.getParameters()).toEqual({ cmd: 'Emulation.clearDeviceMetricsOverride', params: {} });
      });
    }

    it('returns null when a Chromium driver has no usable executor', () => {
      expect(getCdpInvoker({}, 'chrome')).toBeNull();
      expect(getCdpInvoker({ getExecutor: () => ({}) }, 'chrome')).toBeNull();
      expect(getCdpInvoker({ getExecutor: () => ({ defineCommand() {} }) }, 'chrome')).toBeNull();
    });
  });

  describe('createViewportResizer', () => {
    it('orders CDP, BiDi then window for a Chromium BiDi session', async () => {
      const driver = fakeDriver({
        caps: { getBrowserName: () => 'MicrosoftEdge', get: (k) => k === 'webSocketUrl' ? 'ws://x' : undefined },
        sendDevToolsCommand: () => {}
      });
      expect((await createViewportResizer(driver, true)).mechanisms).toEqual(['cdp', 'bidi', 'window']);
    });

    it('uses only the window for Firefox without BiDi', async () => {
      const driver = fakeDriver({ caps: capsOf({ browserName: 'firefox' }) });
      expect((await createViewportResizer(driver, true)).mechanisms).toEqual(['window']);
    });

    it('falls back to the window when capabilities are unavailable', async () => {
      const failing = fakeDriver();
      failing.getCapabilities.and.rejectWith(new Error('no session'));
      const empty = fakeDriver();
      empty.getCapabilities.and.resolveTo(undefined);
      expect((await createViewportResizer(failing, true)).mechanisms).toEqual(['window']);
      expect((await createViewportResizer(empty, true)).mechanisms).toEqual(['window']);
    });

    describe('when exact widths are off', () => {
      it('keeps the legacy Chrome-only CDP path', async () => {
        const chrome = fakeDriver({ sendDevToolsCommand: () => {} });
        const edge = fakeDriver({ caps: capsOf({ browserName: 'MicrosoftEdge' }), sendDevToolsCommand: () => {} });
        expect((await createViewportResizer(chrome, false)).mechanisms).toEqual(['cdp', 'window']);
        expect((await createViewportResizer(edge, false)).mechanisms).toEqual(['window']);
        expect((await createViewportResizer(fakeDriver(), false)).mechanisms).toEqual(['window']);
      });

      it('honours PERCY_DISABLE_CDP_RESIZE', async () => {
        process.env.PERCY_DISABLE_CDP_RESIZE = 'true';
        const chrome = fakeDriver({ sendDevToolsCommand: () => {} });
        expect((await createViewportResizer(chrome, false)).mechanisms).toEqual(['window']);
      });
    });
  });

  describe('setResponsiveViewport', () => {
    it('emulates the viewport over CDP and verifies innerWidth', async () => {
      const driver = fakeDriver({ innerWidths: [375], sendDevToolsCommand: jasmine.createSpy().and.resolveTo() });
      const resizer = await createViewportResizer(driver, true);
      await setResponsiveViewport(resizer, 375, 800);
      expect(driver.sendDevToolsCommand).toHaveBeenCalledWith('Emulation.setDeviceMetricsOverride',
        { height: 800, width: 375, deviceScaleFactor: 1, mobile: false });
      expect(driver.executeScript).toHaveBeenCalledWith('return window.innerWidth');
      expect(driver.windowManager.setRect).not.toHaveBeenCalled();
      expect([...resizer.used]).toEqual(['cdp']);
    });

    it('falls through a failing CDP call to BiDi setViewport', async () => {
      const { factory, setViewport } = fakeBidiFactory(jasmine.createSpy('send'));
      const driver = fakeDriver({
        caps: capsOf({ browserName: 'chrome', webSocketUrl: 'ws://x' }),
        innerWidths: [375],
        sendDevToolsCommand: jasmine.createSpy().and.rejectWith(new Error('no cdp'))
      });
      const resizer = await createViewportResizer(driver, true);
      await setResponsiveViewport(resizer, 375, 800);
      await setResponsiveViewport(resizer, 1280, 800);
      expect(factory).toHaveBeenCalledOnceWith(driver, { browsingContextId: 'ctx-1' });
      expect(setViewport.calls.allArgs()).toEqual([[375, 800, 1], [1280, 800, 1]]);
      expect(driver.sendDevToolsCommand).toHaveBeenCalledTimes(1);
      expect([...resizer.used]).toEqual(['bidi']);
    });

    it('falls back to the window when the binding has no BiDi setViewport', async () => {
      spyOn(bidiModules, 'browsingContext').and.returnValue(async () => ({ bidi: {} }));
      const driver = fakeDriver({ caps: capsOf({ browserName: 'firefox', webSocketUrl: 'ws://x' }), innerWidths: [1280] });
      const resizer = await createViewportResizer(driver, true);
      await setResponsiveViewport(resizer, 1280, 800);
      expect(driver.windowManager.setRect).toHaveBeenCalledOnceWith({ width: 1280, height: 800 });
      expect([...resizer.used]).toEqual(['window']);
    });

    it('corrects the window once by the measured border', async () => {
      const driver = fakeDriver({ caps: capsOf({ browserName: 'MicrosoftEdge' }), innerWidths: [1272, 1272, 1272, 1280] });
      const resizer = await createViewportResizer(driver, true);
      await setResponsiveViewport(resizer, 1280, 800);
      expect(driver.windowManager.setRect.calls.allArgs()).toEqual([
        [{ width: 1280, height: 800 }], [{ width: 1288, height: 800 }]
      ]);
    });

    it('warns once per browser when the window cannot reach the width', async () => {
      const driver = fakeDriver({ caps: capsOf({ browserName: 'unknown-browser' }), innerWidths: [500] });
      const resizer = await createViewportResizer(driver, true);
      await setResponsiveViewport(resizer, 375, 800);
      await setResponsiveViewport(resizer, 360, 800);
      const warnings = helpers.logger.stderr.filter(line => line.includes('Could not set an exact'));
      expect(warnings).toEqual([
        '[percy] Could not set an exact 375px viewport on unknown-browser by resizing the window; ' +
        'start the session with webSocketUrl: true to enable exact responsive widths'
      ]);
    });

    it('names the browser generically when it is unknown', async () => {
      const driver = fakeDriver({ caps: null, innerWidths: [500] });
      const resizer = await createViewportResizer(driver, true);
      await setResponsiveViewport(resizer, 375, 800);
      expect(helpers.logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringContaining('viewport on this browser by resizing')
      ]));
    });

    it('does not correct the window when exact widths are off or innerWidth is unknown', async () => {
      const legacy = fakeDriver({ caps: capsOf({ browserName: 'firefox' }), innerWidths: [500] });
      await setResponsiveViewport(await createViewportResizer(legacy, false), 375, 800);
      expect(legacy.windowManager.setRect).toHaveBeenCalledTimes(1);

      const unknown = fakeDriver({ caps: capsOf({ browserName: 'firefox' }) });
      await setResponsiveViewport(await createViewportResizer(unknown, true), 375, 800);
      expect(unknown.windowManager.setRect).toHaveBeenCalledTimes(1);
    });
  });

  describe('restoreResponsiveViewport', () => {
    it('clears CDP and BiDi emulation and restores the window rect', async () => {
      const send = jasmine.createSpy('send').and.resolveTo({ result: {} });
      fakeBidiFactory(send);
      const driver = fakeDriver({ sendDevToolsCommand: jasmine.createSpy().and.resolveTo() });
      const resizer = await createViewportResizer(driver, true);
      resizer.used = new Set(['cdp', 'bidi', 'window']);
      resizer.bidiContext = await getBidiBrowsingContext(driver);
      await restoreResponsiveViewport(resizer, 1024, 768);
      expect(driver.sendDevToolsCommand).toHaveBeenCalledWith('Emulation.clearDeviceMetricsOverride', {});
      expect(send).toHaveBeenCalledWith({
        method: 'browsingContext.setViewport',
        params: { context: 'ctx-1', viewport: null, devicePixelRatio: null }
      });
      expect(driver.windowManager.setRect).toHaveBeenCalledWith({ width: 1024, height: 768 });
    });

    it('does nothing when no mechanism was used', async () => {
      const driver = fakeDriver({ sendDevToolsCommand: jasmine.createSpy() });
      await restoreResponsiveViewport(await createViewportResizer(driver, true), 1024, 768);
      expect(driver.sendDevToolsCommand).not.toHaveBeenCalled();
      expect(driver.windowManager.setRect).not.toHaveBeenCalled();
    });

    it('never throws when restoring fails', async () => {
      fakeBidiFactory(jasmine.createSpy('send').and.resolveTo({ error: 'unknown command', message: 'nope' }));
      const driver = fakeDriver();
      const resizer = await createViewportResizer(driver, true);
      resizer.used = new Set(['bidi']);
      resizer.bidiContext = await getBidiBrowsingContext(driver);
      await expectAsync(restoreResponsiveViewport(resizer, 1024, 768)).toBeResolved();
    });
  });

  describe('getBidiBrowsingContext', () => {
    it('loads the binding module', () => {
      expect(typeof bidiModules.browsingContext()).toBe('function');
    });

    it('returns null when the binding has no BiDi module', async () => {
      spyOn(bidiModules, 'browsingContext').and.returnValue(null);
      await expectAsync(getBidiBrowsingContext(fakeDriver())).toBeResolvedTo(null);
    });

    it('wraps the installed binding when the session has webSocketUrl', async () => {
      const send = jasmine.createSpy('send').and.resolveTo({ result: {} });
      const driver = fakeDriver({
        caps: capsOf({ browserName: 'firefox', webSocketUrl: 'ws://x' }),
        getBidi: async () => ({ send })
      });
      const context = await getBidiBrowsingContext(driver);
      // selenium-webdriver < 4.15 has no setViewport, so the helper opts out.
      if (context) {
        expect(context.id).toBe('ctx-1');
        await context.setViewport(375, 800);
        expect(send).toHaveBeenCalledWith(jasmine.objectContaining({
          method: 'browsingContext.setViewport',
          params: jasmine.objectContaining({ context: 'ctx-1', viewport: { width: 375, height: 800 }, devicePixelRatio: 1 })
        }));
      } else {
        expect(context).toBeNull();
      }
    });
  });

  describe('responsive capture', () => {
    function responsiveDriver() {
      return fakeDriver({
        sendDevToolsCommand: jasmine.createSpy('sendDevToolsCommand').and.resolveTo(),
        navigate: () => ({ refresh: async () => {} }),
        getCurrentUrl: async () => 'https://example.com/',
        manage: () => ({
          window: () => ({
            setRect: jasmine.createSpy('setRect').and.resolveTo(),
            getRect: async () => ({ width: 1280, height: 768 })
          }),
          getCookies: async () => []
        }),
        executeScript: jasmine.createSpy('executeScript').and.resolveTo({ domSnapshot: { html: '' } })
      });
    }

    beforeEach(() => {
      spyOn(percySnapshot, 'isPercyEnabled').and.resolveTo(true);
      utils.percy.type = 'web';
    });

    it('applies the first width even when it matches the outer window width', async () => {
      const driver = responsiveDriver();
      await percySnapshot(driver, 'exact', { responsiveSnapshotCapture: true, widths: [1280] });
      expect(driver.sendDevToolsCommand).toHaveBeenCalledWith('Emulation.setDeviceMetricsOverride',
        jasmine.objectContaining({ width: 1280 }));
    });

    it('keeps the legacy skip when exactResponsiveWidth is false', async () => {
      const driver = responsiveDriver();
      await percySnapshot(driver, 'legacy', { responsiveSnapshotCapture: true, widths: [1280], exactResponsiveWidth: false });
      expect(driver.sendDevToolsCommand).not.toHaveBeenCalledWith('Emulation.setDeviceMetricsOverride', jasmine.anything());
    });
  });
});

describe('closed shadow root exposure', () => {
  beforeEach(async () => {
    await helpers.setupTest();
    utils.percy.config = {};
    delete process.env.PERCY_CLOSED_SHADOW_CLASSIC;
    delete process.env.PERCY_CLOSED_SHADOW_MAX_HOSTS;
  });

  afterEach(() => {
    delete process.env.PERCY_CLOSED_SHADOW_CLASSIC;
    delete process.env.PERCY_CLOSED_SHADOW_MAX_HOSTS;
  });

  function node(sharedId, mode) {
    return { type: 'node', sharedId, value: { shadowRoot: mode ? { type: 'node', sharedId: `${sharedId}-root`, value: { mode } } : null } };
  }

  function bidiResult(nodes) {
    return { result: { type: 'success', result: { type: 'array', value: nodes } } };
  }

  describe('exposeClosedShadowRoots', () => {
    it('skips everything when shadow DOM capture is disabled', async () => {
      const driver = fakeDriver();
      await exposeClosedShadowRoots(driver, { disableShadowDOM: true });
      utils.percy.config = { snapshot: { disableShadowDOM: true } };
      await exposeClosedShadowRoots(driver, {});
      expect(driver.getCapabilities).not.toHaveBeenCalled();
    });

    it('stops after a successful CDP pass', async () => {
      const driver = fakeDriver({
        caps: capsOf({ browserName: 'chrome', webSocketUrl: 'ws://x' }),
        sendAndGetDevToolsCommand: jasmine.createSpy().and.resolveTo({ root: { children: [] } })
      });
      spyOn(bidiModules, 'browsingContext');
      await exposeClosedShadowRoots(driver);
      expect(bidiModules.browsingContext).not.toHaveBeenCalled();
      expect(driver.executeScript).not.toHaveBeenCalled();
    });

    it('falls back to BiDi when CDP fails', async () => {
      const send = jasmine.createSpy('send').and.resolveTo(bidiResult([]));
      fakeBidiFactory(send);
      const driver = fakeDriver({
        caps: capsOf({ browserName: 'chrome', webSocketUrl: 'ws://x' }),
        sendAndGetDevToolsCommand: jasmine.createSpy().and.rejectWith(new Error('no cdp'))
      });
      await exposeClosedShadowRoots(driver);
      expect(send).toHaveBeenCalledTimes(1);
      expect(driver.executeScript).not.toHaveBeenCalled();
    });

    it('warns and falls back to classic when BiDi fails', async () => {
      fakeBidiFactory(jasmine.createSpy('send').and.resolveTo({ result: { type: 'exception' } }));
      const driver = fakeDriver({ caps: capsOf({ browserName: 'firefox', webSocketUrl: 'ws://x' }), ...sessionOf('bidi-fails') });
      seedExecutorUrl('bidi-fails', 'http://localhost:4444');
      await exposeClosedShadowRoots(driver);
      expect(helpers.logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Could not expose closed shadow roots via BiDi: script.callFunction failed'
      ]));
      expect(driver.executeScript).toHaveBeenCalledTimes(1);
    });

    it('uses classic when the binding has no BiDi module', async () => {
      spyOn(bidiModules, 'browsingContext').and.returnValue(null);
      const driver = fakeDriver({ caps: capsOf({ browserName: 'firefox', webSocketUrl: 'ws://x' }), ...sessionOf('no-bidi-module') });
      seedExecutorUrl('no-bidi-module', 'http://127.0.0.1:4444');
      await exposeClosedShadowRoots(driver);
      expect(driver.executeScript).toHaveBeenCalledTimes(1);
    });

    it('warns when the classic pass fails', async () => {
      const driver = fakeDriver({ caps: capsOf({ browserName: 'firefox' }), ...sessionOf('classic-fails') });
      driver.executeScript.and.rejectWith(new Error('script failed'));
      seedExecutorUrl('classic-fails', 'http://localhost:4444');
      await exposeClosedShadowRoots(driver);
      expect(helpers.logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Could not expose closed shadow roots: script failed'
      ]));
    });

    it('never throws without a driver', async () => {
      await expectAsync(exposeClosedShadowRoots(null)).toBeResolved();
    });
  });

  describe('exposeClosedShadowRootsViaBidi', () => {
    it('returns false when the binding has no BiDi browsing context', async () => {
      spyOn(bidiModules, 'browsingContext').and.returnValue(async () => ({}));
      await expectAsync(exposeClosedShadowRootsViaBidi(fakeDriver())).toBeResolvedTo(false);
    });

    it('feeds closed roots back to fill the map and find nested roots', async () => {
      const send = jasmine.createSpy('send').and.returnValues(
        Promise.resolve(bidiResult([node('a', 'closed'), node('b', 'open'), node('c'), null])),
        Promise.resolve(bidiResult([node('d', 'closed')])),
        Promise.resolve({ result: { type: 'success', result: { type: 'array' } } })
      );
      fakeBidiFactory(send);
      await expectAsync(exposeClosedShadowRootsViaBidi(fakeDriver())).toBeResolvedTo(true);
      expect(send).toHaveBeenCalledTimes(3);
      const [first, second, third] = send.calls.allArgs().map(([msg]) => msg.params);
      expect(first).toEqual(jasmine.objectContaining({
        target: { context: 'ctx-1' },
        arguments: [],
        resultOwnership: 'none',
        serializationOptions: { maxDomDepth: 0, includeShadowTree: 'all' }
      }));
      expect(first.functionDeclaration).toContain('__percyClosedShadowRoots');
      expect(second.arguments).toEqual([{ sharedId: 'a' }, { sharedId: 'a-root' }]);
      expect(third.arguments).toEqual([{ sharedId: 'd' }, { sharedId: 'd-root' }]);
    });

    it('stops after the nesting cap', async () => {
      const send = jasmine.createSpy('send').and.callFake(async () => bidiResult([node('x', 'closed')]));
      fakeBidiFactory(send);
      await exposeClosedShadowRootsViaBidi(fakeDriver());
      expect(send).toHaveBeenCalledTimes(10);
    });

    it('surfaces protocol errors and script exceptions', async () => {
      fakeBidiFactory(jasmine.createSpy('send').and.resolveTo({ error: 'unknown command', message: 'nope' }));
      await expectAsync(exposeClosedShadowRootsViaBidi(fakeDriver())).toBeRejectedWithError('unknown command: nope');

      bidiModules.browsingContext.and.returnValue(async () => ({
        setViewport() {},
        bidi: { send: async () => ({ result: { type: 'exception', exceptionDetails: { text: 'boom' } } }) }
      }));
      await expectAsync(exposeClosedShadowRootsViaBidi(fakeDriver())).toBeRejectedWithError('boom');

      bidiModules.browsingContext.and.returnValue(async () => ({ setViewport() {}, bidi: { send: async () => undefined } }));
      await expectAsync(exposeClosedShadowRootsViaBidi(fakeDriver())).toBeRejectedWithError('script.callFunction failed');
    });
  });

  describe('exposeClosedShadowRootsViaClassic', () => {
    function host(id, root) {
      return {
        id,
        getShadowRoot: typeof root === 'function' ? root : jasmine.createSpy(`getShadowRoot-${id}`).and.resolveTo(root)
      };
    }

    it('skips remote sessions and says how to enable capture, once', async () => {
      const driver = fakeDriver(sessionOf('remote-1'));
      seedExecutorUrl('remote-1', 'https://hub-cloud.browserstack.com/wd/hub');
      await exposeClosedShadowRootsViaClassic(driver);
      await exposeClosedShadowRootsViaClassic(driver);
      expect(driver.executeScript).not.toHaveBeenCalled();
      const notices = helpers.logger.stdout.filter(line => line.includes('closed shadow roots skipped'));
      expect(notices.length).toBeLessThanOrEqual(1);
    });

    it('runs on remote sessions when PERCY_CLOSED_SHADOW_CLASSIC=true', async () => {
      process.env.PERCY_CLOSED_SHADOW_CLASSIC = 'true';
      const driver = fakeDriver(sessionOf('remote-2'));
      seedExecutorUrl('remote-2', 'https://hub-cloud.browserstack.com/wd/hub');
      await exposeClosedShadowRootsViaClassic(driver);
      expect(driver.executeScript).toHaveBeenCalledTimes(1);
    });

    it('exposes closed roots with a hand-built shadow reference and recurses', async () => {
      const nested = host('nested', { getId: async () => 'nested-root' });
      const closed = host('closed', { getId: async () => 'closed-root' });
      const absent = host('absent', null); // Safari answers closed hosts with null
      const failing = host('failing', jasmine.createSpy().and.rejectWith(new Error('no such shadow root')));
      const opaque = host('opaque', {});
      const driver = fakeDriver(sessionOf('local-1'));
      seedExecutorUrl('local-1', 'http://localhost:9515');
      driver.executeScript.and.callFake(async (fn, customOnly, hostArg) => {
        if (!hostArg) return [closed, absent, failing, opaque];
        return hostArg === closed ? [nested] : null;
      });
      await exposeClosedShadowRootsViaClassic(driver);
      const calls = driver.executeScript.calls.allArgs();
      expect(calls.length).toBe(3);
      expect(calls[0].slice(1)).toEqual([true]);
      expect(calls[1].slice(1)).toEqual([true, closed, { [SHADOW_KEY]: 'closed-root' }]);
      expect(calls[2].slice(1)).toEqual([true, nested, { [SHADOW_KEY]: 'nested-root' }]);
    });

    it('caps the number of hosts checked', async () => {
      process.env.PERCY_CLOSED_SHADOW_MAX_HOSTS = '1';
      const first = host('first', null);
      const second = host('second', null);
      const driver = fakeDriver(sessionOf('local-2'));
      seedExecutorUrl('local-2', 'http://[::1]:9515');
      driver.executeScript.and.resolveTo([first, second]);
      await exposeClosedShadowRootsViaClassic(driver);
      expect(first.getShadowRoot).toHaveBeenCalled();
      expect(second.getShadowRoot).not.toHaveBeenCalled();
    });

    it('handles a page with no candidates', async () => {
      const driver = fakeDriver(sessionOf('local-3'));
      seedExecutorUrl('local-3', 'http://localhost:9515');
      driver.executeScript.and.resolveTo(null);
      await expectAsync(exposeClosedShadowRootsViaClassic(driver)).toBeResolved();
    });
  });

  describe('isLocalDriver', () => {
    it('detects local and remote command executors', async () => {
      seedExecutorUrl('host-local', 'http://127.0.0.1:4444');
      seedExecutorUrl('host-remote', 'https://grid.example.com/wd/hub');
      await expectAsync(isLocalDriver(sessionOf('host-local'))).toBeResolvedTo(true);
      await expectAsync(isLocalDriver(sessionOf('host-remote'))).toBeResolvedTo(false);
      await expectAsync(isLocalDriver({})).toBeResolvedTo(false);
    });
  });
});
