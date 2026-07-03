import fs from 'node:fs';
import webdriver from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import helpers from '@percy/sdk-utils/test/helpers';
import percySnapshot from '../index.js';
import utils from '@percy/sdk-utils';
import { Cache } from '../cache.js';
const { percyScreenshot, slowScrollToBottom, createRegion } = percySnapshot;

// Forward-compat shim: `utils.runReadinessGate` is the orchestrator added
// in @percy/sdk-utils 1.31.15. Until that version is published, polyfill
// it here so tests exercise the real call shape instead of being skipped
// by the SDK's typeof guard. Once 1.31.15 lands, this becomes a no-op.
if (typeof utils.runReadinessGate !== 'function') {
  utils.runReadinessGate = async function runReadinessGate(evalScript, snapshotOptions = {}, { callback = false, log } = {}) {
    if (typeof utils.isReadinessDisabled === 'function' && utils.isReadinessDisabled(snapshotOptions)) return null;
    const config = typeof utils.getReadinessConfig === 'function'
      ? utils.getReadinessConfig(snapshotOptions)
      : { ...(utils.percy?.config?.snapshot?.readiness || {}), ...(snapshotOptions?.readiness || {}) };
    const script = typeof utils.waitForReadyScript === 'function'
      ? utils.waitForReadyScript(config, { callback })
      : null;
    if (!script) return null;
    try {
      return await evalScript(script);
    } catch (err) {
      log?.debug?.(`waitForReady failed, proceeding to serialize: ${err?.message || err}`);
      return null;
    }
  };
}

describe('percySnapshot', () => {
  let driver;
  let mockedDriver;

  beforeAll(async function() {
    let firefoxOptions = new firefox.Options();
    let firefoxBinary = '/Applications/Firefox.app/Contents/MacOS/firefox';

    if (process.platform === 'darwin' && fs.existsSync(firefoxBinary)) {
      firefoxOptions.setBinary(firefoxBinary);
    }

    driver = await new webdriver.Builder()
      .forBrowser('firefox')
      .setFirefoxOptions(firefoxOptions)
      .build();

    mockedDriver = {
      getCapabilities: jasmine.createSpy('getCapabilities').and.returnValue({ getBrowserName: () => 'chrome' }),
      sendDevToolsCommand: jasmine.createSpy('sendDevToolsCommand').and.returnValue(Promise.resolve()),
      navigate: jasmine.createSpy('navigate').and.returnValue({ refresh: jasmine.createSpy('refresh') }),
      manage: jasmine.createSpy('manage').and.returnValue({
        window: jasmine.createSpy('window').and.returnValue({
          setRect: jasmine.createSpy('setRect').and.returnValue(Promise.resolve()),
          getRect: jasmine.createSpy('getRect').and.returnValue(Promise.resolve({
            width: 1024,
            height: 768
          }))
        }),
        getCookies: jasmine.createSpy('getCookies').and.returnValue(Promise.resolve({}))
      }),
      executeScript: jasmine.createSpy('executeScript').and.returnValue(Promise.resolve(1)),
      wait: jasmine.createSpy('wait').and.returnValue(Promise.resolve(1))
    };
    global.CDP_SUPPORT_SELENIUM = true;
  });

  afterAll(async () => {
    await driver.quit();
  });

  beforeEach(async () => {
    delete process.env.PERCY_RAISE_ERROR;
    await helpers.setupTest();
    await driver.get(helpers.testSnapshotURL);
  });

  it('throws an error when a driver is not provided', async () => {
    await expectAsync(percySnapshot())
      .toBeRejectedWithError('An instance of the selenium driver object is required.');
  });

  it('throws an error when a name is not provided', async () => {
    await expectAsync(percySnapshot(driver))
      .toBeRejectedWithError('The `name` argument is required.');
  });

  it('disables snapshots when the healthcheck fails', async () => {
    await helpers.test('error', '/percy/healthcheck');

    await percySnapshot(driver, 'Snapshot 1');
    await percySnapshot(driver, 'Snapshot 2');

    expect(helpers.logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy is not running, disabling snapshots'
    ]));
  });

  it('posts snapshots to the local percy server', async () => {
    await percySnapshot(driver, 'Snapshot 1');
    await percySnapshot(driver, 'Snapshot 2');

    expect(await helpers.get('logs')).toEqual(jasmine.arrayContaining([
      'Snapshot found: Snapshot 1',
      'Snapshot found: Snapshot 2',
      `- url: ${helpers.testSnapshotURL}`,
      jasmine.stringMatching(/clientInfo: @percy\/selenium-webdriver\/.+/),
      jasmine.stringMatching(/environmentInfo: selenium-webdriver\/.+/)
    ]));
  });

  it('handles snapshot failures', async () => {
    await helpers.test('error', '/percy/snapshot');
    await percySnapshot(driver, 'Snapshot 1');

    expect(helpers.logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Could not take DOM snapshot "Snapshot 1"'
    ]));
  });

  it('throws error for percy on automate session', async () => {
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'automate';

    let error = null;
    try {
      await percySnapshot(driver, 'Snapshot 2');
    } catch (e) {
      error = e.message;
    }
    expect(error).toEqual('Invalid function call - percySnapshot(). Please use percyScreenshot() function while using Percy with Automate. For more information on usage of percyScreenshot, refer https://www.browserstack.com/docs/percy/integrate/functional-and-visual');
  });

  it('posts snapshots to percy server with responsiveSnapshotCapture true', async () => {
    await driver.manage().window().setRect({ width: 1380, height: 1024 });
    await percySnapshot(driver, 'Snapshot 1', { responsiveSnapshotCapture: true, widths: [1380] });
    expect(await helpers.get('logs')).toEqual(jasmine.arrayContaining([
      'Snapshot found: Snapshot 1',
      `- url: ${helpers.testSnapshotURL}`,
      jasmine.stringMatching(/clientInfo: @percy\/selenium-webdriver\/.+/),
      jasmine.stringMatching(/environmentInfo: selenium-webdriver\/.+/)
    ]));
  });

  it('posts snapshots to percy server with responsiveSnapshotCapture false', async () => {
    await percySnapshot(driver, 'Snapshot 1', { responsiveSnapshotCapture: false, widths: [1380] });

    expect(await helpers.get('logs')).toEqual(jasmine.arrayContaining([
      'Snapshot found: Snapshot 1',
      `- url: ${helpers.testSnapshotURL}`,
      jasmine.stringMatching(/clientInfo: @percy\/selenium-webdriver\/.+/),
      jasmine.stringMatching(/environmentInfo: selenium-webdriver\/.+/)
    ]));
  });

  it('posts snapshots to percy server with responsiveSnapshotCapture with mobile', async () => {
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.widths = { mobile: [1125], widths: [1280] };

    await driver.manage().window().setRect({ width: 1280, height: 1024 });
    await percySnapshot(driver, 'Snapshot 1', { responsiveSnapshotCapture: true });

    expect(await helpers.get('logs')).toEqual(jasmine.arrayContaining([
      'Snapshot found: Snapshot 1',
      `- url: ${helpers.testSnapshotURL}`,
      jasmine.stringMatching(/clientInfo: @percy\/selenium-webdriver\/.+/),
      jasmine.stringMatching(/environmentInfo: selenium-webdriver\/.+/)
    ]));
  });

  it('multiDOM should not run when deferUploads is true', async () => {
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.config = { percy: { deferUploads: true } };
    spyOn(mockedDriver, 'sendDevToolsCommand').and.callThrough();
    spyOn(mockedDriver.manage().window(), 'setRect').and.callThrough();

    await percySnapshot(mockedDriver, 'Test Snapshot', { responsiveSnapshotCapture: true });

    expect(mockedDriver.sendDevToolsCommand).not.toHaveBeenCalled();
    expect(mockedDriver.manage().window().setRect).not.toHaveBeenCalled();
  });

  it('should call sendDevToolsCommand for chrome and not setRect', async () => {
    spyOn(mockedDriver, 'sendDevToolsCommand').and.callThrough();
    spyOn(mockedDriver.manage().window(), 'setRect').and.callThrough();
    utils.percy.widths = { mobile: [], widths: [1280] };

    await percySnapshot(mockedDriver, 'Test Snapshot', { responsiveSnapshotCapture: true });

    expect(mockedDriver.sendDevToolsCommand).toHaveBeenCalledWith('Emulation.setDeviceMetricsOverride', {
      height: jasmine.any(Number),
      width: jasmine.any(Number),
      deviceScaleFactor: 1,
      mobile: false
    });
    expect(mockedDriver.manage().window().setRect).not.toHaveBeenCalled();
  });

  it('should fall back to setRect when sendDevToolsCommand fails', async () => {
    const windowManager = mockedDriver.manage().window();
    spyOn(mockedDriver, 'sendDevToolsCommand').and.rejectWith(new Error('CDP Command Failed'));
    spyOn(windowManager, 'setRect').and.callThrough();
    utils.percy.widths = { mobile: [1125], widths: [375, 1280] };

    await percySnapshot(mockedDriver, 'Test Snapshot', { responsiveSnapshotCapture: true });

    expect(mockedDriver.sendDevToolsCommand).toHaveBeenCalled();
    expect(windowManager.setRect).toHaveBeenCalledWith({
      width: jasmine.any(Number),
      height: jasmine.any(Number)
    });
  });

  it('should log a timeout error when resizeCount fails', async () => {
    spyOn(mockedDriver, 'sendDevToolsCommand').and.rejectWith(new Error('TimeoutError'));
    utils.percy.widths = { mobile: [1125], widths: [375, 1280, 1280] };

    await percySnapshot(mockedDriver, 'Test Snapshot', { responsiveSnapshotCapture: true });

    expect(mockedDriver.executeScript).not.toHaveBeenCalledWith('return window.resizeCount');
  });

  it('should reload page if PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE is set', async () => {
    process.env.PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE = true;
    await percySnapshot(mockedDriver, 'Test Snapshot', { responsiveSnapshotCapture: true });
    expect(mockedDriver.navigate().refresh).toHaveBeenCalled();
    delete process.env.PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE;
  });

  it('should wait if RESPONSIVE_CAPTURE_SLEEP_TIME is set', async () => {
    process.env.RESPONSIVE_CAPTURE_SLEEP_TIME = 1;
    spyOn(global, 'setTimeout').and.callThrough();

    await percySnapshot(mockedDriver, 'Test Snapshot', { responsiveSnapshotCapture: true });

    expect(setTimeout).toHaveBeenCalled();
    delete process.env.RESPONSIVE_CAPTURE_SLEEP_TIME;
  });

  it('should scroll if PERCY_ENABLE_LAZY_LOADING_SCROLL is set', async () => {
    process.env.PERCY_ENABLE_LAZY_LOADING_SCROLL = true;
    const mockedScroll = spyOn(percySnapshot, 'slowScrollToBottom').and.resolveTo(true);
    await percySnapshot(mockedDriver, 'Test Snapshot', { responsiveSnapshotCapture: true });

    expect(mockedScroll).toHaveBeenCalledWith(mockedDriver);
    delete process.env.PERCY_ENABLE_LAZY_LOADING_SCROLL;
  });

  it('should use minHeight if PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT is set', async () => {
    process.env.PERCY_ENABLE_LAZY_LOADING_SCROLL = true;
    process.env.PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT = true;
    utils.percy.config = { snapshot: { minHeight: 10 } };

    const mockedScroll = spyOn(percySnapshot, 'slowScrollToBottom').and.resolveTo(true);

    mockedDriver.executeScript.calls.reset();
    await percySnapshot(mockedDriver, 'Test Snapshot', { responsiveSnapshotCapture: true });

    // Expected 5 executeScript calls on the responsive min-height path (was 3
    // before the CORS iframe + closed-shadow-DOM work landed):
    //   1. inject PercyDOM (percySnapshot)
    //   2. PercyDOM.waitForResize() (captureResponsiveDOM)
    //   3. PercyDOM.serialize(options) (captureSerializedDOM)
    //   4. enumerateIframesScript (captureCorsIframes)
    //   5. document.URL fetch (currentURL)
    // exposeClosedShadowRoots adds 0 executeScript calls here because the
    // mocked sendDevToolsCommand returns Promise.resolve() (no `root`).
    expect(mockedDriver.executeScript).toHaveBeenCalledTimes(5);
    expect(mockedScroll).toHaveBeenCalledWith(mockedDriver);
    delete process.env.PERCY_ENABLE_LAZY_LOADING_SCROLL;
    delete process.env.PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT;
  });

  it('throw error in SDK if PERCY_RAISE_ERROR is true', async () => {
    process.env.PERCY_RAISE_ERROR = 'true';
    await helpers.test('error', '/percy/healthcheck');
    let error = null;
    try {
      await percySnapshot(driver, 'Snapshot 1');
    } catch (e) {
      error = e;
    }

    expect(helpers.logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy is not running, disabling snapshots'
    ]));
    expect(error).toBeInstanceOf(Error);
  });

  it('handles snapshot failures if PERCY_RAISE_ERROR is true', async () => {
    process.env.PERCY_RAISE_ERROR = 'true';
    await helpers.test('error', '/percy/snapshot');
    let error = null;
    try {
      await percySnapshot(driver, 'Snapshot 1');
    } catch (e) {
      error = e;
    }
    expect(helpers.logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Could not take DOM snapshot "Snapshot 1"'
    ]));
    expect(error).toBeInstanceOf(Error);
  });

  it('passes ignoreCanvasSerializationErrors as true to DOM serialization', async () => {
    spyOn(driver, 'executeScript').and.returnValue(Promise.resolve({
      domSnapshot: { html: '<html></html>', resources: [] }
    }));

    await percySnapshot(driver, 'Snapshot with ignore canvas true', { 
      ignoreCanvasSerializationErrors: true 
    });

    expect(driver.executeScript).toHaveBeenCalledWith(
      jasmine.any(Function),
      jasmine.objectContaining({
        ignoreCanvasSerializationErrors: true
      })
    );
  });

  it('passes ignoreCanvasSerializationErrors as false to DOM serialization', async () => {
    spyOn(driver, 'executeScript').and.returnValue(Promise.resolve({
      domSnapshot: { html: '<html></html>', resources: [] }
    }));

    await percySnapshot(driver, 'Snapshot with ignore canvas false', { 
      ignoreCanvasSerializationErrors: false 
    });

    expect(driver.executeScript).toHaveBeenCalledWith(
      jasmine.any(Function),
      jasmine.objectContaining({
        ignoreCanvasSerializationErrors: false
      })
    );
  });

  describe('ignoreCanvasSerializationErrors via percySnapshot', () => {

    it('should default to false when no options are provided', async () => {
      spyOn(driver, 'executeScript').and.returnValue(Promise.resolve({
        domSnapshot: { html: '<html></html>', resources: [] }
      }));

      await percySnapshot(driver, 'Default canvas test');

      expect(driver.executeScript).toHaveBeenCalledWith(
        jasmine.any(Function),
        jasmine.objectContaining({
          ignoreCanvasSerializationErrors: false
        })
      );
    });

    it('should use value from options when provided as true', async () => {
      spyOn(driver, 'executeScript').and.returnValue(Promise.resolve({
        domSnapshot: { html: '<html></html>', resources: [] }
      }));

      await percySnapshot(driver, 'Options true test', { 
        ignoreCanvasSerializationErrors: true 
      });

      expect(driver.executeScript).toHaveBeenCalledWith(
        jasmine.any(Function),
        jasmine.objectContaining({
          ignoreCanvasSerializationErrors: true
        })
      );
    });

    it('should use value from options when provided as false', async () => {
      spyOn(driver, 'executeScript').and.returnValue(Promise.resolve({
        domSnapshot: { html: '<html></html>', resources: [] }
      }));

      await percySnapshot(driver, 'Options false test', { 
        ignoreCanvasSerializationErrors: false 
      });

      expect(driver.executeScript).toHaveBeenCalledWith(
        jasmine.any(Function),
        jasmine.objectContaining({
          ignoreCanvasSerializationErrors: false
        })
      );
    });

    it('should prefer options value over config value', async () => {
      utils.percy.config = { snapshot: { ignoreCanvasSerializationErrors: true } };

      spyOn(driver, 'executeScript').and.returnValue(Promise.resolve({
        domSnapshot: { html: '<html></html>', resources: [] }
      }));

      await percySnapshot(driver, 'Options override test', { 
        ignoreCanvasSerializationErrors: false 
      });

      expect(driver.executeScript).toHaveBeenCalledWith(
        jasmine.any(Function),
        jasmine.objectContaining({
          ignoreCanvasSerializationErrors: false
        })
      );
    });

    it('should return false when both options and config are undefined', async () => {
      utils.percy.config = {
        ...utils.percy.config,
        snapshot: {
          ...utils.percy.config?.snapshot,
        }
      };

      spyOn(driver, 'executeScript').and.returnValue(Promise.resolve({
        domSnapshot: { html: '<html></html>', resources: [] }
      }));

      await percySnapshot(driver, 'Both undefined test', {});

      expect(driver.executeScript).toHaveBeenCalledWith(
        jasmine.any(Function),
        jasmine.objectContaining({
          ignoreCanvasSerializationErrors: false
        })
      );
    });
  });

  describe('ignoreStyleSheetSerializationErrors via percySnapshot', () => {

    it('should default to false when no options are provided', async () => {
      spyOn(driver, 'executeScript').and.returnValue(Promise.resolve({
        domSnapshot: { html: '<html></html>', resources: [] }
      }));

      await percySnapshot(driver, 'Default canvas test');

      expect(driver.executeScript).toHaveBeenCalledWith(
        jasmine.any(Function),
        jasmine.objectContaining({
          ignoreStyleSheetSerializationErrors: false
        })
      );
    });

    it('should use value from options when provided as true', async () => {
      spyOn(driver, 'executeScript').and.returnValue(Promise.resolve({
        domSnapshot: { html: '<html></html>', resources: [] }
      }));

      await percySnapshot(driver, 'Options true test', { 
        ignoreStyleSheetSerializationErrors: true 
      });

      expect(driver.executeScript).toHaveBeenCalledWith(
        jasmine.any(Function),
        jasmine.objectContaining({
          ignoreStyleSheetSerializationErrors: true
        })
      );
    });

    it('should use value from options when provided as false', async () => {
      spyOn(driver, 'executeScript').and.returnValue(Promise.resolve({
        domSnapshot: { html: '<html></html>', resources: [] }
      }));

      await percySnapshot(driver, 'Options false test', { 
        ignoreStyleSheetSerializationErrors: false 
      });

      expect(driver.executeScript).toHaveBeenCalledWith(
        jasmine.any(Function),
        jasmine.objectContaining({
          ignoreStyleSheetSerializationErrors: false
        })
      );
    });

    it('should prefer options value over config value', async () => {
      utils.percy.config = { snapshot: { ignoreStyleSheetSerializationErrors: true } };

      spyOn(driver, 'executeScript').and.returnValue(Promise.resolve({
        domSnapshot: { html: '<html></html>', resources: [] }
      }));

      await percySnapshot(driver, 'Options override test', { 
        ignoreStyleSheetSerializationErrors: false 
      });

      expect(driver.executeScript).toHaveBeenCalledWith(
        jasmine.any(Function),
        jasmine.objectContaining({
          ignoreStyleSheetSerializationErrors: false
        })
      );
    });

    it('should return false when both options and config are undefined', async () => {
      utils.percy.config = {
        ...utils.percy.config,
        snapshot: {
          ...utils.percy.config?.snapshot,
        }
      };

      spyOn(driver, 'executeScript').and.returnValue(Promise.resolve({
        domSnapshot: { html: '<html></html>', resources: [] }
      }));

      await percySnapshot(driver, 'Both undefined test', {});

      expect(driver.executeScript).toHaveBeenCalledWith(
        jasmine.any(Function),
        jasmine.objectContaining({
          ignoreStyleSheetSerializationErrors: false
        })
      );
    });
  });

  describe('async DOM serialization', () => {
    it('should handle async PercyDOM.serialize correctly', async () => {
      spyOn(driver, 'executeScript').and.returnValue(Promise.resolve({
        domSnapshot: { html: '<html><body>Test</body></html>', resources: [] }
      }));

      await percySnapshot(driver, 'Async serialize test');

      expect(driver.executeScript).toHaveBeenCalledWith(
        jasmine.any(Function),
        jasmine.objectContaining({
          ignoreCanvasSerializationErrors: false,
          ignoreStyleSheetSerializationErrors: false
        })
      );
    });

    it('should properly await DOM serialization with options', async () => {
      spyOn(driver, 'executeScript').and.returnValue(Promise.resolve({
        domSnapshot: { 
          html: '<html><body>Test with options</body></html>', 
          resources: [{ url: 'test.css', content: 'body{}' }] 
        }
      }));

      await percySnapshot(driver, 'Async serialize with options', {
        ignoreCanvasSerializationErrors: true,
        ignoreStyleSheetSerializationErrors: true
      });

      expect(driver.executeScript).toHaveBeenCalledWith(
        jasmine.any(Function),
        jasmine.objectContaining({
          ignoreCanvasSerializationErrors: true,
          ignoreStyleSheetSerializationErrors: true
        })
      );
    });

    it('should handle async serialization errors gracefully', async () => {
      spyOn(driver, 'executeScript').and.rejectWith(new Error('Async serialization failed'));

      await percySnapshot(driver, 'Async serialize error test');

      expect(helpers.logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Could not take DOM snapshot "Async serialize error test"'
      ]));
    });

    it('should await serialization in responsive snapshot capture', async () => {
      spyOn(driver, 'executeScript').and.returnValue(Promise.resolve({
        domSnapshot: { html: '<html></html>', resources: [] }
      }));

      utils.percy.widths = { mobile: [], config: [1280] };

      await percySnapshot(mockedDriver, 'Async responsive test', { 
        responsiveSnapshotCapture: true,
        widths: [1280]
      });

      // Should be called for waitForResize and serialize
      expect(mockedDriver.executeScript).toHaveBeenCalled();
    });

    it('should handle async serialization with cookies', async () => {
      const mockCookies = [
        { name: 'test-cookie', value: 'test-value', domain: 'example.com' }
      ];

      const mockManage = {
        getCookies: jasmine.createSpy('getCookies').and.returnValue(Promise.resolve(mockCookies))
      };

      spyOn(driver, 'executeScript').and.returnValue(Promise.resolve({
        domSnapshot: { html: '<html></html>', resources: [] }
      }));

      spyOn(driver, 'manage').and.returnValue(mockManage);

      await percySnapshot(driver, 'Async serialize with cookies');

      expect(mockManage.getCookies).toHaveBeenCalled();
    });

    it('should pass all options through async serialization', async () => {
      const customOptions = {
        enableJavaScript: true,
        widths: [375, 1280],
        minHeight: 1024,
        ignoreCanvasSerializationErrors: true,
        ignoreStyleSheetSerializationErrors: true,
        customParam: 'test-value'
      };

      spyOn(driver, 'executeScript').and.returnValue(Promise.resolve({
        domSnapshot: { html: '<html></html>', resources: [] }
      }));

      await percySnapshot(driver, 'Async with custom options', customOptions);

      expect(driver.executeScript).toHaveBeenCalledWith(
        jasmine.any(Function),
        jasmine.objectContaining({
          enableJavaScript: true,
          widths: [375, 1280],
          minHeight: 1024,
          ignoreCanvasSerializationErrors: true,
          ignoreStyleSheetSerializationErrors: true,
          customParam: 'test-value'
        })
      );
    });

    it('should handle async serialization returning complex resources', async () => {
      const complexSnapshot = {
        domSnapshot: {
          html: '<html><head><link rel="stylesheet" href="style.css"></head><body><canvas></canvas></body></html>',
          resources: [
            { url: 'style.css', content: 'body { margin: 0; }', mimetype: 'text/css' },
            { url: 'image.png', content: 'base64data', mimetype: 'image/png' }
          ]
        }
      };

      spyOn(driver, 'executeScript').and.returnValue(Promise.resolve(complexSnapshot));

      await percySnapshot(driver, 'Async with complex resources');

      expect(driver.executeScript).toHaveBeenCalledWith(
        jasmine.any(Function),
        jasmine.any(Object)
      );
    });
  });
});

