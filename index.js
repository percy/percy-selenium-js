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
const { By } = require('selenium-webdriver');
const log = utils.logger('selenium-webdriver');
const CS_MAX_SCREENSHOT_LIMIT = 25000;
const SCROLL_DEFAULT_SLEEP_TIME = 0.45; // 450ms

// ----------------------------------------------------------------------------
// Inlined helpers — these mirror percy-nightwatch/lib/snapshot.js. Once
// @percy/sdk-utils publishes shared versions we can delete these.
// ----------------------------------------------------------------------------
const DEFAULT_MAX_FRAME_DEPTH = 5;

function isUnsupportedIframeSrc(src) {
  if (!src) return true;
  if (
    src === 'about:blank' ||
    src === 'about:srcdoc' ||
    src.startsWith('about:') ||
    src.startsWith('javascript:') ||
    src.startsWith('data:') ||
    src.startsWith('vbscript:') ||
    src.startsWith('blob:') ||
    src.startsWith('chrome:') ||
    src.startsWith('chrome-extension:')
  ) return true;
  return false;
}

function clampFrameDepth(d) {
  const n = Number(d);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_FRAME_DEPTH;
  if (n > 20) return 20; // safety upper bound
  return Math.floor(n);
}

function normalizeIgnoreSelectors(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.filter(s => typeof s === 'string' && s.length);
  if (typeof input === 'string') return [input]; // `!input` above already catches empty string
  return [];
}

function resolveMaxFrameDepth(options = {}, utilsRef) {
  return clampFrameDepth(
    options.maxIframeDepth ??
    utilsRef?.percy?.config?.snapshot?.maxIframeDepth ??
    DEFAULT_MAX_FRAME_DEPTH
  );
}

function resolveIgnoreSelectors(options = {}, utilsRef) {
  return normalizeIgnoreSelectors(
    options.ignoreIframeSelectors ??
    utilsRef?.percy?.config?.snapshot?.ignoreIframeSelectors ??
    []
  );
}

function getOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function shouldSkipIframe(meta, currentOrigin, logger) {
  if (meta.dataPercyIgnore) {
    logger?.debug?.(`Skipping iframe marked with data-percy-ignore: ${meta.src || '(no src)'}`);
    return true;
  }
  if (meta.matchesIgnoreSelector) {
    logger?.debug?.(`Skipping iframe matching ignoreIframeSelectors: ${meta.src || '(no src)'}`);
    return true;
  }
  if (!meta.src || isUnsupportedIframeSrc(meta.src)) {
    if (meta.src) logger?.debug?.(`Skipping unsupported iframe src: ${meta.src}`);
    return true;
  }
  if (meta.srcdoc) {
    logger?.debug?.(`Skipping srcdoc iframe at index ${meta.index}`);
    return true;
  }
  const frameOrigin = getOrigin(meta.src);
  if (!frameOrigin) {
    logger?.debug?.(`Skipping iframe with invalid URL: ${meta.src}`);
    return true;
  }
  if (frameOrigin === currentOrigin) {
    logger?.debug?.(`Skipping same-origin iframe: ${meta.src}`);
    return true;
  }
  if (!meta.percyElementId) {
    logger?.debug?.(`Skipping cross-origin iframe without data-percy-element-id: ${meta.src}`);
    return true;
  }
  return false;
}

