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
  });

  after(async () => {
    await driver.quit();
  });

  beforeEach(async () => {
    await helpers.setupTest();
    await driver.get(helpers.testSnapshotURL);
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
    await helpers.test('error', '/percy/healthcheck');

    await percySnapshot(driver, 'Snapshot 1');
    await percySnapshot(driver, 'Snapshot 2');

    expect(await helpers.get('logs')).toEqual(expect.arrayContaining([
      'Percy is not running, disabling snapshots'
    ]));
  });

  it('posts snapshots to the local percy server', async () => {
    await percySnapshot(driver, 'Snapshot 1');
    await percySnapshot(driver, 'Snapshot 2');

    expect(await helpers.get('logs')).toEqual(expect.arrayContaining([
      'Snapshot found: Snapshot 1',
      'Snapshot found: Snapshot 2',
      `- url: ${helpers.testSnapshotURL}`,
      expect.stringMatching(/clientInfo: @percy\/selenium-webdriver\/.+/),
      expect.stringMatching(/environmentInfo: selenium-webdriver\/.+/)
    ]));
  });

  it('handles snapshot failures', async () => {
    await helpers.test('error', '/percy/snapshot');
    await percySnapshot(driver, 'Snapshot 1');

    expect(await helpers.get('logs')).toEqual(expect.arrayContaining([
      'Could not take DOM snapshot "Snapshot 1"'
    ]));
  });
});
