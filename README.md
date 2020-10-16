# @percy/selenium-webdriver
[![Version](https://img.shields.io/npm/v/@percy/selenium-webdriver.svg)](https://npmjs.org/package/@percy/selenium-webdriver)
![Test](https://github.com/percy/percy-selenium-js/workflows/Test/badge.svg)

[Percy](https://percy.io) visual testing for [Selenium.js](https://www.npmjs.com/package/selenium-webdriver).

## Installation

Using yarn:

```sh-session
$ yarn add --dev @percy/cli @percy/selenium-webdriver
```

Using npm:

```sh-session
$ npm install --save-dev @percy/cli @percy/selenium-webdriver
```

## Usage

This is an example using the `percySnapshot` function. For other examples of `selenium-webdriver`
usage, see the [Selenium JS docs](https://www.selenium.dev/selenium/docs/api/javascript/index.html).

```javascript
const { Builder } = require('selenium-webdriver');
const percySnapshot = require('@percy/selenium-webdriver');

(async function example() {
  let driver = await new Builder().forBrowser('firefox').build();

  try {
    await driver.get('http://google.com/');
    await percySnapshot(driver, 'Google Homepage');

    await driver.get('http://example.com/');
    await percySnapshot(driver, 'Example Site');
  } finally {
    await driver.quit();
  }
})();
```

Running the code above directly will result in the following logs:

```sh-session
$ node script.js
[percy] Percy is not running, disabling snapshots
```

When running with [`percy
exec`](https://github.com/percy/cli/tree/master/packages/cli-exec#percy-exec), and your project's
`PERCY_TOKEN`, a new Percy build will be created and snapshots will be uploaded to your project.

```sh-session
$ export PERCY_TOKEN=[your-project-token]
$ percy exec -- node script.js
[percy] Percy has started!
[percy] Created build #1: https://percy.io/[your-project]
[percy] Running "node script.js"
[percy] Snapshot taken "Google Homepage"
[percy] Snapshot taken "Example Site"
[percy] Stopping percy...
[percy] Finalized build #1: https://percy.io/[your-project]
[percy] Done!
```

## Configuration

`percySnapshot(driver, name[, options])`

- `driver` (**required**) - A `selenium-webdriver` driver instance
- `name` (**required**) - The snapshot name; must be unique to each snapshot
- `options` - Additional snapshot options (overrides any project options)
  - `options.widths` - An array of widths to take screenshots at
  - `options.minHeight` - The minimum viewport height to take screenshots at
  - `options.percyCSS` - Percy specific CSS only applied in Percy's rendering environment
  - `options.requestHeaders` - Headers that should be used during asset discovery
  - `options.enableJavaScript` - Enable JavaScript in Percy's rendering environment
