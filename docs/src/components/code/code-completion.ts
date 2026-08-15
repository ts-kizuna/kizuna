import type { Element } from 'hast';
import type { ShikiTransformer } from 'shiki';

export interface CodeCompletion {
    after: string;
    items: string[];
    selected?: string;
}

interface CompletionAnchor {
    line: number;
}

function element(tagName: string, className: string, children: Element['children'] = []): Element {
    return {
        type: 'element',
        tagName,
        properties: {
            className: [className],
        },
        children,
    };
}

function completionItem(label: string, selected: boolean): Element {
    return element('span', selected ? 'kizuna-completion-item kizuna-completion-item-selected' : 'kizuna-completion-item', [
        element('span', 'kizuna-completion-icon'),
        {
            type: 'text',
            value: label,
        },
    ]);
}

function completionPopup({ items, selected }: CodeCompletion): Element {
    return element(
        'span',
        'kizuna-completion',
        items.map((label, index) => completionItem(label, selected ? label === selected : index === 0))
    );
}

function addClass(node: Element, name: string): void {
    const existing = node.properties.className ?? node.properties.class;
    const classes = Array.isArray(existing) ? existing.map(String) : typeof existing === 'string' ? existing.split(' ') : [];
    delete node.properties.class;
    node.properties.className = [...classes, name];
}

export function resolveCompletion(code: string, completion: CodeCompletion): CompletionAnchor | null {
    const line = code.split('\n').findIndex((candidate) => candidate.trimEnd().endsWith(completion.after));
    if (line === -1) return null;
    return {
        line,
    };
}

export function completionTransformer(completion: CodeCompletion, anchor: CompletionAnchor): ShikiTransformer {
    return {
        name: 'kizuna-completion',
        line(node, lineNumber) {
            if (lineNumber - 1 !== anchor.line) return;
            addClass(node, 'kizuna-completion-line');
            node.children.push(
                element('span', 'kizuna-completion-anchor', [element('span', 'kizuna-completion-caret'), completionPopup(completion)])
            );
        },
    };
}