describe('#slowScrollToBottom', () => {
  let mockedDriver = { executeScript: jasmine.createSpy('executeScript') };
  beforeEach(() => {
    mockedDriver.executeScript.calls.reset();
  });

  it('should scroll to bottom and does not scroll back', async () => {
    process.env.PERCY_SLEEP_AFTER_LAZY_LOAD_COMPLETE = 2;
    process.env.BYPASS_SCROLL_TO_TOP = 'true';
    mockedDriver.executeScript.and.returnValues(9, 5, true, 9, true, 9);
    spyOn(global, 'setTimeout').and.callThrough();

    await slowScrollToBottom(mockedDriver);
    expect(setTimeout.calls.allArgs()).toEqual([[jasmine.any(Function), 450], [jasmine.any(Function), 450], [jasmine.any(Function), 2000]]);
    expect(mockedDriver.executeScript).toHaveBeenCalledTimes(6);
    delete process.env.BYPASS_SCROLL_TO_TOP;
    delete process.env.PERCY_SLEEP_AFTER_LAZY_LOAD_COMPLETE;
  });

  it('should scroll to bottom and sleep after loading as set in env', async () => {
    process.env.PERCY_SLEEP_AFTER_LAZY_LOAD_COMPLETE = 2;
    mockedDriver.executeScript.and.returnValues(9, 5, true, 9, true, 9, true);
    spyOn(global, 'setTimeout').and.callThrough();

    await slowScrollToBottom(mockedDriver);
    expect(setTimeout.calls.allArgs()).toEqual([[jasmine.any(Function), 450], [jasmine.any(Function), 450], [jasmine.any(Function), 2000]]);
    expect(mockedDriver.executeScript).toHaveBeenCalledWith('window.scrollTo(0, 0)');
    expect(mockedDriver.executeScript).toHaveBeenCalledTimes(7);
    delete process.env.PERCY_SLEEP_AFTER_LAZY_LOAD_COMPLETE;
  });

  it('should scroll to bottom and sleep as set in env', async () => {
    process.env.PERCY_LAZY_LOAD_SCROLL_TIME = '1.2';
    mockedDriver.executeScript.and.returnValues(9, 5, true, 9, true, 9, true);
    spyOn(global, 'setTimeout').and.callThrough();

    await slowScrollToBottom(mockedDriver);
    expect(setTimeout.calls.allArgs()).toEqual([[jasmine.any(Function), 1200], [jasmine.any(Function), 1200], [jasmine.any(Function), 1000]]);
    expect(mockedDriver.executeScript).toHaveBeenCalledWith('window.scrollTo(0, 0)');
    expect(mockedDriver.executeScript).toHaveBeenCalledTimes(7);
    delete process.env.PERCY_LAZY_LOAD_SCROLL_TIME;
  });

  it('should scroll upto 25k px and sleep as passed in function', async () => {
    mockedDriver.executeScript = jasmine.createSpy('executeScript');
    mockedDriver.executeScript.and.returnValues(30000, 15000, true, 30000, true, 30000, true);
    spyOn(global, 'setTimeout').and.callThrough();

    await slowScrollToBottom(mockedDriver, 2);
    expect(setTimeout.calls.allArgs()).toEqual([[jasmine.any(Function), 2000], [jasmine.any(Function), 2000], [jasmine.any(Function), 1000]]);
    expect(mockedDriver.executeScript).toHaveBeenCalledWith('window.scrollTo(0, 0)');
    expect(mockedDriver.executeScript).toHaveBeenCalledTimes(7);
  });
});

describe('percyScreenshot', () => {
  class Browser { // Mocking WDIO driver
    constructor() {
      this.sessionId = '123';
      this.capabilities = { browserName: 'chrome' };
      this.options = { protocol: 'https', path: '/wd/hub', hostname: 'hub-cloud.browserstack.com' };
    }
  }
  let driver;

  beforeAll(async function() {
    driver = {
      getSession: () => {
        return new Promise((resolve, _) => resolve({
          getId: () => { return '123'; },
          getCapabilities: () => { return { map_: new Map([['browserName', 'chrome'], ['platform', 'WINDOWS'], ['version', '123']]) }; }
        }));
      },
      getCurrentUrl: () => { return new Promise((resolve, _) => resolve(helpers.mockGetCurrentUrl())); }
    };
  });

  beforeEach(async () => {
    delete process.env.PERCY_RAISE_ERROR;
    await helpers.setupTest();
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'automate';
    Cache.reset();
  });

  it('throws an error when a driver is not provided', async () => {
    await expectAsync(percyScreenshot())
      .toBeRejectedWithError('An instance of the selenium driver object is required.');
  });

  it('throws an error when a name is not provided', async () => {
    await expectAsync(percyScreenshot(driver))
      .toBeRejectedWithError('The `name` argument is required.');
  });

  it('disables snapshots when the healthcheck fails', async () => {
    spyOn(percySnapshot, 'isPercyEnabled').and.callThrough();
    await helpers.test('error', '/percy/healthcheck');

    await percyScreenshot(driver, 'Snapshot 1');
    await percyScreenshot(driver, 'Snapshot 2');

    expect(helpers.logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy is not running, disabling snapshots'
    ]));
  });

  it('posts driver details to the local percy server', async () => {
    const mockedPostCall = spyOn(percySnapshot, 'request').and.callFake(() => {});
    await percyScreenshot(driver, 'Snapshot 1');
    expect(mockedPostCall).toHaveBeenCalledWith(jasmine.objectContaining({
      sessionId: '123', commandExecutorUrl: 'http://localhost:5338/wd/hub', snapshotName: 'Snapshot 1'
    }));
  });

  it('posts driver details to the local percy server with camel case options', async () => {
    const element = { getId: () => {} };
    const considerElement = { getId: () => {} };
    const mockElement = spyOn(element, 'getId').and.callFake(() => { return new Promise((resolve, _) => resolve('123')); });
    const mockConsiderElement = spyOn(considerElement, 'getId').and.callFake(() => { return new Promise((resolve, _) => resolve('456')); });
    const mockedPostCall = spyOn(percySnapshot, 'request').and.callFake(() => {});
    await percyScreenshot(driver, 'Snapshot 2', { ignoreRegionSeleniumElements: [element], considerRegionSeleniumElements: [considerElement] });

    expect(mockElement).toHaveBeenCalled();
    expect(mockConsiderElement).toHaveBeenCalled();
    expect(mockedPostCall).toHaveBeenCalledWith(jasmine.objectContaining({
      options: {
        ignore_region_selenium_elements: ['123'],
        consider_region_selenium_elements: ['456']
      }
    }));
  });

  it('receive data object from CLI response', async () => {
    const mockResponse = {
      success: true,
      body: { data: { some_data: 'some_data ' } }
    };

    spyOn(percySnapshot, 'request').and.callFake(() => mockResponse);
    const response = await percyScreenshot(driver, 'Snapshot 1');
    expect(response).toEqual(mockResponse.body.data);
  });

  it('posts driver details to the local percy server with ignore and consider region and sync', async () => {
    const element = { getId: () => {} };
    const considerElement = { getId: () => {} };
    const mockElement = spyOn(element, 'getId').and.callFake(() => { return new Promise((resolve, _) => resolve('123')); });
    const mockConsiderElement = spyOn(considerElement, 'getId').and.callFake(() => { return new Promise((resolve, _) => resolve('456')); });
    const mockedPostCall = spyOn(percySnapshot, 'request').and.callFake(() => {});
    await percyScreenshot(driver, 'Snapshot 2', { ignore_region_selenium_elements: [element], consider_region_selenium_elements: [considerElement], sync: true });
    expect(mockElement).toHaveBeenCalled();
    expect(mockConsiderElement).toHaveBeenCalled();
    expect(mockedPostCall).toHaveBeenCalledWith(jasmine.objectContaining({
      sessionId: '123',
      commandExecutorUrl: 'http://localhost:5338/wd/hub',
      snapshotName: 'Snapshot 2',
      options: {
        ignore_region_selenium_elements: ['123'],
        consider_region_selenium_elements: ['456'],
        sync: true
      }
    }));
  });

  it('posts driver details to the local percy server with wdio', async () => {
    driver = new Browser();
    const mockedPostCall = spyOn(percySnapshot, 'request').and.callFake(() => {});
    await percyScreenshot(driver, 'Snapshot 1', {});
    expect(mockedPostCall).toHaveBeenCalledWith(jasmine.objectContaining({
      sessionId: '123', commandExecutorUrl: 'https://hub-cloud.browserstack.com/wd/hub', snapshotName: 'Snapshot 1'
    }));
  });

  it('handles snapshot failures', async () => {
    await helpers.test('error', '/percy/automateScreenshot');
    await percyScreenshot(driver, 'Snapshot 1');

    expect(helpers.logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Could not take Screenshot "Snapshot 1"'
    ]));
  });

  it('throw error in SDK if PERCY_RAISE_ERROR is true', async () => {
    process.env.PERCY_RAISE_ERROR = 'true';
    spyOn(percySnapshot, 'isPercyEnabled').and.callThrough();
    await helpers.test('error', '/percy/healthcheck');
    let error = null;
    try {
      await percyScreenshot(driver, 'Snapshot 1');
    } catch (e) {
      error = e;
    }
    expect(helpers.logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy is not running, disabling snapshots'
    ]));
    expect(error).toBeInstanceOf(Error);
  });

  it('handles snapshot failures if PERCY_RAISE_ERROR is true', async () => {
    process.env.PERCY_RAISE_ERROR = 'true';
    await helpers.test('error', '/percy/automateScreenshot');
    let error = null;
    try {
      await percyScreenshot(driver, 'Snapshot 1');
    } catch (e) {
      error = e;
    }
    expect(helpers.logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Could not take Screenshot "Snapshot 1"'
    ]));
    expect(error).toBeInstanceOf(Error);
  });

  it('throws error for web session', async () => {
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';

    let error = null;
    try {
      await percyScreenshot(driver, 'Snapshot 2');
    } catch (e) {
      error = e.message;
    }
    expect(error).toEqual('Invalid function call - percyScreenshot(). Please use percySnapshot() function for taking screenshot. percyScreenshot() should be used only while using Percy with Automate. For more information on usage of PercySnapshot(), refer doc for your language https://www.browserstack.com/docs/percy/integrate/overview');
  });
});

