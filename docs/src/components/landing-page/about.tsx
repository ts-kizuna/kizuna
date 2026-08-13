import styles from './about.module.css';

export function About() {
    return (
        <div className={styles.about}>
            <p className={styles.lead}>The goal is simple: make it impossible to ship a client that has drifted from your API.</p>
            <p className={styles.body}>
                I built ts-kizuna for the products and projects our team ships. Every change to the API meant editing the same shapes in
                several places, and sooner or later you miss one. It drifts until something breaks in front of a user.
            </p>
            <p className={styles.body}>
                On Swift that happened to us more than once, where one renamed field or one new enum value fails the whole decode, and a
                client that does not handle that failure crashes.
            </p>
            <p className={styles.body}>
                <a className={styles.link} href="https://ts-rest.com" target="_blank" rel="noreferrer">
                    ts-rest
                </a>{' '}
                solved the TypeScript half properly. Routes-first, contract-driven, typed on both sides. The research and most of the syntax
                started there, which is why if you know ts-rest you already know most of ts-kizuna.
            </p>
            <p className={styles.body}>
                It stopped at the edge of TypeScript. That is the part ts-kizuna adds: Swift and Kotlin clients generated from the same
                contract, where an endpoint deprecated once in TypeScript arrives as <code className={styles.code}>@available</code> in
                Xcode and <code className={styles.code}>@Deprecated</code> in Android Studio.
            </p>
            <p className={styles.body}>
                The name comes from 絆 (kizuna), a Japanese word for a deep, enduring bond between people. The hard part is keeping
                everything you built standing as the API underneath it changes. One contract, bound to everything that depends on it, is
                what keeps it standing.
            </p>
            <p className={styles.body}>It solved a real problem for us, and there is a lot more coming. I hope it does the same for you.</p>
        </div>
    );
}
