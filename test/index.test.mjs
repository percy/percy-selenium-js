import expect from 'expect';
import webdriver from 'selenium-webdriver';
import helpers from '@percy/sdk-utils/test/helpers';
import percySnapshot from '../index.js';

describe('percySnapshot', () => {
  let driver;

  before(async function() {
    this.timeout(0);

    driver = await new webdriver.Builder()
      .forBrowser('firefox').build();

    await helpers.mockSite();
  });

  after(async () => {
    await driver.quit();
    await helpers.closeSite();
  });

  beforeEach(async () => {
    await helpers.setup();
    await driver.get('http://localhost:8000');
  });

  afterEach(async () => {
    await helpers.teardown();
  });

  it('throws an error when a driver is not provided', async () => {
    await expect(percySnapshot())
      .rejects.toThrow('An instance of the selenium driver object is required.');
  });

  it('throws an error when a name is not provided', async () => {
    await expect(percySnapshot(driver))
      .rejects.toThrow('The `name` argument is required.');
  });

  it('disables snapshots when the healthcheck fails', async () => {
    await helpers.testFailure('/percy/healthcheck');

    await percySnapshot(driver, 'Snapshot 1');
    await percySnapshot(driver, 'Snapshot 2');

    await expect(helpers.getRequests()).resolves.toEqual([
      ['/percy/healthcheck']
    ]);

    expect(helpers.logger.stderr).toEqual([]);
    expect(helpers.logger.stdout).toEqual([
      '[percy] Percy is not running, disabling snapshots'
    ]);
  });

  it('posts snapshots to the local percy server', async () => {
    await percySnapshot(driver, 'Snapshot 1');
    await percySnapshot(driver, 'Snapshot 2');

    await expect(helpers.getRequests()).resolves.toEqual([
      ['/percy/healthcheck'],
      ['/percy/dom.js'],
      ['/percy/snapshot', {
        name: 'Snapshot 1',
        url: 'http://localhost:8000/',
        domSnapshot: '<html><head></head><body>Snapshot Me</body></html>',
        clientInfo: expect.stringMatching(/@percy\/selenium-webdriver\/.+/),
        environmentInfo: expect.stringMatching(/selenium-webdriver\/.+/)
      }],
      ['/percy/snapshot', expect.objectContaining({
        name: 'Snapshot 2'
      })]
    ]);

    expect(helpers.logger.stderr).toEqual([]);
    expect(helpers.logger.stdout).toEqual([]);
  });

  it('handles snapshot failures', async () => {
    await helpers.testFailure('/percy/snapshot', 'failure');

    await percySnapshot(driver, 'Snapshot 1');

    expect(helpers.logger.stdout).toEqual([]);
    expect(helpers.logger.stderr).toEqual([
      '[percy] Could not take DOM snapshot "Snapshot 1"',
      '[percy] Error: failure'
    ]);
  });
});
