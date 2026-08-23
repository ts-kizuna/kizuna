import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BinarySchema } from './binary.js';
import { UrlSchema } from './url.js';
import { isBinarySchema, isFileSchema, isUrlSchema } from './zod-internals.js';

describe('isFileSchema', () => {
    it('recognizes z.instanceof(File)', () => {
        expect(isFileSchema(z.instanceof(File))).toBe(true);
    });

    it('recognizes z.file()', () => {
        expect(isFileSchema(z.file())).toBe(true);
    });

    it('rejects other schemas', () => {
        expect(isFileSchema(z.string())).toBe(false);
        expect(isFileSchema(BinarySchema)).toBe(false);
        expect(isFileSchema(UrlSchema)).toBe(false);
        expect(isFileSchema(z.custom(() => true))).toBe(false);
    });
});

describe('isBinarySchema', () => {
    it('recognizes z.instanceof(Uint8Array)', () => {
        expect(isBinarySchema(BinarySchema)).toBe(true);
    });

    it('rejects other schemas', () => {
        expect(isBinarySchema(z.string())).toBe(false);
        expect(isBinarySchema(z.instanceof(File))).toBe(false);
        expect(isBinarySchema(UrlSchema)).toBe(false);
        expect(isBinarySchema(z.custom(() => true))).toBe(false);
    });
});

describe('isUrlSchema', () => {
    it('recognizes z.instanceof(URL)', () => {
        expect(isUrlSchema(UrlSchema)).toBe(true);
    });

    it('rejects other schemas', () => {
        expect(isUrlSchema(z.string())).toBe(false);
        expect(isUrlSchema(z.url())).toBe(false);
        expect(isUrlSchema(z.instanceof(File))).toBe(false);
        expect(isUrlSchema(BinarySchema)).toBe(false);
        expect(isUrlSchema(z.custom(() => true))).toBe(false);
    });
});
