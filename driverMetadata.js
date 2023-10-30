// const utils = require('@percy/sdk-utils');
const { Cache } = require('./cache');
const { RequestInterceptor } = require('node-request-interceptor');
const withDefaultInterceptors = require('node-request-interceptor/lib/presets/default');

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
        // To intercept request from driver. used to get remote server url
        const interceptor = new RequestInterceptor(withDefaultInterceptors.default);
        let commandExecutorUrl = '';
        interceptor.use((req) => {
          const url = req.url.href;
          commandExecutorUrl = url.split('/session')[0];
        });
        // making a call so we can intercept commandExecutorUrl
        await this.driver.getCurrentUrl();
        // To stop intercepting request
        interceptor.restore();
        return commandExecutorUrl;
      }
    });
  }
}

module.exports = {
  DriverMetadata
};
