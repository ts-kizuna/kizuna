export class KotlinWriter {
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
        const segments = text.split('\n');
        if (segments.length === 1) {
            this.line(`/** ${segments[0]} */`);
            return;
        }
        this.line('/**');
        for (const segment of segments) {
            this.line(` * ${segment}`);
        }
        this.line(' */');
    }

    blank(): void {
        if (this.lines.length === 0) return;
        if (this.lines[this.lines.length - 1] === '') return;
        this.lines.push('');
    }

    appendToLastLine(suffix: string): void {
        if (this.lines.length > 0) {
            this.lines[this.lines.length - 1] += suffix;
        }
    }

    toString(): string {
        return this.lines.join('\n').replace(/\n+$/, '') + '\n';
    }
}

export const stringLiteral = (value: string): string => {
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
};
