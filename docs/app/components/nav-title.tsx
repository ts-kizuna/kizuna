export function NavTitle() {
    return (
        <>
            <img
                src="/favicon-dark.png"
                alt=""
                className="dark:hidden"
                style={{
                    height: '1.25rem',
                    width: 'auto',
                }}
            />
            <img
                src="/favicon-light.png"
                alt=""
                className="hidden dark:block"
                style={{
                    height: '1.25rem',
                    width: 'auto',
                }}
            />
            ts-kizuna
        </>
    );
}
