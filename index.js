const pkg = require('./package.json');
const seleniumPkg = require('selenium-webdriver/package.json');
const { readFileSync } = require('fs');
const { agentJsFilename, isAgentRunning, postSnapshot } = require('@percy/agent/dist/utils/sdk-utils');

const CLIENT_INFO = `${pkg.name}/${pkg.version}`;
const ENV_INFO = `${seleniumPkg.name}/${seleniumPkg.version}`;

module.exports = async function percySnapshot(browser, name, options) {
  if (!browser) {
    throw new Error('An instance of the selenium driver object must be provided.');
  }

  if (!name) {
    throw new Error("'name' must be provided.");
  }

  try {
    let agentJSString = readFileSync(agentJsFilename()).toString();

    await browser.executeScript(agentJSString);
  } catch (err) {
    console.log(`[percy] Could not inject agent JS for snapshot '${name}', maybe due to stringent CSPs: ${err}`);
    return;
  }

  if (!(await isAgentRunning())) {
    return;
  }

  let domSnapshot;

  try {
    domSnapshot = await browser.executeScript(function(options) {
      return new window.PercyAgent({
        handleAgentCommunication: false
      }).domSnapshot(document, options);
    }, options);
  } catch (err) {
    console.log(`[percy] Could not take snapshot of the DOM for '${name}': ${err}`);
    return;
  }

  await postDomSnapshot(
    name,
    domSnapshot,
    await browser.getCurrentUrl(),
    options
  );
};

async function postDomSnapshot(name, domSnapshot, url, options) {
  let postSuccess = await postSnapshot({
    name,
    url,
    domSnapshot,
    clientInfo: CLIENT_INFO,
    environmentInfo: ENV_INFO,
    ...options
  });

  if (!postSuccess) {
    console.log(`[percy] Error posting snapshot to agent.`);
  }
}