/* eslint-disable no-undef */
// In-browser script — must be self-contained. Returns metadata for every
// iframe in the current document. Called both at top-level and inside each
// frame after switching context. Executed by Selenium in the browser, never
// in Node, so nyc cannot instrument it.
/* istanbul ignore next: browser-executed code */
function enumerateIframesScript(selectors) {
  const iframes = document.querySelectorAll('iframe');
  const result = [];
  for (let i = 0; i < iframes.length; i++) {
    const frame = iframes[i];
    let matchesIgnore = false;
    if (selectors && selectors.length) {
      for (let j = 0; j < selectors.length; j++) {
        try { if (frame.matches(selectors[j])) { matchesIgnore = true; break; } } catch (e) { /* invalid selector — ignore */ }
      }
    }
    result.push({
      src: frame.src || '',
      srcdoc: frame.getAttribute('srcdoc'),
      percyElementId: frame.getAttribute('data-percy-element-id'),
      dataPercyIgnore: frame.hasAttribute('data-percy-ignore'),
      matchesIgnoreSelector: matchesIgnore,
      index: i
    });
  }
  return result;
}
/* eslint-enable no-undef */

// Switch into a single iframe (located by its data-percy-element-id) and
// recursively capture its DOM plus any cross-origin descendants up to
// maxFrameDepth. Cycle-guarded via ancestorUrls.
async function processFrameTree(driver, meta, depth, ancestorUrls, ctx) {
  const { maxFrameDepth, ignoreSelectors, options, percyDOMScript } = ctx;

  /* istanbul ignore if: defensive guard — the caller's `depth < maxFrameDepth`
     check at line 214 prevents this from being reachable in practice. */
  if (depth > maxFrameDepth) {
    log.debug(`Reached max iframe nesting depth (${maxFrameDepth}); stopping at ${meta.src}`);
    return [];
  }
  if (ancestorUrls && ancestorUrls.has(meta.src)) {
    log.debug(`Skipping cyclic iframe (${meta.src} appears in ancestor chain)`);
    return [];
  }

  const collected = [];
  let switchedIn = false;
  let capturedError = null;

  try {
    log.debug(`Processing cross-origin iframe (depth ${depth}): ${meta.src}`);

    const frameElement = await driver.findElement(
      By.css(`iframe[data-percy-element-id="${meta.percyElementId}"]`)
    );
    if (!frameElement) {
      log.debug(`Could not find iframe with data-percy-element-id="${meta.percyElementId}"`);
      return [];
    }

    await driver.switchTo().frame(frameElement);
    switchedIn = true;

    await driver.executeScript(percyDOMScript);

    // Post-switch URL re-check: when the navigation fails (cross-origin error,
    // network failure, blocked frame), the iframe's document context lands on
    // about:blank or about:srcdoc — the element's src attribute can't see this.
    /* istanbul ignore next: no instrumenting injected code */
    const frameUrl = await driver.executeScript(function() { return document.URL; });
    if (frameUrl && isUnsupportedIframeSrc(frameUrl)) {
      log.debug(`Skipping iframe whose document loaded an unsupported URL: ${frameUrl}`);
      return [];
    }
    // The element's src attribute may differ from the resolved document URL
    // (redirects, location.replace, etc). Re-check the ancestor chain against
    // the post-switch URL so we don't recurse into a frame whose document
    // already appears higher in the chain.
    if (frameUrl && ancestorUrls && ancestorUrls.has(frameUrl)) {
      log.debug(`Skipping cyclic iframe (post-switch URL ${frameUrl} appears in ancestor chain)`);
      return [];
    }

    /* istanbul ignore next: no instrumenting injected code */
    const iframeSnapshot = await driver.executeScript(async function(opts) {
      /* eslint-disable-next-line no-undef */
      return await PercyDOM.serialize(opts);
    }, { ...options, enableJavaScript: true });

    if (!iframeSnapshot) {
      log.debug(`Serialization returned empty result for frame: ${meta.src}`);
      return [];
    }

    log.debug(`Captured cross-origin iframe (depth ${depth}): ${frameUrl || meta.src}`);

    collected.push({
      frameUrl: frameUrl || meta.src,
      iframeData: { percyElementId: meta.percyElementId },
      iframeSnapshot
    });

    // Enumerate nested iframes (still inside this frame's context) and recurse.
    // Compare origins against the IMMEDIATE parent (this frame), not the top page.
    if (depth < maxFrameDepth) {
      const currentOrigin = getOrigin(frameUrl || meta.src);
      const childrenRaw = await driver.executeScript(enumerateIframesScript, ignoreSelectors);
      const children = Array.isArray(childrenRaw) ? childrenRaw : [];
      // captureCorsIframes always passes a Set([currentUrl]) — the `|| []`
      // fallback only protects against internal-API callers passing nothing.
      /* istanbul ignore next */
      const nextAncestors = new Set(ancestorUrls || []);
      nextAncestors.add(meta.src);
      if (frameUrl) nextAncestors.add(frameUrl);
      for (const child of children) {
        if (shouldSkipIframe(child, currentOrigin, log)) continue;
        const nested = await processFrameTree(driver, child, depth + 1, nextAncestors, ctx);
        if (nested.length) collected.push(...nested);
      }
    }

    return collected;
  } catch (error) {
    if (error && error.percyContextLost) {
      if (Array.isArray(error.partialCapture) && error.partialCapture.length) {
        collected.push(...error.partialCapture);
      }
      error.partialCapture = collected;
      throw error;
    }
    log.debug(`Failed to process cross-origin iframe ${meta.src}: ${error.message}`);
    capturedError = error;
    return collected;
  } finally {
    if (switchedIn) {
      // Selenium's switchTo() lacks a reliable parentFrame in all drivers, so we
      // restore to defaultContent at the top level (depth === 1) and signal
      // percyContextLost at deeper levels so the outer caller can abort sibling
      // iteration (whose enumeration was performed in a now-lost context).
      try {
        if (depth === 1) {
          await driver.switchTo().defaultContent();
        } else if (typeof driver.switchTo().parentFrame === 'function') {
          await driver.switchTo().parentFrame();
        } else {
          await driver.switchTo().defaultContent();
        }
      } catch (e) {
        log.debug(`Failed to switch back to parent frame: ${e.message}`);
        try { await driver.switchTo().defaultContent(); } catch (_) {}
        if (depth > 1) {
          const err = new Error(`Lost parent frame context: ${e.message}`);
          err.percyContextLost = true;
          err.partialCapture = collected;
          if (capturedError) err.cause = capturedError;
          // eslint-disable-next-line no-unsafe-finally
          throw err;
        }
      }
    }
  }
}

