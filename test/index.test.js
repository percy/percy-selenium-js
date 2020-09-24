const expect = require('expect');
const webdriver = require('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox');
const stdio = require('@percy/logger/test/helper');
const createTestServer = require('@percy/core/test/helpers/server');

// required before each test to reset healthcheck result
let percySnapshot;

describe('percySnapshot', () => {
  let driver, percyServer, testServer;

  before(async function() {
    this.timeout(0);

    // use a firefox driver for testing
    driver = await new webdriver.Builder()
      .forBrowser('firefox').setFirefoxOptions(
        new firefox.Options().headless()
      ).build();
  });

  after(async () => {
    await driver.quit();
  });

  beforeEach(async () => {
    // re-require to clear previous healthcheck result
    delete require.cache[require.resolve('..')];
    percySnapshot = require('..');

    // mock percy server
    percyServer = await createTestServer({
      default: () => [200, 'application/json', { success: true }]
    }, 5338);

    // test site server
    testServer = await createTestServer({
      default: () => [200, 'text/html', 'Snapshot Me']
    });

    // go to test site
    await driver.get('http://localhost:8000');
  });

  afterEach(async () => {
    await percyServer.close();
    await testServer.close();
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
    percyServer.reply('/percy/healthcheck', () => Promise.reject(new Error()));

    await stdio.capture(async () => {
      await percySnapshot(driver, 'Snapshot 1');
      await percySnapshot(driver, 'Snapshot 2');
    });

    expect(percyServer.requests).toEqual([
      ['/percy/healthcheck']
    ]);

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual([
      '[percy] Percy is not running, disabling snapshots\n'
    ]);
  });

  it('disables snapshots when the healthcheck encounters an error', async () => {
    percyServer.reply('/percy/healthcheck', req => req.connection.destroy());

    await stdio.capture(async () => {
      await percySnapshot(driver, 'Snapshot 1');
      await percySnapshot(driver, 'Snapshot 2');
    });

    expect(percyServer.requests).toEqual([
      ['/percy/healthcheck']
    ]);

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual([
      '[percy] Percy is not running, disabling snapshots\n'
    ]);
  });

  it('posts snapshots to the local percy server', async () => {
    await percySnapshot(driver, 'Snapshot 1');
    await percySnapshot(driver, 'Snapshot 2');

    expect(percyServer.requests).toEqual([
      ['/percy/healthcheck'],
      ['/percy/snapshot', {
        name: 'Snapshot 1',
        url: 'http://localhost:8000/',
        domSnapshot: '<!DOCTYPE html><html><head></head><body>Snapshot Me</body></html>',
        clientInfo: expect.stringMatching(/@percy\/seleniumjs\/.+/),
        environmentInfo: expect.stringMatching(/selenium-webdriver\/.+/)
      }],
      ['/percy/snapshot', expect.objectContaining({
        name: 'Snapshot 2'
      })]
    ]);
  });

  it('handles snapshot errors', async () => {
    percyServer.reply('/percy/snapshot', () => (
      [400, 'application/json', { success: false, error: 'testing' }]
    ));

    await stdio.capture(async () => {
      await percySnapshot(driver, 'Snapshot 1');
    });

    expect(stdio[1]).toHaveLength(0);
    expect(stdio[2]).toEqual([
      '[percy] Could not take DOM snapshot "Snapshot 1"\n',
      '[percy] Error: testing\n'
    ]);
  });
});
