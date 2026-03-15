import fs from 'node:fs';
import webdriver from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import helpers from '@percy/sdk-utils/test/helpers';
import percySnapshot from '../index.js';
import utils from '@percy/sdk-utils';
import { Cache } from '../cache.js';
const { percyScreenshot, slowScrollToBottom, createRegion, stitchCorsIframes } = percySnapshot;

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
      getCapabilities: jasmine.createSpy('sendDevToolsCommand').and.returnValue({ getBrowserName: () => 'chrome' }),
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

    expect(mockedDriver.executeScript).toHaveBeenCalledTimes(4);
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

describe('stitchCorsIframes', () => {
  let switchSpies;
  let frameElement;
  let iframeDriver;

  function buildDriver(mainHtml, iframeHtml, frameSrc = 'https://cross.example.com/', percyElementId = 'pid-1') {
    switchSpies = {
      frame: jasmine.createSpy('frame').and.returnValue(Promise.resolve()),
      defaultContent: jasmine.createSpy('defaultContent').and.returnValue(Promise.resolve())
    };
    frameElement = {
      getAttribute: jasmine.createSpy('getAttribute').and.callFake(attr => {
        if (attr === 'src') return Promise.resolve(frameSrc);
        if (attr === 'data-percy-element-id') return Promise.resolve(percyElementId);
        return Promise.resolve(null);
      })
    };
    let callCount = 0;
    return {
      getCurrentUrl: jasmine.createSpy().and.returnValue(Promise.resolve('https://host.example.com/')),
      findElements: jasmine.createSpy().and.returnValue(Promise.resolve([frameElement])),
      switchTo: jasmine.createSpy().and.returnValue(switchSpies),
      executeScript: jasmine.createSpy('executeScript').and.callFake(async () => {
        callCount++;
        if (callCount === 1) return { domSnapshot: { html: mainHtml, resources: [] } };
        return iframeHtml ? { html: iframeHtml, resources: [] } : { resources: [] };
      }),
      manage: jasmine.createSpy().and.returnValue({
        getCookies: jasmine.createSpy().and.returnValue(Promise.resolve([]))
      })
    };
  }

  beforeEach(async () => {
    await helpers.setupTest();
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = {};
  });

  it('switches into cross-origin iframe and always returns to defaultContent', async () => {
    const pid = 'ele-abc';
    const driver = buildDriver(
      `<html><body><iframe data-percy-element-id="${pid}" src="https://cross.example.com/"></iframe></body></html>`,
      '<html><body>cross frame</body></html>'
    );
    await percySnapshot(driver, 'iframe switch & defaultContent');
    expect(switchSpies.frame).toHaveBeenCalledWith(frameElement);
    expect(switchSpies.defaultContent).toHaveBeenCalled();
  });

  it('injects percy DOM script into cross-origin iframe', async () => {
    const pid = 'ele-inject';
    const driver = buildDriver(
      `<html><body><iframe data-percy-element-id="${pid}" src="https://cross.example.com/"></iframe></body></html>`,
      '<html><body>frame</body></html>'
    );
    await percySnapshot(driver, 'percyDOM injected into frame');
    const calls = driver.executeScript.calls.allArgs();
    // After the main page serialize, a string script (percyDOM) is injected into the frame
    const hasStringInjection = calls.slice(1).some(args => typeof args[0] === 'string' && args[0].length > 50);
    expect(hasStringInjection).toBeTrue();
  });

  it('skips frame when iframeSnapshot returns no html', async () => {
    const pid = 'ele-nohtml';
    const driver = buildDriver(
      `<html><body><iframe data-percy-element-id="${pid}" src="https://cross.example.com/"></iframe></body></html>`,
      null // no html in iframe snapshot
    );
    await expectAsync(percySnapshot(driver, 'iframe no-html')).not.toBeRejected();
    // switchTo.frame IS called (to try capture), but stitchCorsIframes skips it due to missing html
    expect(switchSpies.frame).toHaveBeenCalled();
  });

  it('skips frame when data-percy-element-id is missing', async () => {
    const driver = buildDriver(
      '<html><body><iframe src="https://cross.example.com/"></iframe></body></html>',
      '<html></html>'
    );
    // Override percyElementId to be null
    frameElement.getAttribute.and.callFake(attr => {
      if (attr === 'src') return Promise.resolve('https://cross.example.com/');
      if (attr === 'data-percy-element-id') return Promise.resolve(null);
      return Promise.resolve(null);
    });
    await percySnapshot(driver, 'no-pid skip');
    expect(switchSpies.frame).not.toHaveBeenCalled();
  });

  it('continues gracefully when switchTo.frame throws', async () => {
    switchSpies = {
      frame: jasmine.createSpy('frame').and.rejectWith(new Error('cross-origin access denied')),
      defaultContent: jasmine.createSpy('defaultContent').and.returnValue(Promise.resolve())
    };
    const pid = 'ele-err';
    const driver = buildDriver(
      `<html><body><iframe data-percy-element-id="${pid}" src="https://cross.example.com/"></iframe></body></html>`,
      '<html></html>'
    );
    driver.switchTo.and.returnValue(switchSpies);
    await expectAsync(percySnapshot(driver, 'frame error graceful')).not.toBeRejected();
  });

  it('always calls defaultContent even when frame executeScript throws', async () => {
    const pid = 'ele-throw';
    const mainHtml = `<html><iframe data-percy-element-id="${pid}" src="https://cross.example.com/"></iframe></html>`;
    switchSpies = {
      frame: jasmine.createSpy('frame').and.returnValue(Promise.resolve()),
      defaultContent: jasmine.createSpy('defaultContent').and.returnValue(Promise.resolve())
    };
    frameElement = {
      getAttribute: jasmine.createSpy('getAttribute').and.callFake(attr => {
        if (attr === 'src') return Promise.resolve('https://cross.example.com/');
        if (attr === 'data-percy-element-id') return Promise.resolve(pid);
        return Promise.resolve(null);
      })
    };
    let callCount = 0;
    const driver = {
      getCurrentUrl: jasmine.createSpy().and.returnValue(Promise.resolve('https://host.example.com/')),
      findElements: jasmine.createSpy().and.returnValue(Promise.resolve([frameElement])),
      switchTo: jasmine.createSpy().and.returnValue(switchSpies),
      executeScript: jasmine.createSpy('executeScript').and.callFake(async () => {
        callCount++;
        if (callCount === 1) return undefined; // percyDOM inject in percySnapshot
        if (callCount === 2) return { domSnapshot: { html: mainHtml, resources: [] } }; // main page serialize
        if (callCount === 3) return undefined; // percyDOM inject in processFrame
        throw new Error('serialize failed inside frame'); // frame serialize
      }),
      manage: jasmine.createSpy().and.returnValue({
        getCookies: jasmine.createSpy().and.returnValue(Promise.resolve([]))
      })
    };
    await percySnapshot(driver, 'always defaultContent');
    expect(switchSpies.defaultContent).toHaveBeenCalled();
  });
});

