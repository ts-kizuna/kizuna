/**
 * Writes the message to stderr and exits with the given code.
 */
export const die = (message: string, code = 1): never => {
    process.stderr.write(`${message}\n`);
    process.exit(code);
};
