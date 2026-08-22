import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import Logo from '@/icons/Logo.svg';
import logoStyles from '@/components/shared/logo.module.css';
import { NavTitle } from '@/components/shared/nav-title';

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