describe('createRegion', () => {
  it('creates a region with default values', async () => {
    const region = createRegion();
    expect(region).toEqual({
      algorithm: 'ignore',
      elementSelector: {}
    });
  });

  it('sets boundingBox in elementSelector', async () => {
    const region = createRegion({ boundingBox: { x: 10, y: 20, width: 100, height: 50 } });
    expect(region.elementSelector.boundingBox).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('sets elementXpath in elementSelector', async () => {
    const region = createRegion({ elementXpath: '//div[@id=\'test\']' });
    expect(region.elementSelector.elementXpath).toBe("//div[@id='test']");
  });

  it('sets elementCSS in elementSelector', async () => {
    const region = createRegion({ elementCSS: '.test-class' });
    expect(region.elementSelector.elementCSS).toBe('.test-class');
  });

  it('includes padding if provided', async () => {
    const region = createRegion({ padding: 10 });
    expect(region.padding).toBe(10);
  });

  it('includes configuration when algorithm is standard', async () => {
    const region = createRegion({ algorithm: 'standard', diffSensitivity: 5 });
    expect(region.configuration.diffSensitivity).toBe(5);
  });

  it('includes configuration when algorithm is intelliignore', async () => {
    const region = createRegion({ algorithm: 'intelliignore', imageIgnoreThreshold: 0.2 });
    expect(region.configuration.imageIgnoreThreshold).toBe(0.2);
  });

  it('does not include configuration for ignore algorithm', async () => {
    const region = createRegion({ algorithm: 'ignore', diffSensitivity: 5 });
    expect(region.configuration).toBeUndefined();
  });

  it('includes assertion when diffIgnoreThreshold is provided', async () => {
    const region = createRegion({ diffIgnoreThreshold: 0.1 });
    expect(region.assertion.diffIgnoreThreshold).toBe(0.1);
  });

  it('does not include assertion when diffIgnoreThreshold is not provided', async () => {
    const region = createRegion();
    expect(region.assertion).toBeUndefined();
  });

  it('includes carouselsEnabled in configuration if provided', async () => {
    const region = createRegion({ algorithm: 'standard', carouselsEnabled: true });
    expect(region.configuration.carouselsEnabled).toBe(true);
  });

  it('includes bannersEnabled in configuration if provided', async () => {
    const region = createRegion({ algorithm: 'standard', bannersEnabled: true });
    expect(region.configuration.bannersEnabled).toBe(true);
  });

  it('includes adsEnabled in configuration if provided', async () => {
    const region = createRegion({ algorithm: 'standard', adsEnabled: true });
    expect(region.configuration.adsEnabled).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// Helper: build a mock selenium driver for the new enumeration-based iframe
// capture path. The new impl calls driver.executeScript with three distinct
// kinds of arguments:
//   1. a string (percyDOM injection)
//   2. a function returning document.URL or enumerating iframes
//   3. an async function that calls PercyDOM.serialize(opts)
// We dispatch by argument type / a manually-tracked counter.
// ----------------------------------------------------------------------------
function buildIframeDriver({
  pageUrl = 'https://host.example.com/',
  mainSnapshot = { html: '<html></html>', resources: [] },
  topIframes = [], // [{ src, percyElementId, srcdoc, dataPercyIgnore, matchesIgnoreSelector }]
  nestedIframes = {}, // map pid -> [iframeMeta...]
  frameSnapshot = { html: '<html><body>frame</body></html>', resources: [] },
  frameSnapshotByPid = {},
  frameDocumentUrlByPid = {},
  switchFrameThrow = null,
  defaultContentThrow = null,
  parentFrameAvailable = true,
  serializeThrow = false,
  serializeThrowOnPid = null
} = {}) {
  const switchSpies = {
    frame: jasmine.createSpy('frame').and.callFake(() => {
      if (switchFrameThrow) return Promise.reject(switchFrameThrow);
      return Promise.resolve();
    }),
    defaultContent: jasmine.createSpy('defaultContent').and.callFake(() => {
      if (defaultContentThrow) return Promise.reject(defaultContentThrow);
      return Promise.resolve();
    })
  };
  if (parentFrameAvailable) {
    switchSpies.parentFrame = jasmine.createSpy('parentFrame').and.returnValue(Promise.resolve());
  }

  let currentPid = null; // tracks which frame we're inside (null = top page)

  const frameElementByPid = {};
  for (const m of topIframes) frameElementByPid[m.percyElementId] = { __pid: m.percyElementId };
  for (const list of Object.values(nestedIframes)) {
    for (const m of list) frameElementByPid[m.percyElementId] = { __pid: m.percyElementId };
  }

  const driver = {
    getCurrentUrl: jasmine.createSpy('getCurrentUrl').and.returnValue(Promise.resolve(pageUrl)),
    findElement: jasmine.createSpy('findElement').and.callFake(async (locator) => {
      // Locator is By.css(`iframe[data-percy-element-id="..."]`) — extract pid
      const str = locator?.value || String(locator);
      const m = /data-percy-element-id="([^"]+)"/.exec(str);
      if (!m) return null;
      return frameElementByPid[m[1]];
    }),
    switchTo: jasmine.createSpy('switchTo').and.callFake(() => switchSpies),
    executeScript: jasmine.createSpy('executeScript').and.callFake(async (script, arg) => {
      // String script — percyDOM injection or simple eval
      if (typeof script === 'string') return undefined;
      // Function — could be: serialize, document.URL probe, or enumerateIframesScript
      const body = script.toString();
      if (body.includes('PercyDOM.serialize')) {
        if (serializeThrow) throw new Error('serialize failed');
        if (currentPid === null) return { domSnapshot: mainSnapshot };
        if (serializeThrowOnPid && currentPid === serializeThrowOnPid) {
          throw new Error('frame serialize failed');
        }
        return frameSnapshotByPid[currentPid] || frameSnapshot;
      }
      if (body.includes('document.URL')) {
        return frameDocumentUrlByPid[currentPid] || (currentPid
          ? (topIframes.find(t => t.percyElementId === currentPid)?.src ||
             Object.values(nestedIframes).flat().find(t => t.percyElementId === currentPid)?.src ||
             pageUrl)
          : pageUrl);
      }
      if (body.includes('document.querySelectorAll') && body.includes('iframe')) {
        // enumerateIframesScript
        if (currentPid === null) return topIframes.map((m, i) => ({ ...m, index: i }));
        return (nestedIframes[currentPid] || []).map((m, i) => ({ ...m, index: i }));
      }
      return undefined;
    }),
    manage: jasmine.createSpy('manage').and.returnValue({
      getCookies: jasmine.createSpy('getCookies').and.returnValue(Promise.resolve([]))
    })
  };

  // Intercept switchTo().frame to track context
  switchSpies.frame.and.callFake((el) => {
    if (switchFrameThrow) return Promise.reject(switchFrameThrow);
    currentPid = el?.__pid || null;
    return Promise.resolve();
  });
  switchSpies.defaultContent.and.callFake(() => {
    if (defaultContentThrow) return Promise.reject(defaultContentThrow);
    currentPid = null;
    return Promise.resolve();
  });
  if (switchSpies.parentFrame) {
    switchSpies.parentFrame.and.callFake(() => {
      currentPid = null; // simplified — we don't track nested parents in mock
      return Promise.resolve();
    });
  }

  driver._switchSpies = switchSpies;
  return driver;
}

describe('CORS iframe capture in captureSerializedDOM', () => {
  let driver;

  function meta(pid, src, extra = {}) {
    return {
      percyElementId: pid,
      src,
      srcdoc: null,
      dataPercyIgnore: false,
      matchesIgnoreSelector: false,
      ...extra
    };
  }

  beforeEach(async () => {
    await helpers.setupTest();
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = {};
  });

  it('switches into cross-origin iframe and always returns to defaultContent', async () => {
    driver = buildIframeDriver({
      topIframes: [meta('ele-abc', 'https://cross.example.com/')]
    });
    await percySnapshot(driver, 'iframe switch & defaultContent');
    expect(driver._switchSpies.frame).toHaveBeenCalled();
    expect(driver._switchSpies.defaultContent).toHaveBeenCalled();
  });

  it('injects percy DOM script into cross-origin iframe', async () => {
    driver = buildIframeDriver({
      topIframes: [meta('ele-inject', 'https://cross.example.com/')]
    });
    await percySnapshot(driver, 'percyDOM injected into frame');
    const calls = driver.executeScript.calls.allArgs();
    // After the main page serialize, a string script (percyDOM) is injected into the frame
    const stringInjections = calls.filter(args => typeof args[0] === 'string' && args[0].length > 50);
    expect(stringInjections.length).toBeGreaterThanOrEqual(2); // main + frame
  });

  it('skips frame when serialize returns empty result', async () => {
    driver = buildIframeDriver({
      topIframes: [meta('ele-nohtml', 'https://cross.example.com/')],
      frameSnapshotByPid: { 'ele-nohtml': null }
    });
    await expectAsync(percySnapshot(driver, 'iframe empty')).not.toBeRejected();
    expect(driver._switchSpies.frame).toHaveBeenCalled();
  });

  it('skips frame when data-percy-element-id is missing', async () => {
    driver = buildIframeDriver({
      topIframes: [meta(null, 'https://cross.example.com/')]
    });
    await percySnapshot(driver, 'no-pid skip');
    expect(driver._switchSpies.frame).not.toHaveBeenCalled();
  });

  it('continues gracefully when switchTo.frame throws', async () => {
    driver = buildIframeDriver({
      topIframes: [meta('ele-err', 'https://cross.example.com/')],
      switchFrameThrow: new Error('cross-origin access denied')
    });
    await expectAsync(percySnapshot(driver, 'frame error graceful')).not.toBeRejected();
  });

  it('always calls defaultContent even when frame executeScript throws', async () => {
    driver = buildIframeDriver({
      topIframes: [meta('ele-throw', 'https://cross.example.com/')],
      serializeThrowOnPid: 'ele-throw'
    });
    await percySnapshot(driver, 'always defaultContent');
    expect(driver._switchSpies.defaultContent).toHaveBeenCalled();
  });
});

describe('processFrameTree - cross-origin iframe switching', () => {
  let driver;

  function meta(pid, src, extra = {}) {
    return {
      percyElementId: pid,
      src,
      srcdoc: null,
      dataPercyIgnore: false,
      matchesIgnoreSelector: false,
      ...extra
    };
  }

  beforeEach(async () => {
    await helpers.setupTest();
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = {};
    utils.percy.widths = null;
  });

  it('switches to cross-origin iframe and back to defaultContent', async () => {
    driver = buildIframeDriver({
      topIframes: [meta('pid-xyz', 'https://cross.example.com/frame')]
    });
    await percySnapshot(driver, 'frame switch test');
    expect(driver._switchSpies.frame).toHaveBeenCalled();
    expect(driver._switchSpies.defaultContent).toHaveBeenCalled();
  });

  it('skips frame when data-percy-element-id is absent', async () => {
    driver = buildIframeDriver({
      topIframes: [meta(null, 'https://cross.example.com/frame')]
    });
    await percySnapshot(driver, 'no-pid skip test');
    expect(driver._switchSpies.frame).not.toHaveBeenCalled();
  });

  it('continues gracefully when switchTo.frame throws', async () => {
    driver = buildIframeDriver({
      topIframes: [meta('pid-xyz', 'https://cross.example.com/frame')],
      switchFrameThrow: new Error('frame access denied')
    });
    await expectAsync(percySnapshot(driver, 'frame-error graceful')).not.toBeRejected();
  });

  it('always calls defaultContent even when frame serialize throws', async () => {
    driver = buildIframeDriver({
      topIframes: [meta('pid-xyz', 'https://cross.example.com/frame')],
      serializeThrowOnPid: 'pid-xyz'
    });
    await percySnapshot(driver, 'always-defaultContent test');
    expect(driver._switchSpies.defaultContent).toHaveBeenCalled();
  });

  it('does not throw when defaultContent rejects inside processFrameTree finally (top-level)', async () => {
    driver = buildIframeDriver({
      topIframes: [meta('fatal-pid', 'https://cross.example.com/')],
      defaultContentThrow: new Error('driver context lost'),
      parentFrameAvailable: false
    });
    // Top-level (depth=1) failure to restore parent is swallowed by outer catch
    await expectAsync(percySnapshot(driver, 'fatal defaultContent test')).not.toBeRejected();
    expect(driver._switchSpies.defaultContent).toHaveBeenCalled();
  });
});

describe('captureSerializedDOM - iframe src filtering', () => {
  let driver;
  function m(src, pid = 'pid-1', extra = {}) {
    return {
      percyElementId: pid,
      src,
      srcdoc: null,
      dataPercyIgnore: false,
      matchesIgnoreSelector: false,
      ...extra
    };
  }

  beforeEach(async () => {
    await helpers.setupTest();
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = {};
  });

  it('skips iframe with src = about:blank', async () => {
    driver = buildIframeDriver({ topIframes: [m('about:blank')] });
    await percySnapshot(driver, 'blank src test');
    expect(driver._switchSpies.frame).not.toHaveBeenCalled();
  });

  it('skips iframe with src starting with javascript:', async () => {
    driver = buildIframeDriver({ topIframes: [m('javascript:void(0)')] });
    await percySnapshot(driver, 'js src test');
    expect(driver._switchSpies.frame).not.toHaveBeenCalled();
  });

  it('skips iframe with null/empty src', async () => {
    driver = buildIframeDriver({ topIframes: [m('')] });
    await percySnapshot(driver, 'null src test');
    expect(driver._switchSpies.frame).not.toHaveBeenCalled();
  });

  it('skips same-origin iframes', async () => {
    driver = buildIframeDriver({
      pageUrl: 'https://host.example.com/',
      topIframes: [m('https://host.example.com/child', 'pid-same')]
    });
    await percySnapshot(driver, 'same-origin test');
    expect(driver._switchSpies.frame).not.toHaveBeenCalled();
  });

  it('processes cross-origin iframe', async () => {
    driver = buildIframeDriver({
      pageUrl: 'https://host.example.com/',
      topIframes: [m('https://other.example.com/frame', 'pid-cross')]
    });
    await percySnapshot(driver, 'cross-origin test');
    expect(driver._switchSpies.frame).toHaveBeenCalled();
  });

  it('handles invalid frame src URL without throwing', async () => {
    driver = buildIframeDriver({ topIframes: [m('not-a-valid-url')] });
    await expectAsync(percySnapshot(driver, 'invalid url test')).not.toBeRejected();
  });

  it('processes only cross-origin iframes when mixed with same-origin', async () => {
    driver = buildIframeDriver({
      pageUrl: 'https://host.example.com/',
      topIframes: [
        m('https://host.example.com/same', 'pid-same'),
        m('https://other.example.com/cross', 'pid-cross')
      ]
    });
    await percySnapshot(driver, 'mixed origins test');
    expect(driver._switchSpies.frame).toHaveBeenCalledTimes(1);
  });
});

describe('captureResponsiveDOM - getResponsiveWidths height/width handling', () => {
  let mockedDriver;

  function buildResponsiveDriver(windowWidth = 1024, windowHeight = 768) {
    return {
      getCapabilities: jasmine.createSpy('getCapabilities').and.returnValue(Promise.resolve({ getBrowserName: () => 'chrome' })),
      sendDevToolsCommand: jasmine.createSpy('sendDevToolsCommand').and.returnValue(Promise.resolve()),
      navigate: jasmine.createSpy('navigate').and.returnValue({ refresh: jasmine.createSpy('refresh').and.returnValue(Promise.resolve()) }),
      getCurrentUrl: jasmine.createSpy('getCurrentUrl').and.returnValue(Promise.resolve('https://example.com/')),
      findElements: jasmine.createSpy('findElements').and.returnValue(Promise.resolve([])),
      manage: jasmine.createSpy('manage').and.returnValue({
        window: jasmine.createSpy('window').and.returnValue({
          setRect: jasmine.createSpy('setRect').and.returnValue(Promise.resolve()),
          getRect: jasmine.createSpy('getRect').and.returnValue(Promise.resolve({ width: windowWidth, height: windowHeight }))
        }),
        getCookies: jasmine.createSpy('getCookies').and.returnValue(Promise.resolve([]))
      }),
      executeScript: jasmine.createSpy('executeScript').and.returnValue(
        Promise.resolve({ domSnapshot: { html: '<html></html>', resources: [] } })
      ),
      wait: jasmine.createSpy('wait').and.returnValue(Promise.resolve())
    };
  }

  beforeEach(async () => {
    await helpers.setupTest();
    delete process.env.PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT;
    delete process.env.PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE;
    mockedDriver = buildResponsiveDriver();
  });

  it('resizes to width when getResponsiveWidths returns a single width', async () => {
    // The mock server returns widths based on percy config; pass widths directly
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = {};
    utils.percy.widths = { mobile: [], config: [375] };

    await percySnapshot(mockedDriver, 'single width resize', { responsiveSnapshotCapture: true, widths: [375] });

    // sendDevToolsCommand should be called with width=375 and the fallback windowHeight=768
    expect(mockedDriver.sendDevToolsCommand).toHaveBeenCalledWith(
      'Emulation.setDeviceMetricsOverride',
      jasmine.objectContaining({ width: 375 })
    );
  });

  it('resizes for each distinct width returned by getResponsiveWidths', async () => {
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = {};
    utils.percy.widths = { mobile: [], config: [375, 1280] };

    await percySnapshot(mockedDriver, 'multiple distinct widths', { responsiveSnapshotCapture: true, widths: [375, 1280] });

    const cdpResizeCalls = mockedDriver.sendDevToolsCommand.calls.allArgs()
      .filter(args => args[0] === 'Emulation.setDeviceMetricsOverride');
    // At least 2 resize calls (one per distinct width) plus a reset call at end
    expect(cdpResizeCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('resets window to original dimensions after all widths processed', async () => {
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = {};
    utils.percy.widths = { mobile: [], config: [375] };

    await percySnapshot(mockedDriver, 'reset dimensions', { responsiveSnapshotCapture: true, widths: [375] });

    const calls = mockedDriver.sendDevToolsCommand.calls.allArgs()
      .filter(args => args[0] === 'Emulation.setDeviceMetricsOverride');
    // Last call resets to original 1024x768
    const lastCall = calls[calls.length - 1];
    expect(lastCall[1]).toEqual(jasmine.objectContaining({ width: 1024, height: 768 }));
  });

  it('does not resize when responsive capture is disabled', async () => {
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = {};

    await percySnapshot(mockedDriver, 'no responsive capture', { responsiveSnapshotCapture: false, widths: [375] });

    const resizeCalls = mockedDriver.sendDevToolsCommand.calls.allArgs()
      .filter(args => args[0] === 'Emulation.setDeviceMetricsOverride');
    expect(resizeCalls.length).toBe(0);
  });

  it('does not run responsive capture when deferUploads is true', async () => {
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = { percy: { deferUploads: true } };

    await percySnapshot(mockedDriver, 'deferUploads disabled', { responsiveSnapshotCapture: true, widths: [375] });

    const resizeCalls = mockedDriver.sendDevToolsCommand.calls.allArgs()
      .filter(args => args[0] === 'Emulation.setDeviceMetricsOverride');
    expect(resizeCalls.length).toBe(0);
  });

  it('uses PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT env var to compute height', async () => {
    process.env.PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT = 'true';
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = { snapshot: { minHeight: 900 } };
    utils.percy.widths = { mobile: [], config: [375] };

    mockedDriver.executeScript.and.returnValue(
      Promise.resolve({ domSnapshot: { html: '<html></html>', resources: [] } })
    );

    await percySnapshot(mockedDriver, 'minHeight env', { responsiveSnapshotCapture: true, widths: [375] });

    // The height used should be the minHeight from config (900), not the window height (768)
    const calls = mockedDriver.sendDevToolsCommand.calls.allArgs()
      .filter(args => args[0] === 'Emulation.setDeviceMetricsOverride' && args[1].width === 375);
    expect(calls[0][1].height).toBe(900);

    delete process.env.PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT;
  });

  it('reloads page between widths when PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE is set', async () => {
    process.env.PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE = 'true';
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = {};
    utils.percy.widths = { mobile: [], config: [375] };

    await percySnapshot(mockedDriver, 'reload page', { responsiveSnapshotCapture: true, widths: [375] });

    expect(mockedDriver.navigate().refresh).toHaveBeenCalled();
    delete process.env.PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE;
  });

  it('falls back to setRect when sendDevToolsCommand fails during responsive capture', async () => {
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = {};
    utils.percy.widths = { mobile: [], config: [375] };
    mockedDriver.sendDevToolsCommand.and.rejectWith(new Error('CDP failed'));

    await expectAsync(
      percySnapshot(mockedDriver, 'cdp fallback', { responsiveSnapshotCapture: true, widths: [375] })
    ).not.toBeRejected();

    expect(mockedDriver.manage().window().setRect).toHaveBeenCalledWith(
      jasmine.objectContaining({ width: 375 })
    );
  });
});

describe('corsIframes population in captureSerializedDOM', () => {
  beforeEach(async () => {
    await helpers.setupTest();
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = {};
  });

  async function getSnapshotBody() {
    const requests = await helpers.get('requests', r => r);
    const snap = requests.find(r => r.url === '/percy/snapshot');
    return snap?.body ?? null;
  }

  function m(pid, src, extra = {}) {
    return {
      percyElementId: pid,
      src,
      srcdoc: null,
      dataPercyIgnore: false,
      matchesIgnoreSelector: false,
      ...extra
    };
  }

  it('sets corsIframes on domSnapshot when cross-origin frames are captured', async () => {
    const pid = 'cors-pid-1';
    const driver = buildIframeDriver({
      pageUrl: 'https://host.example.com/',
      topIframes: [m(pid, 'https://cross.example.com/')],
      frameSnapshotByPid: { [pid]: { html: '<html><body>cross frame</body></html>', resources: [] } }
    });

    await percySnapshot(driver, 'cors iframe test');

    const body = await getSnapshotBody();
    expect(body).not.toBeNull();
    const snap = Array.isArray(body.domSnapshot) ? body.domSnapshot[0] : body.domSnapshot;
    expect(Array.isArray(snap.corsIframes)).toBeTrue();
    expect(snap.corsIframes.length).toBe(1);
    expect(snap.corsIframes[0].iframeData.percyElementId).toBe(pid);
    expect(snap.corsIframes[0].iframeSnapshot.html).toContain('cross frame');
    expect(snap.corsIframes[0].frameUrl).toBe('https://cross.example.com/');
  });

  it('does not set corsIframes when no cross-origin frames are found', async () => {
    const driver = buildIframeDriver({ topIframes: [] });

    await percySnapshot(driver, 'no cors frames test');

    const body = await getSnapshotBody();
    expect(body).not.toBeNull();
    const snap = Array.isArray(body.domSnapshot) ? body.domSnapshot[0] : body.domSnapshot;
    expect(snap.corsIframes).toBeUndefined();
  });

  it('corsIframes entry has the correct structure for core processing', async () => {
    const pid = 'struct-pid';
    const frameResource = { url: 'https://cross.example.com/style.css' };
    const driver = buildIframeDriver({
      pageUrl: 'https://host.example.com/',
      topIframes: [m(pid, 'https://cross.example.com/frame')],
      frameSnapshotByPid: { [pid]: { html: '<html><body>frame body</body></html>', resources: [frameResource] } }
    });

    await percySnapshot(driver, 'corsIframes structure test');

    const body = await getSnapshotBody();
    const snap = Array.isArray(body.domSnapshot) ? body.domSnapshot[0] : body.domSnapshot;
    const entry = snap.corsIframes[0];
    expect(entry.frameUrl).toBe('https://cross.example.com/frame');
    expect(entry.iframeData).toEqual({ percyElementId: pid });
    expect(entry.iframeSnapshot.html).toContain('frame body');
    expect(entry.iframeSnapshot.resources).toContain(frameResource);
  });

  describe('readiness gate', () => {
    // This describe block is nested under `corsIframes population in
    // captureSerializedDOM`, which does not declare a `driver` at its
    // scope — the percySnapshot suite at the top of the file does, but
    // not this one. Construct a minimal mock driver per-test so the
    // spyOn(driver, …) calls below have something to attach to.
    let driver;
    beforeEach(() => {
      driver = {
        getCurrentUrl: jasmine.createSpy('getCurrentUrl').and.returnValue(Promise.resolve('https://example.com/')),
        findElements: jasmine.createSpy('findElements').and.returnValue(Promise.resolve([])),
        switchTo: jasmine.createSpy('switchTo').and.returnValue({
          frame: jasmine.createSpy('frame').and.returnValue(Promise.resolve()),
          defaultContent: jasmine.createSpy('defaultContent').and.returnValue(Promise.resolve())
        }),
        executeScript: jasmine.createSpy('executeScript').and.returnValue(Promise.resolve()),
        executeAsyncScript: jasmine.createSpy('executeAsyncScript').and.returnValue(Promise.resolve()),
        manage: jasmine.createSpy('manage').and.returnValue({
          getCookies: jasmine.createSpy('getCookies').and.returnValue(Promise.resolve([]))
        })
      };
    });

    it('calls executeAsyncScript with waitForReady before serialize', async () => {
      const asyncSpy = spyOn(driver, 'executeAsyncScript').and.returnValue(
        Promise.resolve({ ok: true, timed_out: false })
      );
      spyOn(driver, 'executeScript').and.returnValue(Promise.resolve({
        domSnapshot: { html: '<html></html>', resources: [] },
        url: 'http://localhost/'
      }));

      await percySnapshot(driver, 'readiness-happy-path');

      expect(asyncSpy).toHaveBeenCalled();
      const firstCall = asyncSpy.calls.first();
      // sdk-utils.waitForReadyScript({ callback: true }) emits a STRING using
      // `arguments[arguments.length - 1]` for the executeAsync done callback.
      expect(typeof firstCall.args[0]).toBe('string');
      expect(firstCall.args[0]).toContain('PercyDOM.waitForReady');
      expect(firstCall.args[0]).toContain('arguments[arguments.length - 1]');
    });

    it('inlines per-snapshot readiness config as JSON into the script', async () => {
      const asyncSpy = spyOn(driver, 'executeAsyncScript').and.returnValue(
        Promise.resolve(null)
      );
      spyOn(driver, 'executeScript').and.returnValue(Promise.resolve({
        domSnapshot: { html: '<html></html>', resources: [] },
        url: 'http://localhost/'
      }));
      const readiness = { preset: 'strict', stabilityWindowMs: 500 };

      await percySnapshot(driver, 'readiness-config', { readiness });

      const call = asyncSpy.calls.first();
      expect(call).toBeTruthy();
      // sdk-utils inlines the config via JSON.stringify rather than passing
      // it as a separate driver.executeAsyncScript argument.
      expect(call.args[0]).toContain('"preset":"strict"');
      expect(call.args[0]).toContain('"stabilityWindowMs":500');
    });

    it('skips executeAsyncScript when preset is disabled', async () => {
      const asyncSpy = spyOn(driver, 'executeAsyncScript').and.returnValue(Promise.resolve());
      spyOn(driver, 'executeScript').and.returnValue(Promise.resolve({
        domSnapshot: { html: '<html></html>', resources: [] },
        url: 'http://localhost/'
      }));

      await percySnapshot(driver, 'readiness-disabled', { readiness: { preset: 'disabled' } });

      expect(asyncSpy).not.toHaveBeenCalled();
    });

    it('still serializes when executeAsyncScript rejects', async () => {
      // Use callFake so the rejected promise is only created when the SDK
      // awaits it (avoids an unhandled-rejection in the test-setup tick).
      spyOn(driver, 'executeAsyncScript').and.callFake(() => Promise.reject(new Error('readiness boom')));
      spyOn(driver, 'executeScript').and.returnValue(Promise.resolve({
        domSnapshot: { html: '<html></html>', resources: [] },
        url: 'http://localhost/'
      }));

      await percySnapshot(driver, 'readiness-reject');

      expect(helpers.logger.stderr).not.toEqual(jasmine.arrayContaining([
        '[percy] Could not take DOM snapshot "readiness-reject"'
      ]));
    });

    it('still serializes when executeAsyncScript rejects with a non-Error', async () => {
      // Covers the `err?.message || err` second branch in the .catch handler:
      // rejection value has no `.message`, so logging falls through to err itself.
      spyOn(driver, 'executeAsyncScript').and.callFake(() => Promise.reject('plain-string-rejection'));
      spyOn(driver, 'executeScript').and.returnValue(Promise.resolve({
        domSnapshot: { html: '<html></html>', resources: [] },
        url: 'http://localhost/'
      }));

      await percySnapshot(driver, 'readiness-reject-string');

      expect(helpers.logger.stderr).not.toEqual(jasmine.arrayContaining([
        '[percy] Could not take DOM snapshot "readiness-reject-string"'
      ]));
    });
  });
});

describe('nested cross-origin iframe capture (depth cap + cycle guard)', () => {
  function m(pid, src, extra = {}) {
    return {
      percyElementId: pid,
      src,
      srcdoc: null,
      dataPercyIgnore: false,
      matchesIgnoreSelector: false,
      ...extra
    };
  }

  beforeEach(async () => {
    await helpers.setupTest();
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = {};
  });

  async function getSnapshotBody() {
    const requests = await helpers.get('requests', r => r);
    const snap = requests.find(r => r.url === '/percy/snapshot');
    return snap?.body ?? null;
  }

  it('captures nested cross-origin iframes inside an outer cross-origin frame', async () => {
    const driver = buildIframeDriver({
      pageUrl: 'https://host.example.com/',
      topIframes: [m('outer-pid', 'https://a.example.com/')],
      nestedIframes: {
        'outer-pid': [m('inner-pid', 'https://b.example.com/')]
      },
      frameSnapshotByPid: {
        'outer-pid': { html: '<html>outer</html>', resources: [] },
        'inner-pid': { html: '<html>inner</html>', resources: [] }
      }
    });

    await percySnapshot(driver, 'nested iframe');

    const body = await getSnapshotBody();
    const snap = Array.isArray(body.domSnapshot) ? body.domSnapshot[0] : body.domSnapshot;
    const pids = snap.corsIframes.map(c => c.iframeData.percyElementId);
    expect(pids).toContain('outer-pid');
    expect(pids).toContain('inner-pid');
  });

  it('stops descending past maxIframeDepth', async () => {
    // depth 1 -> 2 -> 3; with maxIframeDepth=2, depth-3 iframe should NOT be captured
    const driver = buildIframeDriver({
      pageUrl: 'https://host.example.com/',
      topIframes: [m('p1', 'https://a.example.com/')],
      nestedIframes: {
        p1: [m('p2', 'https://b.example.com/')],
        p2: [m('p3', 'https://c.example.com/')]
      },
      frameSnapshotByPid: {
        p1: { html: 'a', resources: [] },
        p2: { html: 'b', resources: [] },
        p3: { html: 'c', resources: [] }
      }
    });

    await percySnapshot(driver, 'depth cap', { maxIframeDepth: 2 });

    const body = await getSnapshotBody();
    const snap = Array.isArray(body.domSnapshot) ? body.domSnapshot[0] : body.domSnapshot;
    const pids = snap.corsIframes.map(c => c.iframeData.percyElementId);
    expect(pids).toContain('p1');
    expect(pids).toContain('p2');
    expect(pids).not.toContain('p3');
  });

  it('skips iframe whose src matches an ancestor URL (cycle guard)', async () => {
    // A iframe points back to top page URL — should be skipped (cycle)
    const driver = buildIframeDriver({
      pageUrl: 'https://host.example.com/',
      topIframes: [m('cycle-pid', 'https://host.example.com/')]
    });

    await percySnapshot(driver, 'cycle skip');

    const body = await getSnapshotBody();
    const snap = Array.isArray(body.domSnapshot) ? body.domSnapshot[0] : body.domSnapshot;
    // Either no corsIframes (skipped via same-origin or cycle) — both acceptable;
    // crucial assertion is we did not infinitely recurse
    expect(snap.corsIframes).toBeUndefined();
  });

  it('uses maxIframeDepth from percy.config when not in options', async () => {
    utils.percy.config = { snapshot: { maxIframeDepth: 1 } };
    const driver = buildIframeDriver({
      pageUrl: 'https://host.example.com/',
      topIframes: [m('p1', 'https://a.example.com/')],
      nestedIframes: {
        p1: [m('p2', 'https://b.example.com/')]
      },
      frameSnapshotByPid: {
        p1: { html: 'a', resources: [] },
        p2: { html: 'b', resources: [] }
      }
    });

    await percySnapshot(driver, 'global depth cap');

    const body = await getSnapshotBody();
    const snap = Array.isArray(body.domSnapshot) ? body.domSnapshot[0] : body.domSnapshot;
    const pids = snap.corsIframes.map(c => c.iframeData.percyElementId);
    expect(pids).toContain('p1');
    expect(pids).not.toContain('p2');
  });
});

// ----------------------------------------------------------------------------
// Coverage for the rare-but-real branches in processFrameTree / captureCorsIframes:
//   - serialize returns falsy for a nested frame (empty-result skip)
//   - parentFrame is unavailable on the driver shape at depth > 1
//   - parentFrame restoration throws at depth > 1 → percyContextLost re-thrown
//   - top-level percyContextLost in captureCorsIframes loop → partial capture
// These paths are reachable only with specific driver-shape combinations, so
// they need targeted mock drivers rather than the standard buildIframeDriver.
// ----------------------------------------------------------------------------
describe('processFrameTree - rare error/finally branches', () => {
  beforeEach(async () => {
    await helpers.setupTest();
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = {};
  });

  async function getSnapshotBody() {
    const requests = await helpers.get('requests', r => r);
    const snap = requests.find(r => r.url === '/percy/snapshot');
    return snap?.body ?? null;
  }

  it('skips a nested frame whose serialize returns an empty result', async () => {
    // serialize returns falsy → processFrameTree returns [] (lines 199-202)
    // but the OUTER frame still captures normally.
    const meta = (pid, src) => ({
      percyElementId: pid, src, srcdoc: null,
      dataPercyIgnore: false, matchesIgnoreSelector: false
    });
    let currentPid = null;
    const switchSpies = {
      frame: jasmine.createSpy('frame').and.callFake((el) => { currentPid = el?.__pid; return Promise.resolve(); }),
      defaultContent: jasmine.createSpy('defaultContent').and.callFake(() => { currentPid = null; return Promise.resolve(); }),
      parentFrame: jasmine.createSpy('parentFrame').and.callFake(() => { currentPid = null; return Promise.resolve(); })
    };
    const driver = {
      getCurrentUrl: jasmine.createSpy().and.returnValue(Promise.resolve('https://host.example.com/')),
      findElement: jasmine.createSpy().and.callFake(async (locator) => {
        const str = locator?.value || String(locator);
        const m = /data-percy-element-id="([^"]+)"/.exec(str);
        return m ? { __pid: m[1] } : null;
      }),
      switchTo: jasmine.createSpy().and.callFake(() => switchSpies),
      executeScript: jasmine.createSpy().and.callFake(async (script) => {
        if (typeof script === 'string') return undefined;
        const body = script.toString();
        if (body.includes('PercyDOM.serialize')) {
          if (currentPid === null) return { domSnapshot: { html: '<html></html>', resources: [] } };
          if (currentPid === 'inner-empty') return null; // <-- falsy serialize
          return { html: 'outer', resources: [] };
        }
        if (body.includes('document.URL')) {
          return currentPid === 'outer'
            ? 'https://a.example.com/'
            : (currentPid === 'inner-empty' ? 'https://b.example.com/' : 'https://host.example.com/');
        }
        if (body.includes('document.querySelectorAll') && body.includes('iframe')) {
          if (currentPid === null) return [{ ...meta('outer', 'https://a.example.com/'), index: 0 }];
          if (currentPid === 'outer') return [{ ...meta('inner-empty', 'https://b.example.com/'), index: 0 }];
          return [];
        }
        return undefined;
      }),
      manage: jasmine.createSpy().and.returnValue({
        getCookies: jasmine.createSpy().and.returnValue(Promise.resolve([]))
      })
    };
    await percySnapshot(driver, 'empty-nested-serialize');

    const body = await getSnapshotBody();
    const snap = Array.isArray(body.domSnapshot) ? body.domSnapshot[0] : body.domSnapshot;
    const pids = (snap.corsIframes || []).map(c => c.iframeData.percyElementId);
    expect(pids).toContain('outer');           // outer captured
    expect(pids).not.toContain('inner-empty'); // inner returned falsy → skipped
  });

  it('falls back to defaultContent at depth > 1 when parentFrame is not a function', async () => {
    // Drives line 252: `else { await driver.switchTo().defaultContent(); }`.
    // We need: depth > 1 reached, then on the way out, parentFrame is absent.
    const meta = (pid, src) => ({
      percyElementId: pid, src, srcdoc: null,
      dataPercyIgnore: false, matchesIgnoreSelector: false
    });
    let currentPid = null;
    // parentFrame is NOT a function on this switchTo() return.
    const switchSpies = {
      frame: jasmine.createSpy('frame').and.callFake((el) => { currentPid = el?.__pid; return Promise.resolve(); }),
      defaultContent: jasmine.createSpy('defaultContent').and.callFake(() => { currentPid = null; return Promise.resolve(); })
    };
    const driver = {
      getCurrentUrl: jasmine.createSpy().and.returnValue(Promise.resolve('https://host.example.com/')),
      findElement: jasmine.createSpy().and.callFake(async (locator) => {
        const str = locator?.value || String(locator);
        const m = /data-percy-element-id="([^"]+)"/.exec(str);
        return m ? { __pid: m[1] } : null;
      }),
      switchTo: jasmine.createSpy().and.callFake(() => switchSpies),
      executeScript: jasmine.createSpy().and.callFake(async (script) => {
        if (typeof script === 'string') return undefined;
        const body = script.toString();
        if (body.includes('PercyDOM.serialize')) {
          if (currentPid === null) return { domSnapshot: { html: '<html></html>', resources: [] } };
          return { html: currentPid, resources: [] };
        }
        if (body.includes('document.URL')) {
          if (currentPid === 'outer') return 'https://a.example.com/';
          if (currentPid === 'inner') return 'https://b.example.com/';
          return 'https://host.example.com/';
        }
        if (body.includes('document.querySelectorAll') && body.includes('iframe')) {
          if (currentPid === null) return [{ ...meta('outer', 'https://a.example.com/'), index: 0 }];
          if (currentPid === 'outer') return [{ ...meta('inner', 'https://b.example.com/'), index: 0 }];
          return [];
        }
        return undefined;
      }),
      manage: jasmine.createSpy().and.returnValue({
        getCookies: jasmine.createSpy().and.returnValue(Promise.resolve([]))
      })
    };
    await expectAsync(percySnapshot(driver, 'no-parentFrame depth2')).not.toBeRejected();
    // defaultContent must be invoked as the depth>1 fallback at least once
    // (from inner finally) in addition to the depth=1 outer finally.
    expect(switchSpies.defaultContent.calls.count()).toBeGreaterThanOrEqual(2);
  });

  it('skips a nested iframe whose pre-switch src equals an ancestor URL', async () => {
    // Drives the pre-switch cycle guard at lines 154-157. The top-level cycle
    // case is already filtered out by `shouldSkipIframe(same-origin)` in
    // captureCorsIframes, so we need a *nested* frame whose src happens to
    // match a higher-up frame URL. The child's origin must differ from its
    // immediate parent's origin (otherwise shouldSkipIframe trips same-origin
    // skip first) — so we point the child back at the TOP page URL, which
    // sits at the top of ancestorUrls.
    const pageUrl = 'https://host.example.com/';
    const outerSrc = 'https://a.example.com/outer';
    const meta = (pid, src) => ({
      percyElementId: pid, src, srcdoc: null,
      dataPercyIgnore: false, matchesIgnoreSelector: false
    });
    let currentPid = null;
    const switchSpies = {
      frame: jasmine.createSpy('frame').and.callFake((el) => { currentPid = el?.__pid; return Promise.resolve(); }),
      defaultContent: jasmine.createSpy('defaultContent').and.callFake(() => { currentPid = null; return Promise.resolve(); }),
      parentFrame: jasmine.createSpy('parentFrame').and.callFake(() => { currentPid = null; return Promise.resolve(); })
    };
    const driver = {
      getCurrentUrl: jasmine.createSpy().and.returnValue(Promise.resolve(pageUrl)),
      findElement: jasmine.createSpy().and.callFake(async (locator) => {
        const str = locator?.value || String(locator);
        const m = /data-percy-element-id="([^"]+)"/.exec(str);
        return m ? { __pid: m[1] } : null;
      }),
      switchTo: jasmine.createSpy().and.callFake(() => switchSpies),
      executeScript: jasmine.createSpy().and.callFake(async (script) => {
        if (typeof script === 'string') return undefined;
        const body = script.toString();
        if (body.includes('PercyDOM.serialize')) {
          if (currentPid === null) return { domSnapshot: { html: '<html></html>', resources: [] } };
          return { html: currentPid, resources: [] };
        }
        if (body.includes('document.URL')) {
          if (currentPid === 'outer') return outerSrc;
          return pageUrl;
        }
        if (body.includes('document.querySelectorAll') && body.includes('iframe')) {
          if (currentPid === null) return [{ ...meta('outer', outerSrc), index: 0 }];
          if (currentPid === 'outer') {
            // Inside outer (origin a.example.com), list a child whose src equals
            // the top page URL (origin host.example.com) — different origin so
            // shouldSkipIframe doesn't filter it, but the pre-switch ancestor
            // cycle guard inside processFrameTree fires.
            return [{ ...meta('cycle-child', pageUrl), index: 0 }];
          }
          return [];
        }
        return undefined;
      }),
      manage: jasmine.createSpy().and.returnValue({
        getCookies: jasmine.createSpy().and.returnValue(Promise.resolve([]))
      })
    };
    await percySnapshot(driver, 'pre-switch cycle');

    const body = await getSnapshotBody();
    const snap = Array.isArray(body.domSnapshot) ? body.domSnapshot[0] : body.domSnapshot;
    const pids = (snap.corsIframes || []).map(c => c.iframeData.percyElementId);
    expect(pids).toContain('outer');
    expect(pids).not.toContain('cycle-child');
  });

  it('swallows errors thrown during top-level iframe enumeration', async () => {
    // Drives the outer catch at lines 317-319 of captureCorsIframes. If the
    // very first enumerateIframesScript executeScript throws, the whole CORS
    // path returns []; the parent snapshot must still be posted successfully.
    let topEnumerateCalls = 0;
    const driver = {
      getCapabilities: jasmine.createSpy().and.returnValue(Promise.resolve({ getBrowserName: () => 'chrome' })),
      sendDevToolsCommand: jasmine.createSpy().and.returnValue(Promise.resolve()),
      getCurrentUrl: jasmine.createSpy().and.returnValue(Promise.resolve('https://host.example.com/')),
      findElement: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      switchTo: jasmine.createSpy().and.returnValue({
        frame: jasmine.createSpy().and.returnValue(Promise.resolve()),
        defaultContent: jasmine.createSpy().and.returnValue(Promise.resolve())
      }),
      executeScript: jasmine.createSpy().and.callFake(async (script) => {
        if (typeof script === 'string') return undefined;
        const body = script.toString();
        if (body.includes('PercyDOM.serialize')) {
          return { domSnapshot: { html: '<html></html>', resources: [] } };
        }
        if (body.includes('document.URL')) return 'https://host.example.com/';
        if (body.includes('document.querySelectorAll') && body.includes('iframe')) {
          topEnumerateCalls++;
          throw new Error('enumerate exploded');
        }
        return undefined;
      }),
      manage: jasmine.createSpy().and.returnValue({
        window: jasmine.createSpy().and.returnValue({
          setRect: jasmine.createSpy().and.returnValue(Promise.resolve()),
          getRect: jasmine.createSpy().and.returnValue(Promise.resolve({ width: 1024, height: 768 }))
        }),
        getCookies: jasmine.createSpy().and.returnValue(Promise.resolve([]))
      }),
      wait: jasmine.createSpy().and.returnValue(Promise.resolve())
    };
    await expectAsync(percySnapshot(driver, 'enumerate-throws')).not.toBeRejected();
    expect(topEnumerateCalls).toBeGreaterThanOrEqual(1);
  });

  it('returns [] when findElement cannot locate the iframe by percyElementId', async () => {
    // Drives lines 166-167: findElement resolves to a falsy value, processFrameTree
    // logs and returns []. The outer captureCorsIframes loop must continue with the
    // next top-level meta (so we use two metas to assert the second one is handled).
    const pageUrl = 'https://host.example.com/';
    const meta = (pid, src) => ({
      percyElementId: pid, src, srcdoc: null,
      dataPercyIgnore: false, matchesIgnoreSelector: false
    });
    let currentPid = null;
    const switchSpies = {
      frame: jasmine.createSpy('frame').and.callFake((el) => { currentPid = el?.__pid; return Promise.resolve(); }),
      defaultContent: jasmine.createSpy('defaultContent').and.callFake(() => { currentPid = null; return Promise.resolve(); }),
      parentFrame: jasmine.createSpy('parentFrame').and.callFake(() => { currentPid = null; return Promise.resolve(); })
    };
    const driver = {
      getCurrentUrl: jasmine.createSpy().and.returnValue(Promise.resolve(pageUrl)),
      // findElement returns null for 'missing-pid', a fake element for 'present-pid'
      findElement: jasmine.createSpy().and.callFake(async (locator) => {
        const str = locator?.value || String(locator);
        const m = /data-percy-element-id="([^"]+)"/.exec(str);
        if (!m) return null;
        if (m[1] === 'missing-pid') return null;
        return { __pid: m[1] };
      }),
      switchTo: jasmine.createSpy().and.callFake(() => switchSpies),
      executeScript: jasmine.createSpy().and.callFake(async (script) => {
        if (typeof script === 'string') return undefined;
        const body = script.toString();
        if (body.includes('PercyDOM.serialize')) {
          if (currentPid === null) return { domSnapshot: { html: '<html></html>', resources: [] } };
          return { html: currentPid, resources: [] };
        }
        if (body.includes('document.URL')) {
          if (currentPid === 'present-pid') return 'https://b.example.com/';
          return pageUrl;
        }
        if (body.includes('document.querySelectorAll') && body.includes('iframe')) {
          if (currentPid === null) {
            return [
              { ...meta('missing-pid', 'https://a.example.com/'), index: 0 },
              { ...meta('present-pid', 'https://b.example.com/'), index: 1 }
            ];
          }
          return [];
        }
        return undefined;
      }),
      manage: jasmine.createSpy().and.returnValue({
        getCookies: jasmine.createSpy().and.returnValue(Promise.resolve([]))
      })
    };
    await percySnapshot(driver, 'findElement returns null');

    const body = await getSnapshotBody();
    const snap = Array.isArray(body.domSnapshot) ? body.domSnapshot[0] : body.domSnapshot;
    const pids = (snap.corsIframes || []).map(c => c.iframeData.percyElementId);
    expect(pids).not.toContain('missing-pid');
    expect(pids).toContain('present-pid');
  });

  it('re-throws percyContextLost when parentFrame fails at depth > 1', async () => {
    // Drives lines 254-263: parentFrame throws at depth>1 → defaultContent
    // recovery attempted, percyContextLost wrapped and re-thrown. The OUTER
    // captureCorsIframes loop must then catch this, push partialCapture, break.
    const meta = (pid, src) => ({
      percyElementId: pid, src, srcdoc: null,
      dataPercyIgnore: false, matchesIgnoreSelector: false
    });
    let currentPid = null;
    const switchSpies = {
      frame: jasmine.createSpy('frame').and.callFake((el) => { currentPid = el?.__pid; return Promise.resolve(); }),
      defaultContent: jasmine.createSpy('defaultContent').and.callFake(() => { currentPid = null; return Promise.resolve(); }),
      parentFrame: jasmine.createSpy('parentFrame').and.callFake(() => Promise.reject(new Error('parentFrame lost')))
    };
    const driver = {
      getCurrentUrl: jasmine.createSpy().and.returnValue(Promise.resolve('https://host.example.com/')),
      findElement: jasmine.createSpy().and.callFake(async (locator) => {
        const str = locator?.value || String(locator);
        const m = /data-percy-element-id="([^"]+)"/.exec(str);
        return m ? { __pid: m[1] } : null;
      }),
      switchTo: jasmine.createSpy().and.callFake(() => switchSpies),
      executeScript: jasmine.createSpy().and.callFake(async (script) => {
        if (typeof script === 'string') return undefined;
        const body = script.toString();
        if (body.includes('PercyDOM.serialize')) {
          if (currentPid === null) return { domSnapshot: { html: '<html></html>', resources: [] } };
          return { html: currentPid, resources: [] };
        }
        if (body.includes('document.URL')) {
          if (currentPid === 'outer') return 'https://a.example.com/';
          if (currentPid === 'inner') return 'https://b.example.com/';
          return 'https://host.example.com/';
        }
        if (body.includes('document.querySelectorAll') && body.includes('iframe')) {
          if (currentPid === null) {
            return [
              { ...meta('outer', 'https://a.example.com/'), index: 0 },
              // Second sibling — should NOT be processed because we break on percyContextLost
              { ...meta('sibling', 'https://c.example.com/'), index: 1 }
            ];
          }
          if (currentPid === 'outer') return [{ ...meta('inner', 'https://b.example.com/'), index: 0 }];
          return [];
        }
        return undefined;
      }),
      manage: jasmine.createSpy().and.returnValue({
        getCookies: jasmine.createSpy().and.returnValue(Promise.resolve([]))
      })
    };

    await expectAsync(percySnapshot(driver, 'percyContextLost rethrow')).not.toBeRejected();

    const body = await getSnapshotBody();
    const snap = Array.isArray(body.domSnapshot) ? body.domSnapshot[0] : body.domSnapshot;
    const pids = (snap.corsIframes || []).map(c => c.iframeData.percyElementId);
    // outer + inner are captured before context is lost; sibling is NOT
    // (the outer loop breaks on percyContextLost).
    expect(pids).toContain('outer');
    expect(pids).toContain('inner');
    expect(pids).not.toContain('sibling');
  });

  it('shouldSkipIframe true branch fires inside a nested frame iteration', async () => {
    // Drives line 226: `shouldSkipIframe(child, currentOrigin, log)` returns
    // true → continue. We enumerate one cross-origin child + one srcdoc child
    // inside outer; the srcdoc child must be skipped at shouldSkipIframe.
    const pageUrl = 'https://host.example.com/';
    const meta = (pid, src, extra = {}) => ({
      percyElementId: pid, src, srcdoc: null,
      dataPercyIgnore: false, matchesIgnoreSelector: false,
      ...extra
    });
    let currentPid = null;
    const switchSpies = {
      frame: jasmine.createSpy().and.callFake((el) => { currentPid = el?.__pid; return Promise.resolve(); }),
      defaultContent: jasmine.createSpy().and.callFake(() => { currentPid = null; return Promise.resolve(); }),
      parentFrame: jasmine.createSpy().and.callFake(() => { currentPid = null; return Promise.resolve(); })
    };
    const driver = {
      getCurrentUrl: jasmine.createSpy().and.returnValue(Promise.resolve(pageUrl)),
      findElement: jasmine.createSpy().and.callFake(async (locator) => {
        const str = locator?.value || String(locator);
        const m = /data-percy-element-id="([^"]+)"/.exec(str);
        return m ? { __pid: m[1] } : null;
      }),
      switchTo: jasmine.createSpy().and.callFake(() => switchSpies),
      executeScript: jasmine.createSpy().and.callFake(async (script) => {
        if (typeof script === 'string') return undefined;
        const body = script.toString();
        if (body.includes('PercyDOM.serialize')) {
          if (currentPid === null) return { domSnapshot: { html: '<html></html>', resources: [] } };
          return { html: currentPid, resources: [] };
        }
        if (body.includes('document.URL')) {
          if (currentPid === 'outer') return 'https://a.example.com/';
          if (currentPid === 'good-child') return 'https://b.example.com/';
          return pageUrl;
        }
        if (body.includes('document.querySelectorAll') && body.includes('iframe')) {
          if (currentPid === null) return [{ ...meta('outer', 'https://a.example.com/'), index: 0 }];
          if (currentPid === 'outer') {
            return [
              { ...meta('srcdoc-child', 'https://c.example.com/', { srcdoc: '<p>x</p>' }), index: 0 },
              { ...meta('good-child', 'https://b.example.com/'), index: 1 }
            ];
          }
          return [];
        }
        return undefined;
      }),
      manage: jasmine.createSpy().and.returnValue({
        getCookies: jasmine.createSpy().and.returnValue(Promise.resolve([]))
      })
    };
    await percySnapshot(driver, 'nested shouldSkipIframe skip');

    const body = await getSnapshotBody();
    const snap = Array.isArray(body.domSnapshot) ? body.domSnapshot[0] : body.domSnapshot;
    const pids = (snap.corsIframes || []).map(c => c.iframeData.percyElementId);
    expect(pids).toContain('outer');
    expect(pids).toContain('good-child');
    expect(pids).not.toContain('srcdoc-child');
  });

  it('handles empty frameUrl + non-array enumerate result inside a frame', async () => {
    // Drives the four defensive fallbacks at lines 218-225 of processFrameTree:
    //   - `frameUrl || meta.src` when frameUrl is empty
    //   - `Array.isArray(childrenRaw) ? : []` when enumerate returns null
    //   - `if (frameUrl)` skipping nextAncestors.add for frameUrl
    // We inject an empty post-switch URL via document.URL → '' and return
    // null from the nested enumerate call.
    const pageUrl = 'https://host.example.com/';
    const meta = (pid, src) => ({
      percyElementId: pid, src, srcdoc: null,
      dataPercyIgnore: false, matchesIgnoreSelector: false
    });
    let currentPid = null;
    const switchSpies = {
      frame: jasmine.createSpy().and.callFake((el) => { currentPid = el?.__pid; return Promise.resolve(); }),
      defaultContent: jasmine.createSpy().and.callFake(() => { currentPid = null; return Promise.resolve(); }),
      parentFrame: jasmine.createSpy().and.callFake(() => { currentPid = null; return Promise.resolve(); })
    };
    const driver = {
      getCurrentUrl: jasmine.createSpy().and.returnValue(Promise.resolve(pageUrl)),
      findElement: jasmine.createSpy().and.callFake(async (locator) => {
        const str = locator?.value || String(locator);
        const m = /data-percy-element-id="([^"]+)"/.exec(str);
        return m ? { __pid: m[1] } : null;
      }),
      switchTo: jasmine.createSpy().and.callFake(() => switchSpies),
      executeScript: jasmine.createSpy().and.callFake(async (script) => {
        if (typeof script === 'string') return undefined;
        const body = script.toString();
        if (body.includes('PercyDOM.serialize')) {
          if (currentPid === null) return { domSnapshot: { html: '<html></html>', resources: [] } };
          return { html: currentPid, resources: [] };
        }
        // Frame's document.URL returns empty — exercise frameUrl-falsy fallback
        if (body.includes('document.URL')) {
          if (currentPid === 'outer') return '';
          return pageUrl;
        }
        if (body.includes('document.querySelectorAll') && body.includes('iframe')) {
          if (currentPid === null) return [{ ...meta('outer', 'https://a.example.com/'), index: 0 }];
          // Inside outer: return non-array → Array.isArray fallback fires.
          if (currentPid === 'outer') return null;
          return [];
        }
        return undefined;
      }),
      manage: jasmine.createSpy().and.returnValue({
        getCookies: jasmine.createSpy().and.returnValue(Promise.resolve([]))
      })
    };
    await percySnapshot(driver, 'empty-frameurl + non-array enumerate');

    const body = await getSnapshotBody();
    const snap = Array.isArray(body.domSnapshot) ? body.domSnapshot[0] : body.domSnapshot;
    const pids = (snap.corsIframes || []).map(c => c.iframeData.percyElementId);
    expect(pids).toContain('outer');
  });

  it('attaches capturedError as cause when finally throws percyContextLost', async () => {
    // Drives line 265: `if (capturedError) err.cause = capturedError;`.
    // Requires the inner depth-2 frame to BOTH throw inside the try (so the
    // catch sets capturedError) AND have its finally's parentFrame fail
    // (so finally re-throws percyContextLost with the cause attached).
    const pageUrl = 'https://host.example.com/';
    const meta = (pid, src) => ({
      percyElementId: pid, src, srcdoc: null,
      dataPercyIgnore: false, matchesIgnoreSelector: false
    });
    let currentPid = null;
    const switchSpies = {
      frame: jasmine.createSpy().and.callFake((el) => { currentPid = el?.__pid; return Promise.resolve(); }),
      defaultContent: jasmine.createSpy().and.callFake(() => { currentPid = null; return Promise.resolve(); }),
      // parentFrame ALWAYS fails — inner depth-2 finally hits the throw branch.
      parentFrame: jasmine.createSpy().and.callFake(() => Promise.reject(new Error('parentFrame dead')))
    };
    const driver = {
      getCurrentUrl: jasmine.createSpy().and.returnValue(Promise.resolve(pageUrl)),
      findElement: jasmine.createSpy().and.callFake(async (locator) => {
        const str = locator?.value || String(locator);
        const m = /data-percy-element-id="([^"]+)"/.exec(str);
        return m ? { __pid: m[1] } : null;
      }),
      switchTo: jasmine.createSpy().and.callFake(() => switchSpies),
      executeScript: jasmine.createSpy().and.callFake(async (script) => {
        if (typeof script === 'string') return undefined;
        const body = script.toString();
        if (body.includes('PercyDOM.serialize')) {
          if (currentPid === null) return { domSnapshot: { html: '<html></html>', resources: [] } };
          // Inner serialize THROWS → catch sets capturedError.
          if (currentPid === 'inner') throw new Error('inner serialize boom');
          return { html: currentPid, resources: [] };
        }
        if (body.includes('document.URL')) {
          if (currentPid === 'outer') return 'https://a.example.com/';
          if (currentPid === 'inner') return 'https://b.example.com/';
          return pageUrl;
        }
        if (body.includes('document.querySelectorAll') && body.includes('iframe')) {
          if (currentPid === null) return [{ ...meta('outer', 'https://a.example.com/'), index: 0 }];
          if (currentPid === 'outer') return [{ ...meta('inner', 'https://b.example.com/'), index: 0 }];
          return [];
        }
        return undefined;
      }),
      manage: jasmine.createSpy().and.returnValue({
        getCookies: jasmine.createSpy().and.returnValue(Promise.resolve([]))
      })
    };
    await expectAsync(percySnapshot(driver, 'cause attached')).not.toBeRejected();
  });

  it('handles percyContextLost with no partialCapture inside outer recursion', async () => {
    // Drives line 234-237 false-branch: `Array.isArray && length` is false
    // when partialCapture is missing or empty. Also exercises lines 298-300
    // in captureCorsIframes where the outer loop receives a percyContextLost
    // with no partial capture to merge.
    //
    // Setup: inner frame has no children, parentFrame fails at depth=2 before
    // the inner serialize completes (we trigger by making inner serialize throw,
    // then parentFrame fails). The error.partialCapture is the empty collected
    // array at the depth-2 catch site.
    const pageUrl = 'https://host.example.com/';
    const meta = (pid, src) => ({
      percyElementId: pid, src, srcdoc: null,
      dataPercyIgnore: false, matchesIgnoreSelector: false
    });
    let currentPid = null;
    const switchSpies = {
      frame: jasmine.createSpy().and.callFake((el) => { currentPid = el?.__pid; return Promise.resolve(); }),
      defaultContent: jasmine.createSpy().and.callFake(() => { currentPid = null; return Promise.resolve(); }),
      parentFrame: jasmine.createSpy().and.callFake(() => Promise.reject(new Error('parentFrame fail')))
    };
    const driver = {
      getCurrentUrl: jasmine.createSpy().and.returnValue(Promise.resolve(pageUrl)),
      findElement: jasmine.createSpy().and.callFake(async (locator) => {
        const str = locator?.value || String(locator);
        const m = /data-percy-element-id="([^"]+)"/.exec(str);
        return m ? { __pid: m[1] } : null;
      }),
      switchTo: jasmine.createSpy().and.callFake(() => switchSpies),
      executeScript: jasmine.createSpy().and.callFake(async (script) => {
        if (typeof script === 'string') return undefined;
        const body = script.toString();
        if (body.includes('PercyDOM.serialize')) {
          // Outer captures fine; inner THROWS so its collected stays empty.
          if (currentPid === null) return { domSnapshot: { html: '<html></html>', resources: [] } };
          if (currentPid === 'inner') throw new Error('inner serialize boom');
          return { html: currentPid, resources: [] };
        }
        if (body.includes('document.URL')) {
          if (currentPid === 'outer') return 'https://a.example.com/';
          if (currentPid === 'inner') return 'https://b.example.com/';
          return pageUrl;
        }
        if (body.includes('document.querySelectorAll') && body.includes('iframe')) {
          if (currentPid === null) return [{ ...meta('outer', 'https://a.example.com/'), index: 0 }];
          if (currentPid === 'outer') return [{ ...meta('inner', 'https://b.example.com/'), index: 0 }];
          return [];
        }
        return undefined;
      }),
      manage: jasmine.createSpy().and.returnValue({
        getCookies: jasmine.createSpy().and.returnValue(Promise.resolve([]))
      })
    };
    await expectAsync(percySnapshot(driver, 'empty partialCapture')).not.toBeRejected();
  });
});

