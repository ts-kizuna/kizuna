import type { MDXComponents } from 'mdx/types';
import { Popup, PopupContent, PopupTrigger } from 'fumadocs-twoslash/ui';
import { Card, Cards } from 'fumadocs-ui/components/card';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';

import { AdapterTabs } from './adapter-tabs';
import { BetaNotice } from './beta-notice';
import { InstallTabs } from './install-tabs';
import { FeatureList } from './feature-list';

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
        Tab,
        Tabs,
        AdapterTabs,
        BetaNotice,
        InstallTabs,
        FeatureList,
    };
}
