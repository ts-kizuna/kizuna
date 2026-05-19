export const metadata = {
    title: 'ts-kizuna Next.js Demo',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body
                style={{
                    margin: 0,
                    fontFamily: 'system-ui',
                }}>
                {children}
            </body>
        </html>
    );
}