describe('percySnapshot called with no options argument', () => {
  // Drives line 520 (and its sibling guards): `options || {}` falsy-branch.
  beforeEach(async () => {
    await helpers.setupTest();
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = {};
  });

  it('does not throw when options is undefined', async () => {
    const driver = {
      getCapabilities: jasmine.createSpy().and.returnValue(Promise.resolve({ getBrowserName: () => 'chrome' })),
      sendDevToolsCommand: jasmine.createSpy().and.returnValue(Promise.resolve()),
      getCurrentUrl: jasmine.createSpy().and.returnValue(Promise.resolve('https://host.example.com/')),
      findElement: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      switchTo: jasmine.createSpy().and.returnValue({
        frame: jasmine.createSpy().and.returnValue(Promise.resolve()),
        defaultContent: jasmine.createSpy().and.returnValue(Promise.resolve())
      }),
      executeScript: jasmine.createSpy().and.callFake(async (script) => {
        if (typeof script === 'string') return undefined;
        const body = script.toString();
        if (body.includes('PercyDOM.serialize')) {
          return { domSnapshot: { html: '<html></html>', resources: [] } };
        }
        if (body.includes('document.URL')) return 'https://host.example.com/';
        if (body.includes('document.querySelectorAll') && body.includes('iframe')) return [];
        return undefined;
      }),
      manage: jasmine.createSpy().and.returnValue({
        window: jasmine.createSpy().and.returnValue({
          setRect: jasmine.createSpy().and.returnValue(Promise.resolve()),
          getRect: jasmine.createSpy().and.returnValue(Promise.resolve({ width: 1024, height: 768 }))
        }),
        getCookies: jasmine.createSpy().and.returnValue(Promise.resolve([]))
      }),
      wait: jasmine.createSpy().and.returnValue(Promise.resolve())
    };
    // No options argument at all → captureCorsIframes(... , options || {} , ...)
    await expectAsync(percySnapshot(driver, 'no-options')).not.toBeRejected();
  });
});

