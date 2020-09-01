import { SnapshotOptions } from '@percy/core';
import { WebDriver } from '@types/selenium-webdriver';

export default function percySnapshot(
  browser: WebDriver,
  name: string,
  options?: SnapshotOptions
): Promise<void>;
