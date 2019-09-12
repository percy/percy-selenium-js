const { Builder, until } = require("selenium-webdriver");
const percySnapshot = require("../index.js");

(async function example() {
  let driver = await new Builder().forBrowser("chrome").build();
  try {
    await driver.get("https://sdk-test.percy.dev");
    await driver.wait(until.titleIs("SDK Test Website"), 1000);
    await percySnapshot(driver, "Percy test");
  } finally {
    await driver.quit();
  }
})();