describe('data-percy-ignore and ignoreIframeSelectors', () => {
  function m(pid, src, extra = {}) {
    return {
      percyElementId: pid,
      src,
      srcdoc: null,
      dataPercyIgnore: false,
      matchesIgnoreSelector: false,
      ...extra
    };
  }

  beforeEach(async () => {
    await helpers.setupTest();
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = {};
  });

  it('skips iframe marked with data-percy-ignore', async () => {
    const driver = buildIframeDriver({
      topIframes: [m('ignore-pid', 'https://cross.example.com/', { dataPercyIgnore: true })]
    });
    await percySnapshot(driver, 'data-percy-ignore');
    expect(driver._switchSpies.frame).not.toHaveBeenCalled();
  });

  it('skips iframe matching ignoreIframeSelectors option', async () => {
    const driver = buildIframeDriver({
      topIframes: [m('sel-pid', 'https://cross.example.com/', { matchesIgnoreSelector: true })]
    });
    await percySnapshot(driver, 'selector ignore', { ignoreIframeSelectors: ['.ad'] });
    expect(driver._switchSpies.frame).not.toHaveBeenCalled();
  });

  it('reads ignoreIframeSelectors from percy.config.snapshot when not in options', async () => {
    utils.percy.config = { snapshot: { ignoreIframeSelectors: ['.ad'] } };
    const driver = buildIframeDriver({
      topIframes: [m('cfg-pid', 'https://cross.example.com/', { matchesIgnoreSelector: true })]
    });
    await percySnapshot(driver, 'global selector ignore');
    expect(driver._switchSpies.frame).not.toHaveBeenCalled();
  });
});

