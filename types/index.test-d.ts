import { expectType, expectError } from 'tsd';
import { WebDriver } from 'selenium-webdriver';
import percySnapshot from '.';

declare const driver: WebDriver;

expectError(percySnapshot());
expectError(percySnapshot(driver));
expectError(percySnapshot('Snapshot name'));

expectType<Promise<void>>(percySnapshot(driver, 'Snapshot name'));
expectType<Promise<void>>(percySnapshot(driver, 'Snapshot name', { widths: [1000] }));

expectError(percySnapshot(driver, 'Snapshot name', { foo: 'bar' }));
