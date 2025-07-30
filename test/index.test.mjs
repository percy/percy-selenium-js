import webdriver from 'selenium-webdriver';
import helpers from '@percy/sdk-utils/test/helpers';
import percySnapshot, { ignoreCanvasSerializationErrors} from '../index.js';
import utils from '@percy/sdk-utils';
import { Cache } from '../cache.js';
const { percyScreenshot, slowScrollToBottom, createRegion } = percySnapshot;

describe('percySnapshot', () => {
  let driver;
  let mockedDriver;

  beforeAll(async function() {
    driver = await new webdriver.Builder()
      .forBrowser('firefox').build();

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
});

describe('#slowScrollToBottom', () => {
  let mockedDriver = { executeScript: jasmine.createSpy('executeScript') };
  beforeEach(() => {
    mockedDriver.executeScript.calls.reset();
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

describe('ignoreCanvasSerializationErrors', () => {

  beforeEach(() => {
    // Reset utils.percy config before each test
    if (utils.percy?.config?.snapshot) {
      delete utils.percy.config.snapshot.ignoreCanvasSerializationErrors;
    }
  });

  it('should return false when no options are provided', () => {
    const result = ignoreCanvasSerializationErrors();
    expect(result).toBe(false);

    const result2 = ignoreCanvasSerializationErrors({});
    expect(result2).toBe(false);
  });

  it('should return value from options.ignoreCanvasSerializationErrors when provided', () => {
    const result = ignoreCanvasSerializationErrors({ ignoreCanvasSerializationErrors: true });
    expect(result).toBe(true);

    const result2 = ignoreCanvasSerializationErrors({ ignoreCanvasSerializationErrors: false });
    expect(result2).toBe(false);
  });

  it('should fall back to utils.percy.config.snapshot.ignoreCanvasSerializationErrors when options value is undefined', () => {
    utils.percy.config = { snapshot: { ignoreCanvasSerializationErrors: true } };
    const result = ignoreCanvasSerializationErrors({});
    expect(result).toBe(true);
  });

  it('should prefer options value over config value', () => {
    utils.percy.config = { snapshot: { ignoreCanvasSerializationErrors: true } };
    const result = ignoreCanvasSerializationErrors({ ignoreCanvasSerializationErrors: false });
    expect(result).toBe(false);
  });

  it('should return false when both options and config are undefined', () => {
    utils.percy.config = { snapshot: {} };
    const result = ignoreCanvasSerializationErrors({});
    expect(result).toBe(false);
  });
});