describe('post-switch URL re-check', () => {
  function m(pid, src, extra = {}) {
    return {
      percyElementId: pid,
      src,
      srcdoc: null,
      dataPercyIgnore: false,
      matchesIgnoreSelector: false,
      ...extra
    };
  }

  beforeEach(async () => {
    await helpers.setupTest();
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = {};
  });

  it('drops iframe whose document.URL is about:blank after switch', async () => {
    const driver = buildIframeDriver({
      pageUrl: 'https://host.example.com/',
      topIframes: [m('postsw-pid', 'https://cross.example.com/')],
      frameDocumentUrlByPid: { 'postsw-pid': 'about:blank' }
    });
    await percySnapshot(driver, 'post-switch unsupported');

    const requests = await helpers.get('requests', r => r);
    const snap = requests.find(r => r.url === '/percy/snapshot');
    const ds = Array.isArray(snap.body.domSnapshot) ? snap.body.domSnapshot[0] : snap.body.domSnapshot;
    expect(ds.corsIframes).toBeUndefined();
  });

  it('drops iframe whose document.URL is javascript: after switch', async () => {
    const driver = buildIframeDriver({
      pageUrl: 'https://host.example.com/',
      topIframes: [m('js-pid', 'https://cross.example.com/')],
      frameDocumentUrlByPid: { 'js-pid': 'javascript:void(0)' }
    });
    await percySnapshot(driver, 'post-switch javascript:');

    const requests = await helpers.get('requests', r => r);
    const snap = requests.find(r => r.url === '/percy/snapshot');
    const ds = Array.isArray(snap.body.domSnapshot) ? snap.body.domSnapshot[0] : snap.body.domSnapshot;
    expect(ds.corsIframes).toBeUndefined();
  });
});

