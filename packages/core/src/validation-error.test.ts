import { describe, expect, it } from 'vitest';
import { isValidationError } from './validation-error.js';

describe('isValidationError', () => {
    it('returns true for a valid validation error body', () => {
        const body = {
            message: 'Validation failed',
            issues: [{ path: ['name'], message: 'Required' }],
        };
        expect(isValidationError(body)).toBe(true);
    });

    it('returns true even without message (issues is the key field)', () => {
        const body = {
            issues: [{ path: ['email'], message: 'Invalid email' }],
        };
        expect(isValidationError(body)).toBe(true);
    });

    it('returns false for null', () => {
        expect(isValidationError(null)).toBe(false);
    });

    it('returns false for a string', () => {
        expect(isValidationError('error')).toBe(false);
    });

    it('returns false for an object without issues', () => {
        expect(isValidationError({ message: 'Something failed' })).toBe(false);
    });

    it('returns false when issues is not an array', () => {
        expect(isValidationError({ issues: 'not an array' })).toBe(false);
    });
});
