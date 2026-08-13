import styles from './about.module.css';

export function About() {
    return (
        <div className={styles.about}>
            <p className={styles.mark} aria-hidden>
                絆
            </p>
            <p className={styles.lead}>
                The goal is simple: define your API once, and keep every client in sync with it, whatever language it is written in.
            </p>
            <p className={styles.body}>
                I built ts-kizuna for the products our team ships: a TypeScript API with a web client and native apps on top of it. Every
                change meant editing the same shapes in several places, and nothing failed loudly. The client just drifted from the server
                until something broke in front of a user. On Swift that happened to us more than once.
            </p>
            <p className={styles.body}>
                <a className={styles.link} href="https://ts-rest.com" target="_blank" rel="noreferrer">
                    ts-rest
                </a>{' '}
                solved the TypeScript half properly. Routes-first, contract-driven, typed on both sides. The research and most of the syntax
                started there, which is why if you know ts-rest you already know most of ts-kizuna.
            </p>
            <p className={styles.body}>
                What it did not cover was everything that was not TypeScript. That is the part ts-kizuna adds: Swift and Kotlin clients
                generated from the same contract, where an endpoint deprecated once in TypeScript arrives as{' '}
                <code className={styles.code}>@available</code> in Xcode and <code className={styles.code}>@Deprecated</code> in Android
                Studio.
            </p>
            <p className={styles.body}>
                MCP came from the same instinct. Every route becomes a typed tool, so assistants can call your API without anyone building
                an integration for them.
            </p>
            <p className={styles.body}>
                The name comes from 絆 (kizuna), a Japanese word for the deep, enduring bonds. It was chosen because the hard part is never
                writing the code, it is keeping everything you built standing as the API underneath it changes. A single contract, bound to
                everything that depends on it, is what makes that possible.
            </p>
            <p className={styles.body}>It solved a real problem for us, and there is a lot more coming. I hope it does the same for you.</p>
        </div>
    );
}
