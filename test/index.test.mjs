import webdriver from 'selenium-webdriver';
import helpers from '@percy/sdk-utils/test/helpers';
import percySnapshot from '../index.js';
const { percyScreenshot } = percySnapshot;

describe('percySnapshot', () => {
  let driver;

  beforeAll(async function() {
    driver = await new webdriver.Builder()
      .forBrowser('firefox').build();
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

  it('posts driver details to the local percy server with ignore region', async () => {
    const element = { getId: () => {} };
    const mockElement = spyOn(element, 'getId').and.callFake(() => { return new Promise((resolve, _) => resolve('123')); });
    const mockedPostCall = spyOn(percySnapshot, 'request').and.callFake(() => {});
    await percyScreenshot(driver, 'Snapshot 2', { ignore_region_selenium_elements: [element] });
    expect(mockElement).toHaveBeenCalled();
    expect(mockedPostCall).toHaveBeenCalledWith(jasmine.objectContaining({
      sessionId: '123', commandExecutorUrl: 'http://localhost:5338/wd/hub', snapshotName: 'Snapshot 2', options: { ignore_region_elements: ['123'] }
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
});
