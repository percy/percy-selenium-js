import { DriverMetadata } from '../driverMetadata.js';
import { Cache } from '../cache.js';

describe('DriverMetadata', () => {
  class Browser { // Mocking WDIO driver
    constructor() {
      this.sessionId = '123';
      this.capabilities = { browserName: 'chrome' };
      this.options = { protocol: 'https', path: '/wd/hub', hostname: 'hub-cloud.browserstack.com' };
    }
  }
  class BoundBrowser { // Mocking ts WDIO driver
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
    Cache.reset();
  });

  describe('getSessionId', () => {
    it('returns the sessionId', async () => {
      const driverMetadata = new DriverMetadata(driver);
      await expectAsync(driverMetadata.getSessionId()).toBeResolvedTo('123');
    });

    it('Should work with typescript wdio', async () => {
      const driverMetadata = new DriverMetadata(new BoundBrowser());
      await expectAsync(driverMetadata.getSessionId()).toBeResolvedTo('123');
    });
  });

  describe('getCapabilities', () => {
    it('returns the capabilities', async () => {
      const driverMetadata = new DriverMetadata(driver);
      await expectAsync(driverMetadata.getCapabilities()).toBeResolvedTo({ browserName: 'chrome', platform: 'WINDOWS', version: '123' });
    });
  });

  describe('getCommandExecutorUrl', () => {
    it('return the command executor url', async () => {
      const driverMetadata = new DriverMetadata(new Browser());
      await expectAsync(driverMetadata.getCommandExecutorUrl()).toBeResolvedTo('https://hub-cloud.browserstack.com/wd/hub');
    });
  });
});
