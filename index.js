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

async function percyScreenshot(driver, name, options, postScreenshot = utils.postScreenshot) {
  if (!driver) throw new Error('An instance of the selenium driver object is required.');
  if (!name) throw new Error('The `name` argument is required.');
  if (!(await utils.isPercyEnabled())) return;
  let log = utils.logger('selenium-webdriver');
  try {
    const session = await driver.getSession();
    const sessionId = session.getId();
    const capabilities = Object.fromEntries(session.getCapabilities().map_);
    let commandExecutorUrl;

    // To intercept request from driver. used to get remote server url
    const interceptor = new RequestInterceptor(withDefaultInterceptors.default);
    interceptor.use((req) => {
      const url = req.url.href;
      commandExecutorUrl = url.split('/session')[0];
    });
    await driver.getCurrentUrl();
    interceptor.restore();

    // Post the driver details to the automate screenshot endpoint with snapshot options and other info
    await postScreenshot({
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

const percy = module.exports = percySnapshot;
percy.percyScreenshot = percyScreenshot;