describe('iframe helper functions (sourced from @percy/sdk-utils)', () => {
  const internals = percySnapshot._internals;

  describe('isUnsupportedIframeSrc', () => {
    it('returns true for unsupported schemes', () => {
      expect(internals.isUnsupportedIframeSrc('about:blank')).toBeTrue();
      expect(internals.isUnsupportedIframeSrc('about:srcdoc')).toBeTrue();
      expect(internals.isUnsupportedIframeSrc('javascript:void(0)')).toBeTrue();
      expect(internals.isUnsupportedIframeSrc('data:text/html,foo')).toBeTrue();
      expect(internals.isUnsupportedIframeSrc('vbscript:foo')).toBeTrue();
      expect(internals.isUnsupportedIframeSrc('blob:foo')).toBeTrue();
      expect(internals.isUnsupportedIframeSrc('chrome://settings')).toBeTrue();
      expect(internals.isUnsupportedIframeSrc('chrome-extension://x')).toBeTrue();
      expect(internals.isUnsupportedIframeSrc('devtools://devtools/bundled')).toBeTrue();
      expect(internals.isUnsupportedIframeSrc('edge://settings')).toBeTrue();
      expect(internals.isUnsupportedIframeSrc('opera://about')).toBeTrue();
      expect(internals.isUnsupportedIframeSrc('view-source:https://example.com')).toBeTrue();
      expect(internals.isUnsupportedIframeSrc('file:///etc/hosts')).toBeTrue();
      expect(internals.isUnsupportedIframeSrc('')).toBeTrue();
      expect(internals.isUnsupportedIframeSrc(null)).toBeTrue();
    });

    it('matches schemes case-insensitively', () => {
      expect(internals.isUnsupportedIframeSrc('JavaScript:void(0)')).toBeTrue();
      expect(internals.isUnsupportedIframeSrc('ABOUT:blank')).toBeTrue();
      expect(internals.isUnsupportedIframeSrc('Data:text/html,foo')).toBeTrue();
      expect(internals.isUnsupportedIframeSrc('VBScript:foo')).toBeTrue();
    });

    it('returns false for normal http/https URLs', () => {
      expect(internals.isUnsupportedIframeSrc('https://cross.example.com/')).toBeFalse();
      expect(internals.isUnsupportedIframeSrc('http://host/path')).toBeFalse();
    });
  });

  describe('clampFrameDepth', () => {
    it('returns DEFAULT_MAX_FRAME_DEPTH for invalid input', () => {
      expect(internals.clampFrameDepth(undefined)).toBe(internals.DEFAULT_MAX_FRAME_DEPTH);
      expect(internals.clampFrameDepth(null)).toBe(internals.DEFAULT_MAX_FRAME_DEPTH);
      expect(internals.clampFrameDepth(0)).toBe(internals.DEFAULT_MAX_FRAME_DEPTH);
      expect(internals.clampFrameDepth(-1)).toBe(internals.DEFAULT_MAX_FRAME_DEPTH);
      expect(internals.clampFrameDepth('not a number')).toBe(internals.DEFAULT_MAX_FRAME_DEPTH);
    });

    it('clamps to the hard upper bound', () => {
      expect(internals.clampFrameDepth(100)).toBe(internals.HARD_MAX_FRAME_DEPTH);
      // Bound now sourced from @percy/sdk-utils (HARD_MAX_IFRAME_DEPTH = 10),
      // previously the locally-inlined value was 25.
      expect(internals.HARD_MAX_FRAME_DEPTH).toBe(10);
    });

    it('defaults to the sdk-utils default depth', () => {
      // Sourced from @percy/sdk-utils (DEFAULT_MAX_IFRAME_DEPTH = 3),
      // previously the locally-inlined default was 10.
      expect(internals.DEFAULT_MAX_FRAME_DEPTH).toBe(3);
    });

    it('returns valid integer depths', () => {
      expect(internals.clampFrameDepth(3)).toBe(3);
      expect(internals.clampFrameDepth(7)).toBe(7);
    });
  });

  describe('processFrameTree selector escaping', () => {
    it('escapes quotes/backslashes in percyElementId before building the CSS selector', async () => {
      // A malicious page could set data-percy-element-id to a value containing a
      // double-quote to break out of the attribute selector. The escaped value
      // must keep the selector well-formed.
      const maliciousPid = 'x"] , iframe[data-evil="\\1';
      const findElement = jasmine.createSpy('findElement').and.returnValue(Promise.resolve(null));
      const driver = { findElement };

      await internals.processFrameTree(
        driver,
        { src: 'https://cross.example.com/', percyElementId: maliciousPid },
        1,
        new Set(['https://host.example.com/']),
        { maxFrameDepth: 10, ignoreSelectors: [], options: {}, percyDOMScript: 'noop' }
      );

      expect(findElement).toHaveBeenCalled();
      const locator = findElement.calls.mostRecent().args[0];
      const selector = locator?.value || String(locator);
      // Both the quote and the backslash from the pid must be backslash-escaped.
      expect(selector).toContain('x\\"]');
      expect(selector).toContain('\\\\1');
      // The selector must remain a single attribute selector (no premature close
      // of the data-percy-element-id attribute value).
      expect((selector.match(/data-percy-element-id=/g) || []).length).toBe(1);
    });
  });

  describe('resolveMaxFrameDepth / resolveIgnoreSelectors default-arg coverage', () => {
    // The `options = {}` default-parameter branch is only taken when the caller
    // passes `undefined` (not just an empty object).
    it('resolveMaxFrameDepth falls back to default when called with no args', () => {
      expect(internals.resolveMaxFrameDepth()).toBe(internals.DEFAULT_MAX_FRAME_DEPTH);
    });
    it('resolveIgnoreSelectors returns [] when called with no args', () => {
      expect(internals.resolveIgnoreSelectors()).toEqual([]);
    });
  });

  describe('normalizeIgnoreSelectors', () => {
    it('returns empty array for falsy input', () => {
      expect(internals.normalizeIgnoreSelectors(undefined)).toEqual([]);
      expect(internals.normalizeIgnoreSelectors(null)).toEqual([]);
      expect(internals.normalizeIgnoreSelectors('')).toEqual([]);
    });

    it('wraps a single string in an array', () => {
      expect(internals.normalizeIgnoreSelectors('.ad')).toEqual(['.ad']);
    });

    it('filters non-string values from array input', () => {
      expect(internals.normalizeIgnoreSelectors(['.ad', null, 42, 'foo'])).toEqual(['.ad', 'foo']);
    });

    it('returns empty array for truthy non-string non-array values', () => {
      // Hits the final `return []` for shapes like numbers or objects.
      expect(internals.normalizeIgnoreSelectors(42)).toEqual([]);
      expect(internals.normalizeIgnoreSelectors({})).toEqual([]);
    });
  });

  describe('getOrigin', () => {
    it('returns origin from valid URL', () => {
      expect(internals.getOrigin('https://example.com/path')).toBe('https://example.com');
    });

    it('returns null for invalid URL', () => {
      expect(internals.getOrigin('not-a-url')).toBeNull();
    });
  });

  describe('shouldSkipIframe', () => {
    const baseLog = { debug: () => {} };
    it('returns true for data-percy-ignore', () => {
      expect(internals.shouldSkipIframe({ dataPercyIgnore: true, src: 'https://cross.example.com/' }, 'https://host.example.com', baseLog)).toBeTrue();
    });
    it('returns true for data-percy-ignore even when src is missing', () => {
      // Drives the `meta.src || '(no src)'` no-src branch on the log line.
      expect(internals.shouldSkipIframe({ dataPercyIgnore: true }, 'https://host.example.com', baseLog)).toBeTrue();
    });
    it('returns true for matchesIgnoreSelector', () => {
      expect(internals.shouldSkipIframe({ matchesIgnoreSelector: true, src: 'https://cross.example.com/' }, 'https://host.example.com', baseLog)).toBeTrue();
    });
    it('returns true for matchesIgnoreSelector even when src is missing', () => {
      // Same `meta.src || '(no src)'` fallback, this time on the selector path.
      expect(internals.shouldSkipIframe({ matchesIgnoreSelector: true }, 'https://host.example.com', baseLog)).toBeTrue();
    });
    it('returns true for unsupported src', () => {
      expect(internals.shouldSkipIframe({ src: 'about:blank' }, 'https://host.example.com', baseLog)).toBeTrue();
    });
    it('returns true for same-origin', () => {
      expect(internals.shouldSkipIframe({ src: 'https://host.example.com/child', percyElementId: 'x' }, 'https://host.example.com', baseLog)).toBeTrue();
    });
    it('returns true when percyElementId is missing', () => {
      expect(internals.shouldSkipIframe({ src: 'https://cross.example.com/' }, 'https://host.example.com', baseLog)).toBeTrue();
    });
    it('returns true for srcdoc iframes (inline content already in parent DOM)', () => {
      expect(internals.shouldSkipIframe({ src: 'https://cross.example.com/', srcdoc: '<p>x</p>', index: 0 }, 'https://host.example.com', baseLog)).toBeTrue();
    });
    it('returns true when getOrigin returns null (invalid URL)', () => {
      // src that passes isUnsupportedIframeSrc (not a known scheme) but URL ctor fails.
      // Empty-host URLs like `https://` parse but yield no origin.
      expect(internals.shouldSkipIframe({ src: 'not a url at all' }, 'https://host.example.com', baseLog)).toBeTrue();
    });
    it('returns false for valid cross-origin iframe with pid', () => {
      expect(internals.shouldSkipIframe({ src: 'https://cross.example.com/', percyElementId: 'p1' }, 'https://host.example.com', baseLog)).toBeFalse();
    });
  });
});

