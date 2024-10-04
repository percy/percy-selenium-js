import webdriver from 'selenium-webdriver';
import helpers from '@percy/sdk-utils/test/helpers';
import percySnapshot from '../index.js';
import utils from '@percy/sdk-utils';
import { Cache } from '../cache.js';
const { percyScreenshot } = percySnapshot;

describe('percySnapshot', () => {
  let driver;
  let mockedDriver;

  beforeAll(async function() {
    driver = await new webdriver.Builder()
      .forBrowser('firefox').build();

    mockedDriver = {
      getCapabilities: jasmine.createSpy('sendDevToolsCommand').and.returnValue({ getBrowserName: () => 'chrome'}),
      sendDevToolsCommand: jasmine.createSpy('sendDevToolsCommand').and.returnValue(Promise.resolve()),
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

  it('should wait if RESPONSIVE_CAPTURE_SLEEP_TIME is set', async () => {
    process.env.RESPONSIVE_CAPTURE_SLEEP_TIME = 1;
    spyOn(global, 'setTimeout').and.callThrough();

    await percySnapshot(mockedDriver, 'Test Snapshot', { responsiveSnapshotCapture: true });

    expect(setTimeout).toHaveBeenCalled();
    delete process.env.RESPONSIVE_CAPTURE_SLEEP_TIME;
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