async function captureCorsIframes(driver, currentUrl, options, percyDOMScript) {
  const ignoreSelectors = resolveIgnoreSelectors(options, utils);
  const maxFrameDepth = resolveMaxFrameDepth(options, utils);
  const ctx = { maxFrameDepth, ignoreSelectors, options, percyDOMScript };

  try {
    const metaListRaw = await driver.executeScript(enumerateIframesScript, ignoreSelectors);
    const metaList = Array.isArray(metaListRaw) ? metaListRaw : [];
    if (!metaList.length) return [];

    log.debug(`Found ${metaList.length} top-level iframe(s)`);

    const pageOrigin = getOrigin(currentUrl);
    const corsIframes = [];
    let skippedCount = 0;

    for (const meta of metaList) {
      if (shouldSkipIframe(meta, pageOrigin, log)) {
        skippedCount++;
        continue;
      }
      let entries;
      try {
        entries = await processFrameTree(driver, meta, 1, new Set([currentUrl]), ctx);
      } catch (error) {
        // `error.percyContextLost` is always true here in practice — processFrameTree
        // only re-throws context-lost errors from its own catch. The leading
        // `error && ...` guard exists for forward-compat if that contract changes.
        if (error && error.percyContextLost) {
          log.debug('Aborting further nested CORS capture due to lost frame context');
          // `error.partialCapture` always contains at least the outer frame
          // (processFrameTree pushes itself to `collected` before recursing,
          // and sets `error.partialCapture = collected` in its own catch), so
          // the falsy arm of this guard is not reachable from normal flow.
          /* istanbul ignore else */
          if (Array.isArray(error.partialCapture) && error.partialCapture.length) {
            corsIframes.push(...error.partialCapture);
          }
          break;
        }
        /* istanbul ignore next: defensive — processFrameTree only re-throws
           when error.percyContextLost is true; all other errors are caught and
           returned inside its own catch. This rethrow exists for forward
           compatibility if that contract ever changes. */
        throw error;
      }
      if (entries && entries.length) corsIframes.push(...entries);
    }

    log.debug(`Captured ${corsIframes.length} cross-origin iframe(s) (top-level skipped: ${skippedCount})`);
    return corsIframes;
  } catch (error) {
    log.debug(`Error during cross-origin iframe processing: ${error.message}`);
    return [];
  }
}

