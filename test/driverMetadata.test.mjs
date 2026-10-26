import http from 'http';
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

    describe('with a selenium-webdriver driver', () => {
      let servers = [];

      // Starts a local hub; the mock driver's getCurrentUrl calls it over http
      const startHub = async () => {
        const server = http.createServer((_, res) => setTimeout(() => res.end('{}'), 20));
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        servers.push(server);
        return `http://127.0.0.1:${server.address().port}`;
      };

      const wdDriver = (id, hub, failing) => ({
        getSession: async () => ({ getId: () => id }),
        getCurrentUrl: () => new Promise((resolve, reject) => {
          http.get(`${hub}/session/${id}/url`, res => {
            res.resume();
            res.on('end', () => (failing ? reject(new Error('boom')) : resolve('')));
          }).on('error', reject);
        })
      });

      afterEach(async () => {
        await Promise.all(servers.map(s => new Promise(resolve => s.close(resolve))));
        servers = [];
      });

      it('keeps concurrent sessions from seeing each other\'s url', async () => {
        const [hubA, hubB] = [await startHub(), await startHub()];
        const results = await Promise.all([
          new DriverMetadata(wdDriver('a', hubA)).getCommandExecutorUrl(),
          new DriverMetadata(wdDriver('b', hubB)).getCommandExecutorUrl()
        ]);
        expect(results).toEqual([hubA, hubB]);
      });

      it('stops intercepting when the driver call fails', async () => {
        const hub = await startHub();
        await expectAsync(
          new DriverMetadata(wdDriver('c', hub, true)).getCommandExecutorUrl()
        ).toBeRejectedWithError('boom');
        // a later call must still work, so the failed one released the lock and the patch
        await expectAsync(
          new DriverMetadata(wdDriver('d', hub)).getCommandExecutorUrl()
        ).toBeResolvedTo(hub);
      });
    });
  });
});
