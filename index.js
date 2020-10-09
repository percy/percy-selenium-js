const fs = require('fs');
const fetch = require('node-fetch');
const log = require('@percy/logger');

// Collect client and environment information
const sdkPkg = require('./package.json');
const seleniumPkg = require('selenium-webdriver/package.json');
const CLIENT_INFO = `${sdkPkg.name}/${sdkPkg.version}`;
const ENV_INFO = `${seleniumPkg.name}/${seleniumPkg.version}`;

// Maybe get the CLI API address from the environment
const { PERCY_CLI_API = 'http://localhost:5338/percy' } = process.env;

// Check if Percy is enabled using the healthcheck endpoint
async function isPercyEnabled() {
  if (isPercyEnabled.result == null) {
    try {
      let response = await fetch(`${PERCY_CLI_API}/healthcheck`);
      isPercyEnabled.result = response.ok;
    } catch (err) {
      isPercyEnabled.result = false;
      log.debug(err);
    }

    if (isPercyEnabled.result === false) {
      log.info('Percy is not running, disabling snapshots');
    }
  }

  return isPercyEnabled.result;
};

// Take a DOM snapshot and post it to the snapshot endpoint
async function percySnapshot(browser, name, options) {
  if (!browser) throw new Error('An instance of the selenium driver object is required.');
  if (!name) throw new Error('The `name` argument is required.');
  if (!(await isPercyEnabled())) return;

  try {
    // Inject the DOM serialization script
    await browser.executeScript(
      fs.readFileSync(require.resolve('@percy/dom'), 'utf-8')
    );

    // Serialize and capture the DOM
    /* istanbul ignore next: no instrumenting injected code */
    let domSnapshot = await browser.executeScript(options => {
      /* eslint-disable-next-line no-undef */
      return PercyDOM.serialize(options);
    }, options);

    // Post the DOM to the snapshot endpoint with snapshot options and other info
    let response = await fetch(`${PERCY_CLI_API}/snapshot`, {
      method: 'POST',
      body: JSON.stringify({
        ...options,
        environmentInfo: ENV_INFO,
        clientInfo: CLIENT_INFO,
        url: await browser.getCurrentUrl(),
        domSnapshot,
        name
      })
    });

    // Handle errors
    let { success, error } = await response.json();
    if (!success) throw new Error(error);
  } catch (err) {
    log.error(`Could not take DOM snapshot "${name}"`);
    log.error(err);
  }
};

module.exports = percySnapshot;
module.exports.isPercyEnabled = isPercyEnabled;