// Use CDP to discover closed shadow roots and expose them to PercyDOM.serialize.
// Closed shadow roots are inaccessible from JS (element.shadowRoot === null), but
// CDP's DOM domain can pierce them. We resolve each to a JS object handle and
// store it in window.__percyClosedShadowRoots (a WeakMap keyed by host element).
async function exposeClosedShadowRoots(driver) {
  // Some drivers (e.g. Appium-based BrowserStack Automate) only expose
  // sendAndGetDevToolsCommand; others expose sendDevToolsCommand; some both.
  // We need at least one to walk the CDP DOM.
  if (
    typeof driver?.sendDevToolsCommand !== 'function' &&
    typeof driver?.sendAndGetDevToolsCommand !== 'function'
  ) return;

  // Prefer sendAndGetDevToolsCommand (returns the result); fall back to
  // sendDevToolsCommand. The selected function must be invoked through a
  // single, awaited call — earlier code split the ternary across the await,
  // which let the *unresolved Promise* be destructured as `{ root }` and
  // silently dropped the closed-shadow-DOM capture path.
  const cdp = typeof driver.sendAndGetDevToolsCommand === 'function'
    ? driver.sendAndGetDevToolsCommand.bind(driver)
    : driver.sendDevToolsCommand.bind(driver);

  try {
    await cdp('DOM.enable', {});

    const { root } = (await cdp('DOM.getDocument', { depth: -1, pierce: true })) || {};

    if (!root) {
      log.debug('CDP DOM.getDocument returned no root; skipping closed shadow root capture');
      return;
    }

    const closedPairs = [];
    function walk(node) {
      if (!node) return;
      // Skip nodes inside child frame documents — cross-frame closed shadow
      // roots are not yet supported (their execution context lacks the WeakMap).
      if (node.contentDocument) return;
      if (node.shadowRoots) {
        for (const sr of node.shadowRoots) {
          if (sr.shadowRootType === 'closed') {
            closedPairs.push({
              hostBackendNodeId: node.backendNodeId,
              shadowBackendNodeId: sr.backendNodeId
            });
          }
          walk(sr);
        }
      }
      if (node.children) {
        for (const c of node.children) walk(c);
      }
    }
    walk(root);

    if (!closedPairs.length) return;

    log.debug(`Found ${closedPairs.length} closed shadow root(s), exposing via CDP`);

    // Create the WeakMap on the page
    /* istanbul ignore next: browser-executed code */
    await driver.executeScript(function() {
      /* eslint-disable-next-line no-undef */
      window.__percyClosedShadowRoots = window.__percyClosedShadowRoots || new WeakMap();
    });

    for (const pair of closedPairs) {
      const hostResp = await cdp('DOM.resolveNode', { backendNodeId: pair.hostBackendNodeId });
      const shadowResp = await cdp('DOM.resolveNode', { backendNodeId: pair.shadowBackendNodeId });

      const hostObjectId = hostResp?.object?.objectId;
      const shadowObjectId = shadowResp?.object?.objectId;
      if (!hostObjectId || !shadowObjectId) continue;

      const cmd = {
        functionDeclaration: 'function(shadowRoot) { window.__percyClosedShadowRoots = window.__percyClosedShadowRoots || new WeakMap(); window.__percyClosedShadowRoots.set(this, shadowRoot); }',
        objectId: hostObjectId,
        arguments: [{ objectId: shadowObjectId }]
      };
      await cdp('Runtime.callFunctionOn', cmd);
    }
  } catch (err) {
    // Non-fatal — closed shadow DOM just won't be captured (e.g. non-Chromium)
    log.debug(`Could not expose closed shadow roots via CDP: ${err.message}`);
  }
}

