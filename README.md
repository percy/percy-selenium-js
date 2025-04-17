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
- `options` - [See per-snapshot configuration options](https://www.browserstack.com/docs/percy/take-percy-snapshots/overview#per-snapshot-configuration)

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

## Running Percy on Automate
`percyScreenshot(driver, name, options)` [ needs @percy/cli 1.27.0-beta.0+ ];

This is an example test using the `percyScreenshot` method.

```javascript
const { Builder } = require('selenium-webdriver');
const { percyScreenshot } = require('@percy/selenium-webdriver'); // both for selenium-webdriver/wdio

(async function example() {
const driver = new webdriver.Builder().usingServer('https://hub-cloud.browserstack.com/wd/hub').withCapabilities(capabilities).build(); // pass automate capabilities

  try {
    await driver.get('http://google.com/');
    await percyScreenshot(driver, 'Screenshot 1');

    await driver.get('http://example.com/');
    await percyScreenshot(driver, 'Screenshot 2');
  } finally {
    await driver.quit();
  }
})();
```

- `driver` (**required**) - A Selenium driver instance
- `name` (**required**) - The screenshot name; must be unique to each screenshot
- `options` (**optional**) - There are various options supported by percyScreenshot to server further functionality.
    - `sync` - Boolean value by default it falls back to `false`, Gives the processed result around screenshot [From CLI v1.28.0-beta.0+]
    - `fullPage` - Boolean value by default it falls back to `false`, Takes full page screenshot [From CLI v1.27.6+]
    - `freezeAnimatedImage` - Boolean value by default it falls back to `false`, you can pass `true` and percy will freeze image based animations.
    - `freezeImageBySelectors` - List of selectors. Images will be freezed which are passed using selectors. For this to work `freezeAnimatedImage` must be set to true.
    - `freezeImageByXpaths` - List of xpaths. Images will be freezed which are passed using xpaths. For this to work `freezeAnimatedImage` must be set to true.
    - `percyCSS` - Custom CSS to be added to DOM before the screenshot being taken. Note: This gets removed once the screenshot is taken.
    - `ignoreRegionXpaths` - List of xpaths. elements in the DOM can be ignored using xpath
    - `ignoreRegionSelectors` - List of selectors. elements in the DOM can be ignored using selectors.
    - `ignoreRegionSeleniumElements` - List of selenium web-element. elements can be ignored using selenium_elements.
    - `customIgnoreRegions` - List of custom objects. elements can be ignored using custom boundaries. Just passing a simple object for it like below.
      - example: ```{top: 10, right: 10, bottom: 120, left: 10}```
      - In above example it will draw rectangle of ignore region as per given coordinates.
        - `top` (int): Top coordinate of the ignore region.
        - `bottom` (int): Bottom coordinate of the ignore region.
        - `left` (int): Left coordinate of the ignore region.
        - `right` (int): Right coordinate of the ignore region.
    - `considerRegionXpaths` - List of xpaths. elements in the DOM can be considered for diffing and will be ignored by Intelli Ignore using xpaths.
    - `considerRegionSelectors` - List of selectors. elements in the DOM can be considered for diffing and will be ignored by Intelli Ignore using selectors.
    - `considerRegionSeleniumElements` - List of selenium web-element. elements can be considered for diffing and will be ignored by Intelli Ignore using selenium_elements.
    - `customConsiderRegions` - List of custom objects. elements can be considered for diffing and will be ignored by Intelli Ignore using custom boundaries
      - example:  ```{top: 10, right: 10, bottom: 120, left: 10}```
      - In above example it will draw rectangle of consider region will be drawn.
      - Parameters:
        - `top` (int): Top coordinate of the consider region.
        - `bottom` (int): Bottom coordinate of the consider region.
        - `left` (int): Left coordinate of the consider region.
        - `right` (int): Right coordinate of the consider region.
    - `regions` parameter that allows users to apply snapshot options to specific areas of the page. This parameter is an array where each object defines a custom region with configurations.
      - Parameters:
       - `elementSelector` (optional, only one of the following must be provided, if this is not provided then full page will be considered as region)
            - `boundingBox` (object): Defines the coordinates and size of the region.
              - `x` (number): X-coordinate of the region.
              - `y` (number): Y-coordinate of the region.
              - `width` (number): Width of the region.
              - `height` (number): Height of the region.
            - `elementXpath` (string): The XPath selector for the element.
            - `elementCSS` (string): The CSS selector for the element.

        - `algorithm` (mandatory)
            - Specifies the snapshot comparison algorithm.
            - Allowed values: `standard`, `layout`, `ignore`, `intelliignore`.

        - `configuration` (required for `standard` and `intelliignore` algorithms, ignored otherwise)
            - `diffSensitivity` (number): Sensitivity level for detecting differences.
            - `imageIgnoreThreshold` (number): Threshold for ignoring minor image differences.
            - `carouselsEnabled` (boolean): Whether to enable carousel detection.
            - `bannersEnabled` (boolean): Whether to enable banner detection.
            - `adsEnabled` (boolean): Whether to enable ad detection.

         - `assertion` (optional)
            - Defines assertions to apply to the region.
            - `diffIgnoreThreshold` (number): The threshold for ignoring minor differences.

### Example Usage for regions

```
const obj1 = {
  elementSelector: {
    elementCSS: ".ad-banner" 
  },
  algorithm: "intelliignore", 
  configuration: {
    diffSensitivity: 2,
    imageIgnoreThreshold: 0.2,
    carouselsEnabled: true,
    bannersEnabled: true,
    adsEnabled: true
  },
  assertion: {
    diffIgnoreThreshold: 0.4,
  }
};

// we can use the createRegion function
const { createRegion } = percySnapshot;

const obj2 = createRegion({
  algorithm: "intelliignore",
  diffSensitivity: 3,
  adsEnabled: true,
  diffIgnoreThreshold: 0.4
});

percySnapshot(page, "Homepage 1", { regions: [obj1,obj2] });
```

### Creating Percy on automate build
Note: Automate Percy Token starts with `auto` keyword. The command can be triggered using `exec` keyword.
```sh-session
$ export PERCY_TOKEN=[your-project-token]
$ percy exec -- [js test command]
[percy] Percy has started!
[percy] [Javascript example] : Starting automate screenshot ...
[percy] Screenshot taken "Javascript example"
[percy] Stopping percy...
[percy] Finalized build #1: https://percy.io/[your-project]
[percy] Done!
```

Refer to docs here: [Percy on Automate](https://www.browserstack.com/docs/percy/integrate/functional-and-visual)