describe('processFrame - cross-origin iframe switching', () => {
  let mockedIframeDriver;
  let frameElement;

  beforeEach(async () => {
    await helpers.setupTest();
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = {};
    utils.percy.widths = null;

    frameElement = {
      getAttribute: jasmine.createSpy('getAttribute').and.callFake(attr => {
        if (attr === 'src') return Promise.resolve('https://cross.example.com/frame');
        if (attr === 'data-percy-element-id') return Promise.resolve('pid-xyz');
        return Promise.resolve(null);
      })
    };

    mockedIframeDriver = {
      getCurrentUrl: jasmine.createSpy('getCurrentUrl').and.returnValue(Promise.resolve('https://host.example.com/')),
      findElements: jasmine.createSpy('findElements').and.returnValue(Promise.resolve([frameElement])),
      switchTo: jasmine.createSpy('switchTo').and.returnValue({
        frame: jasmine.createSpy('frame').and.returnValue(Promise.resolve()),
        defaultContent: jasmine.createSpy('defaultContent').and.returnValue(Promise.resolve())
      }),
      executeScript: jasmine.createSpy('executeScript').and.returnValue(
        Promise.resolve({ html: '<html><body>frame</body></html>', resources: [] })
      ),
      manage: jasmine.createSpy('manage').and.returnValue({
        getCookies: jasmine.createSpy('getCookies').and.returnValue(Promise.resolve([]))
      })
    };
  });

  it('switches to cross-origin iframe and back to defaultContent', async () => {
    // First executeScript call = main page serialize, subsequent = frame inject + serialize
    let callCount = 0;
    mockedIframeDriver.executeScript.and.callFake(async (script) => {
      callCount++;
      if (callCount === 1) {
        return { domSnapshot: { html: '<html><iframe data-percy-element-id="pid-xyz" src="https://cross.example.com/frame"></iframe></html>', resources: [] } };
      }
      return { html: '<html><body>frame</body></html>', resources: [] };
    });

    await percySnapshot(mockedIframeDriver, 'frame switch test');

    const switchTo = mockedIframeDriver.switchTo();
    expect(switchTo.frame).toHaveBeenCalledWith(frameElement);
    expect(switchTo.defaultContent).toHaveBeenCalled();
  });

  it('skips frame when data-percy-element-id is absent', async () => {
    frameElement.getAttribute.and.callFake(attr => {
      if (attr === 'src') return Promise.resolve('https://cross.example.com/frame');
      if (attr === 'data-percy-element-id') return Promise.resolve(null);
      return Promise.resolve(null);
    });

    mockedIframeDriver.executeScript.and.returnValue(
      Promise.resolve({ domSnapshot: { html: '<html></html>', resources: [] } })
    );

    await percySnapshot(mockedIframeDriver, 'no-pid skip test');

    const switchTo = mockedIframeDriver.switchTo();
    expect(switchTo.frame).not.toHaveBeenCalled();
  });

  it('continues gracefully when switchTo.frame throws', async () => {
    mockedIframeDriver.switchTo.and.returnValue({
      frame: jasmine.createSpy('frame').and.rejectWith(new Error('frame access denied')),
      defaultContent: jasmine.createSpy('defaultContent').and.returnValue(Promise.resolve())
    });

    let callCount = 0;
    mockedIframeDriver.executeScript.and.callFake(async () => {
      callCount++;
      if (callCount === 1) return { domSnapshot: { html: '<html><iframe data-percy-element-id="pid-xyz" src="https://cross.example.com/frame"></iframe></html>', resources: [] } };
      return { html: '<html></html>', resources: [] };
    });

    // Should not throw — outer catch swallows iframe errors
    await expectAsync(percySnapshot(mockedIframeDriver, 'frame-error graceful'))
      .not.toBeRejected();
  });

  it('always calls defaultContent even when frame executeScript throws', async () => {
    // Call sequence:
    // 1: driver.executeScript(percyDOMScript) in percySnapshot → inject percy DOM (returns undefined)
    // 2: driver.executeScript(serialize...) in captureSerializedDOM → returns main page snapshot with cross-origin iframe
    // 3: driver.executeScript(percyDOMScript) in processFrame → inject into frame (returns undefined)
    // 4: driver.executeScript(serialize...) in processFrame → throws to trigger finally + defaultContent
    let callCount = 0;
    mockedIframeDriver.executeScript.and.callFake(async () => {
      callCount++;
      if (callCount === 1) return undefined; // percyDOMScript inject in percySnapshot
      if (callCount === 2) return { domSnapshot: { html: '<html><iframe data-percy-element-id="pid-xyz" src="https://cross.example.com/frame"></iframe></html>', resources: [] } };
      if (callCount === 3) return undefined; // percyDOMScript inject inside frame
      throw new Error('serialize failed inside frame'); // callCount === 4
    });

    const switchSpies = {
      frame: jasmine.createSpy('frame').and.returnValue(Promise.resolve()),
      defaultContent: jasmine.createSpy('defaultContent').and.returnValue(Promise.resolve())
    };
    mockedIframeDriver.switchTo.and.returnValue(switchSpies);

    await percySnapshot(mockedIframeDriver, 'always-defaultContent test');

    expect(switchSpies.defaultContent).toHaveBeenCalled();
  });

  it('throws Fatal error (line 204) when defaultContent rejects inside processFrame finally', async () => {
    const pid = 'fatal-pid';
    const mainHtml = `<html><body><iframe data-percy-element-id="${pid}" src="https://cross.example.com/"></iframe></body></html>`;

    const switchSpies = {
      frame: jasmine.createSpy('frame').and.returnValue(Promise.resolve()),
      defaultContent: jasmine.createSpy('defaultContent').and.rejectWith(new Error('driver context lost'))
    };
    mockedIframeDriver.switchTo.and.returnValue(switchSpies);
    mockedIframeDriver.findElements.and.returnValue(Promise.resolve([frameElement]));

    // Use typeof to distinguish string (percyDOM inject) from function (serialize) calls
    mockedIframeDriver.executeScript.and.callFake(async (script) => {
      if (typeof script === 'string') return undefined; // percyDOM inject — string argument
      if (!mockedIframeDriver._mainSerialized) {
        mockedIframeDriver._mainSerialized = true;
        return { domSnapshot: { html: mainHtml, resources: [] } }; // main page serialize
      }
      return { html: '<html></html>' }; // frame serialize
    });
    delete mockedIframeDriver._mainSerialized;

    // The Fatal throw from line 204 is swallowed by captureSerializedDOM outer catch
    await expectAsync(percySnapshot(mockedIframeDriver, 'fatal defaultContent test'))
      .not.toBeRejected();

    expect(switchSpies.defaultContent).toHaveBeenCalled();
  });
});

