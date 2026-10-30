import http from 'http';
import { DriverMetadata, stripCredentials } from '../driverMetadata.js';
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
      const startHub = async (stall) => {
        const held = [];
        const server = http.createServer((_, res) => (stall ? held.push(res) : setTimeout(() => res.end('{}'), 20)));
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        server.held = held;
        servers.push(server);
        return `http://127.0.0.1:${server.address().port}`;
      };

      const get = (url) => new Promise((resolve, reject) => {
        http.get(url, res => { res.resume(); res.on('end', resolve); }).on('error', reject);
      });

      const wdDriver = (id, hub, { failing, noise } = {}) => ({
        getSession: async () => ({ getId: () => id }),
        getCurrentUrl: async () => {
          if (failing) throw new Error('boom');
          if (noise) await get(`${noise}/session/other/element`); // another session's command
          await get(`${hub}/session/${id}/url`);
          return '';
        }
      });

      afterEach(async () => {
        servers.forEach(s => s.held.forEach(res => res.end('{}')));
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
          new DriverMetadata(wdDriver('c', hub, { failing: true })).getCommandExecutorUrl()
        ).toBeRejectedWithError('boom');
        // a later call must still work, so the failed one released the lock and the patch
        await expectAsync(
          new DriverMetadata(wdDriver('d', hub)).getCommandExecutorUrl()
        ).toBeResolvedTo(hub);
      });

      it('drops credentials embedded in the hub url', async () => {
        const hub = await startHub();
        const authed = hub.replace('http://', 'http://user:key@');
        await expectAsync(
          new DriverMetadata(wdDriver('h', authed)).getCommandExecutorUrl()
        ).toBeResolvedTo(hub.replace('http://', 'https://'));
      });

      it('ignores requests from other sessions', async () => {
        const [hub, other] = [await startHub(), await startHub()];
        await expectAsync(
          new DriverMetadata(wdDriver('e', hub, { noise: other })).getCommandExecutorUrl()
        ).toBeResolvedTo(hub);
      });

      it('does not hold the lock while the hub hangs', async () => {
        const [stuck, hub] = [await startHub(true), await startHub()];
        await expectAsync(new DriverMetadata(wdDriver('f', stuck)).getCommandExecutorUrl()).toBeResolvedTo(stuck);
        await expectAsync(new DriverMetadata(wdDriver('g', hub)).getCommandExecutorUrl()).toBeResolvedTo(hub);
      });
    });
  });

  describe('stripCredentials', () => {
    it('removes userinfo the same way the CLI does', () => {
      expect(stripCredentials('https://USER:KEY@hub-cloud.browserstack.com/wd/hub'))
        .toEqual('https://hub-cloud.browserstack.com/wd/hub');
      expect(stripCredentials('http://user:key@localhost:4444/wd/hub'))
        .toEqual('https://localhost:4444/wd/hub');
    });

    it('leaves urls without credentials untouched', () => {
      expect(stripCredentials('http://localhost:4444/wd/hub')).toEqual('http://localhost:4444/wd/hub');
      expect(stripCredentials('https://hub.example.com/a@b')).toEqual('https://hub.example.com/a@b');
    });
  });
});
