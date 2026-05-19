export class SwiftWriter {
    private readonly lines: string[] = [];
    private depth = 0;

    line(text = ''): void {
        if (text === '') {
            this.lines.push('');
            return;
        }
        this.lines.push('    '.repeat(this.depth) + text);
    }

    block(opener: string, body: () => void): void {
        this.line(`${opener} {`);
        this.depth += 1;
        body();
        this.depth -= 1;
        this.line('}');
    }

    indent(body: () => void): void {
        this.depth += 1;
        body();
        this.depth -= 1;
    }

    docComment(text: string | undefined): void {
        if (!text) return;
        for (const segment of text.split('\n')) {
            this.line(`/// ${segment}`);
        }
    }

    blank(): void {
        if (this.lines.length === 0) return;
        if (this.lines[this.lines.length - 1] === '') return;
        this.lines.push('');
    }

    toString(): string {
        return this.lines.join('\n').replace(/\n+$/, '') + '\n';
    }
}

export const stringLiteral = (value: string): string => {
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
};

export const pascalCase = (input: string): string => {
    if (!input) return input;
    const cleaned = input.replace(/[^a-zA-Z0-9]+/g, ' ').trim();
    return cleaned
        .split(' ')
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join('');
};

export const camelCase = (input: string): string => {
    const pascal = pascalCase(input);
    if (!pascal) return pascal;
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
};
