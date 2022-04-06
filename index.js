// Collect client and environment information
const sdkPkg = require('./package.json');
const seleniumPkg = require('selenium-webdriver/package.json');
const CLIENT_INFO = `${sdkPkg.name}/${sdkPkg.version}`;
const ENV_INFO = `${seleniumPkg.name}/${seleniumPkg.version}`;

// Take a DOM snapshot and post it to the snapshot endpoint
module.exports = async function percySnapshot(driver, name, options) {
  let utils = await import('@percy/sdk-utils');

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