async function changeWindowDimensionAndWait(driver, width, height, resizeCount) {
  try {
    const caps = await driver.getCapabilities();
    if (typeof driver?.sendDevToolsCommand === 'function' && caps.getBrowserName() === 'chrome' && process.env.PERCY_DISABLE_CDP_RESIZE !== 'true') {
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
      return await driver.executeScript('return window.resizeCount') === resizeCount;
    }, 1000);
  } catch (e) {
    log.debug(`Timed out waiting for window resize event for width ${width}`, e);
  }
}

function isResponsiveMinHeightEnabled() {
  const envVar = process.env.PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT ||
                 process.env.RESONSIVE_CAPTURE_MIN_HEIGHT;
  return envVar?.toLowerCase() === 'true';
}
// Captures responsive DOM snapshots across different widths
async function captureResponsiveDOM(driver, options) {
  const widthHeights = await utils.getResponsiveWidths(options.widths || []);
  const domSnapshots = [];
  const windowSize = await driver.manage().window().getRect();
  let currentWidth = windowSize.width; let currentHeight = windowSize.height;
  let lastWindowWidth = currentWidth;
  let resizeCount = 0;
  // Setup the resizeCount listener if not present
  /* istanbul ignore next: no instrumenting injected code */
  await driver.executeScript('PercyDOM.waitForResize()');
  let defaultHeight = currentHeight;
  if (isResponsiveMinHeightEnabled()) {
    defaultHeight = utils.percy?.config?.snapshot?.minHeight;
  }
  for (let { width, height } of widthHeights) {
    height = height || defaultHeight;
    if (lastWindowWidth !== width) {
      resizeCount++;
      await changeWindowDimensionAndWait(driver, width, height, resizeCount);
      lastWindowWidth = width;
    }

    if (process.env.PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE?.toLowerCase() === 'true') {
      await driver.navigate().refresh();
      await driver.executeScript(await utils.fetchPercyDOM());
      // Re-prime closed shadow root WeakMap — refresh creates a new execution context
      await exposeClosedShadowRoots(driver);
    }

    if (process.env.RESPONSIVE_CAPTURE_SLEEP_TIME) {
      await new Promise(resolve => setTimeout(resolve, parseInt(process.env.RESPONSIVE_CAPTURE_SLEEP_TIME) * 1000));
    }

    if (process.env.PERCY_ENABLE_LAZY_LOADING_SCROLL?.toLowerCase() === 'true') {
      await module.exports.slowScrollToBottom(driver);
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
  // Fetch the script once at the start of serialization
  const percyDOMScript = await utils.fetchPercyDOM();

  // Expose closed shadow roots via CDP (Chromium only) before serialization so
  // PercyDOM.serialize can find them in window.__percyClosedShadowRoots.
  //
  // Skip when the snapshot won't be serialized locally — `deferUploads` defers
  // all DOM work to the CLI's later snapshot phase. Running CDP here would be
  // wasted I/O and (more importantly) mutates page state on a snapshot the SDK
  // does not actually upload. Mirrors `isResponsiveDOMCaptureValid`'s gating.
  if (!isClosedShadowRootsExposureSkipped(options)) {
    await exposeClosedShadowRoots(driver);
  }

  /* istanbul ignore next */
  let { domSnapshot } = await driver.executeScript(async (options) => ({
    /* eslint-disable-next-line no-undef */
    domSnapshot: await PercyDOM.serialize(options)
  }), {
    ...options,
    ignoreCanvasSerializationErrors: ignoreCanvasSerializationErrors(options),
    ignoreStyleSheetSerializationErrors: ignoreStyleSheetSerializationErrors(options)
  });

  if (!domSnapshot) domSnapshot = {};

  try {
    const currentUrl = await driver.getCurrentUrl();
    const corsIframes = await captureCorsIframes(driver, currentUrl, options || {}, percyDOMScript);
    if (corsIframes.length > 0) {
      domSnapshot.corsIframes = corsIframes;
    }
  } catch (e) {
    log.debug(`Error during cross-origin iframe processing: ${e.message}`);
  }
  /* istanbul ignore next */
  domSnapshot.cookies = await driver.manage().getCookies() || [];
  return domSnapshot;
}

function ignoreCanvasSerializationErrors(options) {
  return options?.ignoreCanvasSerializationErrors ??
         utils.percy?.config?.snapshot?.ignoreCanvasSerializationErrors ??
         false;
}

function ignoreStyleSheetSerializationErrors(options) {
  return options?.ignoreStyleSheetSerializationErrors ??
         utils.percy?.config?.snapshot?.ignoreStyleSheetSerializationErrors ??
         false;
}

function isResponsiveDOMCaptureValid(options) {
  if (utils.percy?.config?.percy?.deferUploads) {
    log.error('Responsive capture disabled: deferUploads is true'); // <-- ADD THIS
    return false;
  }
  return (
    options?.responsive_snapshot_capture ||
    options?.responsiveSnapshotCapture ||
    utils.percy?.config?.snapshot?.responsiveSnapshotCapture ||
    false
  );
}

// Closed-shadow-root exposure runs CDP commands that walk the live DOM and
// mutate `window.__percyClosedShadowRoots`. When `deferUploads` is true the
// CLI serializes the DOM later from its own context — running this here is
// both wasted work and an unwanted side effect on the page. Skip in that case.
// Options-level `deferUploads` is honoured first so callers can override the
// global config per-snapshot, matching the existing options-then-config order
// used elsewhere in this file.
function isClosedShadowRootsExposureSkipped(options) {
  if (options?.deferUploads === true) return true;
  if (utils.percy?.config?.percy?.deferUploads) return true;
  return false;
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

const createRegion = function({
  boundingBox = null,
  elementXpath = null,
  elementCSS = null,
  padding = null,
  algorithm = 'ignore',
  diffSensitivity = null,
  imageIgnoreThreshold = null,
  carouselsEnabled = null,
  bannersEnabled = null,
  adsEnabled = null,
  diffIgnoreThreshold = null
} = {}) {
  const elementSelector = {};
  if (boundingBox) elementSelector.boundingBox = boundingBox;
  if (elementXpath) elementSelector.elementXpath = elementXpath;
  if (elementCSS) elementSelector.elementCSS = elementCSS;

  const region = {
    algorithm,
    elementSelector
  };

  if (padding) {
    region.padding = padding;
  }

  const configuration = {};
  if (['standard', 'intelliignore'].includes(algorithm)) {
    if (diffSensitivity !== null) configuration.diffSensitivity = diffSensitivity;
    if (imageIgnoreThreshold !== null) configuration.imageIgnoreThreshold = imageIgnoreThreshold;
    if (carouselsEnabled !== null) configuration.carouselsEnabled = carouselsEnabled;
    if (bannersEnabled !== null) configuration.bannersEnabled = bannersEnabled;
    if (adsEnabled !== null) configuration.adsEnabled = adsEnabled;
  }

  if (Object.keys(configuration).length > 0) {
    region.configuration = configuration;
  }

  const assertion = {};
  if (diffIgnoreThreshold !== null) {
    assertion.diffIgnoreThreshold = diffIgnoreThreshold;
  }

  if (Object.keys(assertion).length > 0) {
    region.assertion = assertion;
  }

  return region;
};

// Take a DOM snapshot and post it to the snapshot endpoint
const percySnapshot = async function percySnapshot(driver, name, options) {
  if (!driver) throw new Error('An instance of the selenium driver object is required.');
  if (!name) throw new Error('The `name` argument is required.');
  if (!(await module.exports.isPercyEnabled())) {
    if (process.env.PERCY_RAISE_ERROR === 'true') {
      throw new Error('Percy is not running, disabling snapshots.');
    } else {
      return;
    }
  }
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
    if (process.env.PERCY_RAISE_ERROR === 'true') {
      throw error;
    }
  }
};

module.exports = percySnapshot;
module.exports.percySnapshot = percySnapshot;
module.exports.createRegion = createRegion;

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
  if (!(await module.exports.isPercyEnabled())) {
    if (process.env.PERCY_RAISE_ERROR === 'true') {
      throw new Error('Percy is not running, disabling snapshots.');
    } else {
      return;
    }
  }
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
    if (process.env.PERCY_RAISE_ERROR === 'true') {
      throw error;
    }
  }
};

