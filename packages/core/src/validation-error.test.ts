import { describe, expect, it } from 'vitest';
import { isValidationError } from './validation-error.js';

describe('isValidationError', () => {
    it('returns true for a valid validation error body', () => {
        const body = {
            detail: 'Validation failed',
            errors: [{ path: ['name'], message: 'Required' }],
        };
        expect(isValidationError(body)).toBe(true);
    });

    it('returns true even without detail (errors is the key field)', () => {
        const body = {
            errors: [{ path: ['email'], message: 'Invalid email' }],
        };
        expect(isValidationError(body)).toBe(true);
    });

    it('returns false for null', () => {
        expect(isValidationError(null)).toBe(false);
    });

    it('returns false for a string', () => {
        expect(isValidationError('error')).toBe(false);
    });

    it('returns false for an object without errors', () => {
        expect(isValidationError({ detail: 'Something failed' })).toBe(false);
    });

    it('returns false when errors is not an array', () => {
        expect(isValidationError({ errors: 'not an array' })).toBe(false);
    });
});
