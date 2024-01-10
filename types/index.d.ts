import { SnapshotOptions } from '@percy/core';

export default function percySnapshot(
  browser: any,
  name: string,
  options?: SnapshotOptions
): Promise<void>;

export function percyScreenshot(
  browser: any,
  name: string,
  options?: Object
): Promise<void>;
