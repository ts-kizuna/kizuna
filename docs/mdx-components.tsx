import type { MDXComponents } from 'mdx/types';
import { Popup, PopupContent, PopupTrigger } from 'fumadocs-twoslash/ui';
import { Card, Cards } from 'fumadocs-ui/components/card';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { InstallTabs } from '@/lib/InstallTabs';

export function getMDXComponents(components: MDXComponents): MDXComponents {
    return {
        ...components,
        Popup,
        PopupContent,
        PopupTrigger,
        Card,
        Cards,
        Step,
        Steps,
        InstallTabs,
    };
}
