// Collect client and environment information
const sdkPkg = require('./package.json');
let seleniumPkg;
try {
  seleniumPkg = require('selenium-webdriver/package.json');
} catch {
  /* istanbul ignore next */
  seleniumPkg = { name: 'unknown', version: 'unknown' };
}
const CLIENT_INFO = `${sdkPkg.name}/${sdkPkg.version}`;
const ENV_INFO = `${seleniumPkg.name}/${seleniumPkg.version}`;
const utils = require('@percy/sdk-utils');
const { DriverMetadata } = require('./driverMetadata');

// Take a DOM snapshot and post it to the snapshot endpoint
module.exports = async function percySnapshot(driver, name, options) {
  if (!driver) throw new Error('An instance of the selenium driver object is required.');
  if (!name) throw new Error('The `name` argument is required.');
  if (!(await module.exports.isPercyEnabled())) return;
  let log = utils.logger('selenium-webdriver');
  if (utils.percy?.type === 'automate') {
    throw new Error('Invalid function call - percySnapshot(). Please use percyScreenshot() function while using Percy with Automate. For more information on usage of percyScreenshot, refer https://docs.percy.io/docs/integrate-functional-testing-with-visual-testing');
  }

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
    const response = await utils.postSnapshot({
      ...options,
      environmentInfo: ENV_INFO,
      clientInfo: CLIENT_INFO,
      domSnapshot,
      name,
      url
    });
    return response?.body?.data;
  } catch (error) {
    // Handle errors
    log.error(`Could not take DOM snapshot "${name}"`);
    log.error(error);
  }
};

module.exports.request = async function request(data) {
  return await utils.captureAutomateScreenshot(data);
}; // To mock in test case

const getElementIdFromElements = async function getElementIdFromElements(elements) {
  return Promise.all(elements.map(e => e.getId()));
};

module.exports.percyScreenshot = async function percyScreenshot(driver, name, options) {
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
  if (!(await module.exports.isPercyEnabled())) return;
  let log = utils.logger('selenium-webdriver');
  if (utils.percy?.type !== 'automate') {
    throw new Error('Invalid function call - percyScreenshot(). Please use percySnapshot() function for taking screenshot. percyScreenshot() should be used only while using Percy with Automate. For more information on usage of PercySnapshot(), refer doc for your language https://docs.percy.io/docs/end-to-end-testing');
  }

  try {
    const driverData = new DriverMetadata(driver);
    if (options) {
      if ('ignoreRegionSeleniumElements' in options) {
        options.ignore_region_selenium_elements = options.ignoreRegionSeleniumElements;
        delete options.ignoreRegionSeleniumElements;
      }
      if ('considerRegionSeleniumElements' in options) {
        options.consider_region_selenium_elements = options.considerRegionSeleniumElements;
        delete options.considerRegionSeleniumElements;
      }
      if ('ignore_region_selenium_elements' in options) {
        options.ignore_region_selenium_elements = await getElementIdFromElements(options.ignore_region_selenium_elements);
      }
      if ('consider_region_selenium_elements' in options) {
        options.consider_region_selenium_elements = await getElementIdFromElements(options.consider_region_selenium_elements);
      }
    }

    // Post the driver details to the automate screenshot endpoint with snapshot options and other info
    const response = await module.exports.request({
      environmentInfo: ENV_INFO,
      clientInfo: CLIENT_INFO,
      sessionId: await driverData.getSessionId(),
      commandExecutorUrl: await driverData.getCommandExecutorUrl(),
      capabilities: await driverData.getCapabilities(),
      snapshotName: name,
      options
    });
    return response?.body?.data;
  } catch (error) {
    // Handle errors
    log.error(`Could not take Screenshot "${name}"`);
    log.error(error.stack);
  }
};

// jasmine cannot mock individual functions, hence adding isPercyEnabled to the exports object
// also need to define this at the end of the file or else default exports will over-ride this
module.exports.isPercyEnabled = async function isPercyEnabled() {
  return await utils.isPercyEnabled();
};