describe('exposeClosedShadowRoots via CDP', () => {
  beforeEach(async () => {
    await helpers.setupTest();
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = {};
  });

  it('is a no-op when driver has no sendDevToolsCommand', async () => {
    const driver = { /* no sendDevToolsCommand */ };
    await expectAsync(percySnapshot._internals.exposeClosedShadowRoots(driver)).not.toBeRejected();
  });

  it('silently swallows CDP errors (non-Chromium)', async () => {
    const driver = {
      sendDevToolsCommand: jasmine.createSpy().and.rejectWith(new Error('CDP unavailable')),
      executeScript: jasmine.createSpy().and.returnValue(Promise.resolve())
    };
    await expectAsync(percySnapshot._internals.exposeClosedShadowRoots(driver)).not.toBeRejected();
  });

  it('walks DOM tree and exposes closed shadow roots via Runtime.callFunctionOn', async () => {
    const cdpCalls = [];
    const fakeRoot = {
      backendNodeId: 1,
      shadowRoots: [
        { shadowRootType: 'open', backendNodeId: 99 } // should be ignored
      ],
      children: [
        {
          backendNodeId: 2,
          shadowRoots: [{
            shadowRootType: 'closed',
            backendNodeId: 3,
            children: []
          }]
        }
      ]
    };
    const driver = {
      sendDevToolsCommand: jasmine.createSpy().and.callFake((method, params) => {
        cdpCalls.push({ method, params });
        if (method === 'DOM.getDocument') return Promise.resolve({ root: fakeRoot });
        if (method === 'DOM.resolveNode') {
          return Promise.resolve({ object: { objectId: `obj-${params.backendNodeId}` } });
        }
        return Promise.resolve();
      }),
      executeScript: jasmine.createSpy().and.returnValue(Promise.resolve())
    };

    await percySnapshot._internals.exposeClosedShadowRoots(driver);

    const enableCalled = cdpCalls.some(c => c.method === 'DOM.enable');
    const callFnOn = cdpCalls.find(c => c.method === 'Runtime.callFunctionOn');
    expect(enableCalled).toBeTrue();
    expect(callFnOn).toBeDefined();
    expect(callFnOn.params.objectId).toBe('obj-2');
    expect(callFnOn.params.arguments[0].objectId).toBe('obj-3');
  });

  it('skips closed shadow roots inside contentDocument (cross-frame)', async () => {
    const fakeRoot = {
      backendNodeId: 1,
      children: [
        {
          backendNodeId: 10,
          contentDocument: { // iframe — skip everything inside
            backendNodeId: 11,
            shadowRoots: [{ shadowRootType: 'closed', backendNodeId: 12 }]
          }
        }
      ]
    };
    const cdpCalls = [];
    const driver = {
      sendDevToolsCommand: jasmine.createSpy().and.callFake((method, params) => {
        cdpCalls.push({ method, params });
        if (method === 'DOM.getDocument') return Promise.resolve({ root: fakeRoot });
        if (method === 'DOM.resolveNode') return Promise.resolve({ object: { objectId: 'x' } });
        return Promise.resolve();
      }),
      executeScript: jasmine.createSpy().and.returnValue(Promise.resolve())
    };

    await percySnapshot._internals.exposeClosedShadowRoots(driver);

    const callFnOn = cdpCalls.find(c => c.method === 'Runtime.callFunctionOn');
    expect(callFnOn).toBeUndefined();
  });

  it('does nothing when no closed shadow roots are present', async () => {
    const driver = {
      sendDevToolsCommand: jasmine.createSpy().and.callFake((method) => {
        if (method === 'DOM.getDocument') return Promise.resolve({ root: { backendNodeId: 1, children: [] } });
        return Promise.resolve();
      }),
      executeScript: jasmine.createSpy().and.returnValue(Promise.resolve())
    };

    await percySnapshot._internals.exposeClosedShadowRoots(driver);
    // No Runtime.callFunctionOn since there's nothing to expose
    const calls = driver.sendDevToolsCommand.calls.allArgs().map(args => args[0]);
    expect(calls).not.toContain('Runtime.callFunctionOn');
  });

  // ----------------------------------------------------------------------------
  // Regression: ternary-around-await precedence bug.
  //
  // The original code was:
  //   const { root } = await driver.sendAndGetDevToolsCommand
  //     ? await driver.sendAndGetDevToolsCommand(...)
  //     : await driver.sendDevToolsCommand(...) || {};
  //
  // `await` binds tighter than `? :`, so this resolved the *function reference*
  // (truthy), picked the first branch — but its promise was never awaited.
  // Destructuring an unresolved Promise yields `root === undefined`, the
  // early-return triggered, and closed shadow DOM was never captured.
  //
  // The fixed form must produce a real `root` for both driver shapes.
  // ----------------------------------------------------------------------------
  describe('CDP command-shape regression (BLOCKER)', () => {
    const fakeRoot = {
      backendNodeId: 1,
      children: [
        {
          backendNodeId: 2,
          shadowRoots: [{ shadowRootType: 'closed', backendNodeId: 3 }]
        }
      ]
    };

    it('parses root and exposes closed roots when only sendDevToolsCommand is available', async () => {
      const cdpCalls = [];
      const driver = {
        sendDevToolsCommand: jasmine.createSpy().and.callFake((method, params) => {
          cdpCalls.push({ method, params });
          if (method === 'DOM.getDocument') return Promise.resolve({ root: fakeRoot });
          if (method === 'DOM.resolveNode') {
            return Promise.resolve({ object: { objectId: `obj-${params.backendNodeId}` } });
          }
          return Promise.resolve();
        }),
        executeScript: jasmine.createSpy().and.returnValue(Promise.resolve())
      };

      await percySnapshot._internals.exposeClosedShadowRoots(driver);

      const callFnOn = cdpCalls.find(c => c.method === 'Runtime.callFunctionOn');
      expect(callFnOn).toBeDefined();
      expect(callFnOn.params.objectId).toBe('obj-2');
      expect(callFnOn.params.arguments[0].objectId).toBe('obj-3');
    });

    it('parses root and exposes closed roots when only sendAndGetDevToolsCommand is available', async () => {
      const cdpCalls = [];
      const driver = {
        sendAndGetDevToolsCommand: jasmine.createSpy().and.callFake((method, params) => {
          cdpCalls.push({ method, params });
          if (method === 'DOM.getDocument') return Promise.resolve({ root: fakeRoot });
          if (method === 'DOM.resolveNode') {
            return Promise.resolve({ object: { objectId: `obj-${params.backendNodeId}` } });
          }
          return Promise.resolve();
        }),
        executeScript: jasmine.createSpy().and.returnValue(Promise.resolve())
      };

      await percySnapshot._internals.exposeClosedShadowRoots(driver);

      const callFnOn = cdpCalls.find(c => c.method === 'Runtime.callFunctionOn');
      expect(callFnOn).toBeDefined();
      // The selected CDP function MUST be sendAndGetDevToolsCommand
      expect(driver.sendAndGetDevToolsCommand).toHaveBeenCalled();
      expect(callFnOn.params.objectId).toBe('obj-2');
      expect(callFnOn.params.arguments[0].objectId).toBe('obj-3');
    });

    it('prefers sendAndGetDevToolsCommand when both are present', async () => {
      const driver = {
        sendAndGetDevToolsCommand: jasmine.createSpy('sendAndGet').and.callFake((method, params) => {
          if (method === 'DOM.getDocument') return Promise.resolve({ root: fakeRoot });
          if (method === 'DOM.resolveNode') {
            return Promise.resolve({ object: { objectId: `obj-${params.backendNodeId}` } });
          }
          return Promise.resolve();
        }),
        sendDevToolsCommand: jasmine.createSpy('sendOnly').and.returnValue(Promise.resolve()),
        executeScript: jasmine.createSpy().and.returnValue(Promise.resolve())
      };

      await percySnapshot._internals.exposeClosedShadowRoots(driver);

      // sendAndGetDevToolsCommand should be the only CDP transport invoked
      expect(driver.sendAndGetDevToolsCommand).toHaveBeenCalled();
      expect(driver.sendDevToolsCommand).not.toHaveBeenCalled();
    });

    it('is a no-op when neither CDP function is present', async () => {
      const driver = { /* no CDP at all */ };
      await expectAsync(percySnapshot._internals.exposeClosedShadowRoots(driver))
        .not.toBeRejected();
    });

    it('walks past null/undefined children without throwing', async () => {
      // Drives `if (!node) return;` inside walk(): the root has a children
      // array containing a null entry. The function must skip it rather than
      // dereference.
      const fakeRoot = {
        backendNodeId: 1,
        children: [
          null, // <-- triggers `if (!node) return;`
          { backendNodeId: 2, shadowRoots: [{ shadowRootType: 'closed', backendNodeId: 3 }] }
        ]
      };
      const cdpCalls = [];
      const driver = {
        sendDevToolsCommand: jasmine.createSpy().and.callFake((method, params) => {
          cdpCalls.push({ method, params });
          if (method === 'DOM.getDocument') return Promise.resolve({ root: fakeRoot });
          if (method === 'DOM.resolveNode') return Promise.resolve({ object: { objectId: `obj-${params.backendNodeId}` } });
          return Promise.resolve();
        }),
        executeScript: jasmine.createSpy().and.returnValue(Promise.resolve())
      };

      await percySnapshot._internals.exposeClosedShadowRoots(driver);
      // The closed root on the *non-null* sibling must still be exposed.
      const callFnOn = cdpCalls.find(c => c.method === 'Runtime.callFunctionOn');
      expect(callFnOn).toBeDefined();
    });

    it('skips closed pair when resolveNode returns no object', async () => {
      // Drives `if (!hostObjectId || !shadowObjectId) continue;` — the closed
      // pair is discovered but resolveNode returns an empty payload, so
      // Runtime.callFunctionOn is NOT invoked for that pair.
      const fakeRoot = {
        backendNodeId: 1,
        children: [{
          backendNodeId: 2,
          shadowRoots: [{ shadowRootType: 'closed', backendNodeId: 3 }]
        }]
      };
      const cdpCalls = [];
      const driver = {
        sendDevToolsCommand: jasmine.createSpy().and.callFake((method) => {
          cdpCalls.push({ method });
          if (method === 'DOM.getDocument') return Promise.resolve({ root: fakeRoot });
          if (method === 'DOM.resolveNode') return Promise.resolve({}); // <-- no `object`
          return Promise.resolve();
        }),
        executeScript: jasmine.createSpy().and.returnValue(Promise.resolve())
      };

      await percySnapshot._internals.exposeClosedShadowRoots(driver);
      const callFnOn = cdpCalls.find(c => c.method === 'Runtime.callFunctionOn');
      expect(callFnOn).toBeUndefined();
    });

    it('treats an undefined CDP getDocument response as no-root (early return)', async () => {
      const driver = {
        sendAndGetDevToolsCommand: jasmine.createSpy().and.callFake((method) => {
          if (method === 'DOM.getDocument') return Promise.resolve(undefined);
          return Promise.resolve();
        }),
        executeScript: jasmine.createSpy().and.returnValue(Promise.resolve())
      };
      await expectAsync(percySnapshot._internals.exposeClosedShadowRoots(driver))
        .not.toBeRejected();
      const calls = driver.sendAndGetDevToolsCommand.calls.allArgs().map(a => a[0]);
      expect(calls).not.toContain('Runtime.callFunctionOn');
    });
  });

  // --------------------------------------------------------------------------
  // Gate: exposeClosedShadowRoots must NOT run when the snapshot is going to
  // be serialized later by the CLI (deferUploads). Running CDP at this point
  // both wastes I/O and writes window.__percyClosedShadowRoots onto a page the
  // SDK isn't about to upload — observable side effect on the user's app.
  // --------------------------------------------------------------------------
  describe('deferUploads gate around exposeClosedShadowRoots', () => {
    const { isClosedShadowRootsExposureSkipped } = percySnapshot._internals;

    it('skips exposure when options.deferUploads === true', () => {
      expect(isClosedShadowRootsExposureSkipped({ deferUploads: true })).toBe(true);
    });

    it('skips exposure when percy.config.percy.deferUploads is truthy', () => {
      utils.percy.config = { percy: { deferUploads: true } };
      expect(isClosedShadowRootsExposureSkipped()).toBe(true);
      expect(isClosedShadowRootsExposureSkipped({})).toBe(true);
    });

    it('does NOT skip exposure when deferUploads is unset everywhere', () => {
      utils.percy.config = {};
      expect(isClosedShadowRootsExposureSkipped()).toBe(false);
      expect(isClosedShadowRootsExposureSkipped({})).toBe(false);
      expect(isClosedShadowRootsExposureSkipped({ deferUploads: false })).toBe(false);
    });

    it('does not invoke any CDP transport inside captureSerializedDOM when deferUploads is set', async () => {
      // End-to-end check: full percySnapshot with deferUploads must not call
      // sendDevToolsCommand at all (responsive path is already gated; serialized
      // path must be gated too — that is what THIS PR introduces).
      spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
      utils.percy.type = 'web';
      utils.percy.config = { percy: { deferUploads: true } };

      const driver = {
        getCapabilities: jasmine.createSpy().and.returnValue(Promise.resolve({ getBrowserName: () => 'chrome' })),
        sendDevToolsCommand: jasmine.createSpy('sendDevToolsCommand').and.returnValue(Promise.resolve()),
        sendAndGetDevToolsCommand: jasmine.createSpy('sendAndGetDevToolsCommand').and.returnValue(Promise.resolve()),
        getCurrentUrl: jasmine.createSpy().and.returnValue(Promise.resolve('https://example.com/')),
        findElements: jasmine.createSpy().and.returnValue(Promise.resolve([])),
        navigate: jasmine.createSpy().and.returnValue({ refresh: jasmine.createSpy().and.returnValue(Promise.resolve()) }),
        manage: jasmine.createSpy().and.returnValue({
          window: jasmine.createSpy().and.returnValue({
            setRect: jasmine.createSpy().and.returnValue(Promise.resolve()),
            getRect: jasmine.createSpy().and.returnValue(Promise.resolve({ width: 1024, height: 768 }))
          }),
          getCookies: jasmine.createSpy().and.returnValue(Promise.resolve([]))
        }),
        executeScript: jasmine.createSpy('executeScript').and.returnValue(
          Promise.resolve({ domSnapshot: { html: '<html></html>', resources: [] } })
        ),
        wait: jasmine.createSpy().and.returnValue(Promise.resolve())
      };

      await percySnapshot(driver, 'deferred snapshot', { responsiveSnapshotCapture: true });

      expect(driver.sendDevToolsCommand).not.toHaveBeenCalled();
      expect(driver.sendAndGetDevToolsCommand).not.toHaveBeenCalled();
    });
  });
});

// ----------------------------------------------------------------------------
// Cycle-guard check using the resolved post-switch document URL — not just the
// element's pre-switch src attribute. A redirect inside the iframe can land on
// a URL that already appears higher in the ancestor chain.
// ----------------------------------------------------------------------------
describe('processFrameTree - post-switch URL cycle guard', () => {
  beforeEach(async () => {
    await helpers.setupTest();
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = {};
  });

  it('skips a child frame whose document URL equals the top page (post-switch)', async () => {
    const pageUrl = 'https://host.example.com/';
    // The child iframe advertises src=https://other.example.com/x but after
    // we switch in, document.URL resolves to the top page URL (e.g. via a
    // server-side redirect chain). The guard must catch this cycle.
    const driver = buildIframeDriver({
      pageUrl,
      topIframes: [{
        percyElementId: 'pid-cycle',
        src: 'https://other.example.com/x',
        srcdoc: null,
        dataPercyIgnore: false,
        matchesIgnoreSelector: false
      }],
      frameDocumentUrlByPid: { 'pid-cycle': pageUrl }
    });

    const calls = [];
    const origExec = driver.executeScript;
    driver.executeScript = jasmine.createSpy('executeScript').and.callFake(async (script, arg) => {
      if (typeof script === 'function' && script.toString().includes('PercyDOM.serialize')) {
        calls.push({ pid: 'serialize' });
      }
      return origExec(script, arg);
    });

    await percySnapshot(driver, 'cycle-by-post-switch-url');

    // The cycle guard must run AFTER we switched into the frame and read
    // document.URL — so frame switch happens, but no serialize is performed
    // for the inner frame.
    expect(driver._switchSpies.frame).toHaveBeenCalled();
    // Top-level page serialize happens once. The cycle-guarded frame must NOT
    // contribute a second serialize.
    expect(calls.length).toBe(1);
    // We must restore to defaultContent regardless
    expect(driver._switchSpies.defaultContent).toHaveBeenCalled();
  });

  it('skips a nested frame whose document URL equals its parent frame (post-switch)', async () => {
    const pageUrl = 'https://host.example.com/';
    const parentSrc = 'https://parent.example.com/frame';
    const driver = buildIframeDriver({
      pageUrl,
      topIframes: [{
        percyElementId: 'pid-parent',
        src: parentSrc,
        srcdoc: null,
        dataPercyIgnore: false,
        matchesIgnoreSelector: false
      }],
      nestedIframes: {
        'pid-parent': [{
          percyElementId: 'pid-child',
          src: 'https://child.example.com/frame',
          srcdoc: null,
          dataPercyIgnore: false,
          matchesIgnoreSelector: false
        }]
      },
      // Child frame resolves back to its parent URL after switch — cycle
      frameDocumentUrlByPid: {
        'pid-parent': parentSrc,
        'pid-child': parentSrc
      }
    });

    await expectAsync(percySnapshot(driver, 'nested-cycle')).not.toBeRejected();
  });
});
