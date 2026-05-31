'use client';

import { type ReactNode, useState, useTransition } from 'react';
import { isValidationError } from '@ts-kizuna/next';
import { createUser, deleteUser } from './actions';

export function AddUserForm() {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [formError, setFormError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function addUser() {
        startTransition(async () => {
            const result = await createUser({
                body: {
                    name,
                    email,
                },
            });

            if (result.ok) {
                setFieldErrors({});
                setFormError(null);
                setName('');
                setEmail('');
                return;
            }

            // Field-level validation: map each Zod issue to its input.
            if (isValidationError(result.error)) {
                const next: Record<string, string> = {};
                for (const issue of result.error.errors) {
                    const field = issue.path[0];
                    if (field && !next[field]) {
                        next[field] = issue.message;
                    }
                }
                setFieldErrors(next);
                setFormError(null);
                return;
            }

            // Any other error status (e.g. 409) — show the Problem Details message.
            setFieldErrors({});
            setFormError(result.error.detail);
        });
    }

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                marginBottom: '1rem',
                maxWidth: '22rem',
            }}>
            <Field label="Name" error={fieldErrors.name}>
                <input value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Email" error={fieldErrors.email}>
                <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
            </Field>
            <button
                type="button"
                onClick={addUser}
                disabled={pending}
                style={{
                    alignSelf: 'flex-start',
                }}>
                Add user
            </button>
            {formError && (
                <p
                    style={{
                        color: '#b00020',
                        margin: 0,
                    }}>
                    {formError}
                </p>
            )}
        </div>
    );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
    return (
        <label
            style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem',
            }}>
            <span>{label}</span>
            {error && (
                <span
                    style={{
                        color: '#b00020',
                        fontSize: '0.85rem',
                    }}>
                    {error}
                </span>
            )}
            {children}
        </label>
    );
}

export function DeleteUserButton({ id }: { id: string }) {
    const [pending, startTransition] = useTransition();

    function remove() {
        startTransition(async () => {
            await deleteUser({
                params: {
                    id,
                },
            });
        });
    }

    return (
        <button type="button" onClick={remove} disabled={pending}>
            Delete
        </button>
    );
}
