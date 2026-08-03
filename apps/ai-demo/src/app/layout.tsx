export const metadata = {
    title: 'ts-kizuna AI demo',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body
                style={{
                    margin: 0,
                    fontFamily: 'system-ui, sans-serif',
                    background: '#0f1115',
                    color: '#e6e6e6',
                }}>
                {children}
            </body>
        </html>
    );
}
