import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { NavTitle } from './components/nav-title';

export const baseOptions: BaseLayoutProps = {
    nav: {
        title: <NavTitle />,
        url: '/docs',
    },
    githubUrl: 'https://github.com/ts-kizuna/kizuna',
};