describe('captureSerializedDOM - iframe src filtering', () => {
  let baseDriver;

  function makeFrameElement(src, pid = 'pid-1') {
    return {
      getAttribute: jasmine.createSpy('getAttribute').and.callFake(attr => {
        if (attr === 'src') return Promise.resolve(src);
        if (attr === 'data-percy-element-id') return Promise.resolve(pid);
        return Promise.resolve(null);
      })
    };
  }

  beforeEach(async () => {
    await helpers.setupTest();
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = {};
  });

  function makeDriver(frames, currentUrl = 'https://host.example.com/') {
    let callCount = 0;
    const switchSpies = {
      frame: jasmine.createSpy('frame').and.returnValue(Promise.resolve()),
      defaultContent: jasmine.createSpy('defaultContent').and.returnValue(Promise.resolve())
    };
    const d = {
      getCurrentUrl: jasmine.createSpy('getCurrentUrl').and.returnValue(Promise.resolve(currentUrl)),
      findElements: jasmine.createSpy('findElements').and.returnValue(Promise.resolve(frames)),
      switchTo: jasmine.createSpy('switchTo').and.returnValue(switchSpies),
      executeScript: jasmine.createSpy('executeScript').and.callFake(async () => {
        callCount++;
        if (callCount === 1) return { domSnapshot: { html: '<html></html>', resources: [] } };
        return { html: '<html><body>frame</body></html>', resources: [] };
      }),
      manage: jasmine.createSpy('manage').and.returnValue({
        getCookies: jasmine.createSpy('getCookies').and.returnValue(Promise.resolve([]))
      })
    };
    d._switchSpies = switchSpies;
    return d;
  }

  it('skips iframe with src = about:blank', async () => {
    const driver = makeDriver([makeFrameElement('about:blank')]);
    await percySnapshot(driver, 'blank src test');
    expect(driver._switchSpies.frame).not.toHaveBeenCalled();
  });

  it('skips iframe with src starting with javascript:', async () => {
    const driver = makeDriver([makeFrameElement('javascript:void(0)')]);
    await percySnapshot(driver, 'js src test');
    expect(driver._switchSpies.frame).not.toHaveBeenCalled();
  });

  it('skips iframe with null/empty src', async () => {
    const driver = makeDriver([makeFrameElement(null)]);
    await percySnapshot(driver, 'null src test');
    expect(driver._switchSpies.frame).not.toHaveBeenCalled();
  });

  it('skips same-origin iframes', async () => {
    const driver = makeDriver([makeFrameElement('https://host.example.com/child', 'pid-same')], 'https://host.example.com/');
    await percySnapshot(driver, 'same-origin test');
    expect(driver._switchSpies.frame).not.toHaveBeenCalled();
  });

  it('processes cross-origin iframe', async () => {
    const frame = makeFrameElement('https://other.example.com/frame', 'pid-cross');
    const driver = makeDriver([frame], 'https://host.example.com/');
    await percySnapshot(driver, 'cross-origin test');
    expect(driver._switchSpies.frame).toHaveBeenCalledWith(frame);
  });

  it('handles invalid frame src URL without throwing', async () => {
    const frame = makeFrameElement('not-a-valid-url');
    const driver = makeDriver([frame]);
    await expectAsync(percySnapshot(driver, 'invalid url test')).not.toBeRejected();
  });

  it('processes only cross-origin iframes when mixed with same-origin', async () => {
    const sameOrigin = makeFrameElement('https://host.example.com/same', 'pid-same');
    const crossOrigin = makeFrameElement('https://other.example.com/cross', 'pid-cross');
    const driver = makeDriver([sameOrigin, crossOrigin], 'https://host.example.com/');

    await percySnapshot(driver, 'mixed origins test');

    expect(driver._switchSpies.frame).toHaveBeenCalledTimes(1);
    expect(driver._switchSpies.frame).toHaveBeenCalledWith(crossOrigin);
    expect(driver._switchSpies.frame).not.toHaveBeenCalledWith(sameOrigin);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature: captureResponsiveDOM with utils.getResponsiveWidths({width, height})
// utils.getResponsiveWidths is non-writable; widths are configured via the
// mock Percy CLI server which handles /percy/widths-config.
// ─────────────────────────────────────────────────────────────────────────────

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

    expect(mockedDriver.sendDevToolsCommand).not.toHaveBeenCalled();
  });

  it('does not run responsive capture when deferUploads is true', async () => {
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = { percy: { deferUploads: true } };

    await percySnapshot(mockedDriver, 'deferUploads disabled', { responsiveSnapshotCapture: true, widths: [375] });

    expect(mockedDriver.sendDevToolsCommand).not.toHaveBeenCalled();
  });

  it('uses PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT env var to compute height', async () => {
    process.env.PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT = 'true';
    spyOn(percySnapshot, 'isPercyEnabled').and.returnValue(Promise.resolve(true));
    utils.percy.type = 'web';
    utils.percy.config = { snapshot: { minHeight: 500 } };
    utils.percy.widths = { mobile: [], config: [375] };

    let callIndex = 0;
    mockedDriver.executeScript.and.callFake(async (script) => {
      callIndex++;
      if (typeof script === 'string' && script.includes('outerHeight')) return 900;
      return { domSnapshot: { html: '<html></html>', resources: [] } };
    });

    await percySnapshot(mockedDriver, 'minHeight env', { responsiveSnapshotCapture: true, widths: [375] });

    // The height used should be the one returned by the outerHeight script (900), not window height (768)
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

describe('stitchCorsIframes unit tests', () => {
  it('replaces matching iframe element with srcdoc attribute from iframeSnapshot', () => {
    const pid = 'testpid-1';
    const domSnapshot = {
      html: `<html><body><iframe data-percy-element-id="${pid}" src="https://cross.example.com/"></iframe></body></html>`,
      resources: []
    };
    const processedFrames = [
      { iframeData: { percyElementId: pid }, iframeSnapshot: { html: '<html><body>frame content</body></html>' } }
    ];

    const result = stitchCorsIframes(domSnapshot, processedFrames);

    expect(result.html).toContain(`srcdoc="`);
    expect(result.html).toContain('frame content');
    expect(result.resources).toEqual([]);
  });

  it('escapes & and " characters in iframe html before embedding', () => {
    const pid = 'esc-pid';
    const domSnapshot = {
      html: `<html><body><iframe data-percy-element-id="${pid}" src="https://cross.example.com/"/></html>`,
      resources: []
    };
    const iframeHtml = '<html><body>a & b "quoted"</body></html>';
    const processedFrames = [
      { iframeData: { percyElementId: pid }, iframeSnapshot: { html: iframeHtml } }
    ];

    const result = stitchCorsIframes(domSnapshot, processedFrames);

    expect(result.html).toContain('&amp;');
    expect(result.html).toContain('&quot;');
    expect(result.html).not.toContain(' & ');
  });

  it('skips a frame entry when iframeSnapshot has no html property', () => {
    const pid = 'nohtml-pid';
    const originalHtml = `<html><body><iframe data-percy-element-id="${pid}"/></body></html>`;
    const domSnapshot = { html: originalHtml, resources: [] };
    const processedFrames = [
      { iframeData: { percyElementId: pid }, iframeSnapshot: { resources: [] } }
    ];

    const result = stitchCorsIframes(domSnapshot, processedFrames);

    expect(result.html).not.toContain('srcdoc');
    expect(result.html).toBe(originalHtml);
  });

  it('preserves all other domSnapshot fields and returns updated html', () => {
    const pid = 'meta-pid';
    const domSnapshot = {
      html: `<html><body><iframe data-percy-element-id="${pid}" src="https://cross.example.com/"></iframe></body></html>`,
      resources: ['res1', 'res2'],
      meta: 'extra',
      cookies: []
    };
    const processedFrames = [
      { iframeData: { percyElementId: pid }, iframeSnapshot: { html: '<html></html>' } }
    ];

    const result = stitchCorsIframes(domSnapshot, processedFrames);

    expect(result.resources).toEqual(['res1', 'res2']);
    expect(result.meta).toBe('extra');
    expect(result.cookies).toEqual([]);
    expect(result.html).not.toBe(domSnapshot.html);
    expect(result.html).toContain('srcdoc=');
  });
});

