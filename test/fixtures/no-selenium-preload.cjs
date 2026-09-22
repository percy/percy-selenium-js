// Preload shim: makes `selenium-webdriver` (and any subpath) unresolvable, so a
// child process sees the module graph exactly as a consumer that never installs
// Selenium does — e.g. a WebdriverIO project pulling us in via
// @wdio/browserstack-service. selenium-webdriver is a devDependency of this
// package, so it is always present in our own test env; this is the only way to
// reproduce a consumer's tree from inside the suite.
const Module = require('node:module');

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, ...rest) {
  if (request === 'selenium-webdriver' || request.startsWith('selenium-webdriver/')) {
    const err = new Error(`Cannot find module '${request}'`);
    err.code = 'MODULE_NOT_FOUND';
    throw err;
  }
  return originalResolve.call(this, request, ...rest);
};
