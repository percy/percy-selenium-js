const { Builder, until } = require("selenium-webdriver");
const percySnapshot = require("../index.js");

(async function() {
  let driver = await new Builder().forBrowser("chrome").build();

  async function sdkTestWebsite() {
    await driver.get("https://sdk-test.percy.dev");
    await driver.wait(until.titleIs("SDK Test Website"), 1000);
    await percySnapshot(driver, "Percy test");
  }

  async function passingOptions(options) {
    await driver.get("https://sdk-test.percy.dev");
    await driver.wait(until.titleIs("SDK Test Website"), 1000);

    await percySnapshot(driver, `Passed snapshot options with ${Object.keys(options)}`, options);
  }
  try {
    await sdkTestWebsite();
    await passingOptions({ minHeight: 1800 });
    await passingOptions({ widths: [1200, 768] });
    await passingOptions({ enableJavaScript: true });

    await passingOptions({
      percyCSS: `body { background-color: purple; }`
    });
  } finally {
    await driver.quit();
  }
})();
