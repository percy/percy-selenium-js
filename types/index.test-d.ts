import { expectType, expectError } from 'tsd';
import percySnapshot from '.';
import percyScreenshot from '.';
let driver = {}

expectError(percySnapshot());
expectError(percySnapshot('Snapshot name'));

expectType<Promise<void>>(percySnapshot(driver, 'Snapshot name'));
expectType<Promise<void>>(percySnapshot(driver, 'Snapshot name', { widths: [1000] }));

expectError(percySnapshot(driver, 'Snapshot name', { foo: 'bar' }));

expectError(percyScreenshot());
expectError(percyScreenshot('Snapshot name'));

expectType<Promise<void>>(percyScreenshot(driver, 'Snapshot name'));
expectType<Promise<void>>(percyScreenshot(driver, 'Snapshot name', { widths: [1000] }));

expectError(percyScreenshot(driver, 'Snapshot name', { foo: 'bar' }));
