import webdriver from 'selenium-webdriver';
import helpers from '@percy/sdk-utils/test/helpers';
import percySnapshot from '../index.js';

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
