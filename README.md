# @percy/selenium-webdriver
[![Version](https://img.shields.io/npm/v/@percy/selenium-webdriver.svg)](https://npmjs.org/package/@percy/selenium-webdriver)
![Test](https://github.com/percy/percy-selenium-js/workflows/Test/badge.svg)

[Percy](https://percy.io) visual testing for [Selenium.js](https://www.npmjs.com/package/selenium-webdriver).

## Installation

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
- `options` - [See per-snapshot configuration options](https://docs.percy.io/docs/cli-configuration#per-snapshot-configuration)

## Upgrading

### Automatically with `@percy/migrate`

We built a tool to help automate migrating to the new CLI toolchain! Migrating
can be done by running the following commands and following the prompts:

``` shell
$ npx @percy/migrate
? Are you currently using @percy/selenium-webdriver (@percy/seleniumjs)? Yes
? Install @percy/cli (required to run percy)? Yes
? Migrate Percy config file? Yes
? Upgrade SDK to @percy/selenium-webdriver@1.0.0? Yes
```

This will automatically run the changes described below for you.

### Manually

#### Uninstalling `@percy/seleniumjs`

If you're coming from the `@percy/seleniumjs` package, make sure to uninstall that package first
before installing this one.

```sh-session
$ npm uninstall @percy/seleniumjs
```

Now you can safely [install `@percy/selenium-webdriver` and `@percy/cli`](#installation).

#### Installing `@percy/cli`

If you're coming from a pre-1.0 version of this package, make sure to install `@percy/cli` after
upgrading to retain any existing scripts that reference the Percy CLI command.

```sh-session
$ npm install --save-dev @percy/cli
```


#### Migrating Config

If you have a previous Percy configuration file, migrate it to the newest version with the
[`config:migrate`](https://github.com/percy/cli/tree/master/packages/cli-config#percy-configmigrate-filepath-output) command:

```sh-session
$ percy config:migrate
```
