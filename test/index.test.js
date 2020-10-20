const expect = require('expect');
const webdriver = require('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox');
const sdk = require('@percy/sdk-utils/test/helper');
const percySnapshot = require('..');

describe('percySnapshot', () => {
  let driver;

  before(async function() {
    this.timeout(0);

    driver = await new webdriver.Builder()
      .forBrowser('firefox').setFirefoxOptions(
        new firefox.Options().headless()
      ).build();

    await sdk.testsite.mock();
  });

  after(async () => {
    await driver.quit();
    await sdk.testsite.close();
  });

  beforeEach(async () => {
    await sdk.setup();
    await driver.get('http://localhost:8000');
  });

  afterEach(async () => {
    await sdk.teardown();
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
    sdk.test.failure('/percy/healthcheck');

    await sdk.stdio(async () => {
      await percySnapshot(driver, 'Snapshot 1');
      await percySnapshot(driver, 'Snapshot 2');
    });

    expect(sdk.server.requests).toEqual([
      ['/percy/healthcheck']
    ]);

    expect(sdk.stdio[2]).toEqual([]);
    expect(sdk.stdio[1]).toEqual([
      '[percy] Percy is not running, disabling snapshots\n'
    ]);
  });

  it('posts snapshots to the local percy server', async () => {
    await sdk.stdio(async () => {
      await percySnapshot(driver, 'Snapshot 1');
      await percySnapshot(driver, 'Snapshot 2');
    });

    expect(sdk.server.requests).toEqual([
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

    expect(sdk.stdio[2]).toEqual([]);
  });

  it('handles snapshot failures', async () => {
    sdk.test.failure('/percy/snapshot', 'failure');

    await sdk.stdio(async () => {
      await percySnapshot(driver, 'Snapshot 1');
    });

    expect(sdk.stdio[1]).toHaveLength(0);
    expect(sdk.stdio[2]).toEqual([
      '[percy] Could not take DOM snapshot "Snapshot 1"\n',
      '[percy] Error: failure\n'
    ]);
  });
});