// jasmine cannot mock individual functions, hence adding isPercyEnabled to the exports object
// also need to define this at the end of the file or else default exports will over-ride this
module.exports.isPercyEnabled = async function isPercyEnabled() {
  return await utils.isPercyEnabled();
};

module.exports.slowScrollToBottom = async (driver, scrollSleep = SCROLL_DEFAULT_SLEEP_TIME) => {
  if (process.env.PERCY_LAZY_LOAD_SCROLL_TIME) {
    scrollSleep = parseFloat(process.env.PERCY_LAZY_LOAD_SCROLL_TIME);
  }

  const scrollHeightCommand = 'return Math.max(document.body.scrollHeight, document.body.clientHeight, document.body.offsetHeight, document.documentElement.scrollHeight, document.documentElement.clientHeight, document.documentElement.offsetHeight);';
  let scrollHeight = Math.min(await driver.executeScript(scrollHeightCommand), CS_MAX_SCREENSHOT_LIMIT);
  const clientHeight = await driver.executeScript('return document.documentElement.clientHeight');
  let current = 0;

  let page = 1;
  // Break the loop if maximum scroll height 25000px is reached
  while (scrollHeight > current && current < CS_MAX_SCREENSHOT_LIMIT) {
    current = clientHeight * page;
    page += 1;
    await driver.executeScript(`window.scrollTo(0, ${current})`);
    await new Promise(resolve => setTimeout(resolve, scrollSleep * 1000));

    // Recalculate scroll height for dynamically loaded pages
    scrollHeight = await driver.executeScript(scrollHeightCommand);
  }
  // Get back to top
  if (!(process.env.BYPASS_SCROLL_TO_TOP === 'true')) {
    await driver.executeScript('window.scrollTo(0, 0)');
  }
  let sleepAfterScroll = 1;
  if (process.env.PERCY_SLEEP_AFTER_LAZY_LOAD_COMPLETE) {
    sleepAfterScroll = parseFloat(process.env.PERCY_SLEEP_AFTER_LAZY_LOAD_COMPLETE);
  }
  await new Promise(resolve => setTimeout(resolve, sleepAfterScroll * 1000));
};

// Internal helpers exported for testing
module.exports._internals = {
  isUnsupportedIframeSrc,
  clampFrameDepth,
  normalizeIgnoreSelectors,
  resolveMaxFrameDepth,
  resolveIgnoreSelectors,
  getOrigin,
  shouldSkipIframe,
  enumerateIframesScript,
  processFrameTree,
  captureCorsIframes,
  exposeClosedShadowRoots,
  isClosedShadowRootsExposureSkipped,
  DEFAULT_MAX_FRAME_DEPTH
};
