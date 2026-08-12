import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Logo } from './components/logo';
import logoStyles from './components/logo.module.css';
import { NavTitle } from './components/nav-title';

type NavTitleVariant = 'logo' | 'iconWithText';

const navTitleVariant: NavTitleVariant = 'logo';

const navTitles: Record<NavTitleVariant, React.ReactNode> = {
    logo: <Logo className={logoStyles.navLogo} />,
    iconWithText: <NavTitle />,
};

export const baseOptions: BaseLayoutProps = {
    nav: {
        title: navTitles[navTitleVariant],
        url: '/',
    },
    githubUrl: 'https://github.com/ts-kizuna/kizuna',
};
