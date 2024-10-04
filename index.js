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
const log = utils.logger('selenium-webdriver');

const getWidthsForMultiDOM = (userPassedWidths, eligibleWidths) => {
  // Deep copy of eligible mobile widths
  let allWidths = [];
  if (eligibleWidths?.mobile?.length !== 0) {
    allWidths = allWidths.concat(eligibleWidths?.mobile);
  }
  if (userPassedWidths.length !== 0) {
    allWidths = allWidths.concat(userPassedWidths);
  } else {
    allWidths = allWidths.concat(eligibleWidths.config);
  }

  return [...new Set(allWidths)].filter(e => e); // Removing duplicates
};

async function changeWindowDimensionAndWait(driver, width, height, resizeCount) {
  try {
    const caps = await driver.getCapabilities();
    if (typeof driver?.sendDevToolsCommand === 'function' && caps.getBrowserName() === 'chrome') {
      await driver?.sendDevToolsCommand('Emulation.setDeviceMetricsOverride', {
        height,
        width,
        deviceScaleFactor: 1,
        mobile: false
      });
    } else {
      await driver.manage().window().setRect({ width, height });
    }
  } catch (e) {
    log.debug(`Resizing using CDP failed, falling back to driver resize for width ${width}`, e);
    await driver.manage().window().setRect({ width, height });
  }

  try {
    await driver.wait(async () => {
      /* istanbul ignore next: no instrumenting injected code */
      await driver.executeScript('return window.resizeCount') === resizeCount;
    }, 1000);
  } catch (e) {
    log.debug(`Timed out waiting for window resize event for width ${width}`, e);
  }
}

// Captures responsive DOM snapshots across different widths
async function captureResponsiveDOM(driver, options) {
  const widths = getWidthsForMultiDOM(options.widths || [], utils.percy?.widths);
  const domSnapshots = [];
  const windowSize = await driver.manage().window().getRect();
  let currentWidth = windowSize.width; let currentHeight = windowSize.height;
  let lastWindowWidth = currentWidth;
  let resizeCount = 0;
  // Setup the resizeCount listener if not present
  /* istanbul ignore next: no instrumenting injected code */
  await driver.executeScript('PercyDOM.waitForResize()');
  for (let width of widths) {
    if (lastWindowWidth !== width) {
      resizeCount++;
      await changeWindowDimensionAndWait(driver, width, currentHeight, resizeCount);
      lastWindowWidth = width;
    }

    if (process.env.RESPONSIVE_CAPTURE_SLEEP_TIME) {
      await new Promise(resolve => setTimeout(resolve, parseInt(process.env.RESPONSIVE_CAPTURE_SLEEP_TIME) * 1000));
    }

    let domSnapshot = await captureSerializedDOM(driver, options);
    domSnapshot.width = width;
    domSnapshots.push(domSnapshot);
  }

  // Reset window size back to original dimensions
  await changeWindowDimensionAndWait(driver, currentWidth, currentHeight, resizeCount + 1);
  return domSnapshots;
}

async function captureSerializedDOM(driver, options) {
  /* istanbul ignore next: no instrumenting injected code */
  let { domSnapshot } = await driver.executeScript(options => ({
    /* eslint-disable-next-line no-undef */
    domSnapshot: PercyDOM.serialize(options)
  }), options);
  /* istanbul ignore next: no instrumenting injected code */
  domSnapshot.cookies = await driver.manage().getCookies() || [];
  return domSnapshot;
}

function isResponsiveDOMCaptureValid(options) {
  if (utils.percy?.config?.percy?.deferUploads) {
    return false;
  }
  return (
    options?.responsive_snapshot_capture ||
    options?.responsiveSnapshotCapture ||
    utils.percy?.config?.snapshot?.responsiveSnapshotCapture ||
    false
  );
}

async function captureDOM(driver, options = {}) {
  const responsiveSnapshotCapture = isResponsiveDOMCaptureValid(options);
  if (responsiveSnapshotCapture) {
    return await captureResponsiveDOM(driver, options);
  } else {
    return await captureSerializedDOM(driver, options);
  }
}

async function currentURL(driver, options) {
  /* istanbul ignore next: no instrumenting injected code */
  let { url } = await driver.executeScript(options => ({
    /* eslint-disable-next-line no-undef */
    url: document.URL
  }), options);
  return url;
}

// Take a DOM snapshot and post it to the snapshot endpoint
const percySnapshot = async function percySnapshot(driver, name, options) {
  if (!driver) throw new Error('An instance of the selenium driver object is required.');
  if (!name) throw new Error('The `name` argument is required.');
  if (!(await module.exports.isPercyEnabled())) return;
  if (utils.percy?.type === 'automate') {
    throw new Error('Invalid function call - percySnapshot(). Please use percyScreenshot() function while using Percy with Automate. For more information on usage of percyScreenshot, refer https://www.browserstack.com/docs/percy/integrate/functional-and-visual');
  }

  try {
    // Inject the DOM serialization script
    await driver.executeScript(await utils.fetchPercyDOM());
    // Serialize and capture the DOM
    /* istanbul ignore next: no instrumenting injected code */
    let domSnapshot = await captureDOM(driver, options);
    let url = await currentURL(driver, options);
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

module.exports = percySnapshot;
module.exports.percySnapshot = percySnapshot;

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
  if (utils.percy?.type !== 'automate') {
    throw new Error('Invalid function call - percyScreenshot(). Please use percySnapshot() function for taking screenshot. percyScreenshot() should be used only while using Percy with Automate. For more information on usage of PercySnapshot(), refer doc for your language https://www.browserstack.com/docs/percy/integrate/overview');
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
