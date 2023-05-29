// Collect client and environment information
const sdkPkg = require('./package.json');
const seleniumPkg = require('selenium-webdriver/package.json');
const CLIENT_INFO = `${sdkPkg.name}/${sdkPkg.version}`;
const ENV_INFO = `${seleniumPkg.name}/${seleniumPkg.version}`;
const utils = require('@percy/sdk-utils');
const { RequestInterceptor } = require('node-request-interceptor');
const withDefaultInterceptors = require('node-request-interceptor/lib/presets/default');

// Take a DOM snapshot and post it to the snapshot endpoint
async function percySnapshot(driver, name, options) {
  if (!driver) throw new Error('An instance of the selenium driver object is required.');
  if (!name) throw new Error('The `name` argument is required.');
  if (!(await utils.isPercyEnabled())) return;
  let log = utils.logger('selenium-webdriver');

  try {
    // Inject the DOM serialization script
    await driver.executeScript(await utils.fetchPercyDOM());

    // Serialize and capture the DOM
    /* istanbul ignore next: no instrumenting injected code */
    let { domSnapshot, url } = await driver.executeScript(options => ({
      /* eslint-disable-next-line no-undef */
      domSnapshot: PercyDOM.serialize(options),
      url: document.URL
    }), options);

    // Post the DOM to the snapshot endpoint with snapshot options and other info
    await utils.postSnapshot({
      ...options,
      environmentInfo: ENV_INFO,
      clientInfo: CLIENT_INFO,
      domSnapshot,
      name,
      url
    });
  } catch (error) {
    // Handle errors
    log.error(`Could not take DOM snapshot "${name}"`);
    log.error(error);
  }
};

async function request(data) {
  await utils.postScreenshot(data);
}

async function percyScreenshot(driver, name, options) {
  if (!driver || typeof driver === 'string') {
    // Unable to test this as couldnt define `browser` from test mjs file
    try {
      // browser is defined in wdio context
      // eslint-disable-next-line no-undef
      [driver, name, options] = [browser, driver, name];
    } catch (e) { // ReferenceError: browser is not defined.
      driver = undefined;
    }
  }

  if (!driver) throw new Error('An instance of the selenium driver object is required.');
  if (!name) throw new Error('The `name` argument is required.');
  if (!(await utils.isPercyEnabled())) return;
  let log = utils.logger('selenium-webdriver');

  try {
    let sessionId, capabilities, commandExecutorUrl;
    if (driver.constructor.name === 'Browser') { // Logic for wdio
      sessionId = driver.sessionId;
      capabilities = driver.capabilities;
      commandExecutorUrl = `${driver.options.protocol}://${driver.options.hostname}${driver.options.path}`;
    } else { // Logic for selenium-webdriver
      const session = await driver.getSession();
      sessionId = session.getId();
      capabilities = Object.fromEntries(session.getCapabilities().map_);

      // To intercept request from driver. used to get remote server url
      const interceptor = new RequestInterceptor(withDefaultInterceptors.default);
      interceptor.use((req) => {
        const url = req.url.href;
        commandExecutorUrl = url.split('/session')[0];
      });
      await driver.getCurrentUrl();
      interceptor.restore();
    }

    // Post the driver details to the automate screenshot endpoint with snapshot options and other info
    await module.exports.request({
      ...options,
      environmentInfo: ENV_INFO,
      clientInfo: CLIENT_INFO,
      sessionId: sessionId,
      commandExecutorUrl: commandExecutorUrl,
      capabilities: capabilities,
      snapshotName: name
    });
  } catch (error) {
    // Handle errors
    log.error(`Could not take Screenshot "${name}"`);
    log.error(error.stack);
  }
};

module.exports = percySnapshot;
module.exports.percyScreenshot = percyScreenshot;
module.exports.request = request; // To mock in test case
