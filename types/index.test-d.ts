import { expectType, expectError } from 'tsd';
import percySnapshot from '.';

let driver = {}

expectError(percySnapshot());
expectError(percySnapshot('Snapshot name'));

expectType<Promise<void>>(percySnapshot(driver, 'Snapshot name'));
expectType<Promise<void>>(percySnapshot(driver, 'Snapshot name', { widths: [1000] }));

expectError(percySnapshot(driver, 'Snapshot name', { foo: 'bar' }));
