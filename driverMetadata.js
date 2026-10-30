// const utils = require('@percy/sdk-utils');
const { Cache } = require('./cache');
const { RequestInterceptor } = require('node-request-interceptor');
const withDefaultInterceptors = require('node-request-interceptor/lib/presets/default');

// The interceptor patches http globally, so only one may be active at a time
let interceptLock = Promise.resolve();
function withInterceptLock(fn) {
  const run = interceptLock.then(fn, fn);
  interceptLock = run.catch(() => {});
  return run;
}

// Drop basic-auth userinfo from a hub url. The CLI never uses it and rewrites
// such urls to https, so mirror that here instead of forwarding the credentials.
function stripCredentials(url) {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/@]*@/i, 'https://');
}

class DriverMetadata {
  constructor(driver) {
    this.driver = driver;
    this.sessionId = null;
    if (this.driver.constructor.name.includes('Browser')) {
      this.type = 'wdio';
    } else {
      this.type = 'wd';
    }
  }

  async getSessionId() {
    if (!this.sessionId) {
      if (this.type === 'wdio') this.sessionId = await this.driver.sessionId;
      if (this.type === 'wd') this.sessionId = await (await this.driver.getSession()).getId();
    }
    return this.sessionId;
  }

  async getCapabilities() {
    return await Cache.withCache(Cache.capabilities, await this.getSessionId(), async () => {
      if (this.type === 'wdio') {
        return await this.driver.capabilities;
      } else {
        const session = await this.driver.getSession();
        const capabilities = Object.fromEntries(session.getCapabilities().map_);
        return capabilities;
      }
    });
  }

  async getCommandExecutorUrl() {
    return await Cache.withCache(Cache.commandExecutorUrl, await this.getSessionId(), async () => {
      if (this.type === 'wdio') {
        return `${this.driver.options.protocol}://${this.driver.options.hostname}${this.driver.options.path}`;
      } else {
        return withInterceptLock(async () => {
          // To intercept request from driver. used to get remote server url
          const sessionPath = `/session/${this.sessionId}/`;
          const interceptor = new RequestInterceptor(withDefaultInterceptors.default);
          let commandExecutorUrl = '';
          let markSeen;
          const seen = new Promise(resolve => { markSeen = resolve; });
          interceptor.use((req) => {
            const url = req.url.href;
            // only this session's request; other sessions share the global patch
            if (!url.includes(sessionPath)) return;
            commandExecutorUrl = stripCredentials(url.split(sessionPath)[0]);
            markSeen();
          });
          // making a call so we can intercept commandExecutorUrl
          const call = this.driver.getCurrentUrl();
          call.catch(() => {});
          try {
            // release once our request is seen, so a hung hub can't hold the lock
            await Promise.race([call, seen]);
          } finally {
            // To stop intercepting request, even if the call fails
            interceptor.restore();
          }
          return commandExecutorUrl;
        });
      }
    });
  }
}

module.exports = {
  DriverMetadata,
  stripCredentials
};
