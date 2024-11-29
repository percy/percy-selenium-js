import { expectType, expectError } from 'tsd';
import percySnapshot, { percyScreenshot } from '.';
let driver = {}

expectError(percySnapshot());
expectError(percySnapshot('Snapshot name'));

expectType<Promise<void | { [key: string]: any }>>(percySnapshot(driver, 'Snapshot name'));
expectType<Promise<void | { [key: string]: any }>>(percySnapshot(driver, 'Snapshot name', { widths: [1000] }));

expectError(percySnapshot(driver, 'Snapshot name', { foo: 'bar' }));

expectError(percyScreenshot());
expectError(percyScreenshot('Snapshot name'));

expectType<Promise<void | { [key: string]: any }>>(percyScreenshot(driver, 'Snapshot name'));
expectType<Promise<void | { [key: string]: any }>>(percyScreenshot(driver, 'Snapshot name', { widths: [1000] }));

expectType<Promise<void | { [key: string]: any }>>(percyScreenshot(driver, 'Snapshot name', { foo: 'bar' }));
